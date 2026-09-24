import copy
import logging
import os
import platform
import socket
import threading
import time
from pathlib import Path

import psutil

from .config import zerotier_addresses
from .disks import mounted_disks, scan_disk_users, scan_roots, username
from .hardware import collect_hardware, os_summary
from .integrations import import_apc_events, read_docker, read_ups

log = logging.getLogger(__name__)


def counter_rate(current, previous, elapsed):
    return max(0, current - previous) / elapsed if previous is not None and elapsed > 0 else 0


class Collector:
    def __init__(self, config, store):
        self.config, self.store = config, store
        self.stop_event = threading.Event()
        self.lock = threading.RLock()
        self.latest = None
        self.system = os_summary()
        self.hardware = {"state": "pending", "collected_at": None}
        self.aux = {"ups": {"available": False, "state": "unknown", "error": "正在连接 UPS"},
                    "docker": {"available": False, "containers": [], "error": "正在连接 Docker"}}
        self.disk_scan = store.get_state("disk_scan", {"state": "pending", "users": {}, "roots": scan_roots(config.disk_roots)})
        self.scan_progress = None
        self.errors = {}
        self.previous_processes = {}
        self.previous_network = {}
        self.previous_io = None
        self.previous_time = None
        self.cpu_count = psutil.cpu_count() or 1
        self.threads = []

    def start(self):
        now = int(time.time())
        boot_id_path = Path("/proc/sys/kernel/random/boot_id")
        boot_id = boot_id_path.read_text().strip() if boot_id_path.exists() else str(psutil.boot_time())
        previous = self.store.get_state("lifecycle")
        if previous and previous.get("boot_id") != boot_id:
            self.store.event(now, "reboot", "检测到系统重启；重启原因未确认，请结合 UPS 日志判断。", severity="warning")
        elif previous and not previous.get("clean_shutdown"):
            self.store.event(now, "monitor_gap", "监控进程上次未正常结束；采集缺口不代表发生断电。", severity="warning")
        self.store.set_state("lifecycle", {"boot_id": boot_id, "clean_shutdown": False})
        self.store.event(now, "monitor_start", "监控服务启动，开始记录资源使用情况。")
        for target, name in ((self._sample_loop, "resources"), (self._aux_loop, "integrations"), (self._disk_loop, "disk-scan"), (self._hardware_loop, "hardware")):
            thread = threading.Thread(target=target, name=name, daemon=True)
            thread.start()
            self.threads.append(thread)

    def stop(self):
        self.stop_event.set()
        for thread in self.threads:
            thread.join(timeout=20)
        state = self.store.get_state("lifecycle", {})
        state["clean_shutdown"] = True
        self.store.set_state("lifecycle", state)

    def hardware_snapshot(self):
        with self.lock:
            return copy.deepcopy(self.hardware)

    def _hardware_loop(self):
        while not self.stop_event.is_set():
            try:
                inventory = collect_hardware()
                with self.lock:
                    self.hardware = inventory
            except Exception:
                log.exception("Hardware inventory failed")
                with self.lock:
                    self.hardware = {**self.hardware, "state": "error"}
            self.stop_event.wait(3600)

    def snapshot(self):
        with self.lock:
            return copy.deepcopy({**(self.latest or {}), **self.aux, "disk_scan": self.disk_scan,
                                  "scan_progress": self.scan_progress, "collector_errors": self.errors})

    def _users(self, elapsed):
        users, current, denied, io_denied = {}, {}, 0, 0
        for process in psutil.process_iter():
            try:
                with process.oneshot():
                    uid = process.uids().real
                    key = (process.pid, process.create_time())
                    cpu = process.cpu_times()
                    cpu_time = cpu.user + cpu.system
                    rss = process.memory_info().rss
                io = None
                try:
                    io = process.io_counters()
                except psutil.AccessDenied:
                    io_denied += 1
                prior = self.previous_processes.get(key)
                row = users.setdefault(str(uid), {"name": username(uid), "uid": uid, "cpu": 0,
                                                  "memory": 0, "read": 0, "write": 0, "processes": 0, "io_denied": 0})
                row["cpu"] += counter_rate(cpu_time, prior[0] if prior else None, elapsed) * 100 / self.cpu_count
                row["memory"] += rss
                row["processes"] += 1
                row["io_denied"] += int(io is None)
                if io:
                    row["read"] += counter_rate(io.read_bytes, prior[1] if prior else None, elapsed)
                    row["write"] += counter_rate(io.write_bytes, prior[2] if prior else None, elapsed)
                current[key] = (cpu_time, io.read_bytes if io else None, io.write_bytes if io else None)
            except psutil.AccessDenied:
                denied += 1
            except (psutil.NoSuchProcess, psutil.ZombieProcess):
                continue
        self.previous_processes = current
        return users, {"processes_denied": denied, "process_io_denied": io_denied, "root": os.geteuid() == 0}

    def sample(self):
        now, mono = int(time.time()), time.monotonic()
        elapsed = mono - self.previous_time if self.previous_time else 0
        cores = psutil.cpu_percent(percpu=True)
        memory, swap = psutil.virtual_memory(), psutil.swap_memory()
        users, permissions = self._users(elapsed)
        interfaces, counters = {}, psutil.net_io_counters(pernic=True)
        addresses = psutil.net_if_addrs()
        for name, counter in counters.items():
            old = self.previous_network.get(name)
            interfaces[name] = {"name": name,
                                "rx": counter_rate(counter.bytes_recv, old.bytes_recv if old else None, elapsed),
                                "tx": counter_rate(counter.bytes_sent, old.bytes_sent if old else None, elapsed),
                                "rx_total": counter.bytes_recv, "tx_total": counter.bytes_sent,
                                "errors": counter.errin + counter.errout, "drops": counter.dropin + counter.dropout,
                                "addresses": [a.address for a in addresses.get(name, []) if a.family == socket.AF_INET]}
        physical = [v for k, v in interfaces.items() if k != "lo" and not k.startswith(("veth", "docker", "br-", "zt", "tun", "tap", "wg"))]
        io = psutil.disk_io_counters(perdisk=True)
        disk_read = disk_write = 0
        # Count devices backing displayed mounts; omit loop/virtual/parent duplicates.
        disks = mounted_disks()
        device_names = {Path(os.path.realpath(d["device"])).name for d in disks}
        for name in device_names:
            counter = io.get(name)
            old = (self.previous_io or {}).get(name)
            if counter:
                disk_read += counter_rate(counter.read_bytes, old.read_bytes if old else None, elapsed)
                disk_write += counter_rate(counter.write_bytes, old.write_bytes if old else None, elapsed)
        temperatures = []
        try:
            for chip, sensors in psutil.sensors_temperatures().items():
                for sensor in sensors:
                    temperatures.append({"chip": chip, "name": sensor.label or chip, "current": sensor.current,
                                         "high": sensor.high, "critical": sensor.critical})
        except (AttributeError, OSError):
            pass
        cpu_temps = [x["current"] for x in temperatures if x["chip"] in ("coretemp", "k10temp", "cpu_thermal")]
        package_temps = [x["current"] for x in temperatures if "Package" in x["name"] or x["name"] == "Tctl"]
        temperature = max(package_temps or cpu_temps) if package_temps or cpu_temps else None
        with self.lock:
            ups = copy.deepcopy(self.aux["ups"])
            docker = copy.deepcopy(self.aux["docker"])
        point = {"ts": now, "cpu": sum(cores) / len(cores) if cores else 0,
                 "memory_used": memory.total - memory.available, "memory_total": memory.total,
                 "disk_used": sum(d["used"] for d in disks), "disk_total": sum(d["total"] for d in disks),
                 "rx": sum(v["rx"] for v in physical), "tx": sum(v["tx"] for v in physical),
                 "disk_read": disk_read, "disk_write": disk_write, "temperature": temperature,
                 "ups_charge": ups.get("charge") if ups.get("available") else None,
                 "containers": {c["id"]: {"name": c["name"], "cpu": c.get("cpu"), "memory": c.get("memory_bytes"), "state": c["state"]}
                                for c in docker.get("containers", [])},
                 "users": users, "networks": {k: {"name": k, "rx": v["rx"], "tx": v["tx"]} for k, v in interfaces.items()},
                 "disks": {d["mount"]: {"used": d["used"], "total": d["total"]} for d in disks}}
        latest = {**point, "hostname": socket.gethostname(), "platform": platform.platform(),
                  "system": self.system, "cpu_count": self.cpu_count, "cores": cores, "memory_percent": memory.percent,
                  "memory_available": memory.available, "memory_cached": getattr(memory, "cached", 0),
                  "swap_used": swap.used, "swap_total": swap.total, "disks": disks, "networks": interfaces,
                  "temperatures": temperatures, "uptime": now - psutil.boot_time(), "boot_time": psutil.boot_time(),
                  "load": list(os.getloadavg()), "permissions": permissions, "interval": self.config.interval,
                  "zerotier_ips": zerotier_addresses(), "network_total_interfaces": [v["name"] for v in physical]}
        self.store.add_point(point)
        self.previous_network, self.previous_io, self.previous_time = counters, io, mono
        with self.lock:
            self.latest = latest
        return latest

    def _sample_loop(self):
        psutil.cpu_percent(percpu=True)
        cleanup_at = 0
        while not self.stop_event.is_set():
            started = time.monotonic()
            try:
                self.sample()
                with self.lock:
                    self.errors.pop("resources", None)
                if started >= cleanup_at:
                    self.store.cleanup(self.config.raw_retention_days, self.config.history_retention_days)
                    cleanup_at = started + 3600
            except Exception as exc:
                log.exception("Resource collection failed")
                with self.lock:
                    self.errors["resources"] = str(exc)
            self.stop_event.wait(max(0.1, self.config.interval - (time.monotonic() - started)))

    def _aux_loop(self):
        previous = self.store.get_state("ups_state")
        imported_signature = None
        container_states = self.store.get_state("container_states")
        while not self.stop_event.is_set():
            try:
                ups = read_ups(self.config)
                event_file = Path(self.config.events_file)
                try:
                    info = event_file.stat()
                    signature = (info.st_ino, info.st_size, info.st_mtime_ns)
                    if signature != imported_signature:
                        import_apc_events(event_file, self.store)
                        imported_signature = signature
                except OSError:
                    pass
                state = ups.get("state")
                # apcupsd's own event log distinguishes a self-test from a power failure.
                # For NUT or inaccessible APC logs, record only the observation, not its cause.
                if state in ("online", "battery"):
                    if state != previous and (previous is not None or state == "battery"):
                        if ups.get("backend") != "apcupsd" or imported_signature is None:
                            kind = "on_battery" if state == "battery" else "power_restored"
                            message = "UPS 切换为电池供电（可能包含自检，请结合 UPS 日志确认原因）。" if state == "battery" else "UPS 恢复市电供电。"
                            self.store.event(time.time(), kind, message, "UPS 实时状态", "warning" if state == "battery" else "success")
                    previous = state
                    self.store.set_state("ups_state", state)
                with self.lock:
                    self.aux["ups"] = ups
                docker = read_docker(self.cpu_count)
                if docker.get("available"):
                    current_states = {c["id"]: {"name": c["name"], "state": c["state"]} for c in docker["containers"]}
                    if container_states is not None:
                        for cid in set(current_states) | set(container_states):
                            before, after = container_states.get(cid), current_states.get(cid)
                            if before != after:
                                row = after or before
                                label = after["state"] if after else "removed"
                                self.store.event(time.time(), "container_change", f"{row['name']}: {label}", "Docker", "info")
                    container_states = current_states
                    self.store.set_state("container_states", current_states)
                with self.lock:
                    self.aux["docker"] = docker
                    self.errors.pop("integrations", None)
            except Exception as exc:
                log.exception("Integration collection failed")
                with self.lock:
                    self.errors["integrations"] = str(exc)
            self.stop_event.wait(10)

    def _disk_loop(self):
        def progress(result):
            with self.lock:
                self.scan_progress = copy.deepcopy(result)

        while not self.stop_event.is_set():
            last = self.disk_scan.get("finished_at", 0) or 0
            if self.disk_scan.get("collector_uid", self.store.path.stat().st_uid) != os.geteuid():
                last = 0
            delay = last + self.config.disk_scan_interval - time.time()
            if delay > 0 and self.stop_event.wait(delay):
                break
            try:
                roots = scan_roots(self.config.disk_roots)
                progress({"state": "scanning", "roots": roots, "files": 0, "users": {}, "errors": 0})
                result = scan_disk_users(roots, self.stop_event, progress)
                if result["state"] == "cancelled":
                    break
                self.store.save_scan(result)
                with self.lock:
                    self.disk_scan, self.scan_progress = result, None
                    self.errors.pop("disk_scan", None)
            except Exception as exc:
                log.exception("Disk scan failed")
                with self.lock:
                    self.scan_progress = None
                    self.errors["disk_scan"] = str(exc)
                self.stop_event.wait(60)

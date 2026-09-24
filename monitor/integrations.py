import datetime as dt
import json
import re
import shutil
import subprocess
import time
from pathlib import Path


def command(args, timeout=6):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError((result.stderr.strip() or result.stdout.strip() or "命令执行失败")[:300])
    return result.stdout


def number(value):
    match = re.search(r"[-+]?\d+(?:\.\d+)?", str(value or ""))
    return float(match[0]) if match else None


def parse_ups(text, backend):
    values = dict(line.split(":", 1) for line in text.splitlines() if ":" in line)
    values = {k.strip(): v.strip() for k, v in values.items()}
    apc = backend == "apcupsd"
    raw = values.get("STATUS" if apc else "ups.status", "")
    tokens = set(raw.split())
    if not raw or tokens.intersection({"COMMLOST", "NOCOMM", "SHUTDOWN"}):
        state = "unknown"
    elif tokens.intersection({"ONBATT", "OB"}):
        state = "battery"
    elif tokens.intersection({"ONLINE", "OL"}):
        state = "online"
    else:
        state = "unknown"
    runtime = number(values.get("TIMELEFT" if apc else "battery.runtime"))
    return {"available": state != "unknown", "backend": backend, "state": state, "raw_status": raw,
            "model": values.get("MODEL" if apc else "ups.model", "UPS"),
            "charge": number(values.get("BCHARGE" if apc else "battery.charge")),
            "runtime_seconds": runtime * 60 if apc and runtime is not None else runtime,
            "load": number(values.get("LOADPCT" if apc else "ups.load")),
            "voltage": number(values.get("LINEV" if apc else "input.voltage")),
            "battery_voltage": number(values.get("BATTV" if apc else "battery.voltage")),
            "transfer_reason": values.get("LASTXFER", ""),
            "self_test": values.get("SELFTEST", "NO") not in ("NO", "OK", "", "NG"),
            "updated_at": int(time.time()),
            "error": None if state != "unknown" else "UPS 状态不可用或通信中断"}


def read_ups(config):
    if config.ups_backend == "disabled":
        return {"available": False, "state": "unknown", "error": "UPS 采集已关闭", "updated_at": int(time.time())}
    errors = []
    backends = ["apcupsd", "nut"] if config.ups_backend == "auto" else [config.ups_backend]
    for backend in backends:
        try:
            if backend == "apcupsd":
                tool = shutil.which("apcaccess") or ("/usr/sbin/apcaccess" if Path("/usr/sbin/apcaccess").exists() else None)
                if not tool:
                    raise RuntimeError("未安装 apcaccess")
                return parse_ups(command([tool, "status", config.apcupsd_target]), backend)
            if backend == "nut":
                if not shutil.which("upsc"):
                    raise RuntimeError("未安装 upsc")
                target = config.nut_target
                if not target:
                    names = command(["upsc", "-l", "localhost"]).splitlines()
                    if not names:
                        raise RuntimeError("未发现 NUT UPS")
                    target = names[0] + "@localhost"
                return parse_ups(command(["upsc", target]), backend)
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
            errors.append(f"{backend}: {exc}")
    return {"available": False, "state": "unknown", "error": "; ".join(errors), "updated_at": int(time.time())}


def classify_apc_event(message):
    lower = message.lower()
    if "self test" in lower or "self-test" in lower:
        return "self_test", "info"
    if "power failure" in lower:
        return "power_failure", "critical"
    if "power is back" in lower or "mains returned" in lower:
        return "power_restored", "success"
    if "running on ups batteries" in lower:
        return "on_battery", "warning"
    if "shutdown" in lower or "limit on batteries" in lower:
        return "shutdown", "warning"
    if "communication" in lower:
        return "ups_communication", "info" if "restored" in lower else "warning"
    return "ups_event", "info"


def import_apc_events(path, store):
    p = Path(path)
    if not p.exists():
        return 0
    with p.open("rb") as file:
        file.seek(max(0, p.stat().st_size - 262144))
        lines = file.read().decode("utf-8", errors="replace").splitlines()
    count = 0
    for line in lines:
        match = re.match(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d{4})\s+(.+)$", line)
        if not match:
            continue
        stamp, message = match.groups()
        try:
            ts = int(dt.datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S %z").timestamp())
        except ValueError:
            continue
        kind, severity = classify_apc_event(message)
        store.event(ts, kind, message, "apcupsd 日志", severity)
        count += 1
    return count


def parse_size(value):
    match = re.match(r"([0-9.]+)\s*([A-Za-z]+)", str(value or ""))
    if not match:
        return None
    amount, unit = match.groups()
    powers = {"B": 1, "kB": 1000, "KB": 1000, "MB": 1000**2, "GB": 1000**3,
              "TB": 1000**4, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4}
    return float(amount) * powers[unit] if unit in powers else None


def read_docker(cpu_count):
    try:
        rows = [json.loads(line) for line in command(["docker", "ps", "-a", "--format", "{{json .}}"], 8).splitlines() if line]
        running = [r["ID"] for r in rows if r.get("State") == "running"]
        stats, stats_error = {}, None
        if running:
            try:
                for line in command(["docker", "stats", "--no-stream", "--format", "{{json .}}", *running], 12).splitlines():
                    item = json.loads(line)
                    stats[item["ID"]] = item
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                stats_error = str(exc)[:300]
        containers = []
        for row in rows:
            item = stats.get(row["ID"], {})
            cpu = number(item.get("CPUPerc"))
            labels = dict(x.split("=", 1) for x in row.get("Labels", "").split(",") if "=" in x)
            containers.append({"id": row["ID"], "name": row["Names"], "image": row["Image"],
                               "state": row["State"], "status": row["Status"],
                               "project": labels.get("com.docker.compose.project", "—"),
                               "cpu": cpu / cpu_count if cpu is not None else None,
                               "memory": item.get("MemUsage"), "memory_bytes": parse_size(item.get("MemUsage")), "memory_percent": number(item.get("MemPerc")),
                               "net_io": item.get("NetIO"), "block_io": item.get("BlockIO"),
                               "pids": item.get("PIDs"), "ports": row.get("Ports", "")})
        return {"available": True, "containers": containers, "stats_error": stats_error, "updated_at": int(time.time())}
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
        return {"available": False, "containers": [], "error": str(exc)[:300], "updated_at": int(time.time())}

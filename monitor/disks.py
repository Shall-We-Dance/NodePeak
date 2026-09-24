import os
import pwd
import stat
import time
from pathlib import Path

import psutil


def username(uid):
    try:
        return pwd.getpwuid(uid).pw_name
    except KeyError:
        return str(uid)


def mounted_disks():
    disks, seen = [], set()
    for item in psutil.disk_partitions(all=False):
        if item.fstype in {"squashfs", "overlay", "tmpfs", "devtmpfs", "iso9660"}:
            continue
        if item.mountpoint.startswith(("/snap/", "/var/lib/docker/", "/var/snap/")):
            continue
        try:
            identity = os.stat(item.mountpoint).st_dev
            if identity in seen:
                continue
            used = psutil.disk_usage(item.mountpoint)
            seen.add(identity)
            disks.append({"device": item.device, "mount": item.mountpoint, "fstype": item.fstype,
                          "total": used.total, "used": used.used, "free": used.free, "percent": used.percent})
        except OSError:
            continue
    return disks


def scan_roots(configured):
    roots = []
    for root in configured:
        if root == "auto":
            roots.extend(["/home"] + [d["mount"] for d in mounted_disks()
                                      if d["mount"] != "/" and not d["mount"].startswith(("/boot", "/run", "/var/"))])
        else:
            roots.append(str(Path(root).absolute()))
    return sorted(set(roots), key=lambda x: (x != "/home", x))


def scan_disk_users(roots, stop, progress=None):
    """Count allocated blocks by file UID, without following symlinks or mounts.

    Only hardlinked files need an inode set. Directory traversal tracks visited
    directories to avoid overlapping configured roots being counted twice.
    """
    result = {"started_at": int(time.time()), "finished_at": None, "roots": roots, "collector_uid": os.geteuid(),
              "users": {}, "files": 0, "errors": 0, "error_examples": [], "state": "scanning"}
    seen_links, seen_dirs = set(), set()
    last_report = time.monotonic()
    for root in roots:
        result["current_root"] = root
        try:
            root_device = os.stat(root).st_dev
        except OSError as exc:
            result["errors"] += 1
            if len(result["error_examples"]) < 8:
                result["error_examples"].append(f"{root}: {exc.strerror}")
            continue
        stack = [root]
        while stack and not stop.is_set():
            directory = stack.pop()
            try:
                directory_stat = os.lstat(directory)
                identity = (directory_stat.st_dev, directory_stat.st_ino)
                if identity in seen_dirs or stat.S_ISLNK(directory_stat.st_mode):
                    continue
                seen_dirs.add(identity)
                with os.scandir(directory) as entries:
                    for entry in entries:
                        if stop.is_set():
                            break
                        try:
                            info = entry.stat(follow_symlinks=False)
                            if info.st_dev != root_device:
                                continue
                            if stat.S_ISDIR(info.st_mode):
                                stack.append(entry.path)
                                continue
                            if not (stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode)):
                                continue
                            if info.st_nlink > 1:
                                identity = (info.st_dev, info.st_ino)
                                if identity in seen_links:
                                    continue
                                seen_links.add(identity)
                            uid = str(info.st_uid)
                            row = result["users"].setdefault(uid, {"name": username(info.st_uid), "bytes": 0, "files": 0, "roots": {}})
                            allocated = info.st_blocks * 512
                            row["bytes"] += allocated
                            row["files"] += 1
                            row["roots"][root] = row["roots"].get(root, 0) + allocated
                            result["files"] += 1
                            if result["files"] % 2000 == 0:
                                stop.wait(0.015)
                        except OSError:
                            result["errors"] += 1
            except OSError as exc:
                result["errors"] += 1
                if len(result["error_examples"]) < 8:
                    result["error_examples"].append(f"{directory}: {exc.strerror}")
            if progress and time.monotonic() - last_report > 2:
                progress(result)
                last_report = time.monotonic()
    result["finished_at"] = int(time.time())
    result["state"] = "cancelled" if stop.is_set() else ("partial" if result["errors"] else "complete")
    result.pop("current_root", None)
    return result

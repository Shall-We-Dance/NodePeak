from dataclasses import dataclass, field
from pathlib import Path
import os
import socket
import tomllib

import psutil

ROOT = Path(__file__).resolve().parent.parent


def zerotier_addresses():
    return [a.address for name, addrs in psutil.net_if_addrs().items()
            if name.startswith("zt") for a in addrs if a.family == socket.AF_INET]


@dataclass
class Config:
    host: str = "auto"
    port: int = 9100
    interval: int = 5
    raw_retention_days: int = 2
    history_retention_days: int = 90
    disk_scan_interval: int = 21600
    disk_roots: list = field(default_factory=lambda: ["auto"])
    ups_backend: str = "auto"
    nut_target: str = ""
    apcupsd_target: str = "127.0.0.1:3551"
    events_file: str = "/var/log/apcupsd.events"
    data_dir: Path = field(default_factory=lambda: ROOT / "data")

    @classmethod
    def load(cls):
        path = Path(os.environ.get("MONITOR_CONFIG", ROOT / "config.toml"))
        raw = tomllib.loads(path.read_text()) if path.exists() else {}
        obj = cls(**{**raw.get("server", {}), **raw.get("monitor", {}),
                     **{("ups_backend" if k == "backend" else k): v
                        for k, v in raw.get("ups", {}).items()}})
        obj.data_dir = Path(os.environ.get("MONITOR_DATA_DIR", obj.data_dir))
        if not 2 <= obj.interval <= 60:
            raise ValueError("monitor.interval 必须在 2–60 秒之间")
        if obj.raw_retention_days < 1 or obj.history_retention_days < obj.raw_retention_days:
            raise ValueError("历史保留天数必须不少于原始数据保留天数，且至少 1 天")
        if obj.disk_scan_interval < 300:
            raise ValueError("disk_scan_interval 必须至少 300 秒")
        if obj.host == "auto":
            obj.host = next(iter(zerotier_addresses()), "127.0.0.1")
        return obj

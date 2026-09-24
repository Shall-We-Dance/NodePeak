import json
import os
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from monitor.app import create_app
from monitor.collector import counter_rate
from monitor.config import Config
from monitor.disks import scan_disk_users
from monitor.integrations import classify_apc_event, import_apc_events, parse_size, parse_ups
from monitor.storage import Store, average_points


def point(ts, cpu=20, users=None):
    return {"ts": ts, "cpu": cpu, "memory_used": 100, "memory_total": 1000,
            "disk_used": 100, "disk_total": 1000, "rx": 10, "tx": 20,
            "disk_read": 30, "disk_write": 40, "temperature": None, "ups_charge": None,
            "users": users or {}, "networks": {}, "disks": {}}


def test_rates_ignore_reset_and_first_sample():
    assert counter_rate(150, 100, 5) == 10
    assert counter_rate(10, 150, 5) == 0
    assert counter_rate(150, None, 5) == 0
    assert counter_rate(150, 100, 0) == 0


def test_average_zero_for_departed_users_but_null_for_missing_sensors():
    a = point(100, 10, {"1000": {"name": "alice", "cpu": 20, "memory": 100}})
    b = point(105, 30)
    a["containers"] = {"abc": {"name": "db", "cpu": None, "memory": None, "state": "exited"}}
    result = average_points([a, b])
    assert result["cpu"] == 20
    assert result["users"]["1000"]["cpu"] == 10
    assert result["users"]["1000"]["memory"] == 50
    assert result["temperature"] is None
    assert result["containers"]["abc"]["cpu"] is None


def test_persistence_rollup_and_in_progress_tail(tmp_path):
    store = Store(tmp_path / "db.sqlite")
    for ts, cpu in [(3600, 10), (3605, 30), (3660, 50), (7200, 70)]:
        store.add_point(point(ts, cpu))
    reopened = Store(store.path)
    raw = reopened.history(3600, 7300)
    assert len(raw["points"]) == 4
    minute = reopened.history(0, 22000)
    assert [p["cpu"] for p in minute["points"]] == [20, 50, 70]
    hour = reopened.history(0, 200000)
    assert [p["cpu"] for p in hour["points"]] == [35, 70]


def test_old_short_window_uses_retained_minutes(tmp_path):
    store = Store(tmp_path / "db.sqlite")
    for ts in [3600, 3605, 3660, 7200]:
        store.add_point(point(ts))
    with store.connect() as db:
        db.execute("DELETE FROM metrics WHERE resolution=0 AND ts<7200")
    result = store.history(3600, 3700)
    assert len(result["points"]) == 2
    assert result["resolution"] == 60


def test_retention_keeps_events_and_summaries(tmp_path, monkeypatch):
    store = Store(tmp_path / "db.sqlite")
    store.add_point(point(100))
    store.add_point(point(200))
    store.event(100, "power_failure", "Power failure")
    monkeypatch.setattr("monitor.storage.time.time", lambda: 4 * 86400)
    store.cleanup(2, 90)
    with store.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM metrics WHERE resolution=0").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM metrics WHERE resolution=60").fetchone()[0] == 1
    assert len(store.events()) == 1


@pytest.mark.parametrize("text,kind", [
    ("Power failure.", "power_failure"),
    ("UPS Self Test switch to battery.", "self_test"),
    ("Power is back. UPS running on mains.", "power_restored"),
    ("Running on UPS batteries.", "on_battery"),
    ("Initiating system shutdown!", "shutdown")])
def test_self_tests_are_not_power_failures(text, kind):
    assert classify_apc_event(text)[0] == kind


def test_ups_units_and_unavailable_status():
    apc = parse_ups("STATUS : ONLINE\nBCHARGE : 100.0 Percent\nTIMELEFT : 51 Minutes\nMODEL : Back-UPS", "apcupsd")
    assert apc["charge"] == 100
    assert apc["runtime_seconds"] == 3060
    assert apc["state"] == "online"
    nut = parse_ups("ups.status: OB LB\nbattery.runtime: 120\nbattery.charge: 20", "nut")
    assert nut["runtime_seconds"] == 120
    assert nut["state"] == "battery"
    assert not parse_ups("STATUS: COMMLOST\nBCHARGE: 100", "apcupsd")["available"]
    assert parse_ups("", "nut")["charge"] is None


def test_import_is_idempotent_and_keeps_timezone(tmp_path):
    path = tmp_path / "apcupsd.events"
    path.write_text("2026-08-19 10:21:29 -0400  Power failure.\n2026-09-16 22:49:03 -0400  UPS Self Test switch to battery.\n")
    store = Store(tmp_path / "db.sqlite")
    import_apc_events(path, store)
    import_apc_events(path, store)
    assert len(store.events()) == 2
    assert store.events(kind="power_failure")[0]["ts"] == 1787149289


def test_disk_scan_hardlinks_symlinks_and_overlapping_roots(tmp_path):
    root = tmp_path / "files"
    root.mkdir()
    sub = root / "sub"
    sub.mkdir()
    file = sub / "payload"
    file.write_bytes(b"x" * 8192)
    os.link(file, root / "hardlink")
    os.symlink(sub, root / "symlink")
    result = scan_disk_users([str(root), str(sub)], threading.Event())
    assert result["state"] == "complete"
    assert result["files"] == 2  # one regular file + the symlink itself
    row = result["users"][str(os.getuid())]
    assert row["bytes"] == file.stat().st_blocks * 512 + (root / "symlink").lstat().st_blocks * 512
    assert sum(row["roots"].values()) == row["bytes"]


def test_docker_memory_units():
    assert parse_size("1.5GiB / 125GiB") == 1.5 * 1024**3
    assert parse_size("50MB / 1GB") == 50 * 1000**2
    assert parse_size(None) is None


def test_api_validation_static_assets_and_empty_state(tmp_path):
    config = Config(data_dir=tmp_path, disk_roots=[str(tmp_path)])
    with TestClient(create_app(config, run_collector=False)) as client:
        assert client.get("/").status_code == 200
        assert client.get("/static/app.js").status_code == 200
        assert client.get("/health").json()["status"] == "starting"
        assert client.get("/api/live").status_code == 503
        assert client.get("/api/history?start=100&end=1").status_code == 400
        assert client.get("/api/history?start=1&end=999999999999").status_code == 400
        assert client.get("/api/events?limit=100000").status_code == 422
        response = client.get("/api/history?start=1&end=100")
        assert response.json()["points"] == []
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/static/../config.toml").status_code == 404

import hashlib
import json
import sqlite3
import threading
import time
from collections import defaultdict
from contextlib import contextmanager


def average_points(points):
    """Absent users/interfaces contribute zero; unavailable sensors remain null."""
    if not points:
        return None
    result = {"ts": points[-1]["ts"]}
    scalar_keys = ("cpu", "memory_used", "memory_total", "disk_used", "disk_total",
                   "rx", "tx", "disk_read", "disk_write", "temperature", "ups_charge")
    for key in scalar_keys:
        values = [p[key] for p in points if p.get(key) is not None]
        result[key] = sum(values) / len(values) if values else None
    for group, metrics in (("users", ("cpu", "memory", "read", "write")),
                           ("networks", ("rx", "tx"))):
        merged = {}
        for p in points:
            for key, item in p.get(group, {}).items():
                row = merged.setdefault(key, {"name": item.get("name", key)})
                for metric in metrics:
                    row[metric] = row.get(metric, 0) + (item.get(metric) or 0) / len(points)
        result[group] = merged
    # Container failures/stopped states are unknown values, not zero usage.
    containers = {}
    ids = {key for p in points for key in p.get("containers", {})}
    for key in ids:
        entries = [p["containers"][key] for p in points if key in p.get("containers", {})]
        containers[key] = {"name": entries[-1]["name"], "state": entries[-1].get("state")}
        for metric in ("cpu", "memory"):
            values = [e[metric] for e in entries if e.get(metric) is not None]
            containers[key][metric] = sum(values) / len(values) if values else None
    result["containers"] = containers
    # Filesystem occupancy changes slowly; retain the latest actual measurement.
    result["disks"] = points[-1].get("disks", {})
    return result


class Store:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.lock = threading.RLock()
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS metrics (
                    resolution INTEGER NOT NULL, ts INTEGER NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY (resolution, ts)
                );
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL,
                    severity TEXT NOT NULL, message TEXT NOT NULL, source TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_ts ON events(ts DESC);
                CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS disk_scans (ts INTEGER PRIMARY KEY, payload TEXT NOT NULL);
            """)
            row = db.execute("SELECT MAX(ts) FROM metrics WHERE resolution=0").fetchone()
        self.last_ts = row[0]

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.execute("PRAGMA busy_timeout=15000")
        try:
            with db:
                yield db
        finally:
            db.close()

    def get_state(self, key, default=None):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM state WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_state(self, key, value):
        with self.lock, self.connect() as db:
            db.execute("INSERT OR REPLACE INTO state VALUES (?,?)", (key, json.dumps(value)))

    def event(self, ts, kind, message, source="monitor", severity="info", identity=None):
        event_id = identity or hashlib.sha256(f"{ts}|{kind}|{source}|{message}".encode()).hexdigest()
        with self.lock, self.connect() as db:
            db.execute("INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?)",
                       (event_id, int(ts), kind, severity, message, source))

    def events(self, limit=100, before=None, kind=None):
        clauses, args = [], []
        if before is not None:
            clauses.append("ts < ?")
            args.append(before)
        if kind:
            clauses.append("kind = ?")
            args.append(kind)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            return [dict(r) for r in db.execute(
                "SELECT * FROM events" + where + " ORDER BY ts DESC, id DESC LIMIT ?", (*args, limit))]

    def add_point(self, point):
        ts = int(point["ts"])
        with self.lock, self.connect() as db:
            db.execute("INSERT OR REPLACE INTO metrics VALUES (0,?,?)", (ts, json.dumps(point)))
            if self.last_ts is not None and ts // 60 != self.last_ts // 60:
                start = self.last_ts // 60 * 60
                self._rollup(db, 0, 60, start, start + 60)
                if ts // 3600 != self.last_ts // 3600:
                    start = self.last_ts // 3600 * 3600
                    self._rollup(db, 60, 3600, start, start + 3600)
            self.last_ts = ts

    @staticmethod
    def _rollup(db, source, target, start, end):
        rows = db.execute("SELECT payload FROM metrics WHERE resolution=? AND ts>=? AND ts<? ORDER BY ts",
                          (source, start, end)).fetchall()
        point = average_points([json.loads(r[0]) for r in rows])
        if point:
            db.execute("INSERT OR REPLACE INTO metrics VALUES (?,?,?)", (target, int(point["ts"]), json.dumps(point)))

    def history(self, start, end, max_points=600):
        span = end - start
        resolution = 0 if span <= 10800 else (60 if span <= 172800 else 3600)
        with self.connect() as db:
            oldest = db.execute("SELECT MIN(ts) FROM metrics WHERE resolution=0").fetchone()[0]
            if resolution == 0 and (oldest is None or start < oldest):
                older = db.execute("SELECT 1 FROM metrics WHERE resolution=60 AND ts BETWEEN ? AND ? LIMIT 1", (start, (oldest - 1) if oldest is not None else end)).fetchone()
                if older:
                    resolution = 60
            rows = db.execute("SELECT payload FROM metrics WHERE resolution=? AND ts BETWEEN ? AND ? ORDER BY ts",
                              (resolution, start, end)).fetchall()
            points = [json.loads(r[0]) for r in rows]
            # Include the in-progress minute/hour, without duplicating finalized buckets.
            if resolution:
                tail_start = max(start, (int(points[-1]["ts"]) // resolution + 1) * resolution if points else start)
                source = 0 if resolution == 60 else 60
                tail = db.execute("SELECT payload FROM metrics WHERE resolution=? AND ts BETWEEN ? AND ? ORDER BY ts",
                                  (source, tail_start, end)).fetchall()
                if source == 60:
                    last = json.loads(tail[-1][0])["ts"] if tail else tail_start - 1
                    raw_start = max(tail_start, (int(last) // 60 + 1) * 60)
                    raw = db.execute("SELECT payload FROM metrics WHERE resolution=0 AND ts BETWEEN ? AND ? ORDER BY ts",
                                     (raw_start, end)).fetchall()
                    if raw:
                        tail.append((json.dumps(average_points([json.loads(r[0]) for r in raw])),))
                buckets = defaultdict(list)
                for row in tail:
                    p = json.loads(row[0])
                    buckets[int(p["ts"]) // resolution].append(p)
                points.extend(average_points(items) for items in buckets.values())
        stride = max(1, (len(points) + max_points - 1) // max_points)
        # Do not average across a gap in collection.
        sampled, batch = [], []
        base_resolution = max(resolution, 5)
        for point in points:
            if batch and (len(batch) >= stride or point["ts"] - batch[-1]["ts"] > base_resolution * 2.5):
                sampled.append(average_points(batch))
                batch = []
            batch.append(point)
        if batch:
            sampled.append(average_points(batch))
        return {"points": sampled, "resolution": base_resolution * stride, "start": start, "end": end}

    def save_scan(self, scan):
        with self.lock, self.connect() as db:
            db.execute("INSERT OR REPLACE INTO disk_scans VALUES (?,?)", (int(scan["finished_at"]), json.dumps(scan)))
        self.set_state("disk_scan", scan)

    def disk_history(self, start, end):
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM disk_scans WHERE ts BETWEEN ? AND ? ORDER BY ts", (start, end)).fetchall()
        return [json.loads(r[0]) for r in rows]

    def cleanup(self, raw_days, history_days):
        now = time.time()
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM metrics WHERE resolution=0 AND ts<?", (now - raw_days * 86400,))
            db.execute("DELETE FROM metrics WHERE resolution>0 AND ts<?", (now - history_days * 86400,))
            db.execute("DELETE FROM disk_scans WHERE ts<?", (now - history_days * 86400,))
            db.execute("PRAGMA optimize")

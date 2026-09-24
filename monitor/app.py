import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .collector import Collector
from .config import Config, ROOT
from .storage import Store


def create_app(config=None, run_collector=True):
    config = config or Config.load()
    store = Store(config.data_dir / "monitor.sqlite3")
    collector = Collector(config, store)

    @asynccontextmanager
    async def lifespan(app):
        if run_collector:
            collector.start()
        yield
        if run_collector:
            collector.stop()

    app = FastAPI(title="NodePeek", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.collector = collector
    app.state.store = store
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.middleware("http")
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/")
    def index():
        return FileResponse(ROOT / "static/index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/health")
    def health():
        live = collector.snapshot()
        age = time.time() - live.get("ts", 0)
        return {"status": "ok" if age <= config.interval * 3 else "starting" if not live.get("ts") else "stale",
                "last_sample": live.get("ts")}

    @app.get("/api/hardware")
    def hardware():
        return collector.hardware_snapshot()

    @app.get("/api/live")
    def live():
        snapshot = collector.snapshot()
        if not snapshot.get("ts"):
            raise HTTPException(503, "正在采集第一组数据，请稍候")
        snapshot["stale"] = time.time() - snapshot["ts"] > config.interval * 3
        return snapshot

    def window(start, end):
        end = int(time.time()) if end is None else end
        start = end - 3600 if start is None else start
        if start >= end or end - start > config.history_retention_days * 86400:
            raise HTTPException(400, f"时间范围须大于 0 且不超过 {config.history_retention_days} 天")
        return start, end

    @app.get("/api/history")
    def history(start: int | None = None, end: int | None = None, points: int = Query(600, ge=20, le=1200)):
        start, end = window(start, end)
        result = store.history(start, end, points)
        if result["resolution"] == 5:
            result["resolution"] = config.interval
        result["raw_retention_days"] = config.raw_retention_days
        result["history_retention_days"] = config.history_retention_days
        return result

    @app.get("/api/disk-history")
    def disk_history(start: int | None = None, end: int | None = None):
        start, end = window(start, end)
        return {"scans": store.disk_history(start, end)}

    @app.get("/api/events")
    def events(limit: int = Query(100, ge=1, le=1000), before: int | None = None, kind: str | None = None):
        return {"events": store.events(limit, before, kind)}

    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
    return app

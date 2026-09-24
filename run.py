#!/usr/bin/env python3
import argparse
import logging
import os

import uvicorn

from monitor.app import create_app
from monitor.config import Config
from monitor.version import VERSION, EDITION


def main():
    parser = argparse.ArgumentParser(description="NodePeek — Linux resource monitoring over HTTP")
    parser.add_argument("--host", help="监听地址，默认自动发现 ZeroTier IP")
    parser.add_argument("--port", type=int, help="HTTP 端口，默认 9100")
    parser.add_argument("--version", action="version", version=f"NodePeek {VERSION} ({EDITION})")
    args = parser.parse_args()
    if EDITION == "user" and os.geteuid() == 0:
        parser.error("User Edition must run as a regular user, without sudo.")
    if EDITION == "admin" and os.geteuid() != 0:
        parser.error("Admin Edition runs as root; use User Edition for an unprivileged installation.")
    config = Config.load()
    if args.host:
        config.host = args.host
    if args.port:
        config.port = args.port
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.info("NodePeek: http://%s:%s", config.host, config.port)
    uvicorn.run(create_app(config), host=config.host, port=config.port, workers=1, access_log=False, proxy_headers=False)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Version local CSS/JS references so HTML cannot mix old and new UI assets."""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def version_assets():
    path = ROOT / 'static/index.html'
    def replace(match):
        prefix, url, suffix = match.groups()
        version = hashlib.sha256((ROOT / url.lstrip('/')).read_bytes()).hexdigest()[:12]
        return f'{prefix}{url}?v={version}{suffix}'
    html = re.sub(r'((?:src|href)=")(/static/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?(\")', replace, path.read_text())
    path.write_text(html)


if __name__ == '__main__':
    version_assets()

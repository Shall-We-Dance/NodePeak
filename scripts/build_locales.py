#!/usr/bin/env python3
"""Validate locale keys/placeholders and bundle the local dictionaries."""
import json
import re
from pathlib import Path
from version_assets import version_assets

ROOT = Path(__file__).resolve().parent.parent
LANGUAGES = ("en", "zh", "ko", "es", "ja")


def main():
    catalogs = {lang: json.loads((ROOT / "static/locales" / f"{lang}.json").read_text()) for lang in LANGUAGES}
    english = catalogs["en"]
    for lang, catalog in catalogs.items():
        if catalog.keys() != english.keys():
            raise ValueError(f"{lang}: missing={english.keys() - catalog.keys()}, extra={catalog.keys() - english.keys()}")
        for key, value in catalog.items():
            if not isinstance(value, str) or not value:
                raise ValueError(f"{lang}: empty translation for {key!r}")
            if set(re.findall(r"\{\w+\}", key)) != set(re.findall(r"\{\w+\}", value)):
                raise ValueError(f"{lang}: placeholder mismatch for {key!r}")
    (ROOT / "static/locales.js").write_text(
        "window.MONITOR_LOCALES = " + json.dumps(catalogs, ensure_ascii=False, separators=(",", ":")) + ";\n")
    version_assets()
    print(f"Validated and bundled {len(english)} keys across {len(LANGUAGES)} languages.")


if __name__ == "__main__":
    main()

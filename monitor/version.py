"""Distribution identity without host-specific metadata."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = (ROOT / 'VERSION').read_text().strip() if (ROOT / 'VERSION').exists() else 'development'
EDITION = (ROOT / 'EDITION').read_text().strip() if (ROOT / 'EDITION').exists() else 'source'

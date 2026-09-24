#!/usr/bin/env python3
"""Build sanitized source and two privilege editions without reading runtime data."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from release_tools.files import public_files
from verify_release import check_file, verify_directory


def manifest(files):
    return json.dumps({name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}, indent=2).encode() + b'\n'


def tar_archive(path, top, files, epoch):
    with path.open('wb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=epoch) as compressed:
            with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
                for name, data in sorted(files.items()):
                    member = tarfile.TarInfo(f'{top}/{name}')
                    member.size = len(data)
                    member.mode = 0o755 if name == 'install.sh' else 0o644
                    member.mtime = epoch
                    member.uid = member.gid = 0
                    member.uname = member.gname = ''
                    archive.addfile(member, io.BytesIO(data))


def zip_archive(path, top, files):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(f'{top}/{name}', (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (0o100755 if name == 'install.sh' else 0o100644) << 16
            archive.writestr(info, data)


def main():
    version = (ROOT / 'VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', version):
        raise SystemExit('VERSION must be a simple semantic version.')
    names = public_files(ROOT)
    files = {name: (ROOT / name).read_bytes() for name in names}
    for required in ['LICENSE', 'README.md', 'README.zh-CN.md', 'docs/RELEASING.md', 'docs/assets/overview.png']:
        if required not in files:
            raise SystemExit(f'Missing public release input: {required}')
    for name, data in files.items():
        check_file(name, data)
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    source = ROOT / 'release-source'
    if source.exists():
        marker = source / 'SOURCE_MANIFEST.json'
        if not marker.exists() or source.is_symlink():
            raise SystemExit('Refusing to replace a source directory without a generated manifest.')
        shutil.rmtree(source)
    source.mkdir()
    source_files = {**files, 'SOURCE_MANIFEST.json': manifest(files)}
    for name, data in source_files.items():
        target = source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        target.chmod(0o755 if name == 'install.sh' else 0o644)
    assets = []
    for edition in ['user', 'admin']:
        edition_files = {**files, 'EDITION': (edition + '\n').encode(),
                         'PACKAGE.md': (f'# NodePeek {version} — {edition.title()} Edition\n\n' +
                            ('Install with `sh install.sh` as a regular account. No sudo is invoked.\n' if edition == 'user' else
                             'Install with `sudo sh install.sh`. The service runs as root from root-owned system paths.\n') +
                            '\nSee README.md / README.zh-CN.md for requirements, configuration and data locations.\n').encode()}
        edition_files['SOURCE_MANIFEST.json'] = manifest(edition_files)
        top = f'nodepeek-{version}-{edition}'
        path = output / (top + '.tar.gz')
        tar_archive(path, top, edition_files, int(os.environ.get('SOURCE_DATE_EPOCH', '0')))
        assets.append(path)
    path = output / f'nodepeek-{version}-source.zip'
    zip_archive(path, f'nodepeek-{version}-source', source_files)
    assets.append(path)
    (output / 'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in assets))
    changelog = (ROOT / 'CHANGELOG.md').read_text()
    entry = re.search(r'^## ' + re.escape(version) + r'\s*\n(.*?)(?=^## |\Z)', changelog, re.M | re.S)
    highlights = "## What's new\n\n" + entry.group(1).strip() + "\n\n" if entry else ''
    (output / 'RELEASE_NOTES.md').write_text(f'''# NodePeek v{version} — User & Admin Editions

See every user. Understand every resource.

{highlights}A self-hosted Linux dashboard for per-user CPU, memory and storage, networking,
Docker, temperatures, an interactive 2D hardware twin and UPS power events. History stays in
local SQLite. English, Chinese, Korean, Spanish and Japanese are included.

## Choose your download

- **User Edition** (`nodepeek-{version}-user.tar.gz`): install and run without sudo;
  collection uses your account's existing permissions.
- **Admin Edition** (`nodepeek-{version}-admin.tar.gz`): install with sudo; a root
  system service can read additional process, private-file and DMI information.
- **Source** (`nodepeek-{version}-source.zip`): clean uploadable source with illustrated
  English/Chinese READMEs, MIT license, tests and release tooling.
- **SHA256SUMS**: verify downloads against the listed hashes.

Linux and Python 3.11+ with venv/pip are required. Initial dependency installation
requires network access. These are source distributions, not bundled binaries.

Extract your chosen edition and run `sh install.sh` (User) or `sudo sh install.sh`
(Admin). Access the dashboard over HTTP on port 9100 using the configured listening
address. There is no built-in login; you manage network access and firewall rules.
The README covers listener configuration, foreground
mode, service persistence, configuration, optional tools and measurement limits.

The interactive hardware diagram adapts to CPU and memory slots, distinguishing
installed, empty and unknown states. Disk history has an independent time range,
defaulting to seven days with a minimum of twelve hours. Both editions share the
same interface and clearly mark incomplete data when access is limited.

Packages exclude real configuration, addresses, account information, databases,
logs and hardware snapshots. Documentation screenshots use fictional data only.

License: MIT; bundled Apache ECharts retains Apache-2.0.
''')
    report = verify_directory(output)
    (output / 'release-audit.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Built clean release-source/ and ' + ', '.join(path.name for path in assets))


if __name__ == '__main__':
    main()

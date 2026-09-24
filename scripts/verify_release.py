#!/usr/bin/env python3
"""Verify archive boundaries, privacy patterns, manifests and SHA-256 sums."""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import zipfile

BLOCKED_PARTS = {'.venv', '.git', '.codex', '.agents', '__pycache__', '.pytest_cache', 'data', 'test-results'}
BLOCKED_NAMES = {'config.toml', 'hardware-snapshot.json'}
SECRET_PATTERNS = [re.compile(rb'gh[pousr]_[A-Za-z0-9]{30,}'), re.compile(rb'github_pat_[A-Za-z0-9_]{50,}'),
                   re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')]
IP_PATTERN = re.compile(rb'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])')
DOC_NETWORKS = [ipaddress.ip_network(net) for net in ['192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24']]


def check_file(name, data, forbidden=()):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or not path.parts:
        raise ValueError(f'Unsafe archive path: {name}')
    if any(part in BLOCKED_PARTS for part in path.parts) or path.name in BLOCKED_NAMES:
        raise ValueError(f'Private runtime file: {name}')
    if path.name.startswith('.env') or path.suffix in {'.pyc', '.log', '.sqlite', '.sqlite3', '.db'} or '.sqlite' in path.name:
        raise ValueError(f'Private/generated file type: {name}')
    if path.suffix.lower() in {'.png', '.jpg', '.jpeg'}:
        if path.parts[:2] != ('docs', 'assets'):
            raise ValueError(f'Image outside approved synthetic documentation: {name}')
        return
    for value in forbidden:
        if not value:
            continue
        encoded=value.encode()
        found=re.search(rb'(?<![A-Za-z0-9_.-])'+re.escape(encoded)+rb'(?![A-Za-z0-9_.-])',data) if len(value)<4 else encoded in data
        if found:
            raise ValueError(f'Local identifier found in {name}')
    for pattern in SECRET_PATTERNS:
        if pattern.search(data):
            raise ValueError(f'Credential-like content in {name}')
    for match in IP_PATTERN.finditer(data):
        try:
            address = ipaddress.ip_address(match.group().decode())
        except ValueError:
            continue
        if address.is_private and not address.is_loopback and not address.is_unspecified and not any(address in net for net in DOC_NETWORKS):
            raise ValueError(f'Private network address in {name}')


def archive_files(path):
    result = {}
    if path.name.endswith('.tar.gz'):
        with tarfile.open(path, 'r:gz') as archive:
            for member in archive.getmembers():
                if not member.isfile() or member.issym() or member.islnk():
                    raise ValueError(f'Non-file archive entry in {path.name}')
                if member.uname or member.gname:
                    raise ValueError(f'Local owner metadata in {path.name}')
                if member.name in result:
                    raise ValueError('Duplicate archive entry')
                result[member.name] = archive.extractfile(member).read()
    else:
        with zipfile.ZipFile(path) as archive:
            for member in archive.infolist():
                if member.is_dir() or (member.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError(f'Non-file archive entry in {path.name}')
                if member.filename in result:
                    raise ValueError('Duplicate archive entry')
                result[member.filename] = archive.read(member)
    roots = {PurePosixPath(name).parts[0] for name in result}
    if len(roots) != 1:
        raise ValueError(f'Archive must have one top directory: {path.name}')
    clean = {}
    for name, value in result.items():
        path_parts = PurePosixPath(name)
        if path_parts.is_absolute() or '..' in path_parts.parts:
            raise ValueError('Unsafe archive path')
        clean[str(PurePosixPath(*path_parts.parts[1:]))] = value
    return clean


def verify_directory(directory, forbidden=()):
    directory = Path(directory)
    rows = (directory / 'SHA256SUMS').read_text().splitlines()
    reports = []
    for row in rows:
        expected, name = row.split('  ', 1)
        if Path(name).name != name:
            raise ValueError('Unsafe checksum filename')
        path = directory / name
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Checksum mismatch: {name}')
        files = archive_files(path)
        for relative, data in files.items():
            check_file(relative, data, forbidden)
        for required in ['README.md', 'README.zh-CN.md', 'LICENSE', 'VERSION', 'install.sh', 'SOURCE_MANIFEST.json']:
            if required not in files:
                raise ValueError(f'Missing {required}: {name}')
        manifest = json.loads(files['SOURCE_MANIFEST.json'])
        expected_paths = set(files) - {'SOURCE_MANIFEST.json'}
        if set(manifest) != expected_paths:
            raise ValueError(f'Manifest membership mismatch: {name}')
        for relative, expected_hash in manifest.items():
            if hashlib.sha256(files[relative]).hexdigest() != expected_hash:
                raise ValueError(f'Manifest content mismatch: {name}')
        edition = files.get('EDITION', b'source').decode().strip()
        if edition not in ('user', 'admin', 'source') or f'-{edition}.' not in name:
            raise ValueError(f'Edition mismatch: {name}')
        reports.append({'asset': name, 'edition': edition, 'files': len(files), 'sha256': expected, 'status': 'passed'})
    if {row['edition'] for row in reports} != {'user', 'admin', 'source'}:
        raise ValueError('Expected User, Admin and source assets')
    return {'status': 'passed', 'checks': ['archive paths', 'no runtime data', 'no owner metadata', 'privacy patterns',
             'exact local identifiers' if forbidden else 'public patterns only', 'SHA-256', 'source manifests', 'edition identities'], 'assets': reports}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', default='dist')
    parser.add_argument('--forbid-file', type=Path, help='Private JSON list of exact identifiers; never included in output')
    args = parser.parse_args()
    forbidden = json.loads(args.forbid_file.read_text()) if args.forbid_file else []
    report = verify_directory(args.directory, forbidden)
    (Path(args.directory) / 'release-audit.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

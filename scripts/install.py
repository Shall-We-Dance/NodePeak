#!/usr/bin/env python3
"""Install an explicit privilege edition. Never invokes sudo or changes account privileges."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from release_tools.files import public_files


def unit_quote(value, expand_dollars=False):
    value = str(value).replace("$", "$$") if expand_dollars else str(value)
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def installation_plan(edition, prefix=None):
    home = Path.home()
    user = edition == 'user'
    prefix = Path(prefix).expanduser().absolute() if prefix else (
        Path(os.environ.get('XDG_DATA_HOME', home / '.local/share')) / 'nodepeek' if user else Path('/opt/nodepeek'))
    config = Path(os.environ.get('XDG_CONFIG_HOME', home / '.config')) / 'nodepeek' if user else Path('/etc/nodepeek')
    data = Path(os.environ.get('XDG_STATE_HOME', home / '.local/state')) / 'nodepeek' if user else Path('/var/lib/nodepeek')
    unit_dir = Path(os.environ.get('XDG_CONFIG_HOME', home / '.config')) / 'systemd/user' if user else Path('/etc/systemd/system')
    for path in (prefix, config, data, unit_dir):
        if not path.is_absolute() or any(c in str(path) for c in '\n\r\x00'):
            raise ValueError('Installation paths must be absolute and cannot contain line breaks.')
    return {'edition': edition, 'prefix': str(prefix), 'config': str(config / 'config.toml'),
            'data': str(data), 'service': str(unit_dir / 'nodepeek.service')}


def service_text(plan):
    prefix = Path(plan['prefix'])
    user = plan['edition'] == 'user'
    return f'''[Unit]
Description=NodePeek server resource monitor ({plan['edition']} edition)
After=network-online.target

[Service]
Type=simple
WorkingDirectory={str(prefix).replace('%', '%%')}
ExecStart={unit_quote(prefix / '.venv/bin/python', True)} {unit_quote(prefix / 'run.py', True)}
Environment={unit_quote('MONITOR_CONFIG=' + plan['config'])}
Environment={unit_quote('MONITOR_DATA_DIR=' + plan['data'])}
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Restart=on-failure
RestartSec=10
TimeoutStopSec=90
Nice=10
IOSchedulingClass=idle
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy={'default.target' if user else 'multi-user.target'}
'''


def check_admin_path(path):
    """Root code/config must not live under a writable or symlinked ancestor."""
    path = Path(path)
    for part in [path, *path.parents]:
        if part.is_symlink():
            raise ValueError(f'Administrator paths cannot contain symlinks: {part}')
        if part.exists():
            stat = part.stat()
            if stat.st_uid != 0 or stat.st_mode & 0o022:
                raise ValueError(f'Administrator path must be root-owned and not group/world writable: {part}')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--edition', choices=['user', 'admin'])
    parser.add_argument('--prefix', help='Code/virtualenv installation directory')
    parser.add_argument('--no-service', action='store_true', help='Install a foreground launcher without registering systemd')
    parser.add_argument('--dry-run', action='store_true', help='Print installation paths/unit; make no changes')
    args = parser.parse_args(argv)
    packaged = (ROOT / 'EDITION').read_text().strip() if (ROOT / 'EDITION').exists() else None
    edition = args.edition or packaged
    if edition not in ('user', 'admin'):
        parser.error('Choose --edition user or --edition admin when installing from source.')
    if packaged in ('user', 'admin') and edition != packaged:
        parser.error(f'This archive is {packaged} Edition. Download the other archive to change privileges.')
    plan = installation_plan(edition, args.prefix)
    if args.dry_run:
        print(json.dumps(plan, indent=2))
        print(service_text(plan))
        return 0
    if sys.platform != 'linux' or sys.version_info < (3, 11):
        parser.error('Linux and Python 3.11 or newer are required.')
    if (edition == 'admin') != (os.geteuid() == 0):
        parser.error('Admin Edition requires root. User Edition must be installed without sudo.')
    if not args.no_service:
        command = ['systemctl'] + (['--user'] if edition == 'user' else [])
        try:
            subprocess.run([*command, 'show-environment'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        except (OSError, subprocess.CalledProcessError):
            parser.error('systemd is unavailable. Use --no-service and run the generated start.sh in your session.')
    prefix = Path(plan['prefix'])
    if prefix.exists():
        parser.error(f'Installation directory already exists: {prefix}. Use a new --prefix; existing config/data are preserved.')
    paths = [prefix, Path(plan['config']).parent, Path(plan['data'])]
    if not args.no_service:
        paths.append(Path(plan['service']).parent)
    if edition == 'admin':
        for path in paths:
            check_admin_path(path)
        if Path(plan['config']).exists():
            check_admin_path(plan['config'])
        if Path(plan['service']).exists():
            check_admin_path(plan['service'])
    files = public_files(ROOT)
    for required in ['VERSION', 'run.py', 'requirements.lock', 'config.example.toml']:
        if required not in files:
            parser.error(f'Incomplete distribution: missing {required}')
    os.umask(0o077)
    for path in paths:
        path.mkdir(parents=True, exist_ok=True)
    for relative in files:
        target = prefix / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, target)
    (prefix / 'EDITION').write_text(edition + '\n')
    config = Path(plan['config'])
    if not config.exists():
        shutil.copyfile(prefix / 'config.example.toml', config)
    venv.EnvBuilder(with_pip=True).create(prefix / '.venv')
    python = prefix / '.venv/bin/python'
    subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check',
                    '-r', str(prefix / 'requirements.lock')], check=True)
    launcher = prefix / 'start.sh'
    launcher.write_text('#!/bin/sh\nset -eu\numask 077\n' +
                       'export MONITOR_CONFIG=' + shlex.quote(plan['config']) + '\n' +
                       'export MONITOR_DATA_DIR=' + shlex.quote(plan['data']) + '\n' +
                       'exec ' + shlex.quote(str(python)) + ' ' + shlex.quote(str(prefix / 'run.py')) + ' "$@"\n')
    launcher.chmod(0o700)
    if not args.no_service:
        unit = Path(plan['service'])
        if unit.exists():
            shutil.copyfile(unit, unit.with_suffix('.service.bak'))
        unit.write_text(service_text(plan))
        subprocess.run([*command, 'daemon-reload'], check=True)
        subprocess.run([*command, 'enable', 'nodepeek.service'], check=True)
        subprocess.run([*command, 'restart', 'nodepeek.service'], check=True)
        print('Installed and started nodepeek.service.')
    print(f'Edition: {edition}\nConfig: {config}\nData: {plan["data"]}\nLauncher: {launcher}')
    if edition == 'user' and not args.no_service:
        print('User-service lifetime follows your system login/linger policy; no administrator settings were changed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

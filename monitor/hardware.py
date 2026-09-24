"""Read-only hardware models/specifications. Unique device identifiers are omitted."""
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import time
from pathlib import Path

import psutil

# Explicit whitelist: do not retain serial numbers, UUIDs, asset tags or addresses.
DMI_FIELDS = set('''Vendor|Manufacturer|Product Name|Version|Release Date|BIOS Revision|Firmware Revision|ROM Size|Runtime Size|Characteristics|Type|Family|Socket Designation|Core Count|Core Enabled|Thread Count|Current Speed|Max Speed|External Clock|Upgrade|Voltage|Location|Use|Error Correction Type|Maximum Capacity|Number Of Devices|Size|Form Factor|Locator|Bank Locator|Type Detail|Speed|Configured Memory Speed|Configured Clock Speed|Part Number|Rank|Total Width|Data Width|Minimum Voltage|Maximum Voltage|Configured Voltage|Volatile Size|Non-Volatile Size|Cache Size|Logical Size|Memory Technology|Memory Operating Mode Capability|Status|Max Power Capacity|Input Voltage Probe|Power Supply Characteristics'''.split('|'))


def read_text(path):
    try:
        value = Path(path).read_text(errors='replace')[:65536].strip()
        return value if value.lower() not in {'', 'none', 'not specified', 'unknown', 'default string', 'to be filled by o.e.m.'} else None
    except OSError:
        return None


def os_summary():
    try:
        release = platform.freedesktop_os_release()
    except OSError:
        release = {}
    return {'architecture': platform.machine(), 'distribution': release.get('PRETTY_NAME', platform.system()),
            'kernel': platform.release(), 'kernel_build': platform.version()}


def run_source(name, args, sources, timeout=12):
    executable = shutil.which(args[0])
    if not executable:
        sources[name] = {'status': 'missing', 'message': 'Command is not installed.'}
        return None
    try:
        result = subprocess.run([executable, *args[1:]], capture_output=True, text=True, errors='replace',
                                timeout=timeout, env={**os.environ, 'LC_ALL': 'C', 'LANG': 'C'})
    except (OSError, subprocess.TimeoutExpired):
        sources[name] = {'status': 'unavailable', 'message': 'Hardware information could not be read.'}
        return None
    if result.returncode:
        sources[name] = {'status': 'unavailable', 'message': 'Hardware information could not be read.'}
        return None
    sources[name] = {'status': 'available'}
    return result.stdout


def parse_dmi(text):
    """Retain only approved model/specification fields, including multi-line lists."""
    records = []
    for block in re.split(r'(?=^Handle 0x[0-9A-Fa-f]+,)', text, flags=re.M):
        lines = block.splitlines()
        if not lines:
            continue
        match = re.match(r'Handle 0x[0-9A-Fa-f]+, DMI type (\d+),', lines[0])
        if not match:
            continue
        fields, title, last_key = {}, '', None
        for line in lines[1:]:
            if not line.strip():
                continue
            if not line.startswith((' ', '\t')):
                title = line.strip()
            elif re.match(r'^\t[^\t]', line) and ':' in line:
                key, value = line.strip().split(':', 1)
                last_key = key if key in DMI_FIELDS else None
                if last_key:
                    fields[key] = value.strip()
            elif last_key:
                fields[last_key] = (fields[last_key] + '\n' + line.strip()).strip()
        records.append({'type': int(match[1]), 'title': title, 'fields': fields})
    return records


def flatten_cpu(items):
    fields = {}
    for item in items:
        if item.get('data') is not None:
            fields[item['field'].rstrip(':')] = str(item['data'])
        fields.update(flatten_cpu(item.get('children', [])))
    return fields


def parse_disks(payload):
    result, seen = [], set()
    allowed = {'name','kname','type','pkname','model','vendor','rev','size','rota','tran','log-sec','phy-sec','fstype'}
    def mounts(node):
        values = [value for value in node.get('mountpoints', []) or [] if value]
        for child in node.get('children', []):
            values.extend(mounts(child))
        return sorted(set(values))
    def visit(node):
        if node.get('type') in {'disk', 'rom'} and node.get('name') not in seen:
            seen.add(node['name'])
            record = {key: value.strip() if isinstance(value, str) else value for key, value in node.items() if key in allowed}
            record['mountpoints'] = mounts(node)
            result.append(record)
        for child in node.get('children', []):
            visit(child)
    for node in payload.get('blockdevices', []):
        visit(node)
    return result


def collect_hardware():
    sources = {}
    result = {'state': 'ready', 'collected_at': int(time.time()), 'collector_uid': os.geteuid(),
              'system': os_summary(), 'sources': sources, 'cpu': {}, 'board': {}, 'bios': {}, 'chassis': {},
              'memory': {'total_bytes': psutil.virtual_memory().total, 'swap_bytes': psutil.swap_memory().total,
                         'modules': [], 'arrays': [], 'slots': 0, 'empty_slots': 0, 'dmi_available': False},
              'disks': [], 'network': [], 'pci': [], 'usb': [], 'firmware_records': []}
    result['system']['boot_mode'] = 'UEFI' if Path('/sys/firmware/efi').exists() else 'BIOS / legacy'
    mappings = {
        'system': {'Manufacturer':'sys_vendor','Product name':'product_name','Product version':'product_version'},
        'board': {'Manufacturer':'board_vendor','Model':'board_name','Version':'board_version'},
        'bios': {'Manufacturer':'bios_vendor','Version':'bios_version','Release date':'bios_date','BIOS release':'bios_release'},
        'chassis': {'Manufacturer':'chassis_vendor','Type':'chassis_type','Version':'chassis_version'},
    }
    for group, fields in mappings.items():
        result[group].update({label: read_text(Path('/sys/class/dmi/id') / name) for label, name in fields.items()})
    cpu = run_source('lscpu', ['lscpu', '--json'], sources)
    if cpu:
        try:
            result['cpu'] = flatten_cpu(json.loads(cpu).get('lscpu', []))
        except (ValueError, TypeError, KeyError):
            sources['lscpu'] = {'status': 'unavailable', 'message': 'Unable to parse hardware information.'}
    if not result['cpu']:
        info = read_text('/proc/cpuinfo') or ''
        model = re.search(r'^(?:model name|Hardware)\s*:\s*(.+)$', info, re.M)
        result['cpu'] = {'Architecture': platform.machine(), 'Model name': model[1] if model else None,
                         'CPU(s)': str(psutil.cpu_count()), 'Physical cores': str(psutil.cpu_count(logical=False))}
    dmi = run_source('dmidecode', ['dmidecode', '--type', '0,1,2,3,4,16,17,22,39'], sources)
    if dmi:
        records = parse_dmi(dmi)
        result['firmware_records'] = records
        modules = [record['fields'] for record in records if record['type'] == 17]
        result['memory'].update({'arrays': [record['fields'] for record in records if record['type'] == 16],
                                 'slots': len(modules), 'empty_slots': sum(m.get('Size') == 'No Module Installed' for m in modules),
                                 'modules': [m for m in modules if m.get('Size') != 'No Module Installed'],
                                 'dmi_available': bool(modules)})
    disks = run_source('lsblk', ['lsblk', '--json', '--bytes', '--paths', '-o',
                       'NAME,KNAME,TYPE,PKNAME,MODEL,VENDOR,REV,SIZE,ROTA,TRAN,LOG-SEC,PHY-SEC,FSTYPE,MOUNTPOINTS'], sources)
    if disks:
        try:
            result['disks'] = parse_disks(json.loads(disks))
        except (ValueError, TypeError):
            sources['lsblk'] = {'status': 'unavailable', 'message': 'Unable to parse hardware information.'}
    pci = run_source('lspci', ['lspci', '-D', '-mm'], sources)
    if pci:
        for line in pci.splitlines():
            try:
                values = shlex.split(line)
            except ValueError:
                continue
            if len(values) >= 4:
                result['pci'].append({'slot': values[0], 'class': values[1], 'vendor': values[2], 'model': values[3]})
    for node in sorted(Path('/sys/class/net').glob('*')):
        if not (node / 'device').exists():
            continue
        device = (node / 'device').resolve()
        match = next((item for item in result['pci'] if item['slot'] == device.name), {})
        result['network'].append({'Interface':node.name, 'Model':match.get('model'), 'Manufacturer':match.get('vendor'),
                                  'Driver':(node / 'device/driver').resolve().name if (node / 'device/driver').exists() else None,
                                  'Speed (Mbps)':read_text(node / 'speed'), 'MTU':read_text(node / 'mtu'),
                                  'NUMA node':read_text(node / 'device/numa_node')})
    usb = run_source('lsusb', ['lsusb'], sources)
    if usb:
        result['usb'] = usb.strip().splitlines()
    return result

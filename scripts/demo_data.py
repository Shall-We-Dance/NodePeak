"""Synthetic, non-identifying demonstration data. Never reads the host or a live API."""
import math
import time

GIB = 1024**3
TIB = 1024**4


def dataset(now=None):
    now = int(time.time()) if now is None else int(now)
    names = {'0': 'root', '100': 'service', '1000': 'alice', '1001': 'bob', '1002': 'carol'}
    system = {'architecture': 'x86_64', 'distribution': 'Example Linux 24.04 LTS',
              'kernel': '6.8.0-demo', 'kernel_build': 'Demonstration build', 'boot_mode': 'UEFI',
              'Manufacturer': 'Example Systems', 'Product name': 'Demo Server', 'Product version': '1.0'}
    def point(ts, step):
        users = {}
        for index, (uid, name) in enumerate(names.items()):
            cpu = (1.8 + index * 1.4) * (1.35 + .5 * math.sin(step / 8 + index))
            users[uid] = {'uid': int(uid), 'name': name, 'cpu': cpu, 'memory': int((1 + index * 2.1 + .25 * math.sin(step / 9 + index)) * GIB),
                          'read': (index + 1) * 1048576, 'write': (index + 1) * 262144, 'processes': 9 + index * 11, 'io_denied': 0}
        return {'ts': ts, 'cpu': sum(u['cpu'] for u in users.values()) + 4,
                'memory_used': 34 * GIB, 'memory_total': 64 * GIB,
                'disk_used': 6.35 * TIB, 'disk_total': 11 * TIB,
                'rx': (14 + 6 * math.sin(step / 7)) * 1048576, 'tx': (8 + 4 * math.sin(step / 9)) * 1048576,
                'disk_read': (22 + 12 * math.sin(step / 6)) * 1048576, 'disk_write': (9 + 7 * math.sin(step / 10)) * 1048576,
                'temperature': 48 + 4 * math.sin(step / 8), 'ups_charge': 100, 'users': users,
                'containers': {'demo-api': {'name': 'demo-api', 'cpu': 4 + math.sin(step / 8), 'memory': GIB},
                               'demo-db': {'name': 'demo-db', 'cpu': 2 + .5 * math.sin(step / 4), 'memory': 2 * GIB}},
                'networks': {name: {'rx': (i + 1) * 1048576, 'tx': (i + 1) * 524288} for i, name in enumerate(['enp1s0', 'ztdemo0', 'docker0'])}}
    def scan(ts, factor=1):
        ownership = {
            '0': {'/home': 4 * GIB, '/data': 40 * GIB},
            '1000': {'/home': 32 * GIB, '/data': 2.1 * TIB, '/fast': .35 * TIB},
            '1001': {'/home': 18 * GIB, '/data': 1.3 * TIB, '/fast': .45 * TIB},
            '1002': {'/home': 10 * GIB, '/data': .6 * TIB, '/public': 72 * GIB},
        }
        users = {uid: {'name': names[uid], 'roots': {r: int(v * factor) for r, v in roots.items()},
                       'bytes': int(sum(roots.values()) * factor), 'files': 21000} for uid, roots in ownership.items()}
        return {'started_at': ts - 65, 'finished_at': ts, 'state': 'partial', 'roots': ['/home', '/data', '/fast', '/public'],
                'collector_uid': 0, 'users': users, 'files': 84000, 'errors': 2,
                'error_examples': ['/data/example-private: Permission denied', '/public/example-removed: No such file or directory']}
    scans = [scan(now - (27 - i) * 21600, .72 + i * .01) for i in range(28)]
    interfaces = {}
    for index, (name, address) in enumerate([('enp1s0', '192.0.2.10'), ('ztdemo0', '198.51.100.10'), ('docker0', '203.0.113.1'), ('vethdemo', '')]):
        interfaces[name] = {'name': name, 'addresses': [address] if address else [], 'rx': (index + 1) * 1048576,
                            'tx': (index + 1) * 524288, 'rx_total': 480 * GIB, 'tx_total': 260 * GIB, 'errors': 0, 'drops': 0}
    disks = [{'device': device, 'mount': mount, 'fstype': 'ext4', 'total': int(total * TIB), 'used': int(used * TIB),
              'free': int((total - used - .02) * TIB), 'percent': round(used / total * 100, 1)}
             for device, mount, total, used in [('/dev/sda1', '/', 1, .45), ('/dev/sdb1', '/data', 8, 4.8), ('/dev/nvme0n1p1', '/fast', 2, 1.1)]]
    live = {**point(now, 120), 'hostname': 'demo-node', 'platform': 'Linux demo', 'system': system,
            'cpu_count': 16, 'cores': [24] * 16, 'memory_percent': 53.1, 'memory_available': 30 * GIB,
            'memory_cached': 6 * GIB, 'swap_used': 0, 'swap_total': 8 * GIB, 'disks': disks, 'networks': interfaces,
            'temperatures': [{'chip': 'coretemp', 'name': name, 'current': 44 + i * 2, 'high': 85, 'critical': 100}
                             for i, name in enumerate(['Package 0', 'Core 0', 'Core 1', 'Core 2', 'Core 3'])],
            'uptime': 19 * 86400 + 7200, 'boot_time': now - 19 * 86400 - 7200, 'load': [3.2, 2.8, 2.4],
            'permissions': {'root': True, 'processes_denied': 0, 'process_io_denied': 0}, 'interval': 5,
            'zerotier_ips': ['198.51.100.10'], 'network_total_interfaces': ['enp1s0'], 'stale': False,
            'disk_scan': scans[-1], 'scan_progress': None, 'collector_errors': {},
            'ups': {'available': True, 'backend': 'nut', 'state': 'online', 'model': 'Example UPS 1500',
                    'charge': 100, 'runtime_seconds': 2520, 'load': 28, 'voltage': 230, 'battery_voltage': 27.2, 'updated_at': now},
            'docker': {'available': True, 'updated_at': now, 'containers': [
                {'id': 'demo-api', 'name': 'demo-api', 'image': 'example/api:1.0', 'state': 'running', 'status': 'Up 3 days', 'project': 'demo', 'cpu': 4.2, 'memory': '1 GiB / 4 GiB', 'net_io': '2 GiB / 1 GiB'},
                {'id': 'demo-db', 'name': 'demo-db', 'image': 'example/database:1.0', 'state': 'running', 'status': 'Up 3 days', 'project': 'demo', 'cpu': 2.1, 'memory': '2 GiB / 8 GiB', 'net_io': '5 GiB / 3 GiB'},
                {'id': 'demo-job', 'name': 'demo-job', 'image': 'example/worker:1.0', 'state': 'exited', 'status': 'Exited normally', 'project': 'demo', 'cpu': None, 'memory': None, 'net_io': None}]}}
    hardware = {'state': 'ready', 'collected_at': now, 'collector_uid': 0, 'system': system,
                'cpu': {'Model name': 'Example 8-Core Processor', 'Architecture': 'x86_64', 'Vendor ID': 'Example', 'Socket(s)': '1', 'Core(s) per socket': '8', 'CPU(s)': '16', 'Thread(s) per core': '2', 'CPU max MHz': '4200', 'CPU min MHz': '1200', 'L1d cache': '256 KiB', 'L1i cache': '256 KiB', 'L2 cache': '4 MiB', 'L3 cache': '32 MiB', 'NUMA node(s)': '1', 'Virtualization': 'Supported'},
                'board': {'Manufacturer': 'Example Systems', 'Model': 'Demo Board', 'Version': '1.0'},
                'bios': {'Manufacturer': 'Example Systems', 'Version': '1.0', 'Release date': '2026-01-01'}, 'chassis': {'Type': 'Tower'},
                'memory': {'total_bytes': 64 * GIB, 'swap_bytes': 8 * GIB, 'slots': 4, 'empty_slots': 0, 'dmi_available': True,
                           'modules': [{'Locator': f'DIMM {i}', 'Part Number': 'DEMO-DDR4-16G', 'Size': '16 GB', 'Type': 'DDR4', 'Speed': '3200 MT/s'} for i in range(1, 5)], 'arrays': []},
                'disks': [{'name': d['device'], 'model': 'Example NVMe' if 'nvme' in d['device'] else 'Example Storage', 'size': d['total'], 'vendor': 'Example', 'type': 'disk', 'mountpoints': [d['mount']]} for d in disks],
                'network': [{'Interface': 'enp1s0', 'Model': 'Example Ethernet Adapter', 'Speed (Mbps)': '1000'}], 'pci': [], 'usb': [], 'firmware_records': [],
                'sources': {name: {'status': 'available'} for name in ['lscpu', 'dmidecode', 'lsblk', 'lspci', 'lsusb']}}
    hardware['disks'] = [
        {'name': '/dev/nvme0n1', 'model': 'Example NVMe', 'tran': 'nvme', 'rota': False, 'type': 'disk', 'size': 2*1024**4},
        {'name': '/dev/sda', 'model': 'Example SATA SSD', 'tran': 'sata', 'rota': False, 'type': 'disk', 'size': 1024**4},
        {'name': '/dev/sdb', 'model': 'Example SATA HDD', 'tran': 'sata', 'rota': True, 'type': 'disk', 'size': 4*1024**4},
        {'name': '/dev/sdc', 'model': 'Example SAS HDD', 'tran': 'sas', 'rota': True, 'type': 'disk', 'size': 2*1024**4},
        {'name': '/dev/sdd', 'model': 'Example RAID Virtual Disk', 'tran': 'sas', 'rota': True, 'type': 'disk', 'size': 8*1024**4},
    ]
    hardware['memory']['slots'] = 8
    hardware['memory']['empty_slots'] = 4
    hardware['firmware_records'] = [
        {'type': 4, 'title': 'Processor Information', 'fields': {'Socket Designation': 'CPU1', 'Version': 'Example 8-Core Processor', 'Status': 'Populated, Enabled', 'Core Count': '8', 'Thread Count': '16', 'Upgrade': 'Example socket'}},
        *[{'type': 17, 'title': 'Memory Device', 'fields': module} for module in hardware['memory']['modules']],
        *[{'type': 17, 'title': 'Memory Device', 'fields': {'Locator': f'DIMM {index}', 'Size': 'No Module Installed'}} for index in range(5, 9)],
    ]
    events = [{'ts': now - 1200, 'kind': 'power_restored', 'severity': 'success', 'message': 'UPS returned to mains power.', 'source': 'UPS live status'},
              {'ts': now - 1380, 'kind': 'on_battery', 'severity': 'warning', 'message': 'UPS switched to battery power. This may be a self-test; check the UPS logs.', 'source': 'UPS live status'},
              {'ts': now - 1400, 'kind': 'power_failure', 'severity': 'critical', 'message': 'Power failure.', 'source': 'apcupsd log'}]
    def history(start, end):
        step = max(5, (end - start) // 180)
        return {'start': start, 'end': end, 'resolution': step, 'points': [point(ts, i) for i, ts in enumerate(range(start, end + 1, step))]}
    return {'live': live, 'hardware': hardware, 'scans': scans, 'events': events, 'history': history}

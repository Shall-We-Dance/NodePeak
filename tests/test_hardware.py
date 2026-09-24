import json

from fastapi.testclient import TestClient
from monitor.app import create_app
from monitor.config import Config
from monitor.hardware import parse_dmi, parse_disks, flatten_cpu, collect_hardware

DMI = '''# dmidecode
Handle 0x1000, DMI type 16, 23 bytes
Physical Memory Array
\tLocation: System Board Or Motherboard
\tMaximum Capacity: 1536 GB
\tNumber Of Devices: 24

Handle 0x1100, DMI type 17, 40 bytes
Memory Device
\tSize: 16384 MB
\tLocator: A1
\tManufacturer: Example Vendor
\tPart Number: EXAMPLE-DDR4-16G
\tSerial Number: NEVER-PUBLISH-SERIAL
\tAsset Tag: NEVER-PUBLISH-ASSET
\tUUID: NEVER-PUBLISH-UUID
\tType: DDR4
\tConfigured Memory Speed: 2400 MT/s
\tType Detail:
\t\tSynchronous
\t\tRegistered (Buffered)

Handle 0x1101, DMI type 17, 40 bytes
Memory Device
\tSize: No Module Installed
\tLocator: A2
'''


def test_dmi_specs_preserved_identifiers_omitted():
    records = parse_dmi(DMI)
    assert len(records) == 3
    module = records[1]['fields']
    assert module['Part Number'] == 'EXAMPLE-DDR4-16G'
    assert module['Type Detail'] == 'Synchronous\nRegistered (Buffered)'
    assert 'NEVER-PUBLISH' not in json.dumps(records)
    assert 'Serial Number' not in module
    assert records[2]['fields']['Size'] == 'No Module Installed'


def test_disks_have_models_and_child_mounts_without_unique_ids():
    result = parse_disks({'blockdevices': [
        {'name':'/dev/sda','type':'disk','model':' SSD 4TB ','size':4000,'serial':'NEVER-PUBLISH',
         'children':[{'name':'/dev/sda1','type':'part','mountpoints':['/data',None]}]},
        {'name':'/dev/loop0','type':'loop','size':100},
    ]})
    assert len(result) == 1
    assert result[0]['mountpoints'] == ['/data']
    assert result[0]['model'] == 'SSD 4TB'
    assert 'serial' not in result[0]


def test_lscpu_nested_and_flat_formats():
    values = flatten_cpu([{'field':'Architecture:','data':'x86_64'},
        {'field':'CPU(s):','data':'72','children':[{'field':'Model name:','data':'Example CPU'}]}])
    assert values['Architecture'] == 'x86_64'
    assert values['Model name'] == 'Example CPU'


def test_inventory_handles_dmi_and_absent_optional_commands(monkeypatch):
    def source(name, args, sources, timeout=12):
        sources[name] = {'status':'available' if name == 'dmidecode' else 'missing'}
        return DMI if name == 'dmidecode' else None
    monkeypatch.setattr('monitor.hardware.run_source', source)
    result = collect_hardware()
    memory = result['memory']
    assert memory['dmi_available']
    assert memory['slots'] == 2 and memory['empty_slots'] == 1
    assert len(memory['modules']) == 1
    assert result['cpu']['Architecture']
    assert result['disks'] == []
    assert 'NEVER-PUBLISH' not in json.dumps(result)


def test_hardware_endpoint_uses_snapshot_and_disables_caching(tmp_path):
    app = create_app(Config(data_dir=tmp_path,disk_roots=[str(tmp_path)]),run_collector=False)
    with TestClient(app) as client:
        assert client.get('/api/hardware').json()['state'] == 'pending'
        app.state.collector.hardware = {'state':'ready','collected_at':123,'cpu':{'Model name':'Example CPU'}}
        response = client.get('/api/hardware')
        assert response.json()['cpu']['Model name'] == 'Example CPU'
        assert response.headers['cache-control'] == 'no-store'
        snapshot = app.state.collector.hardware_snapshot()
        snapshot['cpu']['Model name'] = 'Modified copy'
        assert app.state.collector.hardware['cpu']['Model name'] == 'Example CPU'

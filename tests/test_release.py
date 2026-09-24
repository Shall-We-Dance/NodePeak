from pathlib import Path
import sys
import shutil
import subprocess
import tarfile

import pytest

from release_tools.files import public_files
from scripts.install import installation_plan, service_text, check_admin_path, main as install
from scripts.verify_release import check_file, archive_files


def test_public_manifest_excludes_runtime_and_only_includes_synthetic_images(tmp_path):
    for name in ['VERSION', 'config.toml', 'data/private.sqlite3', 'static/app.js',
                 'static/hardware-snapshot.json', 'test-results/real.png', 'docs/assets/overview.png',
                 '.env', '.venv/private.py', 'scripts/install.py']:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('example')
    files = public_files(tmp_path)
    assert files == ['VERSION', 'docs/assets/overview.png', 'scripts/install.py', 'static/app.js']


def test_manifest_rejects_symlink(tmp_path):
    (tmp_path / 'VERSION').symlink_to('/etc/hostname')
    with pytest.raises(ValueError, match='Unsafe'):
        public_files(tmp_path)


def test_edition_installation_plans_and_units(monkeypatch, tmp_path):
    for key, name in [('XDG_DATA_HOME', 'share'), ('XDG_CONFIG_HOME', 'config'), ('XDG_STATE_HOME', 'state')]:
        monkeypatch.setenv(key, str(tmp_path / name))
    user = installation_plan('user')
    assert user['prefix'] == str(tmp_path / 'share/nodepeek')
    assert user['data'] == str(tmp_path / 'state/nodepeek')
    assert user['config'] == str(tmp_path / 'config/nodepeek/config.toml')
    assert 'WantedBy=default.target' in service_text(user)
    assert 'NoNewPrivileges=true' in service_text(user)
    assert 'sudo' not in service_text(user)
    admin = installation_plan('admin')
    assert admin['prefix'] == '/opt/nodepeek'
    assert admin['data'] == '/var/lib/nodepeek'
    assert admin['config'] == '/etc/nodepeek/config.toml'
    assert 'WantedBy=multi-user.target' in service_text(admin)


def test_install_dry_run_writes_nothing(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr('scripts.install.subprocess.run', lambda *a, **k: pytest.fail('dry-run invoked a command'))
    prefix = tmp_path / 'new-prefix'
    assert install(['--edition', 'user', '--prefix', str(prefix), '--dry-run']) == 0
    assert not prefix.exists()
    assert 'nodepeek.service' in capsys.readouterr().out


@pytest.mark.parametrize('edition,uid', [('user', 0), ('admin', 1000)])
def test_installer_rejects_wrong_privilege(monkeypatch, tmp_path, edition, uid):
    monkeypatch.setattr('scripts.install.os.geteuid', lambda: uid)
    with pytest.raises(SystemExit) as error:
        install(['--edition', edition, '--no-service', '--prefix', str(tmp_path / 'new')])
    assert error.value.code == 2
    assert not (tmp_path / 'new').exists()


def test_packaged_edition_cannot_be_overridden(monkeypatch, tmp_path):
    (tmp_path / 'EDITION').write_text('user\n')
    monkeypatch.setattr('scripts.install.ROOT', tmp_path)
    with pytest.raises(SystemExit):
        install(['--edition', 'admin', '--dry-run'])


def test_admin_paths_reject_user_writable_ancestors_and_symlinks(tmp_path):
    with pytest.raises(ValueError):
        check_admin_path(tmp_path / 'root-code')
    link = tmp_path / 'linked'
    link.symlink_to('/opt')
    with pytest.raises(ValueError, match='symlinks'):
        check_admin_path(link)


@pytest.mark.parametrize('name', ['config.toml', 'data/monitor.sqlite3', '.env', 'static/hardware-snapshot.json',
                                  'test-results/live.png', '../outside.py'])
def test_archive_privacy_paths(name):
    with pytest.raises(ValueError):
        check_file(name, b'example')


def test_archive_privacy_content():
    private_ip = '.'.join(['10', '23', '45', '67']).encode()
    with pytest.raises(ValueError, match='network'):
        check_file('README.md', private_ip)
    with pytest.raises(ValueError, match='identifier'):
        check_file('README.md', b'private-example-account', ['private-example-account'])
    check_file('README.md', b'127.0.0.1 192.0.2.10 198.51.100.10')
    check_file('README.md', b'Example q7.0.0', ['q7'])
    with pytest.raises(ValueError, match='identifier'):
        check_file('README.md', b'Host: q7', ['q7'])
    credential = ('gh' + 'p_' + 'a' * 40).encode()
    with pytest.raises(ValueError, match='Credential'):
        check_file('README.md', credential)


def test_archive_rejects_links(tmp_path):
    path = tmp_path / 'unsafe.tar.gz'
    with tarfile.open(path, 'w:gz') as archive:
        entry = tarfile.TarInfo('project/link')
        entry.type = tarfile.SYMTYPE
        entry.linkname = '/etc/hostname'
        archive.addfile(entry)
    with pytest.raises(ValueError, match='Non-file'):
        archive_files(path)


@pytest.mark.parametrize('edition,uid', [('user', 0), ('admin', 1000)])
def test_runtime_refuses_wrong_privilege(monkeypatch, edition, uid):
    import run
    monkeypatch.setattr(run, 'EDITION', edition)
    monkeypatch.setattr(run.os, 'geteuid', lambda: uid)
    monkeypatch.setattr(sys, 'argv', ['run.py'])
    with pytest.raises(SystemExit) as error:
        run.main()
    assert error.value.code == 2


def test_generated_units_pass_systemd_parser(tmp_path):
    tool=shutil.which('systemd-analyze')
    if not tool:
        pytest.skip('systemd-analyze is not installed')
    prefix=tmp_path / 'code with spaces'
    (prefix / '.venv/bin').mkdir(parents=True)
    (prefix / '.venv/bin/python').symlink_to(sys.executable)
    (prefix / 'run.py').write_text('print("demo")\n')
    for edition in ['user', 'admin']:
        unit=tmp_path / f'nodepeek-{edition}.service'
        unit.write_text(service_text(installation_plan(edition,prefix)))
        result=subprocess.run([tool,'verify',str(unit)],capture_output=True,text=True)
        assert result.returncode==0,result.stderr

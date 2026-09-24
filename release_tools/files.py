"""Explicit public-source manifest. Never archive an entire working directory."""
from pathlib import Path

TOP = ('VERSION', 'README.md', 'README.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
       'CHANGELOG.md', 'SECURITY.md', 'pytest.ini', '.gitignore', 'config.example.toml',
       'requirements.txt', 'requirements.lock', 'requirements-dev.txt', 'run.py', 'install.sh')
SCRIPTS = ('build_locales.py', 'version_assets.py', 'install.py', 'build_release.py',
           'verify_release.py', 'demo_data.py', 'render_readme.py', 'check_hardware_twin.py', 'check_independent_ranges.py')


def public_files(root):
    root = Path(root)
    files = [root / name for name in TOP if (root / name).is_file()]
    files += [root / 'scripts' / name for name in SCRIPTS if (root / 'scripts' / name).is_file()]
    for folder, pattern in [('monitor', '*.py'), ('release_tools', '*.py'), ('tests', 'test_*.py'),
                            ('tests', 'test_*.cjs'), ('static', '*.js'), ('static', '*.css'),
                            ('static', '*.html'), ('static', '*.svg'), ('static/locales', '*.json'),
                            ('static/vendor', '*.js'), ('static/vendor', '*LICENSE*'), ('static/vendor', '*NOTICE*'),
                            ('docs', '*.md'), ('docs/assets', '*.png'), ('docs/assets', '*.svg'),
                            ('.github/workflows', '*.yml')]:
        files.extend((root / folder).glob(pattern))
    paths = sorted(set(path.relative_to(root).as_posix() for path in files))
    for relative in paths:
        path = root / relative
        if path.is_symlink() or not path.is_file() or root.resolve() not in path.resolve().parents:
            raise ValueError(f'Unsafe source path: {relative}')
    return paths

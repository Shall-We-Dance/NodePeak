![NodePeek — See every user. Understand every resource.](docs/assets/banner.svg)

[简体中文](README.zh-CN.md) · **English** · [MIT license](LICENSE) · [Release guide](docs/RELEASING.md)

**NodePeek** is a self-hosted Linux server monitor that shows who is using CPU, memory and disk space, alongside networking, Docker, temperatures, hardware and UPS events. It keeps history in local SQLite and serves a lightweight HTTP dashboard over your trusted network or ZeroTier.

No cloud account, frontend build step, CDN or external database. Choose an unprivileged **User Edition** or a root **Admin Edition**.

![Overview with per-user CPU and memory trends](docs/assets/overview.png)

*All documentation screenshots use synthetic data: example users, fictional hardware, documentation-only addresses and generated metrics. They are not captures of a real server.*

Network & disk I/O and Docker each have independent time controls (15m–30d presets and custom dates up to 90 days). Changing Resource trends does not change these sections.

## What you can see

| Area | What NodePeek records and displays |
| --- | --- |
| CPU & memory | Live host totals, stacked per-user trends, load, process counts and readable process I/O. UID ≥ 1000 shown individually; lower UIDs grouped under expandable **System**. |
| Storage | Mounted filesystem capacity, each user's share of each disk, per-user cards across disks and independent historical charts. A disk's capacity bar represents **100% of total capacity**, including free space. |
| Network | RX/TX history and counters; labels for physical interfaces, ZeroTier, Docker bridges and virtual interfaces. |
| Docker | Containers, images, Compose projects, state changes, CPU/memory history and available I/O counters. |
| Hardware | Interactive 2D motherboard schematic with adaptive CPU sockets, installed/empty DIMMs, physical interfaces, drives, BIOS and OS; detailed specifications on selection. |
| Power & health | Readable temperature sensors, uptime, UPS charge/runtime/load, mains/battery transitions and imported apcupsd events. |
| Interface | English, 简体中文, 한국어, Español and 日本語, with a **文 / A** picker and responsive layouts. |

## Choose your edition

Both editions have the same dashboard and history format. The difference is the operating-system privileges used for collection.

| | User Edition — **no sudo** | Admin Edition — **sudo/root** |
| --- | --- | --- |
| Release asset | `nodepeek-1.3.2-user.tar.gz` | `nodepeek-1.3.2-admin.tar.gz` |
| Installer | Run as your regular account | Run with sudo/root |
| Runtime | Your account; refuses root | Root system service |
| Installation | `~/.local/share/nodepeek` | `/opt/nodepeek` |
| Configuration | `~/.config/nodepeek/config.toml` | `/etc/nodepeek/config.toml` |
| History | `~/.local/state/nodepeek` | `/var/lib/nodepeek` |
| Service | `systemctl --user` | System `systemctl` |
| Other users' private files / process I/O | Only existing readable access; often partial | More complete where the OS/filesystem allows |
| Memory-module DMI details | Often unavailable | Available when supported and `dmidecode` is installed |
| Docker / UPS | Existing CLI/socket/daemon permissions apply | Existing tools and daemon configuration still required |
| After logout / reboot | Depends on your user-service/linger policy | Starts at boot once enabled |

User paths honor `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_STATE_HOME`. Neither installer modifies sudoers, group memberships, filesystem access rules, UPS configuration or ZeroTier membership. Root cannot bypass every restriction: remote root-squash, unavailable sensors and changing files can still produce partial results.

## Install

**Requirements:** Linux, Python **3.11+** with `venv` and `pip`, and network access to install the pinned Python dependencies. These are portable Python source distributions, not standalone binaries or offline wheel bundles. Optional system utilities are described below. No Node.js is needed to run the app.

Download the desired `.tar.gz` and `SHA256SUMS` from the repository's GitHub **Releases** page. Check the downloaded asset against its listed SHA-256 before extracting it.

### User Edition: no sudo

```bash
tar -xzf nodepeek-1.3.2-user.tar.gz
cd nodepeek-1.3.2-user
sh install.sh
```

The installer creates a private virtual environment and starts a user systemd service. If the user systemd manager is unavailable, run it in a foreground session instead:

```bash
sh install.sh --no-service
~/.local/share/nodepeek/start.sh
```

The foreground process ends when its session ends unless your session manager keeps it alive. A user service's lifetime after logout depends on the machine's existing linger policy; the installer does not request administrator privileges to change it. Check it with `loginctl show-user "$USER" -p Linger`.

### Admin Edition: sudo/root

```bash
tar -xzf nodepeek-1.3.2-admin.tar.gz
cd nodepeek-1.3.2-admin
sudo sh install.sh
```

The installer copies the code into a root-owned directory, creates its virtual environment and enables `nodepeek.service`. It runs no monitoring code from your writable extraction directory. For a non-systemd machine, use `sudo sh install.sh --no-service`, then run `sudo /opt/nodepeek/start.sh` under your service supervisor.

Preview either installation without changing anything:

```bash
sh install.sh --dry-run
```

If `venv` or `pip` is missing, use a Python installation that includes them; User Edition cannot install OS packages without an administrator. Debian/Ubuntu administrators can provide `python3-venv` through their package manager.

### Open the dashboard

The default `host = "auto"` binds to the first active ZeroTier IPv4 address. If none exists at startup, it binds to **127.0.0.1**. The listening URL is printed in the service log.

```text
http://YOUR_ZEROTIER_IP:9100/
```

Start ZeroTier before NodePeek, or set an explicit address in the configuration and restart. To use a different trusted interface, set its IP as `server.host`.

**HTTP has no application login. Anyone who can reach the listening address can read monitoring information.** Keep it on a trusted private/ZeroTier network. See [deployment and data boundaries](SECURITY.md).

## Storage, with ownership

![Per-disk capacity and per-user storage cards](docs/assets/storage.png)

- **Disk level:** one full-capacity bar combining users, unassigned usage, reserved blocks and free space. Each user percentage is divided by the whole disk's capacity.
- **User level:** search by username or UID, inspect their storage across mounted disks, and jump between user and disk cards.
- **Gray means unknown or unattributed:** unreadable/changed files, unscanned areas and filesystem accounting differences are not presented as a known user's files.
- **Disk history has its own range:** defaults to **7 days**; choose **12h / 24h / 3d / 7d / 30d / 90d** or a custom interval between 12 hours and 90 days. Changing it does not change the CPU/memory range above.

Disk scanning runs every six hours by default, in the background. The history chart updates its query every minute; it does not force a new disk scan. One available scan appears as a bar, multiple scans as a stepped stacked history. Empty periods are not invented measurements.

## Hardware, power and mobile

<details>
<summary><strong>Hardware twin: an adaptive, interactive 2D motherboard</strong></summary>

Hardware now has its own sidebar section. DIMM contacts follow the long edge in a compact schematic. Storage types use reported transport, rotation flags, and controller identity: NVMe, SATA/SAS SSD or HDD, and RAID virtual disks. ATA without transport remains ATA; RAID member media and bay positions cannot be inferred.

![Expanded hardware inventory with fictional demonstration models](docs/assets/hardware.png)

The diagram adapts to reported socket and DIMM counts, including one-, two- and four-socket systems. Click a CPU, memory slot, motherboard, network interface, drive, BIOS or OS to inspect it. Installed parts are solid, confirmed empty slots are dashed, and unknown occupancy is gray/hatched. Full specifications remain available in a collapsed section.

![Synthetic four-socket server with an empty CPU socket and mixed DIMM occupancy](docs/assets/hardware-four-socket.png)

This is a **schematic**, not a reconstruction of physical placement or CPU-to-memory wiring. Disk bay positions are unknown. Without readable DMI, the view uses OS-reported processors and does not infer empty sockets or DIMM counts from RAM capacity. Selection survives language changes and inventory refreshes.

DMI fields use an allowlist: serial numbers, UUIDs, asset tags and MAC addresses are omitted. A RAID controller model is labeled as controller-reported; it is not claimed to be the model of each member drive. Inventory updates independently once per hour.

</details>

![UPS charge, temperature sensors and power events](docs/assets/power.png)

UPS integration detects local **apcupsd** or **NUT**. It reads their existing status interfaces and, when readable, the apcupsd event file. It does not configure your UPS or send shutdown/control commands. A monitoring gap or reboot is not automatically labeled a power failure.

<details>
<summary><strong>Mobile view in Simplified Chinese</strong></summary>

<img src="docs/assets/mobile-zh.png" alt="Synthetic Chinese mobile dashboard" width="390">

</details>

## Configuration and optional tools

Edit the edition's configuration file and restart its service. [config.example.toml](config.example.toml) lists all options.

```toml
[server]
host = "auto"
port = 9100

[monitor]
interval = 5
raw_retention_days = 2
history_retention_days = 90
disk_scan_interval = 21600
disk_roots = ["auto"]

[ups]
backend = "auto"
nut_target = ""
apcupsd_target = "127.0.0.1:3551"
events_file = "/var/log/apcupsd.events"
```

`disk_roots = ["auto"]` includes `/home` and automatically discovered mounted data filesystems, excluding system mount trees. To include directories on the root filesystem explicitly, use paths such as `["auto", "/fast", "/data", "/public"]`. Scans do not follow symlinks, do not cross filesystem boundaries within a scan root, and deduplicate hard links.

| Optional tool/source | Used for |
| --- | --- |
| `lscpu`, `lsblk` (util-linux) | CPU and storage specifications |
| `dmidecode` | Memory slots, DIMM models and firmware data; normally requires root |
| `lspci` / `lsusb` | PCI and USB hardware descriptions |
| `docker` CLI | Readable daemon/container status and statistics; honors its existing context |
| `apcaccess` or `upsc` | Existing apcupsd or NUT server status |
| Kernel `/proc` and `/sys` | Processes, interfaces and available temperature sensors |

Missing optional tools do not prevent core monitoring. Unavailable values show as `—` or gray; permissions and partial scans are reported.

## Manage, update and back up

| Action | User Edition | Admin Edition |
| --- | --- | --- |
| Status | `systemctl --user status nodepeek` | `sudo systemctl status nodepeek` |
| Restart | `systemctl --user restart nodepeek` | `sudo systemctl restart nodepeek` |
| Logs | `journalctl --user -u nodepeek -n 100` | `sudo journalctl -u nodepeek -n 100` |
| Disable | `systemctl --user disable --now nodepeek` | `sudo systemctl disable --now nodepeek` |

The installer refuses to overwrite an existing code directory. For an update, back up data, stop the old service and install into a new code directory using `--prefix /absolute/new/path`. It preserves the edition's existing configuration/history and updates the service to the new path. Keep the old code until the new version works. Do not run two collectors against the same database or port. When switching editions, use the [migration instructions](docs/OPERATIONS.md); the data paths and ownership differ.

Use SQLite's backup API for an online backup, or stop the service before copying its data directory. Copying only a live `.sqlite3` file can miss uncheckpointed WAL data. See [operations](docs/OPERATIONS.md) for backup, migration and removal steps.

### Measurement limits

- CPU is normalized to the entire host, so one fully busy core on a 16-thread host is about 6.25%. The dashed **Host total** includes work not attributable to readable user processes.
- Per-process memory is **RSS**; shared pages can be counted more than once. It is not a unique-physical-memory accounting system.
- Default history keeps raw samples for two days and minute/hour summaries for ninety days. There is no resource history from before the software was running.
- Disk accounting uses allocated filesystem blocks, not apparent file lengths. Metadata, reserved blocks and inaccessible files explain differences from host capacity usage.
- Processes that start and exit between samples can be missed. Hardware and integration availability depend on your host and edition's permissions.

## Develop and build releases

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
# Optional: node tests/test_users.cjs (and the other tests/test_*.cjs files)
python3 scripts/build_locales.py
python3 scripts/build_release.py
python3 scripts/verify_release.py dist
```

To install the source checkout, choose `sh install.sh --edition user` or `sudo sh install.sh --edition admin`. For local development, copy `config.example.toml` to `config.toml` and run `.venv/bin/python run.py --host 127.0.0.1 --port 9100`.

To regenerate the synthetic README images:

```bash
.venv/bin/python -m playwright install chromium
.venv/bin/python scripts/render_readme.py
```

See [the release guide](docs/RELEASING.md) for uploadable assets and reproducible packaging. Public files come from an explicit allowlist, not a recursive archive of a running installation.

## License

Original NodePeek code: [MIT](LICENSE). Bundled Apache ECharts retains its Apache-2.0 license; see [third-party notices](THIRD_PARTY_NOTICES.md).

# Operations

## Data, updates and services

User Edition uses `${XDG_CONFIG_HOME:-$HOME/.config}/nodepeek/config.toml` and `${XDG_STATE_HOME:-$HOME/.local/state}/nodepeek/monitor.sqlite3`. Admin Edition uses `/etc/nodepeek/config.toml` and `/var/lib/nodepeek/monitor.sqlite3`.

Services are named `nodepeek.service`. They use a private `0077` umask. The dashboard is read-only, but the collector writes its own database. The runtime never invokes sudo. Packaged User Edition refuses to run as root; packaged Admin Edition requires root. A source checkout supports either installation explicitly.

For an update:

1. Back up the database and configuration.
2. Stop the old collector (`systemctl --user stop nodepeek` or `sudo systemctl stop nodepeek`).
3. Extract the matching new edition and install using a fresh absolute `--prefix`. For example, a future version could use `$HOME/.local/share/nodepeek-1.2.0` or `/opt/nodepeek-1.2.0`.
4. The existing config/data remain in their original paths. The systemd service is updated to use the new code; a prior unit is retained as `.service.bak`.
5. Verify the service and dashboard before removing the old code. If installation fails, correct the error and use a fresh prefix, or restore the previous service unit. Do not delete configuration or history to retry.

An existing unrelated monitor on port 9100 is not stopped automatically. Stop it yourself or choose a different port. Two collectors must not share a live database.

## SQLite backup

This online backup example uses environment variables so it works for either edition. Set them to your actual data path and desired new backup filename, and run with the appropriate file permissions.

```bash
export NODEPEEK_DATABASE="$HOME/.local/state/nodepeek/monitor.sqlite3"
export NODEPEEK_BACKUP="$HOME/nodepeek-backup.sqlite3"
python3 - <<'PY'
import os
import sqlite3
from pathlib import Path
source = Path(os.environ['NODEPEEK_DATABASE'])
target = Path(os.environ['NODEPEEK_BACKUP'])
if not source.is_file() or target.exists():
    raise SystemExit('The source must exist and the backup destination must be new.')
os.umask(0o077)
with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as db:
    with sqlite3.connect(target) as backup:
        db.backup(backup)
print('Backup created.')
PY
```

For Admin Edition, execute the equivalent command with root privileges, using `/var/lib/nodepeek/monitor.sqlite3`. Back up configuration separately. An alternative is to stop the service cleanly, then copy the complete data directory, including any SQLite sidecar files. Restore only with the collector stopped.

## Changing editions

The edition directories intentionally differ. Migration is not automatic.

- Stop and disable the old service first. Back up its database/configuration.
- Install the new edition with `--no-service` so no collector starts before migration.
- Copy the configuration and consistent database backup to the destination edition's paths. Preserve intended private permissions. For migration to Admin Edition, the destination belongs to root. For migration to User Edition, an administrator must transfer ownership of the copied files to that user; the unprivileged installer cannot take over root-owned history.
- The `--no-service` installation generates `start.sh` but does not register a unit. Run it under your supervisor, or generate the unit with `sh install.sh --dry-run` and register the shown unit manually. Alternatively, after preparing the destination config/data, install normally into another new code prefix.
- Verify that the new collector is the only process using its port and database. Historical totals collected as root may be more complete than later unprivileged scans; partial-data indicators remain significant.

## Removing a service

First disable and stop it with the command in the README. Remove only its unit file (`~/.config/systemd/user/nodepeek.service`, honoring XDG config, or `/etc/systemd/system/nodepeek.service`) and run the matching `systemctl --user daemon-reload` or `sudo systemctl daemon-reload`.

The installation prefix, configuration and history are separate. Archive the data before deleting any of them. The software does not delete history automatically during uninstall.

## Troubleshooting

- **Address not reachable:** inspect the bind URL in logs; `auto` can select localhost if ZeroTier was unavailable at startup. Set an explicit interface IP and restart. No firewall rules or ZeroTier membership are changed by the installer.
- **Port already in use:** stop the other collector or configure a different port. Do not solve this by running duplicate collectors against the same database.
- **User service stops at logout:** check the host's existing linger policy. Use an appropriate session/service supervisor or ask the system administrator to configure persistence. No-sudo does not imply boot-time persistence on every Linux installation.
- **Missing DIMMs/UPS/containers:** check the optional command availability and existing access permissions. Admin privileges alone do not install these tools or configure their daemons.
- **Disk history initially sparse:** scans run every six hours. The chart may have one or two samples even in a seven-day window; it does not manufacture older history.
- **Gray storage:** inaccessible or changed files, filesystem metadata, reserved blocks and partial coverage can prevent complete attribution.
- **Install failed while downloading dependencies:** retain the error, verify package-index/network access, and retry into a fresh prefix. Configuration and historical data are preserved.

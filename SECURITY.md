# Deployment and data boundaries

NodePeek serves a read-only monitoring dashboard over HTTP. It has no application login. Bind it to a trusted ZeroTier/private address, or keep the default localhost fallback. Every device that can reach that address can read usernames, network addresses, mount paths, container names and monitoring history. Do not expose the port directly to an untrusted network.

`host = "auto"` chooses the first available ZeroTier IPv4 at process startup, otherwise `127.0.0.1`. Start ZeroTier first or set an explicit address and restart NodePeek. Multiple networks can be disambiguated with an explicit bind address. NodePeek does not create or join a ZeroTier network.

User Edition never elevates privileges. Admin Edition runs the collector as root to read protected process/file/hardware information. Its installer uses root-owned directories and a private umask. Installing it does not grant other users sudo, Docker-group membership or access to the Docker socket. Docker socket access is powerful even when the monitor only issues read-only commands; configure it deliberately outside NodePeek.

The hardware inventory uses a field allowlist and omits serial numbers, UUIDs, asset tags and MAC addresses. Normal runtime data is not anonymized: it intentionally identifies local users and devices. The **public distribution** is sanitized separately: local configuration, SQLite databases, logs, hardware snapshots, virtual environments and real-server screenshots are excluded by an explicit release manifest. Documentation uses synthetic data only.

When reporting a problem, include a minimal reproduction and sanitized errors. Do not attach a live database, private configuration or screenshots containing real addresses or account names. Use the repository owner's private reporting channel for security-sensitive reports.

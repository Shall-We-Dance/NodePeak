# Changelog

## Unreleased

- Keep live used/free/reserved disk capacity visible after file deletion; label inconsistent user totals as historical and avoid fabricated attribution.
- Give power/temperature charts and events an independent time range, collapse sensors by default, and compact the scrollable event list.

- Add read-only CI for supported Python versions, frontend tests, generated assets, release reproducibility/audits and synthetic browser previews.
- Document the repository maintenance workflow and keep generated source manifests out of the editable repository root.

## 1.3.2

- Adopted NodePeek as the product name across the dashboard, documentation, installer defaults and release archives.

## 1.3.1

- Renamed the project to NodePeek across the dashboard, documentation, installer defaults and release archives.

## 1.3.0

- Network & disk I/O and Docker now have separate history ranges, including custom dates, independent of Resource trends.
- Chart axes, loading/error states and interface/metric selection follow each section's range.
- Restyled native select controls with consistent dark surfaces, dropdown arrows and keyboard focus indicators.

## 1.2.0

- Dedicated Hardware section and sidebar navigation.
- Compact motherboard schematic with DIMM contacts along the long edge.
- Storage labels distinguish NVMe, SATA/SAS SSD/HDD, ATA, virtual and RAID devices. Unknown transport or media is not guessed; RAID controller rotation flags do not describe member drives.

## 1.1.0

- Interactive 2D hardware twin with adaptive CPU sockets and DIMM slots, including installed, empty and unknown occupancy.
- Clickable motherboard, BIOS, operating system, physical interfaces and storage devices; full specifications remain available.
- Schematic-layout disclosure and honest unprivileged/partial inventory fallbacks; no guessed physical wiring or drive bays.
- Persistent selection, keyboard activation, mobile navigation, five-language labels and synthetic one-/four-socket documentation images.

## 1.0.0

First public NodePeek release.

- Live CPU, memory, mounted storage, network traffic, Docker containers, temperatures, uptime and UPS state, with SQLite history.
- Stacked per-user CPU/memory trends; UID < 1000 grouped as expandable System; individual account filtering.
- Per-disk ownership using full filesystem capacity, per-user storage cards and partial-data indicators.
- Independent disk history, default seven days, presets from twelve hours to ninety days and custom dates.
- Physical/Docker/ZeroTier interface classification, UPS events and default-collapsed hardware inventory.
- English, Simplified Chinese, Korean, Spanish and Japanese; responsive desktop/mobile dashboard.
- Separate User (no sudo) and Admin (root system service) packages, MIT license, illustrated bilingual documentation and sanitized release tooling.

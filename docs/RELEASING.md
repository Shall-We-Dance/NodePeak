# Publishing NodePeek / 发布指南

Project repository: [Shall-We-Dance/NodePeak](https://github.com/Shall-We-Dance/NodePeak). The product and package name is **NodePeek**.

项目仓库名为 **NodePeak**，软件和安装包名为 **NodePeek**。

## Prepare a release

1. Merge reviewed changes after CI passes. Update `VERSION`, `CHANGELOG.md`, and both READMEs' versioned installation examples together.
2. Build and audit from the exact commit to release using the commands below.
3. Review `dist/RELEASE_NOTES.md` and the synthetic documentation images. Add the version's specific changes from the changelog to the release description.
4. Create a GitHub Release in this repository, choosing tag `v<VERSION>` at that same commit. Use title `NodePeek v<VERSION> — User & Admin Editions`.
5. Attach the matching User/Admin `.tar.gz`, source `.zip`, and `SHA256SUMS`. Optionally attach `release-audit.json`.

当前版本见仓库根目录 `VERSION`。审核合并并通过 CI 后，从对应提交打包、审查并手动发布。不要将 `dist/`、运行数据或真实截图提交进源码仓库。

GitHub's automatic source archives do not contain edition-specific metadata. Use the generated User/Admin packages for installation defaults, or explicitly choose `--edition` when installing a source checkout.

`release-source/` is a generated clean source snapshot for distribution. For normal maintenance, commit changes in the existing clone; do not replace the repository with this directory. Root `SOURCE_MANIFEST.json` files from earlier archive uploads are unnecessary in Git: the builder generates a fresh manifest for each archive and clean snapshot.

CI validates changes and generates synthetic UI preview artifacts. It does not publish GitHub Releases or deploy to the running server.

## Build again

From the clean source tree, with Python 3.11+:

```bash
python3 scripts/build_locales.py
python3 scripts/build_release.py
python3 scripts/verify_release.py dist
```

The builder emits `release-source/` and `dist/` in the current source tree. It uses an explicit file allowlist, normalized archive metadata and a deterministic timestamp (override with `SOURCE_DATE_EPOCH`). It never recursively archives the running installation. Rebuilding identical public files with the same timestamp produces identical archive checksums.

For a version change, update `VERSION`, release notes/changelog and the versioned examples in both READMEs before building. Review new source files and extend `release_tools/files.py` deliberately if they need to ship. Tests, README links, checksums and edition metadata should be validated before publishing.

## Sanitization checks

The release verifier rejects private runtime paths, database/log/env files, hardware snapshots, symlinks, unsafe archive paths, private-network IP literals and common credential patterns. Optional `--forbid-file PRIVATE_JSON` adds exact local identifiers to the scan; that private JSON must remain outside the public source tree. Archive headers omit local owner names and source paths. The public audit report does not list any real identifiers.

Screenshot provenance is explicit: `scripts/render_readme.py` serves the real frontend against `scripts/demo_data.py`; the fixture never reads host resources or the live monitoring API. Only loopback requests to that temporary fixture server are allowed. Regenerate images this way rather than blurring real-server screenshots.

Automated checks reduce accidental disclosure; review the clean repository and images before publishing. Normal installed runtime data still identifies the local machine's users and resources, as intended by a monitoring application.

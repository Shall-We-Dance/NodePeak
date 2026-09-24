# Publishing NodePeek / 发布指南

The provided `release-source/` folder is a clean, uploadable repository tree. The working installation and its private data are not part of this tree. You publish it yourself; the build scripts do not create repositories, upload files or read GitHub credentials.

提供的 `release-source/` 是可直接上传 GitHub 的干净代码目录。`dist/` 中是 Release 附件。不要上传正在运行的整个开发目录；它可能有真实配置、数据库和截图。

## Files for the first release

- Repository name suggestion / 建议仓库名: **NodePeek**
- Tag / 标签: **v1.3.2**
- Release title / 标题: **NodePeek v1.3.2 — User & Admin Editions**
- Description / 描述: copy `dist/RELEASE_NOTES.md`.
- Assets / 附件: the User and Admin `.tar.gz`, the source `.zip`, and `SHA256SUMS`.
- Optional audit attachment / 可选审计附件: `release-audit.json` (file counts and check results only).

Create your public repository, upload the **contents** of `release-source/` so README.md is at the repository root, then create a GitHub Release for `v1.3.2` and attach those files. GitHub's automatically generated source archive is separate from the two edition-specific install packages.

创建公开仓库后，把 `release-source/` **里面的内容**放在仓库根目录，保证打开仓库就能看到图文 README。然后创建 `v1.3.2` Release，粘贴发布说明并上传附件。无需把 `dist/`、虚拟环境或历史数据提交到仓库。

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

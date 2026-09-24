# Contributing / 开发与维护

The software is **NodePeek**; its repository is [Shall-We-Dance/NodePeak](https://github.com/Shall-We-Dance/NodePeak). The spelling difference does not change package names or `nodepeek.service`. While the repository is private, cloning, pull requests and Actions artifacts require an authorized GitHub account.

软件名为 **NodePeek**，当前仓库名为 **NodePeak**。安装包与服务名保持 `nodepeek`。仓库为 private 时，需要有权限的 GitHub 账号访问。

## Work in a source checkout

Use a branch in a clean clone, separate from a running installation and its database:

```bash
gh repo clone Shall-We-Dance/NodePeak
cd NodePeak
git switch -c fix/describe-the-change
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

Python 3.11+ is required. Frontend logic tests use Node.js (CI uses Node 22); no npm dependencies or frontend build are needed.

## Validate a change

```bash
.venv/bin/python -m pytest -q
for test in tests/test_*.cjs; do node "$test" || exit 1; done
python3 scripts/build_locales.py
git diff --check
python3 scripts/build_release.py
python3 scripts/verify_release.py dist
```

When changing UI strings, update all five `static/locales/*.json` dictionaries, then commit the rebuilt `static/locales.js` and `static/index.html`. When changing CSS/JS without translations, run `python3 scripts/version_assets.py` and commit the updated asset URLs. CI rejects stale generated assets.

修改文案时须同步五种语言并重新生成语言包；修改 JS/CSS 后须刷新资源哈希。CI 会检查生成文件是否过期。

For browser smoke checks and README illustrations, use fictional data only:

```bash
.venv/bin/python -m playwright install chromium
.venv/bin/python scripts/render_readme.py
```

On a minimal Linux host, Playwright may need OS libraries; `python -m playwright install --with-deps chromium` installs them with administrator privileges. The renderer never starts the real collector. Inspect regenerated screenshots before committing them. Use `--output-dir test-results/synthetic` for a smoke check that leaves the committed README images untouched. The optional `check_hardware_twin.py` and `check_independent_ranges.py` scripts take an explicit running dashboard URL; they are not required to access production for CI.

## Pull requests and releases

Review `git diff` and stage specific source files. Do not include real configuration, history databases, hardware snapshots, logs or credentials. CI runs Python 3.11/3.13 tests, all JavaScript logic tests, locale/asset checks, reproducible release builds, archive audits and a synthetic browser smoke test. Its token is read-only; it does not deploy, publish a release or change repository visibility.

提交前检查差异，只添加源码和脱敏演示资料。CI 不会部署服务器、自动发布 Release 或将仓库公开。

Push your branch and open a PR with the problem, resulting behavior and validation:

```bash
git push -u origin HEAD
gh pr create
```

A PR becoming green does not update an installed service. Follow [operations](docs/OPERATIONS.md) for deployment and [releasing](docs/RELEASING.md) for packages. `SOURCE_MANIFEST.json` is generated inside release output only; it should not be committed in the editable repository root.

# Project Task Report — 2026-10-02: v0.11.1 README and Release Repair

## Goal

Correct the stale release instructions and missing npm page README in v0.11.0. Provide an exact, verifiable 0.11.1 install path for DeepSeek Harness Desktop 0.2.0-rc.1 and 0.2.0-rc.2, and preserve the older releases.

## Current publication status

The local 0.11.1 archive is ready, but **npm publication has not succeeded**. Public registry lookup for `0.11.1` returns 404. Multiple publish attempts reached the registry and then failed during the large PUT upload (`ECONNRESET` / `ETIMEDOUT`); do not treat the npm package name as installable yet. The versioned GitHub release is the fallback install source and is being prepared separately. npm's existing `latest` tag remains 0.4.32.

## Work completed

- Prepared version 0.11.1 as a documentation and package-metadata patch over the 0.11.0 runtime. No model-routing or Gal runtime behavior was changed.
- Rewrote the English and Chinese READMEs and the Chinese installation guide so the exact package is `@ljwei-stak/model-router-galgame@0.11.1`. The docs explain that npm's `latest` tag remains on 0.4.32, so users must enter the exact version.
- Explained the old compatibility failure: 0.10.1 only declared the rc.1 peer range; the 0.11.x manifest accepts rc.1 and rc.2. The installer should use the official registry HTTPS source if a selected mirror has not synchronized the release.
- Updated Gal story, artwork, and settings documents to remove obsolete “unpublished candidate” wording and link to the current release report.
- Added all local images referenced by the READMEs to the npm `files` allowlist. The packed archive contains 49 entries and every relative image reference in `README.md`, `README.zh.md`, and `INSTALLATION_GUIDE.zh.md` resolves inside the archive.
- Repacked the archive and generated a SHA-256 sidecar. Current local archive SHA-256: `5abe474da7b63da18b7d27a4d3d41451274c7dc2ea9df0100a74d85d818f41ea`.
- Updated the Desktop compatibility test's expected package version to 0.11.1.

## Changed files

| File | Purpose |
| --- | --- |
| `package.json` | Bumps to 0.11.1 and includes README diagrams, screenshots, and the story title art in the package. |
| `README.md` | Replaces stale candidate instructions with the exact release version, compatibility notes, installation steps, and algorithm/use documentation. |
| `README.zh.md` | Chinese release, compatibility, installation, routing algorithm, Gal usage, and verification instructions. |
| `INSTALLATION_GUIDE.zh.md` | Chinese step-by-step installation and first-run checks. |
| `docs/ECHO_CITY_STORY.zh.md` | Updates release references and usage notes for the Gal story collection. |
| `docs/GAL_ART_SOURCES.zh.md` | Refreshes the art source guide's release links. |
| `docs/GAL_SETTINGS.zh.md` | Refreshes settings guide version links and labels. |
| `tests/desktop-compat.test.mjs` | Asserts the 0.11.1 manifest and supported host peer ranges. |
| `PROJECT-TASK-REPORT-2026-10-02-NPM-RELEASE-AND-README-FIX.md` | This report: files, checks, remaining acceptance items, and follow-up steps. |

## Verification

- `npm test`: **153 passed, 0 failed**.
- `npm run check:client`: passed.
- `pnpm peers check`: passed with no peer dependency issues.
- `npm pack --pack-destination dist`: succeeded; package version 0.11.1, 49 files, 44.0 MB compressed.
- Archive README assets: **0 missing references** across the three published Markdown guides.
- `git diff --check`: passed; Git emitted only a Windows line-ending notice for the edited compatibility test.

These checks validate the source and the local archive. They do not by themselves establish that npm's security scan has finished, that GitHub assets match the final archive, or that the current Desktop profile accepts the newly installed 0.11.1 package.

## Still to finish

1. Retry npm 0.11.1 when the registry accepts package uploads. Complete the browser verification for that attempt, wait for npm's lifecycle status to become `published`, then verify the public version document, README metadata, tarball and SHA-256. Keep the `next` dist-tag and do not move `latest` from 0.4.32.
2. Commit and push the source, create the `v0.11.1` GitHub release, attach the exact `.tgz` and `.sha256` files, then download the GitHub asset and compare its hash with the local archive.
3. In the user's DeepSeek Harness Desktop profile, install the versioned GitHub release archive (or the exact npm package after registry confirmation), enable it, and confirm plugin details show 0.11.1 and both **模型路由** and **Gal 模块** entries render. Preserve the existing profile and saves.
4. After the UI acceptance check, separately verify a configured provider route and any official CLI that the user has credentials for. Check observed provider/model identity and billing in the user's own account; these are live-account checks and are not simulated by unit tests.

## How to finish the remaining checks

- For npm, retry `npm publish --tag next --access public` when registry uploads are healthy. Complete its fresh browser verification promptly, then verify the published lifecycle and compare the registry tarball byte-for-byte. Never move `latest` from 0.4.32 as part of this patch.
- For GitHub, push the source and annotated `v0.11.1` tag to `origin`, attach the prepared tarball and checksum sidecar to a release, then verify a fresh download.
- In the Desktop plugin manager, choose **插件 → 添加插件** and install from the versioned GitHub release archive. If npm later confirms the exact version is published, `@ljwei-stak/model-router-galgame@0.11.1` is also valid. If installation fails, expand **查看安装详情** and capture the host version and full peer-dependency error before changing compatibility metadata.

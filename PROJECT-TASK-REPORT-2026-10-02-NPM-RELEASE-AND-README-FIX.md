# Project Task Report — 2026-10-02: v0.11.1 README and Release Repair

## Goal

Correct the stale release instructions and missing npm page README in v0.11.0. Provide an exact, verifiable 0.11.1 install path for DeepSeek Harness Desktop 0.2.0-rc.1 and 0.2.0-rc.2, and preserve the older releases.

## Current publication status

GitHub **v0.11.1 is published** with the `.tgz` and `.sha256` assets. I downloaded both assets from the release and confirmed the archive hash matches the local file and sidecar. npm **v0.11.1 is now published** after completing npm's web-auth challenge and retrying the package upload. The public registry resolves `@ljwei-stak/model-router-galgame@0.11.1`; its `dist.shasum` matches the local archive (`58047e12a4e17859f30656bf9c371cbf412f170d`). The `next` tag points to 0.11.1. The existing `latest` tag intentionally remains 0.4.32.

## Work completed

- Prepared version 0.11.1 as a documentation and package-metadata patch over the 0.11.0 runtime. No model-routing or Gal runtime behavior was changed.
- Rewrote the English and Chinese READMEs and the Chinese installation guide so the exact package is `@ljwei-stak/model-router-galgame@0.11.1`. The docs explain that npm's `latest` tag remains on 0.4.32, so users must enter the exact version.
- Explained the old compatibility failure: 0.10.1 only declared the rc.1 peer range; the 0.11.x manifest accepts rc.1 and rc.2. The installer should use the official registry HTTPS source if a selected mirror has not synchronized the release.
- Updated Gal story, artwork, and settings documents to remove obsolete “unpublished candidate” wording and link to the current release report.
- Added all local images referenced by the READMEs to the npm `files` allowlist. The packed archive contains 49 entries and every relative image reference in `README.md`, `README.zh.md`, and `INSTALLATION_GUIDE.zh.md` resolves inside the archive.
- Repacked the archive and generated a SHA-256 sidecar. Current release archive size: **43,963,934 bytes**. SHA-256: `5abe474da7b63da18b7d27a4d3d41451274c7dc2ea9df0100a74d85d818f41ea`.
- Pushed source and documentation to GitHub `main`; created the `v0.11.1` release with both archive assets. A fresh GitHub download matches the local tarball and sidecar byte-for-byte by SHA-256.
- Updated the Desktop compatibility test's expected package version to 0.11.1.
- After the npm registry accepted 0.11.1, updated the source READMEs and installation guide to show the exact npm version and `next` tag. npm `latest` remains 0.4.32 to avoid changing the stable install default.

## Changed files

| File | Purpose |
| --- | --- |
| `package.json` | Bumps to 0.11.1 and includes README diagrams, screenshots, and the story title art in the package. |
| `README.md` | Replaces stale candidate instructions with the release version, compatibility notes, installation steps, and algorithm/use documentation. |
| `README.zh.md` | Chinese release, compatibility, installation, routing algorithm, Gal usage, and verification instructions. |
| `INSTALLATION_GUIDE.zh.md` | Chinese step-by-step installation and first-run checks, including npm tag behavior and the GitHub archive fallback. |
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
- `git diff --check`: passed; Git emitted only Windows line-ending notices for two edited text files.
- GitHub `v0.11.1` release API lists two assets. The archive downloaded from GitHub is 43,963,934 bytes; its SHA-256 equals both the local archive and sidecar.
- npm `view @ljwei-stak/model-router-galgame@0.11.1 version dist.tarball dist.shasum`: returns version 0.11.1 and the expected tarball URL; the registry `dist.shasum` matches the local `.tgz` SHA-1.
- npm `dist-tag ls @ljwei-stak/model-router-galgame`: `next: 0.11.1`; `latest: 0.4.32`.
- The final publish command exited 0 and npm printed `+ @ljwei-stak/model-router-galgame@0.11.1`. The registry initially returned 404 while processing the new package; subsequent exact-version and dist-tag queries confirmed it became available.
- Local archive SHA-1: `58047e12a4e17859f30656bf9c371cbf412f170d`, matching npm's public `dist.shasum`; local and GitHub release SHA-256: `5abe474da7b63da18b7d27a4d3d41451274c7dc2ea9df0100a74d85d818f41ea`.

The registry metadata confirms that npm lists the published version and points at the expected archive hash. The downloaded GitHub release assets match the local archive and sidecar. The user's current Desktop profile and live provider accounts still need acceptance testing.

## Still to finish

1. The npm package's README snapshot was packed before the final upload and therefore still contains a pre-publication sentence saying the upload is pending. The source READMEs on `main` are corrected. To update the immutable npm README page, prepare a docs-only 0.11.2 release, repack, and publish it under `next`.
2. In the user's DeepSeek Harness Desktop profile, install `@ljwei-stak/model-router-galgame@0.11.1` (or use the GitHub archive), enable it, and confirm plugin details show 0.11.1 and both **模型路由** and **Gal 模块** entries render. Preserve the existing profile and saves.
3. After the UI acceptance check, separately verify a configured provider route and any official CLI that the user has credentials for. Check observed provider/model identity and billing in the user's own account; these are live-account checks and are not simulated by unit tests.

## How to finish the remaining checks

- In the Desktop plugin manager, choose **插件 → 添加插件** and enter `@ljwei-stak/model-router-galgame@0.11.1`; alternatively, install the v0.11.1 GitHub archive. If installation fails, expand **查看安装详情** and capture the host version and full peer-dependency error before changing compatibility metadata.
- For the npm-rendered README correction, bump only the documentation package version to 0.11.2, update the package version assertion and report, pack and verify the archive, then publish `--tag next`; preserve `latest: 0.4.32`.

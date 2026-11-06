# Source build guide

## English

<a id="development"></a>

## Develop and build from source

Requirements: plain **Node.js 22.19+** and **pnpm 10.34.6** (the repository's package-manager pin). Native SQLite/PTY modules must run through the matching plain Node runtime, not Electron's incompatible ABI. From the repository root:

```powershell
npm install --include=dev
npm run build:client
npm run check:client
node scripts/check-readme.mjs
npm test
node scripts/integration-product-source.mjs
npm --prefix remote-computer-agent ci
npm --prefix remote-computer-agent run build
npm run pack:local
```

Install the generated `dist/*.tgz` in a test profile. `npm run preview:ui` provides an offline fixture preview, not authenticated Host acceptance. When SDK packages are unavailable from the configured registry, `scripts/setup-harness-dev.mjs` supports an explicitly supplied installed Host tree; follow its options and do not substitute an arbitrary SDK version silently.

For a Windows x64 Agent bundle after its dependencies are installed:

```powershell
powershell -NoProfile -File scripts/package-remote-agent.ps1
```

The packaging helper builds native helpers, includes the plain Node runtime/dependencies and verifies SQLite before creating its zip under `tmp/integration/remote-agent-package/`. Its output includes the package path and SHA-256. Setup is run on the user-provided Windows computer, not during source packaging.

### Reproduce the pinned upstream runtime

Never edit `modules/bot-runtime/vendor/ds-bot/` directly. Product changes belong in the external overlay. Import from the explicit checkout and pinned commit:

```powershell
node scripts/sync-ds-bot.mjs --source ../DS-Bot-upstream --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a
node scripts/sync-ds-bot.mjs --check --source ../DS-Bot-upstream --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a
npm run build:client
npm run check:client
```

Without a source argument, `node scripts/sync-ds-bot.mjs --check` checks the recorded vendored bytes; it does not guess a sibling `../ds-bot`. An intended upstream change requires reviewing the source commit and overlay application. `.dsh-plugin/client.js` is generated.

The paired READMEs retain six display formulas and 33 inline mathematical expressions. After editing both translations, update `README.i18n.yaml` with their exact Git blob SHA-1 values and run `node scripts/check-readme.mjs` plus `node --test tests/readme-math.test.mjs`. Structural checks do not replace a visual renderer check.

## 简体中文

<a id="development"></a>

## 从源码开发和构建

需要普通 **Node.js 22.19+** 和 **pnpm 10.34.6**（仓库固定的包管理器版本）。原生 SQLite/PTY 模块必须使用匹配的普通 Node 运行时，不能通过不兼容的 Electron ABI 加载。在仓库根目录执行：

```powershell
npm install --include=dev
npm run build:client
npm run check:client
node scripts/check-readme.mjs
npm test
node scripts/integration-product-source.mjs
npm --prefix remote-computer-agent ci
npm --prefix remote-computer-agent run build
npm run pack:local
```

在测试 profile 中安装生成的 `dist/*.tgz`。`npm run preview:ui` 是离线 fixture 预览，不是认证 Host 验收。配置的 registry 无法提供 SDK 包时，`scripts/setup-harness-dev.mjs` 支持显式指定已安装 Host 树；按其选项操作，不静默替换任意 SDK 版本。

安装 Agent 依赖后，可以在 Windows x64 上生成完整包：

```powershell
powershell -NoProfile -File scripts/package-remote-agent.ps1
```

打包脚本构建原生 helper，包含普通 Node 与生产依赖，验证 SQLite 后在 `tmp/integration/remote-agent-package/` 创建 zip，输出产物路径和 SHA-256。安装向导在用户准备的 Windows 电脑上运行，不在源码打包时运行。

### 复现固定上游运行时

不要直接编辑 `modules/bot-runtime/vendor/ds-bot/`，产品修改应放在外置 overlay。导入时显式指定来源 checkout 和固定提交：

```powershell
node scripts/sync-ds-bot.mjs --source ../DS-Bot-upstream --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a
node scripts/sync-ds-bot.mjs --check --source ../DS-Bot-upstream --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a
npm run build:client
npm run check:client
```

不带来源参数的 `node scripts/sync-ds-bot.mjs --check` 只检查已记录的 vendor 字节，不猜测同级 `../ds-bot`。有意升级上游时要检查来源提交与 overlay 应用结果。`.dsh-plugin/client.js` 是生成文件。

双语 README 保留 6 个展示公式和 33 个行内数学表达式。修改两份翻译后，将准确 Git blob SHA-1 写入 `README.i18n.yaml`，运行 `node scripts/check-readme.mjs` 和 `node --test tests/readme-math.test.mjs`。结构校验不能代替实际渲染检查。

Version-specific validation and release history are kept in [release reports](releases/) and the [changelog](../CHANGELOG.md).

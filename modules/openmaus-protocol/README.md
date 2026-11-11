# OpenMausBot 端到端协议

冻结复用 `companion/src/e2e` 的 Noise、凭据派生、设备描述符、yamux、流会话与 Node 客户端。来源、固定提交、完整许可证和每文件 SHA-256 位于 `SOURCE.json`、`NOTICE` 与 `vendor/LICENSE`。

这是全功能迁移的协议底座，导入协议本身不授予任何 Bot、电脑或模型权限。产品适配器负责一次性配对、设备生命周期、Host 授权与原任务身份；不改冻结源文件。`scripts/openmaus-protocol-entry.mjs` 聚合冻结源码，经固定 esbuild 构建为 `dist/protocol.mjs`；生产 `index.mjs` 只导出 JavaScript。Node 不允许在 node_modules 中直接擦除 TypeScript，因此不能把开发目录中直接导入 `.ts` 的成功当作安装后可用。

```sh
node scripts/sync-openmaus-protocol.mjs --check
node scripts/sync-openmaus-protocol.mjs --source ../OpenMausBot
node scripts/build-openmaus-protocol.mjs
node scripts/build-openmaus-protocol.mjs --check
node --test tests/pairing-protocol.test.mjs
```

导入只接受固定提交的可信 checkout；允许 Windows 检出换行差异，写入 vendor 的始终是固定 Git blob 原始字节。更换提交是显式的源升级，不能自动取远端最新版本。

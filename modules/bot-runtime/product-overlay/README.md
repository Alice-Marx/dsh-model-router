# 产品覆盖层（product-overlay）

本目录保存 MR 对上游 DS Bot runtime 的**自有改动**。`vendor/ds-bot/` 永远由
`scripts/sync-ds-bot.mjs` 生成：先按字节复制上游 checkout，再把本目录的改动重新盖上去。
因此同步不会丢掉产品改动，也不会让上游的新代码被旧副本覆盖。

## 条目形态

`OVERLAY.json` 的每个条目是两种之一：

- `kind: "product-file"`：上游没有对应文件，产品自有。文件实体在 `files/<vendor 路径>`，
  同步时按字节复制进 vendor。目前只有 `src/client/desktop-pane.js`（Bot 抽屉里的远程桌面页）。
- `kind: "patched"`：上游文件加上产品的少量改动。`base/<vendor 路径>` 是生成补丁时对应的
  上游文件内容，`patches/<vendor 路径>.patch` 是统一 diff，`base.commit` / `base.sha256`
  记录它是哪个上游版本。同步时把补丁应用到当前上游文件上，因此**上游在同一文件里的新改动
  会保留**，只有产品的行被改掉。

补丁按内容行比较，与 CRLF/LF 无关；结果沿用被补文件原有的行尾。`SOURCE.json` 的
`overlays` 数组记录同样的条目，`files[].origin` 为 `overlay` 的即产品自有字节，
`generated` 的是按打过补丁的源码重新构建的 `client.js`，其余都必须与上游逐字节相同。

## 同步

```sh
# 从可信 checkout 同步，并固定提交（HEAD 不一致会直接失败）
node scripts/sync-ds-bot.mjs --source ../DS-Bot-upstream \
  --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a --rebase-overlay

# 只校验：不带 --source 时校验 vendor 与 SOURCE.json；带上时逐字节比对上游并重建 client.js
node scripts/sync-ds-bot.mjs --check [--source ../DS-Bot-upstream]

# 特性矩阵与覆盖层报告
node scripts/check-upstream-parity.mjs [--source ../DS-Bot-upstream] [--diff]
```

`--source` 是唯一能让字节进入 vendor 的途径：不再自动寻找 `../ds-bot` 或仓库内的
`ds-bot/`，打包后的仓库没有同级 checkout 也能正常 `build:client` / `check:client`
（此时只刷新和校验已有字节）。同步不访问网络。

上游改了被打过补丁的文件时，补丁会按偏移应用；`--rebase-overlay` 把 `base` 换成新上游
内容并重写补丁，使下次同步回到精确匹配。若某一段上下文再也匹配不上，同步直接失败并指出
位置，需要人工重新表达该处改动——不会静默丢掉产品行为或上游改动。

## 当前条目

| 条目 | 说明 |
| --- | --- |
| `src/client/desktop-pane.js` | Grok Bot 式远程桌面页：仅观看 / 取得控制权、小卡与放大窗。本身不持有任何权限，全部通过产品客户端注册在 `globalThis.__dshDesktop` 上的桥调用。桥上有 `renderPane` 时交给产品自己的桌面前端，否则回退到本页。 |
| `src/client/details-drawer.js` | 1:1 Bot 的抽屉增加「电脑操作」页签并渲染 `DesktopPane`。 |
| `src/client/sidebar.js` | 在团队列表下渲染 `actions.sidebarAddon`（MR 面板导航）。 |
| `src/client/index.js` | `sidebar.workspaces` 槽位探测接受被产品包装过的 `TeamSidebar`（`dsBotTeamSidebar`）。 |

Harness 0.2.2 的 system-prompt assembly 先只返回 sections、随后由 SDK 附加工具。`src/host/tools.js` 的产品补丁兼容该阶段没有 `tools` 的结果；原 hidden-tool 执行 guard 保留，未直接修改上游 checkout。

`src/host/schedules.js` 覆盖层引用产品自有 `../schedule-compat.mjs`，将0.2.1按Session的旧接口适配到0.2.2显式Host-wide Schedule API；新任务保留精确Session target，移动只读取该Session的active任务，删除验证target及expectedUpdatedAt。

# 跨进程契约

这里的每个目录都是一个**已发布**的消息版本：`<name>/<version>/`，含 `schema.json`、`fixtures/`，以及首次生成后即冻结的 `LOCK.json`。

## 规则

1. **已发布版本不可改**。`LOCK.json` 记录 `schema.json`、`fixtures/*` 与同一目录里其它 `.json` 的哈希。改动其中任何一项，`npm run check:contracts` 直接失败并提示"加 v2"。
2. **每个 schema 必须有 fixture**。没有 fixture 的 schema 只是猜测：没人喂过它。
3. **校验器只实现它认识的词**。`contracts/validate.mjs` 的可用关键字清单是白名单；写了一个未实现的词（例如 `if`、`$ref`）在加载时就报错，而不是被静默忽略——静默忽略会让拼写错误变成"检查通过"。
4. **产品动作全表声明**。`product-action/v1/actions.json` 由 `npm run contracts:write` 从 `product-composition.mjs` 生成后冻结。新增动作、或改动某个动作的调用者类别（owner / bot），都会在 `check:contracts` 里失败，直到表被重新生成并作为契约变更提交。

## 当前版本

| 契约 | 覆盖 | fixtures |
| --- | --- | --- |
| `task-request/v1` | 产品通道接受的任务请求（submit / retry / reconcile）；`target` 由宿主解析，模型不提供 | 3 |
| `task-event/v1` | 任务时间线里的一条持久事件；`kind` 故意开放，`detail` 是事实袋 | 3 |
| `product-action/v1` | 产品通道的请求信封 + 28 个动作的调用者类别 | 3 + actions.json |

## 命令

```sh
npm run check:contracts   # 校验 fixture、锁定已发布版本、核对动作全表
npm run contracts:write   # 从代码重新生成动作表（仅当这是有意的契约变更）
```

## 这与另外两个参考实现的关系

`Agents-Anywhere` 用 `contracts/<name>/<version>/` + `protocol:check` 保证四端一致；`OpenBot` 把"谁发起的"写进**签名断言**，不让任何一端自称。这里取了前者的目录与校验形状，以及后者的一条原则：`product-action` 的 `action` 名与 payload 是契约，但**调用者类别由宿主决定，永远不来自 payload**。

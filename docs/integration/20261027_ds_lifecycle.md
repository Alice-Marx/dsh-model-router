# DS 自动生命周期与真实 Gateway 检查

2026-10-27，接续 `062df18`。冻结 DS `de55888` 已公开导出 `createRuntime`。
本轮用该工厂创建原运行时，在外层包裹生命周期，不修改 DS 或 DSH SDK 源码。
这是独立测试 profile 的严格组合入口，没有迁移用户默认 profile 或数据。

## 提交后的归属才授予权限

`packages/orchestration/src/ds-lifecycle.mjs` 维护成功提交的 Bot/Session 归属快照。
一个 Bot 的当前私聊和群聊成员 Session 归到同一宿主主体，历史分段不取得活动权限。
真实 Agent 对象由 `resolveAgent` 或发布事件进入缓存；只有保存的归属确认后才绑定。
Session ID 在内存中出现得比提交早时，权限仍拒绝，不能用等待之外的手动绑定补洞。

保存调用强制 `required: true`，避免原 store 在只读/未写入时返回成功并授予内存权限。
调用时同步捕获即将写入的归属，等待原保存成功后再应用；后来尚未保存的内存变更不
进入该快照。初次load和refresh读取实际保存文件，限制32 MiB。归属/版本/重复Session/
群成员关系先整体校验，再更新目录；旧修订不恢复旧权限，同修订不同内容和Session
跨Bot重新归属会拒绝。

写入或读取失败会收紧现有授权、取消关联租约并解绑活动Agent；已加载后发现提交文件
缺失也不能保留旧权限。后续成功save/refresh
才能从可信提交恢复。关闭恢复本适配器拥有的方法；关闭前发起的保存即使迟到完成，
也不能重新授予权限。读写锁接管和所有恢复交错尚未验收。

## 从启动开始的真实组合

`--lifecycle` 禁用原profile的单独DS入口，以同一冻结工厂创建运行时，并在启动时
提供权限服务、设置MR `requireBotPolicy: true`。它与临时手动绑定的
`--legacy-policy` 是两个独立实验入口，不能同时启用。

严格组合仍通过既有9项Main/工种Bot的真实Session、派活、MR路由、用量及重启检查。
工种模型请求中只出现获准的MR路由工具。新检查还创建临时Bot与群，真实运行群成员
Session，改变临时Bot工作目录以触发DS自己的换段，验证旧Agent解绑、新Agent保持
原Bot主体；删除临时Bot后私聊/群聊身份均失效，Main和原工种Bot仍可用。新宿主进程
从保存状态重建绑定，没有测试代码调用`directory.bind`来修复归属。

测试第一次误用了内部群发函数的参数，已改为正式SessionController prompt。随后
修正了两项测试假设：应等保存后的自动绑定，不能只等成员ID分配；工作目录必须在
DSH数据home之外。上游原目录保护保持生效，没有放宽它或沙箱来制造通过。

## 真实 HTTP / Gateway

使用官方登录返回的临时cookie，经实际 `/api/modelRouterOfficialTools/...` 和
Gateway标准RPC信封调用。明确获准的owner方法成功；未获准方法在业务体前拒绝；
不带浏览器认证时HTTP拒绝。身份来自Gateway固定的peer principal，payload不能
提供owner。测试只授予只读边界查询，没有执行安装、命令、重跑或读取真实用户数据。
临时URL/cookie不写入公开证据或归档。

## 保留的门禁

授权配置仍是宿主提供的固定实验模型/能力；尚未建成用户配置、迁移与管理界面。
这层不是OS沙箱，不能替代真正DSH隔离worker或Windows专属账户。原先普通PTC的
partial隔离、Win11 ACL受阻仍保留。CLI私有引导、执行/重跑归属、持久Task、预算/
receipt、静默辅助推理主动取消均未完成。新增检查不把T05、T25或T33升级为passed。

```sh
npm run test:integration
node scripts/integration-combined-host.mjs --ds-root <frozen-DS> --host-root tests/fixtures/integration-host --lifecycle
```

全部推理由离线fixture提供，实际模型请求0。平台、代码摘要与结果见
[本轮证据](evidence/20261027_m0_ds_lifecycle.json)。CI两平台新增严格生命周期与
Gateway步骤，既有临时权限、PTC和原生数据库步骤继续保留。

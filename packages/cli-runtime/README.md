# 官方 CLI 运行时与 Task 执行组件

当前适配器是 Codex `app-server` 0.163.0、只读模式。本目录不是第二个可安装插件。
真实CLI的非推理引导与本组件的离线Task验证分开记录，不能将后者称为真实模型执行。

`createCodexSession` 要求宿主提供安装已核验的绝对原生入口、SHA256和版本；逐次校验入口，
为每个operation创建独立profile，校验有效MCP配置，绑定真实孙进程身份。命令行和环境中
不传授权bearer。Windows使用内核PID/创建时间/属主及Job Object，Linux使用SO_PEERCRED、
PID/启动时间/UID和进程祖先校验。长profile路径下仅Unix socket移到0700的短私有目录，
签名描述文件及密钥仍在profile，正常关闭后非递归清理socket目录。

`packages/orchestration/src/cli-execution.mjs` 提供
`probe/prepare/start/observe/cancel/collect/reconcile`，并导出固定的`createCliReadBackend`。
任务输入只接收文本，入口、模型、工作区、资金、能力和凭据配置均由宿主固定；这些内容
形成backend版本摘要。已排队任务遇到版本变化会停止，不能沿用旧预览启动不同的执行。

执行前先保留Task/attempt/operation引用，再通过唯一SQLite MR资金库预占并写`cli`
来源收据；`turn/start`前再次检查Task fence、授权和预算。Task当前期限上限两小时，
运行中续签短期租约，续签不能复活过期或已撤销的授权。取消等待CLI清理及原生停止证据，
不因按钮已点击就提前释放费用。缺失或不可信的结果保留unknown和原预占，重试必须新建
attempt/operation，恢复核对只读取原收据，不重放CLI。

订阅不制造API美元费用，未知token保持未知；Codex包含缓存的输入计数拆成互不重叠的
普通输入与缓存计数。每日订阅调用上限按UTC日、持久来源准入计数，资金运行归档后仍有效。
CLI配置模型不等于实际响应模型证明；当前协议没有报告可信API账单的路径，因此API CLI
执行会保留未知费用与预占，不以配置模型乘价格伪装成已核实美元收据。

复现：

```sh
node scripts/integration-cli-native.mjs
node scripts/integration-cli-execution.mjs
node scripts/integration-task-probe.mjs
```

三机结果见[CLI Task组件证据](../../docs/integration/evidence/20261027_m5_cli_execution.json)。
真实Codex0.163.0非推理证据见[机器阶段附带核验](../../docs/integration/evidence/20261027_m4_product_machines.json)。

尚未完成：默认产品Task/资金配置接线、完整Task/资金单事务准入、其他11个CLI适配器、
远程CLI、写入审批、真正OS worker、Electron ABI及真实GPT双来源工作流。
独立profile、MCP作用域或CLI只读参数都不是OS文件隔离验收。

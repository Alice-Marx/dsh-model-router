# 接手提示词（2026-10-30）

你接手 DSH Bot 一体化工程。工程当前位于 `F:/everyAI/dsh-model-router-all/dsh-model-router`，分支 `feat/bot-integration`，HEAD `89e831264ebc7dacacdd54234377e51f37fb0785`；大量未提交/未跟踪文件与被忽略的 vendor 就是工程主体，禁止 reset/clean/stash 或只取 HEAD/diff。

先完整阅读 [HANDOFF-20261030-CODEX.md](HANDOFF-20261030-CODEX.md)，它是当前状态权威入口。旧交接中的计数、GPT-only、已结束任务顺序不能覆盖本文件或用户最新 AGENTS。

当前阶段 E58–E60 完成：实际物理根准入/未知锁与 Linux 挂载身份门控、Agent Windows Job 原子创建/父进程死亡/UTF-8、官方 Codex0.163.0 真实原生 MCP 无推理验证。

962 源一致、冻结 DS297 不变；三机根1743/0fail（Windows1721pass/22skip，Ubuntu1690pass/53skip）。workspace31（Windows30pass/1skip）、Windows Job11/11（Linux全skip）、真 Linux 容器29/29、真实安装 CLI13/13 每机；其余基准和复跑命令见主交接。

完整工程仍0/20包、1passed/52partial/10not_run、M0 11/12；未提交/推送/发布。用户已有“全部做好后上传GitHub/npm”授权，前提尚未达到，不重复询问，也不提前发布。

优先任务：

1. CLI 的 `packages/cli-runtime/src/native-peer.ps1` 是另一份 Windows supervisor，仍是 suspended-create 后 Assign。不要把 `native/windows-desktop/ProcessJob.cs` 的修复当作它也已修复；先做真实死亡屏障，再收口原子创建和监督。
2. fs_write leaf/parent 描述符固定、真实工作区权限/根世代、所有原生执行路径与完整命令/CLI写 Task facade；当前模型 shell 门控保留。
3. 完整迁移/停写/OS元数据/激活后最新数据回退，常开生产/实际休眠，完整浏览器/桌面/PTY/UI/安装与全量验收。

产品验证0真实模型推理，真实推理由用户执行；开发模型通道授权按最新AGENTS，StepCode/Step Plan优先且不人为设预算，Kimi先Go确认限额后才转Plan。`integration-cli-installed.mjs` 才是无推理脚本；`integration-cli-runtime.mjs` 默认会推理，勿随意运行。

desktop是用户选定迁移对象，web延后，旧MR是用户手动移除，不自动恢复；冻结vendor/SDK不改。tasks/audit保持CRLF两空格，package.json保持LF；临时脚本.mjs，逐项hash-object，未验证不completed。组件完成按主交接第13节同步全部台账/证据/文档。

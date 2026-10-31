# 部署拓扑档案（deployment-profile）

更新日期：2026-10-27。本文是方案 §8.4 要求的 M0 交付物：明确日常 DSH 宿主、首台常开 agent、UI 所在设备、Windows 桌面设备的角色、机器标识、网络路径、运行账户、数据目录、休眠/重启影响及对应证据。

**真实端点、账户、域名、密钥与凭据只保存在本机私有配置，不进入本文件、不提交。** 本文件全部使用占位符（`<placeholder>`）；机器可读的已登记状态见 [deployment-status.json](deployment-status.json)。

## 1. 当前状态（如实）

| 项 | 状态 |
|---|---|
| 生产常开 DSH 宿主 | **未部署**（`productionTopology: not_configured`） |
| 产品 remote-computer-agent 常开实例 | **未部署**（两个已登记目标均只做过隔离测试） |
| 休眠/重启拓扑验证 | **未验证**（`verifiedSleepTopology: false`） |
| 已登记并使用 | 两台真实测试目标：`ubuntu-test-01`、`win10-test-01`（运行过隔离产品 Host 与 Agent；未配置常开实例） |

已登记测试目标（别名与证据在 deployment-status.json，端点与账户在私有配置）：

| 别名 | OS / Node | 已验证 | 未验证 |
|---|---|---|---|
| `ubuntu-test-01` | Ubuntu 24.04.4 LTS / v22.22.1 | 隔离组合宿主、工具/模型拦截、SQLite；产品secretRef配对、按Bot受控读取/撤销与冷启动，Host原生8项、Agent原生12项、默认组合9项 | 跨机受保护网络、常开部署、休眠、干净安装 |
| `win10-test-01` | Windows 10 IoT Enterprise LTSC / v24.18.0 | 同上（Windows侧，独立测试根目录） | 同上；另有交互桌面/DPI/UAC/RDP门禁 |

SSH 可达不能替代产品配对/鉴权、WireGuard 拓扑或笔记本休眠验收；不据 SSH 宣称部署完成。

## 2. 目标拓扑（待 M0/W02.7 实测确认的默认路线）

| 角色 | 建议位置与模式 | 机器标识 | 运行账户 | 数据目录 | 休眠/重启影响 |
|---|---|---|---|---|---|
| 常开 DSH 宿主 | 用户自己的 Ubuntu 云主机运行 DSH Web（`<host-endpoint>`） | `machine-host-<id>` | 专用非 root 账户 `<host-account>` | `<DSH_HOME>`（本机磁盘，非网络盘） | 宿主重启后从持久状态恢复；休眠不适用（常开） |
| 首台常开 agent | 优先 Ubuntu，可与宿主同物理机但进程/容器和权限分离 | `machine-linux-<id>` | 独立 OS 账户或容器 profile `<agent-account>` | `<agent-data-dir>`（含 `orchestration` 操作库与 artifacts） | 重启后未完成 operation 进入 `OUTCOME_UNKNOWN`，只核对不重放 |
| UI 所在设备 | 笔记本浏览器访问常开 Web；DSH Desktop 在独立 profile 做本机兼容验收 | — | 用户交互账户 | 独立 profile，不共享活动数据库 | **笔记本休眠会使新调度、续签与计划触发不可用**；界面恢复后接回原任务。若选笔记本为主宿主，须如实标明该限制 |
| Windows 桌面设备 | 用户 Win10 设备经 WireGuard 直连常开端；Win11 另做兼容验收 | `machine-win-<id>` | 交互账户 `<desktop-account>`（helper 在其 Session 运行） | 程序数据与凭据默认保留 | 锁屏/注销/UAC/RDP 变化时桌面步骤明确暂停；重启后 helper 自动启动（需服务模式安装选项） |

网络路径：默认仅 loopback；VPN 模式显式绑定指定网卡地址；公网模式要求 TLS。私有 IP 本身不作为可信网络证明。隧道不得依赖笔记本转发才能连接两台常开设备。

## 3. 接入与配对流程（产品读取部分已实现，部署发行仍待验收）

1. 从最终仓 Release 下载对应平台 agent 与摘要文件，验证后安装。
2. 初始化 machineId、运行账户、允许根目录与运行模式（默认不开全部磁盘访问）。
3. agent 本机管理命令生成配对凭据，用户输入机器页的秘密表单。秘密复用DS库，使用 `REMOTE_AGENT_*` 名称且Bot scope为空；机器目录只保存secretRef。后续请求使用最长五分钟的短期票据，Host当前请求六十秒。
4. 连接并核对 machineId、agent 版本、协议范围与机器能力。
5. 用户给指定 Bot 授予机器、工具与根目录，运行 ping 与受控读测试。
6. 需要 shell/写入/桌面时按选定审批策略启用。

## 4. 证据与缺口

- 已有机型证据：[远程平台记录](evidence/20261027_m0_remote_platforms.json)（两台测试目标的隔离验证）。
- 新增产品证据：[三机机器接入](evidence/20261027_m4_product_machines.json)。每台机的Host与Agent通过本地回环通信；这不等于已验证跨机VPN/TLS链路。离线撤销的停止未确认状态持久保存，可从机器页重试确认，确认不会恢复授权。
- 缺口（按方案门禁，未完成不外推）：生产常开宿主与产品 agent 部署、WireGuard/Tailscale/Cloudflare Tunnel/公网 TLS 四种网络模式的真实连接、笔记本休眠后任务/计划继续与界面恢复、干净安装/升级/卸载。
- 私有配置中保存：真实端点、账户、密钥引用、完整连接日志；本目录与 Release 只保留占位符与别名。

## 5. 接手规则

后续会话先读 `deployment-status.json` 的机器可读状态与本页占位符；获得新的实测结果后同步更新两处，并补 `evidence/` 记录。不要把“安装可用”提升成“生产拓扑已验收”，也不要把测试目标当作常开部署。

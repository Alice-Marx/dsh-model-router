# 桌面 helper 全局仲裁与可确认停止（2026-10-28，实施前设计）

## 已有事实和本次范围

E44 在真实 Win10/96DPI 与 Win11/144DPI 各跑过8项基础检查，截图只含专用窗口。现有 `DesktopTools.owner/until` 仅在一个 Agent 对象内，两个 Agent 可各自认为自己拥有同一 helper；agent 的 `operation_cancel`/撤权扫描目前只真正停止 shell，桌面调用没有可取消的在途记录。不能把现有单 Agent 的跨 Bot 互斥扩大宣传为整台桌面的全局保证。

本次不改冻结DS/SDK，不触碰用户其他窗口、不改系统DPI/锁屏或UAC；先完成 helper 仲裁、私有取消链和真实输入效果。125%、跨屏、锁屏/UAC/RDP、完整桌面Bot授权/审批facade和安装仍是独立待验收项。

## 合同

1. 在 native helper 中引入独立 `DesktopLease`：同一交互 Session 的 helper mutex 是单一仲裁点。owner tag 为 Agent 实例随机 nonce 与真实 client/Bot/task/attempt/revision 的固定长度摘要，不能取自工具参数。不同 Agent 即便使用相同业务 ID 也不能碰撞。
2. 版本2私有IPC包含 protocolVersion/owner；旧客户端或旧helper须明确报协议不兼容，不静默退回只在Node中互斥。截图保存 owner、单调时间、窗口/前台/边界/DPI/内容指纹。所有输入重新校验。全局lease在每步间保留15秒，有活动步骤时不能仅因TTL过去就让另一owner进入。
3. 另设同ACL/同随机秘密的 control pipe，处理 cancel-owner；不能被普通MCP工具参数建立。控制线程不等待输入Gate才接收取消，先封锁owner/generation，再等待正在执行步骤退出。只有实际退出才返回 stopConfirmed。不能把断开socket、发出abort或kill请求当已停止。
4. 取消owner保留有界短期墓碑，阻止已经排队的旧包在取消确认后重新进入。使用单调时钟；清理过期项，容量耗尽须关闭准入并给明确恢复动作，不能淘汰仍有效的取消标记。新attempt/新revision有新tag；不自动重放旧输入。
5. 主输入线程在每个 SendInput 单元前检查取消fence、暂停/停止、交互桌面和前台目标。取消/期限发生在已开始输入后须保留“可能部分应用”事实。可信helper返回停止确认与not-applied/possibly-applied区分；Node收到已发送请求但无可信结果仍 OUTCOME_UNKNOWN。
6. Agent 为桌面步骤登记独立的在途controller/job。operation_cancel、当前grant失效和close走control pipe并等待确认；关闭前清理已知job。截图artifact在返回前再次核对grant。只在有确认时记cancelled；停止不明记unknown，原operation墓碑不重放。
7. Tray暂停先禁止新输入并令当前fence失效，清掉旧截图后才允许恢复接受新截图；停止会阻止后续SendInput并退出helper。恢复不自动继续一个未知的旧键盘包。

## 验证顺序

- 纯C#仲裁状态测试：相同owner、不同owner/Agent、活动步骤跨TTL、generation、取消墓碑、超时仍封锁、容量与单调时间；测试注入时钟，不调用真实桌面。
- Node私有IPC测试：协议拒绝、业务参数不能覆盖owner、abort前无输入、取消确认/断线unknown、close与撤权，使用离线pipe替身分开标级别。
- 真实专用窗口：按钮点击计数、文本与允许按键、滚轮事件确有变化；两Agent互斥；旧/错截图与Session拒绝；取消/撤权后输入计数稳定，确认没有迟到输入。需要较长输入来制造在途窗口时采用受限显式输入节奏，并在证据中说明，不能改源码假装真实SendInput。
- 在两台已获用户确认的Windows交互桌面运行，核对截图与进程/临时任务清理；复跑原Agent12、相关root/默认宿主与source/客户端检查，新增证据并同步七份台账。

helper原生可确认停止只解决桌面控制资源。部分输入造成的业务状态、OS账户隔离、任务树/工作区锁与上层授权仍需按完整方案各自验证。

## 施工检查点

已落地协议2、helper全局仲裁、独立控制通道与Agent取消/撤权扫描。控制管道有8个固定接收线程，避免同进程关闭多个owner时一个串行管道导致错误的停止不明；每包有大小/总读取期限，输入管道仍串行。显式重试最多发两次取消包，从不重放输入。

真实fixture采用可选0–5ms的逐字符节奏制造在途步骤，每个SendInput前仍检查fence；生产默认0ms，原生每步15秒上限不变。滚轮另核验实际鼠标所在窗口，拒绝向目标外窗口滚动。测试窗口等待控件动画稳定后再截图，不放宽内容指纹；初次测试因按钮动画产生TARGET_STALE而正确拒绝，日志保留。

本机Win11当前150%下19项实际窗口检查通过（含按钮计数、键、滚轮、跨Agent、在途取消/撤权与截图过期）；正在对最终代码做双Windows及完整回归。最终证据及台账另按实际结果记录，本设计不替代验收。

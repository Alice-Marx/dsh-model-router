# 配置事务 Windows 文件稳定性复核（E81）

状态：组件级修复，隶属 W06.14；不改变激活、产品接线或 W06.15 的状态。

## 1. 失败与根因

E79 在配置事务采样中保留过 `MIGRATION_COMMIT_SOURCE_CHANGED`。旧堆栈只能定位到 `image()` 的读取前后稳定性复核，不能证明具体字段或实际写入者。

E81 先加入不含路径和文件内容的有界诊断：`open-identity`、`read-stable`、`read-length` 与 `published-image`，记录 expected/actual digest、dev/ino、size、mtimeNs、ctimeNs、nlink 和阶段。随后 8 轮串行及 16 路并发配置事务共 24 轮未复现，不能据此宣布问题消失。

改用与原发布序列一致的真实 hardlink 探针：`write stage → link(stage,target) → unlink(stage) → lstat/open/read/fstat/lstat`。第 70 次迭代出现：

- `dev`、`ino`、`size`、`mtimeNs`、`nlink` 完全一致；
- 仅 `ctimeNs` 从 `1793426594235729200` 变为 `1793426594236728300`；
- 变化发生在首次 `lstat` 与已打开句柄的首次 `fstat` 之间，即真正读取之前。

这证明存在 Windows hardlink 元数据延迟提交造成的假阳性，不是内容 digest 漂移，也不是 inode 替换。

## 2. 修复合同

`migrationImageMetadataMismatch(named,opened,after,again,platform)` 分离内容/身份字段与 ctime 基线：

- 所有平台在 `lstat → open → read → fstat/lstat` 全区间继续严格比较 `dev/ino/size/mtimeNs/nlink`；新增 nlink 比较，避免 Windows ctime 调整后丢失硬链接变化检测。
- POSIX 的 ctime 仍以首次 `lstat` 为基线，opened/after/again 均不得漂移。
- Windows 以**已打开句柄**的 ctime 作为当次读取基线，允许本次 hardlink 操作在 open 前延迟提交 ctime。
- 初版仅采用 opened 基线后，5000 次探针在第 1588 次又于 `after-read` 捕获 ctime 延迟更新，证明该版本不充分。最终 `image()` 对 **Win32 + read-stable + field=ctimeNs** 最多做 2 次、每次间隔 10ms 的完整重读（首次共 3 次）；重读必须重新通过全部 lstat/open/read/fstat/lstat 复核，耗尽仍抛原 `SOURCE_CHANGED`。
- digest、identity、size、mtime、nlink 漂移与任何 POSIX 漂移均不重试；不把并发编辑当成可接受状态。诊断继续 fail-closed 并给出具体 field/observation。

该处理只适配已实测的 Windows 元数据提交时序，不宣称所有元数据竞争都可安全忽略。文件权限、外部写者与全域停写仍由各自门禁证明。

## 3. 回归与验收

确定性测试覆盖：

1. Windows open 前 ctime settle 被接受；
2. Windows 实际读取期间 ctime 漂移被识别；
3. Windows/Linux 的 nlink 漂移均拒绝；
4. POSIX open 前 ctime 漂移和 size 漂移仍拒绝；
5. 仅 Win32 read-stable ctime 符合有界完整重读，其他字段、阶段、平台及普通错误均不符合。

最终 5000 次真实 hardlink 探针按同一有界完整重读合同执行，0 个不稳定图像。还需完成配置事务多轮采样、相关套件与完整根回归。E79 的原始日志、24 轮未复现样本及第 1588 次初版修复失败均保留，不把一次未复现写成永久不存在其他 `SOURCE_CHANGED` 原因。

# Bot 私有资料库文本搜索（2026-11-05）

现有 `bot-library.mjs.search()` 已接通实际模型工具与页面入口，而非仅列出一个能力名称。

- `.dsh-plugin/shared/library-tools.mjs` 注册 `bot_library_search({botId,query})`，先经过原有 `registerPolicyTool`，再复用 `libraryFor` 核对真实调用 Bot。可识别 Bot 不能指定另一个 Bot 的库；操作员通道仍遵守已有 passthrough 设置。
- Host 的 `library.search` owner action 返回 `{results:[{path,line,text}]}`；product read-model 白名单、默认 `tool/bot_library_search` grant 和 routed worker 的只读工具集合均已接通。
- `LibraryPanel` 新增正文查询与路径/行号/片段结果。点击结果会读出相应文件并选择命中行；保存保留完整相对路径，避免将 `notes/project.md` 误写到当前目录的 `project.md`。
- 后端按字面、不区分大小写匹配；查询最多 256 字符，文件不超过 1 MiB，遍历最多 500 个条目/8 层目录，返回最多 50 行，每行片段最多 600 字符。未增加 PDF/OCR、语义检索或 RAG；同名上传仍拒绝覆盖。

验证命令：

```sh
node --test tests/library-tools.test.mjs tests/library-panel.integration.test.mjs
```

结果 **8 passed / 0 failed**。工具测试读取真实隔离磁盘目录，确认只返回调用 Bot 的行、拒绝跨 Bot 搜索和禁用 operator passthrough 的未知会话。React/JSDOM 测试实际输入查询、点击搜索，通过认证 owner product channel 搜索磁盘文件，验证路径/行号/文本与另一 Bot/二进制排除，点击命中行并修改、保存、读回原嵌套文件，同时确认没有在根目录产生错误副本。原有二进制上传/下载字节回读测试仍通过。

测试数据只写入 `tmp/integration/`，未使用用户资料库、真实凭据或付费模型。

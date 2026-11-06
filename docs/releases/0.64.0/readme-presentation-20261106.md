# 0.64.0 公共文档与视觉展示

## 本次范围

程序版本保持 0.64.0，Windows Remote Agent 保持 0.1.1。本次更新中英文公共 README、纯路由包的中英文 README，以及精简展示树生成脚本；没有重新发布 npm 包或移动正式版标签。

- 以产品定位、双版本选择、安装和首个任务为主线重写说明。
- 明确 route-bot 完整包与 router 纯路由包的区别，修正旧安装说明残留的包名。
- 覆盖工作台、原生 CLI、Bot 对话/群聊/记忆/浏览器/定时工作、Bot 委派、远程电脑、例行任务、资料库、预算和恢复操作。
- 保留六个徽章、dshfind 卡片、六组公式及 33 组配对数学表达式。
- 新增项目概念封面与两张真实 RouterMainPage 离线数据截图，均置于 `.github/assets/`。
- 四份公开 README 均不引用私人归档；展示树生成脚本取消向私人归档改写链接，并检查公共 README 不带私人归档地址或被排除文档的相对链接。

## 视觉来源

封面使用内置 imagegen 生成，未使用 CLI/API 回退。图片为概念插图，未冒用官方商标、未展示假界面或承诺未实现能力。

最终提示词：

> Use case: ads-marketing. Asset type: panoramic GitHub README cover for the open-source project DSH Bot · Model Router, a community plugin for DeepSeek Harness. Create a polished, restrained premium software editorial cover, landscape aspect ratio about 2.5:1, generous margins. Typography is the focal point on the left, exactly: large 'DSH Bot', second line 'Model Router', smaller descriptor 'Model routing · Bot collaboration · Remote desktop'. On the right, an elegant abstract isometric 3D illustration of one routing hub distributing thin luminous paths into three coordinated small bot nodes and a stylized desktop monitor, representing task delegation. No fake UI screenshots, just sculptural translucent glass and brushed dark metal geometry. Background warm ivory, charcoal typography, restrained teal and electric blue accents, subtle fine grid, soft studio lighting, ample negative space, professional developer tooling identity, crisp beautiful typesetting. No mascots, no large robot faces, no brand logos from DeepSeek, xAI or RustDesk, no official endorsement, no claims or prices, no release version, no extra text, no GitLab references. Ensure all text is accurate and readable when viewed at GitHub README width.

工作台截图使用 Playwright 截取当前真实组件和内存 fixtures，不接触用户数据或凭据，不调用模型，不安装工具。截图说明明确所有价格、模型、路径和用量为示例；预览截图保留模拟提示。

## 验证

- `node scripts/check-readme.mjs` 通过：六组公式、33 组行内表达式与翻译 Git blob 哈希均一致。
- `node --test tests/readme-math.test.mjs`：13/13 通过。
- 实际执行精简树生成：697 个文件，四份 README 与三张图片与全量树逐字节一致。
- 四份 README 的相对文件链接和显式锚点均有效，未包含私人归档地址、变更日志链接或被排除文档的相对链接。
- GitHub Markdown API 分别渲染四份说明；每份根 README 包含 10 个图片节点（原六徽章、一卡片、新封面、两截图）、六个展示公式、33 个行内数学节点、一个 Mermaid 图及一个可折叠技术参考。
- 新旧 README 的徽章/卡片原文、数学公式、行内数学表达式逐项相同。
- 离线真实组件截图无浏览器错误；点击模板和预览未调用模型，未执行真实任务。
- `git diff --check` 通过。本次未改变程序代码，不重复进行付费模型或远程桌面执行。

验证元数据：`readme-presentation-validation-20261106.json`。发布后另存回执；README 是当前功能和操作说明，不收录此历史记录。

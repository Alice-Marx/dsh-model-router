# README 块公式与封面修正

## 问题与范围

用户指出六组块公式在 GitHub 上显示为 LaTeX 代码，并要求重新设计封面。上一轮记录统计了六个 `pre lang="math"` 和 33 个行内数学节点，前者不能证明块公式已经渲染，验证判据有误。本次修正排版和验证方式，程序仍为 0.64.0，不重新发布 npm 包或移动标签。

## 复现实验

对实际完整 README 调用 GitHub Markdown API：

| 变体 | 真正块数学节点 | 行内数学节点 | 原始数学代码节点 |
| --- | --- | --- | --- |
| 原文：折叠区域同时含块公式和行内公式 | 0 | 33 | 6 |
| 仅删除折叠包装 | 6 | 33 | 0 |
| 保留折叠包装但删除行内公式 | 6 | 0 | 0 |

单独的简短折叠样例可以正确渲染，不能代表完整文档。实际原文改用多行 `$$` 也没有恢复六个块数学节点，因此本次保留原有 math fence 与公式内容，只将技术参考移到正常 Markdown 区域。支持语法参考 [GitHub 数学公式文档](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions)。复现实验反映这份文档的行为，不宣称所有折叠区域中的公式都无法渲染。

## 修正

- 两份根 README 使用正常二级标题承载技术参考，六个公式锚点、公式内容、33 组行内表达式和徽章卡片保持原样。
- 校验器拒绝把块公式放回 `<details>`，新增回归覆盖，普通文字折叠和代码字面量仍允许。
- GitHub API 验证必须得到六个 `js-display-math`、33 个 `js-inline-math`，以及零个原始 math 代码块；不再把代码节点计为渲染成功。
- 新封面为黑白排版、蓝色路由图形与中文能力说明，保存至 `.github/assets/readme-cover-v2.png`。旧封面保留为历史资产，当前 README 使用新路径避免缓存混淆。
- 公共 README 继续不含私人归档地址。

## 封面来源与最终提示词

内置 imagegen 生成，无 CLI/API 回退。图片为概念封面，未使用假产品界面或冒用官方标识。

> Use case: ads-marketing. Asset type: exceptionally polished panoramic GitHub README cover, landscape 2.5:1. Project is DSH Model Router, a community plugin for DeepSeek Harness with model routing, Bot collaboration and remote computers. Design a confident minimalist editorial software cover with Swiss typographic discipline, almost-black matte background and warm white typography, one restrained cobalt-blue accent. Mostly flat graphic design, precise alignment, very generous negative space and margins. Main title on the left, exact words, set in elegant large clean sans-serif with deliberate hierarchy: 'DSH' on a small line, 'MODEL' on a large line, 'ROUTER' on a large line. Small bottom-left subtitle, exact Chinese: '模型路由 · Bot 协作 · 远程电脑'. Small top-right text exactly 'FOR DEEPSEEK HARNESS'. The right third has a restrained abstract routing motif: one thin white line enters a single small blue square, three thin right-angle paths leave toward small white endpoints, sharply composed on a faint technical grid. This graphic should feel like a refined engineering identity rather than a flowchart screenshot. Crisp graphic linework, extraordinary spacing and typesetting, balanced asymmetry, subtle grain allowed. No 3D rendering, no robots or faces, no glass cubes, no monitor images, no neon glow, no giant icons, no glossy effects, no dense network mesh, no fake UI, no version, no extra labels, no logos or claims of official endorsement. All letters and Chinese must be clear and accurate. Make it feel like the cover of a well-designed developer tool rather than generic AI art.

## 验证

- `node scripts/check-readme.mjs`：六组公式、33 组行内数学、翻译哈希通过。
- `node --test tests/readme-math.test.mjs`：14/14 通过。
- 英文和中文完整 README 经 GitHub API 渲染均为六块数学、33 行内数学、零原始 math 代码块，图片节点各为 10 个。
- 新旧公式与数学表达式、徽章卡片逐项一致。
- 实际公开 GitHub 中英文页面逐个验证六个块公式：浏览器均生成原生 MathML、可见尺寸非零、零数学错误；前三个分数式及分段函数的分数节点存在，分段函数实际有两行。33 个行内数学也全部生成 MathML。
- 已视觉检查实际费用公式、分段函数及新封面截图。客户端实际使用原生 MathML，不能把“没有 SVG”误判为排版失败。
- 新封面在中英文页面均成功加载，分辨率 1983×793；正文无私人归档地址。六个更新公开文件回读并逐字节核对。
- GitHub 展示提交及完整元数据见发布回执；真实浏览器排版证据见 `readme-math-cover-browser-20261106.json`。

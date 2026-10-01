# Gal 模块立绘与场景图来源

本清单区分三层资源：用户在 `../galgame/EchoCity/game/images/chars/aipersona/` 提供的 **28 张原稿 PNG**、插件实际加载的**基础立绘**、另外生成的**六表情差分**。可机读的完整 SHA-256 和文件映射见 [gal-portrait-sources.json](assets/gal-portrait-sources.json)。清单中的路径均相对本仓库根目录；`../galgame/` 是本机相邻的素材仓库，发布包不会自动包含它。

## 原稿与插件基础立绘

0.11.0 的舞台默认显示这些**完整全身原画**，并在对话、选项上方留出展示区域；设置中可切回六表情半身特写。全身情绪暂时共用原图，对话头像仍能切换派生表情。这里的尺寸与哈希对应已有资源，本轮没有重画人物。Claude 使用下表中的同字节原稿；具体调节见[Gal 设置教程](GAL_SETTINGS.zh.md)。

以下 28 行以 `galgame/EchoCity` 的 PNG 为唯一来源基准。尺寸和 SHA-256 都针对**原稿文件**；基础图的实际文件及其独立 SHA-256 记录在 JSON 中。`同字节`表示插件基础 PNG 与原稿完全一致，`转 WebP` 表示为减小安装包而使用的格式转换图，不能用 WebP 文件哈希冒充原稿哈希。五张新补入角色原稿还在 `aipicture/echo-originals/` 留有同字节副本。

| 角色键 | 原稿相对路径 | 原稿尺寸 | 原稿 SHA-256 | 插件基础图 | 关系 |
| --- | --- | ---: | --- | --- | --- |
| `chatgpt` | `ChatGPT/ChatGPT1.png` | 1052 × 1885 | `07bf55a5595bef51b301152b8e42e9d633b7179152db43bd1e04244f33581ac8` | `aipicture/ChatGPT1.png` | 同字节 |
| `claude` | `Claude/Claude.png` | 1052 × 1885 | `d265f4c424929ab68f0427adabe8faec968d55d00b6fcc9dd7011ec4622e0c5a` | `aipicture/Claude1.png` | 同字节 |
| `cloudflare` | `cloudflare/Cloudflare.png` | 941 × 1672 | `8731ac0f4b75b905dd097f470147ae18fcb9c953359c2faddf417818eed69ddb` | `aipicture/cloudflare.webp` | 转 WebP |
| `comfyui` | `ComfyUI/comfyUI.png` | 2160 × 3840 | `81b5b13b4b11e63564854bd23ce747f78fb6c476092dc379c6c0e5a784e72fcb` | `.dsh-plugin/client/source-portraits/comfyui.webp` | 转 WebP |
| `deepseek` | `DeepSeek/DeepSeek1.png` | 1052 × 1870 | `1ee43fb06f5d0c6a9b342d37b0dd74859b73b375946f0e938b7bdc41c42833f0` | `aipicture/DeepSeek1.png` | 同字节 |
| `harness` | `DeepSeekharness/DeepSeek_Harness1.png` | 941 × 1672 | `81f752f30426c08548a21e13dedc978020ff622aea618c5b2ceac42f5c7cf179` | `aipicture/DeepSeek_Harness1.png` | 同字节 |
| `doubao` | `doubao/Doubao1.png` | 1052 × 1885 | `b7b6b6d3ad578319eb90c4e152c4e2e2568d76c0c78ecfac1a39c7ab5356fd27` | `aipicture/Doubao1.png` | 同字节 |
| `ernie` | `Ernie/ERNIE1.png` | 1052 × 1885 | `245cca340a9ac072245c98e5e47418aa7c31d94615735f83a086f160da70f045` | `aipicture/ernie1.png` | 同字节 |
| `gemini` | `Gemini/Gemini1.png` | 1052 × 1885 | `f21b6dae197d5de60d41444c947c765bbec7b6345427e64b7bf2f647791d8796` | `aipicture/Gemini1.png` | 同字节 |
| `github` | `github/GitHub.png` | 1152 × 2048 | `83c3f7315288aa01885f5e3c6cb245316793ce5e0f6deef564d7167d48a52105` | `aipicture/github.webp` | 转 WebP |
| `gitlab` | `GitLab/GitLab.png` | 1152 × 2048 | `e835aa95139cebce8fd8396e070c7eb4dc460cb37558ce96aad7a25a34b1fdc2` | `aipicture/gitlab.webp` | 转 WebP |
| `gitee` | `gittee/Gitee.png` | 1152 × 2048 | `de0ff047c61b7d27c60efde27e151a3bb607ae5e0b4e232f4ed4d52c7ab82ca1` | `aipicture/gitee.webp` | 转 WebP |
| `glm` | `glm/GLM1.png` | 1052 × 1870 | `e00df1a19859deed093f1554b6d376d32eb1861f8e966acd4e91c97209b5ef1d` | `aipicture/GLM1.png` | 同字节 |
| `gptimage` | `gpt-image/GPT-image.png` | 1536 × 2752 | `acedef8f29e4fb98f8371d3a5624380b379cc02427f6db4184bcb418992fe610` | `.dsh-plugin/client/source-portraits/gptimage.webp` | 转 WebP |
| `grok` | `grok/Grok1.png` | 1052 × 1885 | `bf17cf85e0f275e9306949d3d4a41e96280a83fdaa0b05ebe519eb979b066c49` | `aipicture/Grok1.png` | 同字节 |
| `huggingface` | `HuggingFace/HuggingFace1.png` | 1152 × 2048 | `0f848d326d441b9827351c7673a0a2a735234a9bad2237f5362958725f3d7962` | `aipicture/huggingface.webp` | 转 WebP |
| `hy` | `HY/HY1.png` | 1152 × 2048 | `58f8caf88c4c89f3c851d864a716209e93a7bd7a0ed4d838c8be49c293c5f9c3` | `.dsh-plugin/client/source-portraits/hy.webp` | 转 WebP |
| `jev` | `JEV/JEV.png` | 1152 × 2048 | `3eaf540d9b3d2af09779a677696f93f0412ff3d8cab02ae60af17c719974d879` | `.dsh-plugin/client/source-portraits/jev.webp` | 转 WebP |
| `kimi` | `Kimi/Kimi1.png` | 1052 × 1870 | `d807ae640a6c17a56334608c892e18f832815cdcee42cd19d317f7ba3d56247c` | `aipicture/Kimi1.png` | 同字节 |
| `llama` | `llama/llama.png` | 3072 × 5504 | `eb11e3da5053ed509f79d30a693d81bc3b5581c6fb4b24733177ced75aff1760` | `aipicture/llama.webp` | 转 WebP |
| `mimo` | `mimo/Mimo1.png` | 1052 × 1885 | `e37b2af0e4037df1a659b6e14bce51f9b3525b4f27f48e184c80db580f938e0f` | `aipicture/Mimo1.png` | 同字节 |
| `minimax` | `Minmax/Minmax1.png` | 1052 × 1885 | `f88d4bece71981d8596110f64c8cb5f54733c319be0f192dab4d830e0d8847ac` | `aipicture/Minmax1.png` | 同字节 |
| `novelai` | `novelai/NovelAI1.png` | 1152 × 2048 | `dc6d6f0b4ec0061998cd804f6866322d164e2b744841115c36310f368ed0be6d` | `.dsh-plugin/client/source-portraits/novelai.webp` | 转 WebP |
| `opencode` | `opencode/opencode1.png` | 1052 × 1870 | `7176ace81ad0a1926126cdfe32d7c13df26bd657e2c53609cf99253da97ba235` | `aipicture/opencode1.png` | 同字节 |
| `perplexity` | `perplexity/Perplexity.png` | 3072 × 5504 | `c7de0c4de06056c748890a30eae98d55625ce660ad80f705e0f70d4ccc6d2191` | `aipicture/perplexity.webp` | 转 WebP |
| `qwen` | `qwen/Qwen1.png` | 1052 × 1885 | `8afa33723ee50968dcee7ec6586a22e60075ac6165a1b2c0335d92fafe6e850c` | `aipicture/Qwen1.png` | 同字节 |
| `rwkv` | `rwkv/RWKV.png` | 2160 × 3840 | `93c4560abd932adf75c9c656f37be5a65526f59ff184eb18a07720643148eacc` | `aipicture/rwkv.webp` | 转 WebP |
| `zcode` | `zcode/Zcode.png` | 1152 × 2048 | `55e4054c6f641dbb8f745620bbfcd7591c80047c2b5ac2baaf7143ffeae9215e` | `aipicture/Zcode.png` | 同字节 |

**Claude 主图特别约束：** 权威原稿为 `Claude/Claude.png`，其 SHA-256 是 `d265f4c424929ab68f0427adabe8faec968d55d00b6fcc9dd7011ec4622e0c5a`；插件映射到 `aipicture/Claude1.png`，两者字节完全一致。旧 `aipicture/Claude.png` 是另一张女仆形象，SHA-256 为 `da6aadacaee340c8620b2dee3ec805bfaa619cc1d5e59443ed18817aaf208f48`，不得作为本剧 Claude 的基础图或差分参考。

`JEV/JEV.png` 已接入基础资源表和自由模式的角色选择，当前没有剧情出场，也没有六表情集。将来编写 JEV 场景时，可以先用 `.dsh-plugin/client/source-portraits/jev.webp` 显示原稿转换图，再单独制作、接线并核对 JEV 表情。

## 原图和生成差分如何显示

- `.dsh-plugin/client/characters.mjs` 的 `CHARACTER_IMAGES` 映射基础立绘，保证没有表情差分或资源缺失时仍能显示角色原图。`hy`、`novelai`、`comfyui`、`gptimage`、`jev` 使用 `source-portraits/` 内的原稿转换图。Claude 明确使用 `aipicture/Claude1.png`。
- `.dsh-plugin/client/gal-game-expressions.mjs` 根据角色与情绪优先取六表情差分；没有差分时回退基础图。六种差分键为 `neutral`、`happy`、`sad`、`determined`、`surprised`、`shy`。其他文本情绪会映射到接近的差分或中性形象；它们不代表另有原稿。
- 既有春篇 15 角色的差分位于 `.dsh-plugin/client/spring-portraits/`；本轮新增 12 角色位于 `.dsh-plugin/client/echo-portraits/`，合计覆盖 **27 套、162 张**。每张差分是**派生新图**，不能标成原稿 PNG 或用它的哈希替代原稿；JEV 暂不计入 27 套。新增角色为 ChatGPT、Claude、Harness、ERNIE、MiniMax、HuggingFace、GitHub、GitLab、Gitee、Cloudflare、ComfyUI、GPT-image。
- 原稿 PNG 是连续角色视觉的身份锚点。生成差分可有表情、姿势和光照变化，但发色、服饰和角色标识应回到相应原稿核对。若某个差分跑偏，应回退基础图，再重做该角色差分。

## 六张正篇专属背景

正篇专属图位于 `.dsh-plugin/client/echo-backgrounds/`，由 `.dsh-plugin/client/gal-echo-art.mjs` 注册为下列背景键：

| 背景键 | 输出文件 | 主要剧情场景 |
| --- | --- | --- |
| `echo-gate-snow` | `gate-snow.webp` | 南门、城门雪夜、塔外初见 |
| `echo-petition-wall` | `petition-wall.webp` | 王女“五日之变”的手印墙 |
| `echo-old-tower-snow` | `old-tower-snow.webp` | DeepSeek 旧塔、雪国线与雪夜写稿 |
| `echo-flame-platform` | `flame-platform.webp` | Llama 授焰台、石碑风波和重立 |
| `echo-seal-chamber` | `seal-chamber.webp` | Claude 地下封印室 |
| `echo-two-lamps` | `two-lamps.webp` | 执事命名、旧塔双灯与隐藏线收束 |

其余正篇语义场景由 `.dsh-plugin/shared/gal-story-echocity.mjs` 的 `ECHO_BACKGROUNDS` 映射到已有图：万源城四季与终章复用 `six-endings.webp`，档案/碑林用 `community-archive.webp`，演出用 `laurel-theatre.webp`，工坊/集市用 `offline-workshop.webp`，茶庭与签约用 `protocol-composition.webp`，桥与执事室用 `operations-bridge.webp` 等。这些是**复用映射**，不能在文档中称作新增的专属插画。新增背景的可用性还需在目标桌面版逐场查看裁切、亮度与人物叠放。

## 重建和后续维护

`tools/build-echo-art.ps1` 从仓库 `output/echo-city-art/raw/` 读取原始生成图，使用 `ffmpeg` 裁切、缩放、编码 **6 张背景、12 套六表情板（72 张）**，并从 `aipicture/echo-originals/` 重建 5 张基础 WebP。脚本同时重建 `gal-echo-art.mjs` 的图片导入与映射。它重建加工文件，不会重新生成原始画作，也不会改动用户提供的 28 张权威 PNG。

本机使用方式（在仓库根目录）：

```powershell
powershell -NoProfile -File .\tools\build-echo-art.ps1
```

运行前需保留仓库中的原始板，并使 `ffmpeg` 位于 `PATH`。npm 包把最终画作嵌入 `client.js`，无需用户本机的素材目录或绘图工具；开发源码保留原始板与脚本。春篇原有 90 张差分由 `tools/slice-spring-portraits.ps1` 管理。生成规范见 [本轮美术提示词](GAL_ART_PROMPTS.zh.md)。

浏览器实查使用 `tools/preview-gal.mjs` 启动实际 Gal 组件，验证图片加载和透明叠放；它不连接模型账号。以下截图是本地组件预览，官方桌面实装仍需检查。

![Claude 正确形象的实际组件预览](assets/gal-claude-0.10.1-preview.png)

![春篇双人舞台的实际组件预览](assets/gal-spring-0.10.1-preview.png)

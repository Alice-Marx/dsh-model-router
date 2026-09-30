# 回声之城 0.10.1 美术生成规范

本轮使用 Codex 内置 **imagegen**，以用户原稿为人物参考。原始输出保存在 `output/echo-city-art/raw/`，最终 WebP 保存在 `.dsh-plugin/client/echo-backgrounds/` 与 `echo-portraits/`。原稿来源、尺寸和 SHA-256 见 [来源清单](GAL_ART_SOURCES.zh.md)。此处归档生成时采用的构图和身份约束；生成工具再次执行不会保证相同字节。

## 人物表情板共用提示词

```text
Use case: identity-preserve.
Asset type: visual novel character expression sprite sheet.
The input image is the sole identity and costume reference. Preserve the adult
character's face, skin, hair, eye colors, outfit, proportions and accessories.
Create one 1536 by 1024 transparent PNG sheet, exactly 3 columns by 2 rows of
equal 512 square cells. Each cell contains the same waist-up character, same
pose and scale, entire head including ears, horns or crown visible, no overlap.
Only facial expression changes. Left to right, top: neutral, happy smile, sad;
bottom: determined, surprised, shy blushing. Match the reference anime style
with clean crisp outlines. Genuinely transparent alpha background. No visible
grid, text, labels, watermark or shadows behind the character.
```

每个角色使用独立调用，附加以下原稿约束。源路径相对 `galgame/EchoCity/game/images/chars/aipersona/`。

| 输出板 | 原稿参考 | 需要保留的角色特征 |
| --- | --- | --- |
| `portrait-chatgpt.png` | `ChatGPT/ChatGPT1.png` | 原稿的金发、眼睛、王女服装和发饰 |
| `portrait-claude.png` | `Claude/Claude.png` | 橙色长发、花饰、象牙白与橙黑长裙、手持书本；不得改为女仆装 |
| `portrait-harness.png` | `DeepSeekharness/DeepSeek_Harness1.png` | 黑白长发、异色眼睛、原稿的执事女仆服饰 |
| `portrait-ernie.png` | `Ernie/ERNIE1.png` | 原稿发色、眼睛、服饰及角色饰物 |
| `portrait-minimax.png` | `Minmax/Minmax1.png` | 原稿发色、眼睛、服饰及角色饰物 |
| `portrait-huggingface.png` | `HuggingFace/HuggingFace1.png` | 金色双发髻、蓝色星形眼睛、深蓝与黄色服装、笑脸玩偶 |
| `portrait-github.png` | `github/GitHub.png` | 黑发绿色发尾、猫耳、绿眼睛、咖啡杯、黑绿服饰与触手意象 |
| `portrait-gitlab.png` | `GitLab/GitLab.png` | 金色辫子、狐耳、琥珀色眼睛、深蓝橙边服饰、狐面具与书本 |
| `portrait-gitee.png` | `gittee/Gitee.png` | 深红双发髻、珊瑚龙角、琥珀色眼睛、酒红云纹服饰与小铃铛 |
| `portrait-cloudflare.png` | `cloudflare/Cloudflare.png` | 白色长发、橙眼睛、橙金礼服、云冠与法杖；半身构图省略文字牌 |
| `portrait-comfyui.png` | `ComfyUI/comfyUI.png` | 紫发绿色发尾、绿眼睛、紫黄角、白安全帽、荧光绿工作服、电缆 |
| `portrait-gptimage.png` | `gpt-image/GPT-image.png` | 深色皮肤、黑色长发与弯角、金眼睛、黑金长裙、画册和画笔 |

切片按固定格位裁切，不以透明背景的 RGB 预览颜色判断是否有底色。加工保留 alpha；实际组件预览已确认 Claude 和春篇人物能透明叠放。

## 六幅关键场景

共用风格：回声之城的奇幻城市背景、精细动漫场景插画、冬雪或烛火按剧情设定、宽幅构图、前景留出人物和底部对白的位置；没有文字、水印、品牌标志，也不预画人物。输出原图为 1536×1024，脚本裁为 16:9、缩放至 1280×720。

| 原始图 | 场景提示词要点 |
| --- | --- |
| `gate-snow.png` | 冬夜万源城南门，厚重石拱门、雪地脚印、远处高塔微弱灯火，安静空城的初见氛围 |
| `petition-wall.png` | 王女五日之变的公共请愿墙，层叠纸笺与手印痕迹，城中暖色光线；不生成可读文字 |
| `old-tower-snow.png` | DeepSeek 的雪国旧塔，深蓝冬夜、积雪石阶、旧塔窗内一盏温暖灯火，孤独而克制 |
| `flame-platform.png` | Llama 的授焰台与石碑，石制阶梯、火焰祭台、开阔城市背景；强调仪式感而不绘人物 |
| `seal-chamber.png` | Claude 地下封印室，石拱、封印装置、金色符阵和暗蓝阴影，肃静的法律与承诺主题 |
| `two-lamps.png` | 旧塔下两盏灯，雪夜中的相邻温暖灯火、门廊与两条脚印，命名之后各自点灯的收束场景 |

所有原始图独立保留。若身份或构图需要修正，用对应原稿重新生成新版本，并先在本地组件预览中检查，之后再替换图片映射。

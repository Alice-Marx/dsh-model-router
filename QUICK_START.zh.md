# 快速入门指南 - Model Router + GALGame

> 5分钟上手 DeepSeek Harness 智能路由插件

---

## 📦 一、快速安装

### 1. 前置要求

- ✅ 已安装 DSH Desktop 2.0.5+，或 `@deepseek-ai/dsh@0.1.2-rc.1`
- ✅ 已配置至少一个模型 provider
- ✅ Node.js 环境 (用于测试，可选)

### 2. 安装插件

正式 npm 包（0.13.0 起包名为 `@ljwei-stak/dsh-model-router`；旧名 `@ljwei-stak/model-router-galgame` 最后版本为 0.13.0，与新包 0.13.0 内容相同，之后不再更新）：

```bash
pnpm config set registry https://registry.npmjs.org/
pnpm dsh plugin --profile web add @ljwei-stak/dsh-model-router@0.13.2
pnpm dsh plugin --profile desktop add @ljwei-stak/dsh-model-router@0.13.2
```

官方 `@liustack/modlens@3.25.4` 会随插件自动安装。

本地源码开发：

```bash
# 方法1: 从插件目录安装
cd /path/to/dsh-model-router
dsh plugin --profile web add .

# 方法2: 从任意位置安装
dsh plugin --profile web add /path/to/dsh-model-router

# 重启 Harness
dsh restart
```

### 3. 验证安装

启动 Harness 后，检查：
- ✅ 对话界面显示 GAL 风格（模型娘立绘）
- ✅ 输入 `/router plan` 有响应
- ✅ 浏览器控制台无错误

---

## 🚀 二、基础配置

### 配置 DeepSeek 模型

在 Harness 设置中添加 DeepSeek provider：

```yaml
# 配置路径: 设置 → LLM → Providers
providers:
  deepseek:
    apiKey: "sk-your-api-key-here"
    baseURL: "https://api.deepseek.com"
    models:
      - id: "deepseek-chat"
        name: "DeepSeek V3"
      - id: "deepseek-reasoner"
        name: "DeepSeek R1"
```

### 配置模型价格（可选）

```yaml
# 配置路径: 设置 → Model Router
pricing:
  deepseek-chat:
    input: 0.14      # USD per 1M tokens
    output: 0.28
    cacheRead: 0.014
    cacheWrite: 0.028
  
  deepseek-reasoner:
    input: 0.55
    output: 2.19
    cacheRead: 0.14
    cacheWrite: 0.55

budgetUsd: 0.01           # 单任务预算上限（可选）
liveBenchEndpoint: "https://livebench.ai"
liveBenchTtlMs: 900000    # 15分钟刷新
```

---

## 🎮 三、开始使用

### 1. 基础对话

直接在对话框输入问题：

```
你好！请介绍一下你自己
```

插件会：
- 自动选择合适的模型
- 以 GAL 风格显示对话（带模型娘立绘）
- 根据模型特点调整回答风格

### 2. 查看路由决策

输入命令查看路由分析：

```
/router plan
```

返回示例：
```json
{
  "taskType": "general",
  "complexity": { "value": 0.15, "band": "simple" },
  "selected": {
    "provider": "deepseek",
    "model": "deepseek-chat"
  },
  "estimatedCost": 0.000123,
  "reason": "低复杂度优先成本与响应速度"
}
```

### 3. 切换路由模式

```bash
# 集体协作模式（默认）- 自动选择最优模型
/router mode collective

# 单独会话模式 - 保持你手动选择的模型
/router mode single
```

---

## 📚 四、典型使用场景

### 场景1：代码调试

**输入：**
```python
这段代码有bug，帮我找出问题：

def calculate(a, b):
    result = a / b
    return result

print(calculate(10, 0))
```

**插件行为：**
- 识别任务类型：`code`
- 复杂度：`simple`
- 选择模型：DeepSeek（code 专长）
- 表达风格：推理研究员·小鲸鱼（专注、务实）

**预期输出：**
```
先把变量和约束列出来：

问题：除数为0会抛出 ZeroDivisionError

修复方案：
def calculate(a, b):
    if b == 0:
        return None  # 或抛出自定义异常
    result = a / b
    return result

验证：calculate(10, 0) 现在返回 None 而不是崩溃
```

---

### 场景2：复杂系统设计

**输入：**
```
设计一个分布式任务调度系统，需要包含：
1. 高可用架构
2. 任务队列管理
3. 失败重试机制
4. 监控告警
```

**插件行为：**
- 识别任务类型：`code`
- 复杂度：`complex`
- 启动协作模式：
  
  ```
  阶段1: 问题建模与约束提取
  ├─ 模型: GPT-5.6-Sol
  └─ 输出: 架构约束、性能指标、技术选型
  
  阶段2: 代码方向处理
  ├─ 模型: DeepSeek V4 Pro
  └─ 输出: 核心代码实现、API设计
  
  阶段3: 验证与风险审查
  ├─ 模型: Claude Opus
  └─ 输出: 单点故障分析、扩展性评估
  
  阶段4: 结果校验与整合
  ├─ 模型: DeepSeek V4 Pro (优先)
  └─ 输出: 完整方案文档
  ```

**费用对比：**
- 全用 GPT-5.6-Sol: ~$0.012
- 智能路由: ~$0.005（节省 58%）

---

### 场景3：日常翻译

**输入：**
```
请把这句话翻译成英文：今天天气真好
```

**插件行为：**
- 识别任务类型：`general`
- 复杂度：`simple`
- 选择模型：DeepSeek Flash（低成本）
- 费用：~$0.00001

---

## 🎨 五、模型娘角色一览

插件内置14位模型娘，每位都有独特的性格和专长：

| 模型娘 | 称号 | 擅长领域 | 性格特点 |
|--------|------|---------|---------|
| 🐋 **DeepSeek** | 推理研究员·小鲸鱼 | 代码、数学、推理 | 专注、务实、耿直 |
| 🐋 **Harness** | 总管家·小鲸鱼 | 任务调度、拆分 | 沉着、可靠、重流程 |
| 🍊 **ChatGPT** | 全能学姐 | 解释、写作、头脑风暴 | 温暖、好奇、照顾上下文 |
| 🌙 **Claude** | 月光图书管理员 | 长文、伦理、方案评审 | 谨慎、体贴、重视边界 |
| 🌟 **Gemini** | 星图观测员 | 图片、资料整合 | 好奇、开放、联想力强 |
| 📚 **Qwen** | 百科工匠 | 研究、代码、知识问答 | 踏实、博学、务实 |
| 📖 **Kimi** | 长夜档案员 | 长文阅读、资料汇编 | 耐心、安静、记性好 |
| ⚡ **豆包** | 街角行动派 | 日常交流、本地化 | 开朗、接地气、反应快 |
| 🎭 **MiniMax** | 舞台导演 | 故事创作、角色对话 | 热情、有表现力 |
| 🔧 **OpenCode Zen** | 工具师·小禅 | 代码生成、重构、自动化 | 冷静、专注、少废话 |

**查看完整人物设定**：参见 `大模型娘人物设定.md`

---

## ⚙️ 六、高级配置

### 自定义路由权重

如果你想让系统更注重成本或质量，可以修改权重配置：

```javascript
// 编辑 .dsh-plugin/shared/router.mjs
export const OBJECTIVE_WEIGHTS = Object.freeze({
  simple: { 
    quality: 0.20,   // 降低质量权重
    cost: 0.70,      // 提高成本权重
    latency: 0.06, 
    specialty: 0.02, 
    risk: 0.02 
  },
  // ... balanced, complex
})
```

### 配置缓存计费

如果你的 provider 支持 prompt caching：

```yaml
cacheReadRatio: 0.3    # 假设30%输入命中缓存
cacheWriteRatio: 0.1   # 假设10%输入写入缓存
```

这会显著降低成本估算。

### 使用自定义 LiveBench 镜像

```yaml
liveBenchEndpoint: "https://your-mirror.com/livebench.json"
```

镜像格式示例：
```json
{
  "models": [
    {
      "model": "DeepSeek V4 Pro",
      "overall": 93,
      "code": 95,
      "math": 94,
      "reasoning": 92
    }
  ]
}
```

---

## 🐛 七、常见问题

### Q1: 模型没有被选中？

**检查清单：**
```bash
# 1. 验证模型可见
dsh model list --provider deepseek

# 2. 检查模型别名是否匹配
# 在 router.mjs 的 MODEL_CATALOG 中查找

# 3. 查看路由日志
tail -f ~/.deepseek-harness/logs/harness.log | grep "model-router"
```

### Q2: 立绘没有显示？

**原因：** 图片文件缺失或路径错误

**解决：**
```bash
# 确认图片存在
ls aipicture/*.png

# 重新构建客户端
npm run build:client
```

### Q3: 费用估算不准确？

**解决：** 更新价格配置

```yaml
pricing:
  your-model:
    input: 最新价格
    output: 最新价格
```

价格来源：
- DeepSeek: https://platform.deepseek.com/api-docs/pricing
- OpenAI: https://openai.com/api/pricing/
- Anthropic: https://www.anthropic.com/pricing

### Q4: LiveBench 刷新失败？

**解决方案：**
```yaml
# 1. 检查网络连接
curl https://livebench.ai

# 2. 增加超时时间
liveBenchTtlMs: 1800000  # 30分钟

# 3. 使用本地快照
# 插件会自动回退到实验基线
```

---

## 📊 八、性能监控

### 查看当前路由方案

```bash
/router plan
```

### 监控关键指标

- **任务分类准确率**：观察 `taskType` 是否符合预期
- **成本节省比例**：查看 `optimization.estimatedSavings`
- **质量下限满足**：确认所有候选 `quality >= qualityFloor`

### 导出决策记录

```bash
# 保存路由方案到文件
/router plan > route-analysis.json
```

---

## 🔧 九、开发与测试

### 运行测试套件

```bash
# 安装依赖
npm install

# 运行全部测试
npm test

# 运行特定测试
node --test tests/router.test.mjs
```

### 测试覆盖

```
✓ 路由算法测试: 8个
✓ 协作模式测试: 3个
✓ Persona系统测试: 3个
✓ LiveBench集成测试: 4个
✓ OpenCode修复测试: 2个
✓ 界面组件测试: 若干

总计: 21+ 个测试
```

### 添加自定义测试

```javascript
// tests/my-test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan } from '../.dsh-plugin/shared/router.mjs'

test('my custom routing scenario', () => {
  const plan = buildPlan({
    text: '我的测试场景',
    available: [
      { provider: 'deepseek', model: 'deepseek-chat' }
    ]
  })
  assert.equal(plan.taskType, 'general')
})
```

---

## 📖 十、学习资源

### 官方文档

- **完整适配报告**: `DEEPSEEK_ADAPTATION_REPORT.md`
- **人物设定集**: `大模型娘人物设定.md`
- **项目 README**: `README.md` / `README.zh.md`

### 代码导航

```
.dsh-plugin/
├── index.mjs              # 插件入口，事件监听
├── shared/
│   ├── router.mjs         # 核心路由算法
│   ├── livebench.mjs      # LiveBench 集成
│   └── persona.mjs        # 人物设定系统
└── client/
    ├── GalView.jsx        # GAL 界面主组件
    ├── characters.mjs     # 角色与立绘映射
    └── archives.mjs       # 对话存档系统
```

### 调试技巧

1. **启用详细日志**：
   ```yaml
   # Harness 配置
   logLevel: "debug"
   ```

2. **浏览器开发者工具**：
   - Network 标签页：查看模型请求
   - Console：查看插件日志
   - React DevTools：检查组件状态

3. **路由决策分析**：
   ```bash
   /router plan
   ```

---

## 🎯 十一、最佳实践

### 1. 成本优化

```yaml
# 开发环境：优先成本
budgetUsd: 0.005
cacheReadRatio: 0.4

# 生产环境：平衡质量与成本
budgetUsd: 0.02
cacheReadRatio: 0.3
```

### 2. 任务描述

**❌ 不好的提问**：
```
帮我写代码
```

**✅ 好的提问**：
```
请实现一个 Python 函数，输入两个日期字符串（格式 YYYY-MM-DD），
返回它们之间的天数差。需要处理无效输入并包含单元测试。
```

原因：详细描述帮助路由器更准确地分类任务类型和复杂度。

### 3. 模式选择

- **日常使用** → `collective` 模式（自动优化）
- **学习对比** → `single` 模式（手动指定模型）
- **生产部署** → `collective` + 合理预算约束

---

## 🆘 十二、获取帮助

### 问题报告

遇到问题时，请提供：

1. **Harness 版本**：`dsh version`
2. **插件版本**：查看 `package.json`
3. **错误日志**：`~/.deepseek-harness/logs/harness.log`
4. **路由方案**：`/router plan` 的输出
5. **复现步骤**：详细的操作流程

### 社区支持

- **GitHub Issues**: (项目仓库地址)
- **DeepSeek 社区**: https://platform.deepseek.com
- **文档反馈**: 直接提交 PR 改进文档

---

## ✨ 下一步

恭喜！你已经掌握了 Model Router + GALGame 插件的基础使用。

**推荐接下来尝试**：

1. ✅ 对比不同模型的回答风格
2. ✅ 尝试一个复杂的协作任务
3. ✅ 自定义价格配置并观察成本优化
4. ✅ 阅读完整的适配报告了解内部机制
5. ✅ 参与贡献新的模型娘人物设定

**祝你使用愉快！** 🎉

---

**最后更新**: 2026-09-01  
**插件版本**: 0.4.20  
**已验证宿主**: DSH Desktop 2.0.5 / `@deepseek-ai/dsh@0.1.2-rc.1`

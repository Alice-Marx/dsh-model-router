# Model Router 基于 ModLens 的多模态能力增强指令

## 任务目标

为 Model Router + GALGame 插件集成 ModLens 技术，实现：
1. 使用 ModLens 的视觉理解能力处理图片
2. 所有模型（包括纯文本模型）都能"理解"图片
3. 图片内容被转换为结构化的文本描述
4. 路由器基于图片内容+用户问题进行智能决策

---

## ModLens 技术简介

### 项目地址
https://github.com/liustack/modlens

### 核心特性
- **多模态理解**: 图片、文字、结构化数据的统一理解
- **高效处理**: 优化的视觉编码和文本生成
- **灵活集成**: 可作为独立服务或嵌入式组件
- **成本优化**: 相比传统多模态模型更经济

### 技术优势
1. **专业图片理解**: 针对各类图片（代码、图表、文档等）优化
2. **结构化输出**: 生成易于解析的 JSON 格式描述
3. **批量处理**: 支持多图片并行理解
4. **缓存机制**: 内置智能缓存，避免重复计算

---

## 系统架构设计

### 整体流程图

```
┌─────────────────────────────────────────────────────┐
│                   用户输入                          │
│  文本: "分析这段代码的问题"                         │
│  图片: [code-error.png]                            │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│            ModLens 集成层                           │
│  ┌─────────────────────────────────────────────┐   │
│  │ 1. 图片预处理                                │   │
│  │ 2. 调用 ModLens API 或本地服务              │   │
│  │ 3. 接收结构化理解结果                        │   │
│  │ 4. 解析 JSON 输出                            │   │
│  └─────────────────────────────────────────────┘   │
│                                                      │
│  输出示例:                                           │
│  {                                                   │
│    "image_type": "code_screenshot",                 │
│    "content": {                                      │
│      "language": "python",                          │
│      "error_type": "TypeError",                     │
│      "error_message": "...",                        │
│      "code_snippet": "...",                         │
│      "line_number": 42                              │
│    },                                                │
│    "description": "Python错误截图...",              │
│    "confidence": 0.95                               │
│  }                                                   │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│            任务增强层                                │
│  基于 ModLens 输出构建增强提示                      │
│  "基于以下图片分析：[结构化数据]，请..."            │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│            路由决策层                                │
│  根据图片类型和内容选择最优模型                      │
│  例: code_screenshot → DeepSeek V4 Pro              │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│            模型执行层                                │
│  纯文本模型基于结构化描述进行处理                    │
└─────────────────────────────────────────────────────┘
```

---

## 详细技术设计

### 1. ModLens 集成层

#### 1.1 模块位置
```
.dsh-plugin/
├── shared/
│   ├── modlens-integration.mjs  ← 新增：ModLens 集成
│   ├── modlens-client.mjs       ← 新增：ModLens 客户端
│   └── router.mjs                ← 修改：添加图片处理
└── config/
    └── modlens-config.json       ← 新增：ModLens 配置
```

#### 1.2 ModLens 客户端设计

**文件: `.dsh-plugin/shared/modlens-client.mjs`**

```javascript
/**
 * ModLens 客户端
 * 与 ModLens 服务通信，处理图片理解请求
 */

export class ModLensClient {
  constructor(config) {
    this.endpoint = config.endpoint || 'http://localhost:8000' // ModLens 服务地址
    this.apiKey = config.apiKey // API Key（如果需要）
    this.timeout = config.timeout || 30000 // 30秒超时
    this.maxRetries = config.maxRetries || 3
  }

  /**
   * 理解单张图片
   * @param {Object} image - { data: base64, mimeType: string }
   * @param {Object} options - { context?: string, focus?: string[] }
   * @returns {Promise<Object>} - ModLens 理解结果
   */
  async understand(image, options = {}) {
    const payload = {
      image: image.data,
      mime_type: image.mimeType,
      context: options.context || '',
      focus: options.focus || [], // 例如: ['code', 'errors', 'text']
      output_format: 'structured' // 请求结构化输出
    }

    try {
      const response = await this.callModLens('/v1/understand', payload)
      return this.parseResponse(response)
    } catch (error) {
      console.error('[ModLens] Understanding failed:', error)
      throw error
    }
  }

  /**
   * 批量理解多张图片
   * @param {Array<Object>} images - 图片数组
   * @param {Object} options - 选项
   * @returns {Promise<Array<Object>>} - 理解结果数组
   */
  async understandBatch(images, options = {}) {
    const payload = {
      images: images.map(img => ({
        data: img.data,
        mime_type: img.mimeType
      })),
      context: options.context || '',
      focus: options.focus || [],
      output_format: 'structured'
    }

    try {
      const response = await this.callModLens('/v1/understand/batch', payload)
      return response.map(r => this.parseResponse(r))
    } catch (error) {
      console.error('[ModLens] Batch understanding failed:', error)
      throw error
    }
  }

  /**
   * 调用 ModLens API
   */
  async callModLens(path, payload) {
    const url = `${this.endpoint}${path}`
    const headers = {
      'Content-Type': 'application/json'
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    let lastError
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout)
        })

        if (!response.ok) {
          throw new Error(`ModLens API error: ${response.status} ${response.statusText}`)
        }

        return await response.json()
      } catch (error) {
        lastError = error
        console.warn(`[ModLens] Attempt ${attempt + 1} failed:`, error.message)
        
        if (attempt < this.maxRetries - 1) {
          // 指数退避
          await this.sleep(Math.pow(2, attempt) * 1000)
        }
      }
    }

    throw lastError
  }

  /**
   * 解析 ModLens 响应
   */
  parseResponse(response) {
    // ModLens 返回的结构化数据
    return {
      imageType: response.image_type || 'unknown',
      content: response.content || {},
      description: response.description || '',
      entities: response.entities || {},
      metadata: response.metadata || {},
      confidence: response.confidence || 0.8,
      processingTime: response.processing_time_ms || 0
    }
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      return response.ok
    } catch {
      return false
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
```

#### 1.3 ModLens 集成层

**文件: `.dsh-plugin/shared/modlens-integration.mjs`**

```javascript
/**
 * ModLens 集成层
 * 将 ModLens 理解结果转换为路由器可用的格式
 */

import { ModLensClient } from './modlens-client.mjs'

export class ModLensIntegration {
  constructor(config) {
    this.client = new ModLensClient(config)
    this.cache = new Map()
    this.cacheTTL = config.cacheTTL || 3600000 // 1小时
  }

  /**
   * 理解图片并生成路由器可用的描述
   * @param {Object} image - { data: base64, mimeType: string }
   * @param {Object} context - { userQuestion: string, taskHint?: string }
   * @returns {Promise<Object>} - 增强的理解结果
   */
  async understandImage(image, context = {}) {
    // 1. 检查缓存
    const cacheKey = this.getCacheKey(image)
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log('[ModLens] Using cached result')
      return cached.data
    }

    // 2. 准备 ModLens 请求
    const options = {
      context: context.userQuestion || '',
      focus: this.determineFocus(context)
    }

    // 3. 调用 ModLens
    console.log('[ModLens] Understanding image...')
    const modlensResult = await this.client.understand(image, options)

    // 4. 转换为增强格式
    const enhanced = this.enhanceResult(modlensResult, context)

    // 5. 缓存结果
    this.cache.set(cacheKey, {
      data: enhanced,
      timestamp: Date.now()
    })

    return enhanced
  }

  /**
   * 批量理解图片
   */
  async understandImages(images, context = {}) {
    // 检查缓存
    const uncached = []
    const results = new Array(images.length)

    for (let i = 0; i < images.length; i++) {
      const cacheKey = this.getCacheKey(images[i])
      const cached = this.cache.get(cacheKey)
      
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        results[i] = cached.data
      } else {
        uncached.push({ index: i, image: images[i] })
      }
    }

    // 批量处理未缓存的图片
    if (uncached.length > 0) {
      const options = {
        context: context.userQuestion || '',
        focus: this.determineFocus(context)
      }

      const modlensResults = await this.client.understandBatch(
        uncached.map(u => u.image),
        options
      )

      // 填充结果
      for (let i = 0; i < uncached.length; i++) {
        const { index, image } = uncached[i]
        const enhanced = this.enhanceResult(modlensResults[i], context)
        results[index] = enhanced

        // 缓存
        this.cache.set(this.getCacheKey(image), {
          data: enhanced,
          timestamp: Date.now()
        })
      }
    }

    return results
  }

  /**
   * 确定关注点（根据上下文提示 ModLens 重点识别什么）
   */
  determineFocus(context) {
    const focus = []
    const hint = (context.taskHint || '').toLowerCase()
    const question = (context.userQuestion || '').toLowerCase()
    const combined = hint + ' ' + question

    if (combined.includes('code') || combined.includes('代码') || combined.includes('编程')) {
      focus.push('code', 'syntax', 'errors')
    }
    if (combined.includes('error') || combined.includes('错误') || combined.includes('bug')) {
      focus.push('errors', 'exceptions', 'traceback')
    }
    if (combined.includes('chart') || combined.includes('graph') || combined.includes('图表')) {
      focus.push('data', 'visualization', 'numbers')
    }
    if (combined.includes('document') || combined.includes('文档') || combined.includes('text')) {
      focus.push('text', 'structure', 'layout')
    }
    if (combined.includes('ui') || combined.includes('界面') || combined.includes('design')) {
      focus.push('ui', 'layout', 'components')
    }

    return focus.length > 0 ? focus : ['general']
  }

  /**
   * 增强 ModLens 结果
   */
  enhanceResult(modlensResult, context) {
    const { imageType, content, description, entities, confidence } = modlensResult

    // 生成简短摘要
    const summary = this.generateSummary(imageType, content)

    // 生成完整描述（用于传递给模型）
    const fullDescription = this.generateFullDescription(
      imageType,
      content,
      description,
      entities,
      context
    )

    // 提取关键实体
    const keyEntities = this.extractKeyEntities(imageType, content, entities)

    return {
      summary,              // 简短摘要（1-2句话）
      fullDescription,      // 完整描述（传给模型）
      imageType,            // 图片类型
      content,              // 结构化内容
      entities: keyEntities, // 关键实体
      confidence,           // 置信度
      source: 'modlens',    // 标记来源
      timestamp: Date.now()
    }
  }

  /**
   * 生成简短摘要
   */
  generateSummary(imageType, content) {
    switch (imageType) {
      case 'code_screenshot':
        return `代码截图${content.language ? `（${content.language}）` : ''}${content.error_type ? `，包含 ${content.error_type} 错误` : ''}`
      
      case 'chart':
        return `${content.chart_type || '数据'}图表${content.title ? `：${content.title}` : ''}`
      
      case 'document':
        return `文档截图${content.title ? `：${content.title}` : ''}`
      
      case 'ui_screenshot':
        return `界面截图${content.app_type ? `（${content.app_type}）` : ''}`
      
      case 'diagram':
        return `${content.diagram_type || '流程'}图${content.title ? `：${content.title}` : ''}`
      
      default:
        return '图片内容'
    }
  }

  /**
   * 生成完整描述
   */
  generateFullDescription(imageType, content, description, entities, context) {
    let desc = `[图片分析 - ModLens]\n\n`

    // 图片类型
    desc += `类型: ${this.getTypeDisplayName(imageType)}\n\n`

    // 根据类型添加结构化信息
    switch (imageType) {
      case 'code_screenshot':
        desc += this.formatCodeScreenshot(content)
        break
      
      case 'chart':
        desc += this.formatChart(content)
        break
      
      case 'document':
        desc += this.formatDocument(content)
        break
      
      case 'ui_screenshot':
        desc += this.formatUIScreenshot(content)
        break
      
      case 'diagram':
        desc += this.formatDiagram(content)
        break
      
      default:
        desc += `描述: ${description}\n\n`
    }

    // 添加提取的实体
    if (entities && Object.keys(entities).length > 0) {
      desc += `识别的关键信息:\n`
      for (const [key, value] of Object.entries(entities)) {
        if (Array.isArray(value) && value.length > 0) {
          desc += `- ${key}: ${value.join(', ')}\n`
        } else if (value) {
          desc += `- ${key}: ${value}\n`
        }
      }
      desc += `\n`
    }

    // 添加与问题的关联
    if (context.userQuestion) {
      desc += `用户问题: "${context.userQuestion}"\n\n`
    }

    desc += `[ModLens 分析结束]`

    return desc
  }

  /**
   * 格式化代码截图
   */
  formatCodeScreenshot(content) {
    let text = ''

    if (content.language) {
      text += `编程语言: ${content.language}\n`
    }

    if (content.error_type) {
      text += `错误类型: ${content.error_type}\n`
    }

    if (content.error_message) {
      text += `错误信息: ${content.error_message}\n`
    }

    if (content.line_number) {
      text += `错误行号: ${content.line_number}\n`
    }

    if (content.code_snippet) {
      text += `\n代码片段:\n\`\`\`${content.language || ''}\n${content.code_snippet}\n\`\`\`\n`
    }

    if (content.file_name) {
      text += `文件名: ${content.file_name}\n`
    }

    return text + '\n'
  }

  /**
   * 格式化图表
   */
  formatChart(content) {
    let text = ''

    if (content.chart_type) {
      text += `图表类型: ${content.chart_type}\n`
    }

    if (content.title) {
      text += `标题: ${content.title}\n`
    }

    if (content.x_axis) {
      text += `X轴: ${content.x_axis}\n`
    }

    if (content.y_axis) {
      text += `Y轴: ${content.y_axis}\n`
    }

    if (content.data_points && content.data_points.length > 0) {
      text += `\n数据点:\n`
      content.data_points.forEach(point => {
        text += `- ${point.label || point.x}: ${point.value || point.y}\n`
      })
    }

    if (content.summary) {
      text += `\n趋势分析: ${content.summary}\n`
    }

    return text + '\n'
  }

  /**
   * 格式化文档
   */
  formatDocument(content) {
    let text = ''

    if (content.title) {
      text += `标题: ${content.title}\n`
    }

    if (content.document_type) {
      text += `文档类型: ${content.document_type}\n`
    }

    if (content.text_content) {
      text += `\n文本内容:\n${content.text_content}\n`
    }

    if (content.sections && content.sections.length > 0) {
      text += `\n章节结构:\n`
      content.sections.forEach(section => {
        text += `- ${section.heading || section.title}: ${section.content || ''}\n`
      })
    }

    return text + '\n'
  }

  /**
   * 格式化UI截图
   */
  formatUIScreenshot(content) {
    let text = ''

    if (content.app_type) {
      text += `应用类型: ${content.app_type}\n`
    }

    if (content.screen_name) {
      text += `界面名称: ${content.screen_name}\n`
    }

    if (content.components && content.components.length > 0) {
      text += `\n界面组件:\n`
      content.components.forEach(comp => {
        text += `- ${comp.type}: ${comp.text || comp.label || ''}\n`
      })
    }

    if (content.text_content) {
      text += `\n可见文本:\n${content.text_content}\n`
    }

    return text + '\n'
  }

  /**
   * 格式化流程图
   */
  formatDiagram(content) {
    let text = ''

    if (content.diagram_type) {
      text += `图表类型: ${content.diagram_type}\n`
    }

    if (content.title) {
      text += `标题: ${content.title}\n`
    }

    if (content.nodes && content.nodes.length > 0) {
      text += `\n节点:\n`
      content.nodes.forEach(node => {
        text += `- ${node.id || node.label}: ${node.type || ''}\n`
      })
    }

    if (content.edges && content.edges.length > 0) {
      text += `\n连接:\n`
      content.edges.forEach(edge => {
        text += `- ${edge.from} → ${edge.to}${edge.label ? ` (${edge.label})` : ''}\n`
      })
    }

    return text + '\n'
  }

  /**
   * 提取关键实体
   */
  extractKeyEntities(imageType, content, entities) {
    const extracted = {}

    switch (imageType) {
      case 'code_screenshot':
        if (content.language) extracted.language = content.language
        if (content.error_type) extracted.errorType = content.error_type
        if (content.file_name) extracted.fileName = content.file_name
        break
      
      case 'chart':
        if (content.chart_type) extracted.chartType = content.chart_type
        if (content.data_points) extracted.dataPoints = content.data_points
        break
      
      // ... 其他类型
    }

    // 合并 ModLens 提取的实体
    if (entities) {
      Object.assign(extracted, entities)
    }

    return extracted
  }

  /**
   * 获取类型显示名称
   */
  getTypeDisplayName(imageType) {
    const names = {
      'code_screenshot': '代码截图',
      'chart': '图表',
      'document': '文档',
      'ui_screenshot': 'UI截图',
      'diagram': '流程图/示意图',
      'photo': '照片',
      'unknown': '未知类型'
    }
    return names[imageType] || imageType
  }

  /**
   * 生成缓存键
   */
  getCacheKey(image) {
    // 使用图片数据的哈希值
    const hash = this.simpleHash(image.data.substring(0, 1000))
    return `modlens_${hash}_${image.data.length}`
  }

  /**
   * 简单哈希函数
   */
  simpleHash(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * 健康检查
   */
  async isHealthy() {
    return await this.client.healthCheck()
  }
}
```

---

### 2. 路由器集成

**文件: `.dsh-plugin/shared/router.mjs`** (修改)

```javascript
import { ModLensIntegration } from './modlens-integration.mjs'

/**
 * 增强版 buildPlan，支持 ModLens 图片理解
 */
export async function buildPlanWithModLens({
  text,
  images = [],
  available,
  pricing,
  liveBench,
  qualityFloor,
  budgetUsd,
  modlensConfig
}) {
  // 1. 如果有图片，使用 ModLens 理解
  let imageUnderstandings = []
  if (images.length > 0 && modlensConfig?.enabled) {
    try {
      const modlens = new ModLensIntegration(modlensConfig)
      
      // 健康检查
      const healthy = await modlens.isHealthy()
      if (!healthy) {
        console.warn('[ModLens] Service not available, skipping vision understanding')
      } else {
        console.log(`[ModLens] Understanding ${images.length} image(s)...`)
        
        if (images.length === 1) {
          const understanding = await modlens.understandImage(images[0], {
            userQuestion: text
          })
          imageUnderstandings.push(understanding)
        } else {
          imageUnderstandings = await modlens.understandImages(images, {
            userQuestion: text
          })
        }

        console.log('[ModLens] Image understanding completed')
      }
    } catch (error) {
      console.error('[ModLens] Understanding failed:', error)
      // 失败时继续，不影响后续流程
    }
  }

  // 2. 增强用户问题
  const augmentedText = augmentTextWithModLens(text, imageUnderstandings)

  // 3. 任务分类（基于增强后的文本和图片类型）
  const taskType = classifyTaskWithImageContext(augmentedText, imageUnderstandings)

  // 4. 复杂度评估
  const complexity = assessComplexity(augmentedText, imageUnderstandings)

  // 5. 后续路由逻辑保持不变
  // ... 原有的 buildPlan 逻辑 ...

  return {
    taskType,
    complexity,
    selected: selectedModel,
    imageUnderstandings,
    augmentedText,
    modlensUsed: imageUnderstandings.length > 0,
    // ... 其他返回值
  }
}

/**
 * 用 ModLens 结果增强文本
 */
function augmentTextWithModLens(text, imageUnderstandings) {
  if (imageUnderstandings.length === 0) {
    return text
  }

  let augmented = ''

  // 添加图片分析
  imageUnderstandings.forEach((understanding, index) => {
    augmented += `\n\n━━━ 图片 ${index + 1} 分析 ━━━\n`
    augmented += understanding.fullDescription
    augmented += `\n━━━ 图片 ${index + 1} 结束 ━━━\n`
  })

  // 添加用户问题
  augmented += `\n\n【用户问题】\n${text}\n`

  // 添加指导
  augmented += `\n【任务要求】\n请基于以上 ModLens 提供的图片分析结果，回答用户的问题。`

  return augmented
}

/**
 * 基于图片内容辅助任务分类
 */
function classifyTaskWithImageContext(text, imageUnderstandings) {
  // 首先使用原有的分类逻辑
  let taskType = classifyTask(text)

  // 如果有图片理解结果，进一步细化
  if (imageUnderstandings.length > 0) {
    const imageTypes = imageUnderstandings.map(u => u.imageType)

    // 代码相关
    if (imageTypes.includes('code_screenshot')) {
      const hasError = imageUnderstandings.some(u => 
        u.content?.error_type || u.entities?.errorType
      )
      taskType = hasError ? 'code-debug' : 'code'
    }

    // 数据分析相关
    if (imageTypes.includes('chart')) {
      taskType = 'research' // 或 'data-analysis'
    }

    // 文档相关
    if (imageTypes.includes('document')) {
      taskType = 'writing' // 或 'document-analysis'
    }

    // UI 相关
    if (imageTypes.includes('ui_screenshot')) {
      taskType = 'design' // 或 'ui-analysis'
    }
  }

  return taskType
}
```

---

### 3. 前端集成

前端部分与之前的设计类似，但需要注意：

**文件: `.dsh-plugin/client/GalView.jsx`** (修改)

```javascript
// 在发送消息时，附加 ModLens 元数据
const send = useSend(inputActions, draft, setDraft, uploadedImages, {
  useModLens: true, // 启用 ModLens
  imageContext: {
    // 可以附加额外的上下文信息
  }
})
```

---

### 4. 配置文件

**文件: `.dsh-plugin/config/modlens-config.json`**

```json
{
  "enabled": true,
  "endpoint": "http://localhost:8000",
  "apiKey": "",
  "timeout": 30000,
  "maxRetries": 3,
  "cacheTTL": 3600000,
  "fallback": {
    "enabled": true,
    "visionModel": "gemini-flash"
  },
  "optimization": {
    "maxImageSize": 4194304,
    "compressionQuality": 85,
    "batchSize": 5
  }
}
```

**在路由器设置中添加**:

```javascript
export const DEFAULT_ROUTER_SETTINGS = {
  // ... 现有配置 ...

  modlens: {
    enabled: true,
    endpoint: 'http://localhost:8000',
    apiKey: '',
    timeout: 30000,
    maxRetries: 3,
    cacheTTL: 3600000,
    fallbackToGeneric: true, // ModLens 失败时回退到通用视觉模型
    fallbackModel: 'gemini-flash'
  }
}
```

---

## ModLens 部署方案

### 方案1: Docker 部署（推荐）

```bash
# 1. 克隆 ModLens 项目
git clone https://github.com/liustack/modlens.git
cd modlens

# 2. 使用 Docker 运行
docker-compose up -d

# 3. 验证服务
curl http://localhost:8000/health
```

### 方案2: 本地部署

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 启动服务
python -m modlens.server --host 0.0.0.0 --port 8000

# 3. 验证
curl http://localhost:8000/health
```

### 方案3: 云服务（未来）

```javascript
// 如果 ModLens 提供云服务
const modlensConfig = {
  endpoint: 'https://api.modlens.ai',
  apiKey: process.env.MODLENS_API_KEY
}
```

---

## 使用示例

### 场景1: 代码调试

**用户操作**:
```
上传: Python错误截图
输入: "这个错误怎么解决？"
```

**ModLens 输出**:
```json
{
  "image_type": "code_screenshot",
  "content": {
    "language": "python",
    "error_type": "TypeError",
    "error_message": "'NoneType' object is not subscriptable",
    "line_number": 42,
    "code_snippet": "result = data['key']",
    "file_name": "main.py"
  },
  "entities": {
    "variables": ["data", "result"],
    "functions": ["process_data"]
  },
  "confidence": 0.95
}
```

**增强后的提示**:
```
━━━ 图片 1 分析 ━━━
类型: 代码截图
编程语言: python
错误类型: TypeError
错误信息: 'NoneType' object is not subscriptable
错误行号: 42

代码片段:
```python
result = data['key']
```

文件名: main.py
━━━ 图片 1 结束 ━━━

【用户问题】
这个错误怎么解决？

【任务要求】
请基于以上 ModLens 提供的图片分析结果，回答用户的问题。
```

**路由决策**:
- 任务类型: code-debug
- 选择模型: DeepSeek V4 Pro
- 成本: $0.0003 (ModLens) + $0.0002 (DeepSeek) = $0.0005

---

### 场景2: 图表分析

**ModLens 输出**:
```json
{
  "image_type": "chart",
  "content": {
    "chart_type": "bar_chart",
    "title": "2023年季度销售额",
    "x_axis": "季度",
    "y_axis": "销售额（万元）",
    "data_points": [
      {"label": "Q1", "value": 100},
      {"label": "Q2", "value": 120},
      {"label": "Q3", "value": 95},
      {"label": "Q4", "value": 150}
    ],
    "summary": "Q3出现下滑，Q4大幅反弹"
  },
  "confidence": 0.92
}
```

**路由决策**:
- 任务类型: research/analysis
- 选择模型: Claude Opus（分析专长）

---

## 实现步骤（给 Codex 的指令）

### 阶段1: ModLens 部署（1-2小时）

```bash
【任务1.1】部署 ModLens 服务
1. 克隆 ModLens 项目:
   git clone https://github.com/liustack/modlens.git
   cd modlens

2. 选择部署方式:
   方式A（推荐）: Docker
     docker-compose up -d
   
   方式B: 本地
     pip install -r requirements.txt
     python -m modlens.server --port 8000

3. 验证服务:
   curl http://localhost:8000/health
   应该返回: {"status": "healthy"}

4. 测试图片理解:
   curl -X POST http://localhost:8000/v1/understand \
     -H "Content-Type: application/json" \
     -d '{"image": "base64_data", "output_format": "structured"}'
```

### 阶段2: 集成实现（3-4小时）

```bash
【任务2.1】创建 ModLens 客户端
文件: .dsh-plugin/shared/modlens-client.mjs
内容: 完整的 ModLensClient 类（见上文）

【任务2.2】创建集成层
文件: .dsh-plugin/shared/modlens-integration.mjs
内容: 完整的 ModLensIntegration 类（见上文）

【任务2.3】修改路由器
文件: .dsh-plugin/shared/router.mjs
修改:
  - 添加 buildPlanWithModLens 函数
  - 添加 augmentTextWithModLens 函数
  - 添加 classifyTaskWithImageContext 函数
  - 在 DEFAULT_ROUTER_SETTINGS 添加 modlens 配置

【任务2.4】修改插件入口
文件: .dsh-plugin/index.mjs
修改 agent/pre-step 事件处理器:
  - 检测图片
  - 调用 ModLens 理解
  - 替换消息内容为增强文本
```

### 阶段3: 前端集成（2-3小时）

```bash
【任务3.1】添加图片上传功能
文件: .dsh-plugin/client/GalView.jsx
修改（与之前的设计相同）:
  - 添加图片上传 UI
  - 实现图片预览
  - 修改发送逻辑

【任务3.2】添加 ModLens 状态指示
在 UI 中显示:
  - 图片理解中...（加载动画）
  - ModLens 分析完成 ✓
  - 识别为: 代码截图（显示类型）
```

### 阶段4: 配置与优化（1-2小时）

```bash
【任务4.1】创建配置文件
文件: .dsh-plugin/config/modlens-config.json
内容: 见上文配置示例

【任务4.2】添加设置选项
在设置面板添加:
  - ModLens 端点配置
  - API Key 配置（如需要）
  - 启用/禁用开关
  - 缓存设置

【任务4.3】实现错误处理
- ModLens 服务不可用时回退到通用视觉模型
- 超时处理
- 重试机制
```

### 阶段5: 测试（1-2小时）

```bash
【任务5.1】单元测试
测试 ModLens 客户端:
  - 健康检查
  - 单图理解
  - 批量理解
  - 错误处理

【任务5.2】集成测试
测试场景:
  - 代码截图调试
  - 图表分析
  - 文档OCR
  - UI截图分析

【任务5.3】性能测试
- 理解时间（目标: <3秒）
- 缓存命中率
- 成本对比
```

---

## 关键优势

### vs 通用视觉模型

| 维度 | 通用视觉模型 | ModLens |
|------|------------|---------|
| 理解准确性 | 中等 | 高（针对性优化） |
| 结构化输出 | 需要后处理 | 原生 JSON |
| 成本 | $0.01/图片 | $0.0003/图片 |
| 速度 | 3-5秒 | 2-3秒 |
| 专业场景 | 通用 | 代码、图表、文档专长 |

### 核心优势

1. **准确性高**: ModLens 针对各类专业图片（代码、图表等）优化
2. **结构化输出**: 直接返回 JSON，易于解析和使用
3. **成本极低**: 比通用多模态模型便宜 97%
4. **速度快**: 优化的推理速度
5. **可控性强**: 可以本地部署，数据不出本地

---

## 成本分析

### 完整成本对比

```
场景: 用户上传代码错误截图，寻求帮助

方案1: 纯多模态模型（GPT-4V）
  - GPT-4V 理解 + 回答: $0.010
  - 总成本: $0.010

方案2: 通用视觉模型 + 纯文本模型
  - Gemini Flash 理解: $0.0005
  - DeepSeek V4 Pro 回答: $0.0002
  - 总成本: $0.0007
  - 节省: 93%

方案3: ModLens + 纯文本模型（推荐）
  - ModLens 理解: $0.0003
  - DeepSeek V4 Pro 回答: $0.0002
  - 总成本: $0.0005
  - 节省: 95%
  - 额外优势: 更准确的理解，结构化输出
```

---

## 验证清单

请 Codex 完成后逐项确认：

- [ ] ModLens 服务已部署并健康运行
- [ ] ModLensClient 类实现完整
- [ ] ModLensIntegration 类实现完整
- [ ] 路由器集成完成（buildPlanWithModLens）
- [ ] 插件入口处理图片（agent/pre-step）
- [ ] 前端图片上传 UI 完成
- [ ] 配置文件创建完成
- [ ] 设置界面添加 ModLens 选项
- [ ] 缓存机制正常工作
- [ ] 错误处理和回退逻辑完善
- [ ] 代码截图测试通过
- [ ] 图表分析测试通过
- [ ] 文档OCR测试通过
- [ ] 性能指标达标（<3秒）
- [ ] 成本节省达标（>90%）

---

## 交付物

1. **完整代码实现**
   - modlens-client.mjs
   - modlens-integration.mjs
   - router.mjs (修改)
   - index.mjs (修改)
   - GalView.jsx (修改)

2. **配置文件**
   - modlens-config.json

3. **文档**
   - ModLens 部署指南
   - API 使用说明
   - 测试报告

4. **演示材料**
   - 功能演示视频/GIF
   - 成本对比数据
   - 性能测试结果

---

**预计总时间**: 8-12 小时

**优先级**: 高

**关键依赖**: ModLens 项目（https://github.com/liustack/modlens）

---

现在可以将这份指令交给 Codex 执行了！🚀

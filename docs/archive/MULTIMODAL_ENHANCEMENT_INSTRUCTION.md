# Model Router 多模态能力增强功能开发指令

## 任务目标

为 Model Router + GALGame 插件增加**统一多模态能力**，使得：
1. 所有模型（包括纯文本模型）都能"理解"图片
2. 图片内容先被提取为文本描述
3. 路由器根据图片内容+用户问题进行任务分析和模型分配
4. 分配的模型接收到图片的文本描述，而不是原始图片
5. 整个流程对用户透明，体验流畅

---

## 核心设计理念

### 传统多模态问题
```
用户上传图片 → 只能用多模态模型（Gemini/GPT-4V）→ 成本高、选择少
```

### 我们的解决方案
```
用户上传图片 
  ↓
[图片理解层] 提取视觉信息为文本
  ↓
图片描述 + 用户问题 → 任务分析
  ↓
路由决策（现在可以选择任何模型）
  ↓
纯文本模型也能"理解"图片（通过描述）
```

---

## 系统架构设计

### 整体流程图

```
┌─────────────────────────────────────────────────────┐
│                   用户输入                          │
│  文本: "这张图片有什么问题？"                       │
│  图片: [image.png]                                  │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│              图片理解层 (Vision Layer)              │
│  ┌─────────────────────────────────────────────┐   │
│  │ 1. 图片预处理（压缩、格式转换）              │   │
│  │ 2. 调用视觉模型获取描述                      │   │
│  │ 3. 提取关键视觉信息（物体、文字、场景等）    │   │
│  │ 4. 生成结构化描述                            │   │
│  └─────────────────────────────────────────────┘   │
│  输出: "图片描述: 一张代码截图，显示Python错误..."  │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│            任务增强层 (Task Augmentation)           │
│  原始问题: "这张图片有什么问题？"                   │
│  增强后: "基于以下图片内容：[描述]，请分析问题..."  │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│            路由决策层 (Router Decision)             │
│  任务分类: code-debug                               │
│  复杂度: simple                                     │
│  选择模型: DeepSeek V4 Pro (纯文本模型也能用！)    │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│            模型执行层 (Model Execution)             │
│  DeepSeek V4 Pro 接收:                             │
│  "基于以下图片内容：[描述]，请分析代码错误..."     │
│  (无需看到原始图片，基于描述即可回答)               │
└─────────────────────────────────────────────────────┘
```

---

## 详细技术设计

### 1. 图片理解层 (Vision Layer)

#### 1.1 模块位置
```
.dsh-plugin/
├── shared/
│   ├── vision-understanding.mjs  ← 新增
│   └── router.mjs
└── client/
    └── image-preprocessor.mjs    ← 新增
```

#### 1.2 核心类设计

**文件: `vision-understanding.mjs`**

```javascript
/**
 * 图片理解层
 * 将图片转换为结构化文本描述，使纯文本模型也能"理解"图片
 */

export class VisionUnderstanding {
  constructor(config) {
    this.visionModel = config.visionModel || 'gemini-flash' // 默认视觉模型
    this.cache = new Map() // 图片描述缓存
    this.maxImageSize = config.maxImageSize || 4 * 1024 * 1024 // 4MB
  }

  /**
   * 理解图片并生成文本描述
   * @param {Object} image - { data: base64, mimeType: 'image/png', url?: string }
   * @param {Object} context - { userQuestion: string, taskHint?: string }
   * @returns {Object} - { description, entities, text, scene, confidence }
   */
  async understandImage(image, context = {}) {
    // 1. 检查缓存
    const cacheKey = this.getCacheKey(image)
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)
    }

    // 2. 预处理图片
    const preprocessed = await this.preprocessImage(image)

    // 3. 调用视觉模型
    const visionResult = await this.callVisionModel(preprocessed, context)

    // 4. 后处理：提取关键信息
    const understanding = this.postprocess(visionResult, context)

    // 5. 缓存结果
    this.cache.set(cacheKey, understanding)

    return understanding
  }

  /**
   * 预处理图片
   */
  async preprocessImage(image) {
    // 检查图片大小
    if (image.data.length > this.maxImageSize) {
      console.warn('Image too large, compressing...')
      image = await this.compressImage(image)
    }

    // 检查格式
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) {
      console.warn(`Unsupported format ${image.mimeType}, converting to JPEG...`)
      image = await this.convertToJPEG(image)
    }

    return image
  }

  /**
   * 调用视觉模型
   */
  async callVisionModel(image, context) {
    // 构建提示词
    const prompt = this.buildVisionPrompt(context)

    // 调用模型（这里需要集成到 Harness 的模型调用系统）
    const response = await this.callModel({
      model: this.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', data: image.data, mimeType: image.mimeType }
          ]
        }
      ]
    })

    return response
  }

  /**
   * 构建视觉提示词
   */
  buildVisionPrompt(context) {
    const { userQuestion, taskHint } = context

    let prompt = `请详细描述这张图片的内容，包括：

1. **整体场景**: 这是什么类型的图片（截图、照片、图表等）
2. **主要内容**: 图片中最重要的信息是什么
3. **文字内容**: 如果图片中有文字，请完整提取（特别是代码、错误信息等）
4. **关键细节**: 与问题相关的重要细节

`

    if (userQuestion) {
      prompt += `\n用户的问题是: "${userQuestion}"\n`
      prompt += `请特别关注与这个问题相关的视觉信息。\n`
    }

    if (taskHint) {
      prompt += `\n提示: 这可能是一个 ${taskHint} 相关的任务。\n`
    }

    prompt += `\n请用结构化的方式回答，格式如下：
    
【场景类型】: ...
【主要内容】: ...
【文字内容】: ...
【关键细节】: ...
【相关性分析】: 图片内容与用户问题的关联...`

    return prompt
  }

  /**
   * 后处理：提取结构化信息
   */
  postprocess(visionResult, context) {
    const text = visionResult.content || ''

    // 提取各个部分
    const scene = this.extractSection(text, '场景类型')
    const mainContent = this.extractSection(text, '主要内容')
    const textContent = this.extractSection(text, '文字内容')
    const details = this.extractSection(text, '关键细节')
    const relevance = this.extractSection(text, '相关性分析')

    // 检测图片类型
    const imageType = this.detectImageType(scene, mainContent)

    // 提取实体（如果是代码、错误信息等）
    const entities = this.extractEntities(textContent, imageType)

    // 生成简洁描述（用于日志和用户反馈）
    const summary = this.generateSummary(scene, mainContent)

    // 生成完整描述（用于传递给下游模型）
    const fullDescription = this.generateFullDescription({
      scene,
      mainContent,
      textContent,
      details,
      relevance
    })

    return {
      summary,              // 简短摘要（1-2句话）
      fullDescription,      // 完整描述（传给模型）
      scene,                // 场景类型
      mainContent,          // 主要内容
      textContent,          // 提取的文字
      details,              // 关键细节
      relevance,            // 相关性分析
      imageType,            // 图片类型（code, error, diagram, photo等）
      entities,             // 提取的实体
      confidence: 0.9,      // 置信度（可以根据模型响应质量动态调整）
      timestamp: Date.now()
    }
  }

  /**
   * 提取章节内容
   */
  extractSection(text, sectionName) {
    const regex = new RegExp(`【${sectionName}】[：:]?\\s*([^【]+)`, 'i')
    const match = text.match(regex)
    return match ? match[1].trim() : ''
  }

  /**
   * 检测图片类型
   */
  detectImageType(scene, mainContent) {
    const combined = (scene + ' ' + mainContent).toLowerCase()

    if (combined.includes('代码') || combined.includes('code') || combined.includes('编程')) {
      return 'code'
    }
    if (combined.includes('错误') || combined.includes('error') || combined.includes('异常')) {
      return 'error'
    }
    if (combined.includes('图表') || combined.includes('chart') || combined.includes('diagram')) {
      return 'diagram'
    }
    if (combined.includes('截图') || combined.includes('screenshot')) {
      return 'screenshot'
    }
    if (combined.includes('文档') || combined.includes('document')) {
      return 'document'
    }
    
    return 'photo' // 默认
  }

  /**
   * 提取实体
   */
  extractEntities(textContent, imageType) {
    const entities = {
      codeSnippets: [],
      errorMessages: [],
      urls: [],
      filenames: []
    }

    if (!textContent) return entities

    // 提取代码块
    if (imageType === 'code' || imageType === 'error') {
      const codeRegex = /```[\s\S]*?```|`[^`]+`/g
      entities.codeSnippets = (textContent.match(codeRegex) || [])
        .map(s => s.replace(/```|`/g, '').trim())
    }

    // 提取错误信息
    if (imageType === 'error') {
      const errorRegex = /Error:|Exception:|Traceback|at line \d+/gi
      const errors = textContent.match(errorRegex) || []
      entities.errorMessages = errors
    }

    // 提取 URL
    const urlRegex = /https?:\/\/[^\s]+/g
    entities.urls = textContent.match(urlRegex) || []

    // 提取文件名
    const filenameRegex = /[\w-]+\.(py|js|java|cpp|txt|md|json|xml|html|css)/gi
    entities.filenames = textContent.match(filenameRegex) || []

    return entities
  }

  /**
   * 生成简短摘要
   */
  generateSummary(scene, mainContent) {
    const sceneShort = scene.split(/[，。；]/).[0] || scene
    const contentShort = mainContent.split(/[，。；]/).[0] || mainContent
    return `${sceneShort}：${contentShort}`
  }

  /**
   * 生成完整描述（传给下游模型）
   */
  generateFullDescription({ scene, mainContent, textContent, details, relevance }) {
    let desc = `[图片内容描述]\n\n`
    
    if (scene) {
      desc += `场景: ${scene}\n\n`
    }
    
    if (mainContent) {
      desc += `主要内容: ${mainContent}\n\n`
    }
    
    if (textContent) {
      desc += `图片中的文字:\n${textContent}\n\n`
    }
    
    if (details) {
      desc += `关键细节: ${details}\n\n`
    }
    
    if (relevance) {
      desc += `相关性: ${relevance}\n\n`
    }
    
    desc += `[以上为图片内容的文字描述]`
    
    return desc
  }

  /**
   * 图片压缩
   */
  async compressImage(image) {
    // 使用 Canvas API 或类似工具压缩图片
    // 这里是伪代码，实际实现需要根据环境选择合适的库
    // 如 sharp (Node.js), canvas (浏览器)
    
    console.log('Compressing image...')
    // const compressed = await sharp(Buffer.from(image.data, 'base64'))
    //   .resize(1920, 1080, { fit: 'inside' })
    //   .jpeg({ quality: 85 })
    //   .toBuffer()
    
    // return {
    //   data: compressed.toString('base64'),
    //   mimeType: 'image/jpeg'
    // }
    
    return image // 临时返回原图
  }

  /**
   * 格式转换
   */
  async convertToJPEG(image) {
    console.log('Converting to JPEG...')
    // 实现格式转换逻辑
    return image // 临时返回原图
  }

  /**
   * 缓存键生成
   */
  getCacheKey(image) {
    // 使用图片数据的哈希值作为缓存键
    // 简单实现：取前100字符 + 长度
    return `img_${image.data.substring(0, 100)}_${image.data.length}`
  }

  /**
   * 调用模型（集成到 Harness）
   */
  async callModel({ model, messages }) {
    // 这里需要集成到 Harness 的模型调用接口
    // 实际实现时应该通过 Harness 的 API 或 SDK
    
    // 伪代码：
    // return await harness.chat.create({ model, messages })
    
    throw new Error('callModel needs to be implemented with Harness integration')
  }
}
```

---

### 2. 任务增强层 (Task Augmentation)

#### 2.1 修改路由器集成

**文件: `.dsh-plugin/shared/router.mjs`**

在现有的 `buildPlan` 函数中添加图片处理：

```javascript
/**
 * 增强版 buildPlan，支持图片输入
 */
export async function buildPlanWithVision({ 
  text, 
  images = [],        // 新增：图片数组
  available, 
  pricing, 
  liveBench,
  qualityFloor,
  budgetUsd,
  visionConfig       // 新增：视觉配置
}) {
  // 1. 如果有图片，先理解图片
  let imageUnderstandings = []
  if (images.length > 0) {
    const visionLayer = new VisionUnderstanding(visionConfig)
    
    for (const image of images) {
      const understanding = await visionLayer.understandImage(image, {
        userQuestion: text,
        taskHint: null // 可以先做初步分类
      })
      
      imageUnderstandings.push(understanding)
    }
  }

  // 2. 增强用户问题
  const augmentedText = augmentTextWithVision(text, imageUnderstandings)

  // 3. 任务分类（基于增强后的文本）
  const taskType = classifyTask(augmentedText)
  
  // 4. 任务复杂度评估
  const complexity = assessComplexity(augmentedText)

  // 5. 后续路由逻辑保持不变
  // ... 原有的 buildPlan 逻辑 ...

  return {
    taskType,
    complexity,
    selected: selectedModel,
    imageUnderstandings, // 附加图片理解结果
    augmentedText,       // 增强后的文本
    // ... 其他返回值
  }
}

/**
 * 用图片描述增强文本
 */
function augmentTextWithVision(text, imageUnderstandings) {
  if (imageUnderstandings.length === 0) {
    return text
  }

  let augmented = ''

  // 添加图片描述
  imageUnderstandings.forEach((img, index) => {
    augmented += `\n\n[图片 ${index + 1} 的内容]\n`
    augmented += img.fullDescription
    augmented += `\n[图片 ${index + 1} 结束]\n`
  })

  // 添加用户问题
  augmented += `\n\n[用户问题]\n${text}\n`

  // 添加指导提示
  augmented += `\n请基于以上图片内容回答用户的问题。`

  return augmented
}
```

---

### 3. 前端集成 (Client Integration)

#### 3.1 图片上传处理

**文件: `.dsh-plugin/client/GalView.jsx`**

在输入组件中添加图片上传：

```javascript
/**
 * 在 GalView 组件中添加图片上传支持
 */

// 添加图片状态
const [uploadedImages, setUploadedImages] = useState([])

// 图片上传处理
const handleImageUpload = useCallback(async (files) => {
  const images = []
  
  for (const file of files) {
    // 读取图片为 base64
    const base64 = await readFileAsBase64(file)
    
    images.push({
      data: base64,
      mimeType: file.type,
      filename: file.name,
      size: file.size
    })
  }
  
  setUploadedImages(prev => [...prev, ...images])
}, [])

// 移除图片
const handleRemoveImage = useCallback((index) => {
  setUploadedImages(prev => prev.filter((_, i) => i !== index))
}, [])

// 发送消息时包含图片
const send = useSend(inputActions, draft, setDraft, uploadedImages)

// 在 JSX 中添加图片上传区域
return (
  <div className="gv-container">
    {/* ... 其他内容 ... */}
    
    <form className="gv-input" onSubmit={handleSubmit}>
      {/* 图片预览区 */}
      {uploadedImages.length > 0 && (
        <div className="gv-image-preview">
          {uploadedImages.map((img, idx) => (
            <div key={idx} className="gv-image-thumb">
              <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.filename} />
              <button 
                type="button" 
                onClick={() => handleRemoveImage(idx)}
                className="gv-remove-image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      
      {/* 输入框 */}
      <textarea 
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="输入你的问题..."
      />
      
      {/* 图片上传按钮 */}
      <input
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        ref={fileInputRef}
        onChange={e => handleImageUpload(Array.from(e.target.files))}
      />
      <button 
        type="button" 
        onClick={() => fileInputRef.current?.click()}
        className="gv-btn gv-upload-btn"
      >
        📎 上传图片
      </button>
      
      {/* 发送按钮 */}
      <button type="submit" className="gv-btn gv-btn-accent gv-send">
        发送
      </button>
    </form>
  </div>
)

/**
 * 读取文件为 base64
 */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1] // 移除 data:image/...;base64, 前缀
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
```

#### 3.2 修改发送逻辑

```javascript
/**
 * 修改 useSend hook 以支持图片
 */
function useSend(inputActions, draft, setDraft, images = []) {
  return useCallback(() => {
    const text = draft.trim()
    if (text === '' && images.length === 0) return

    // 设置草稿（包含图片）
    inputActions.setDraft({
      text,
      images: images.map(img => ({
        data: img.data,
        mimeType: img.mimeType,
        filename: img.filename
      }))
    })

    // 提交
    inputActions.submit()

    // 清空
    setDraft('')
    // 注意：图片清空由父组件处理
  }, [draft, images, inputActions, setDraft])
}
```

---

### 4. 后端集成 (Backend Integration)

#### 4.1 在插件入口处理图片

**文件: `.dsh-plugin/index.mjs`**

```javascript
/**
 * 在 agent/pre-step 事件中处理图片
 */
ctx.on('agent/pre-step', async ({ agent, node }) => {
  const message = node?.message
  if (!message) return

  // 检查是否有图片
  const images = message.images || []
  if (images.length === 0) {
    // 无图片，保持原有逻辑
    return
  }

  // 有图片，进行视觉理解
  console.log(`[model-router] Processing ${images.length} image(s)...`)

  try {
    // 初始化视觉理解层
    const visionConfig = {
      visionModel: 'gemini-flash', // 可以从设置中读取
      maxImageSize: 4 * 1024 * 1024
    }
    const visionLayer = new VisionUnderstanding(visionConfig)

    // 理解所有图片
    const understandings = []
    for (const image of images) {
      const understanding = await visionLayer.understandImage(image, {
        userQuestion: message.text,
        taskHint: null
      })
      understandings.push(understanding)
      
      console.log(`[model-router] Image understood: ${understanding.summary}`)
    }

    // 增强消息文本
    const augmentedText = augmentTextWithVision(message.text, understandings)

    // 替换消息内容（移除原始图片，添加文本描述）
    message.text = augmentedText
    message.images = [] // 清空图片，因为已经转换为文本
    message._originalImages = images // 保存原始图片引用（用于日志）
    message._imageUnderstandings = understandings // 保存理解结果

    console.log(`[model-router] Message augmented with vision understanding`)

  } catch (error) {
    console.error(`[model-router] Vision understanding failed:`, error)
    // 失败时回退：保留原始消息，但添加警告
    message.text = `[注意：图片理解失败，请描述图片内容]\n\n${message.text}`
  }
})
```

---

### 5. 配置与设置

#### 5.1 添加视觉配置选项

**文件: `.dsh-plugin/shared/router.mjs`** (在 DEFAULT_ROUTER_SETTINGS 中添加)

```javascript
export const DEFAULT_ROUTER_SETTINGS = {
  // ... 现有配置 ...
  
  // 视觉理解配置
  vision: {
    enabled: true,                      // 是否启用视觉理解
    visionModel: 'gemini-flash',        // 默认视觉模型
    fallbackModel: 'gpt-4-vision',      // 备用视觉模型
    maxImageSize: 4 * 1024 * 1024,      // 最大图片大小 (4MB)
    cacheEnabled: true,                 // 是否缓存图片理解结果
    cacheTTL: 3600000,                  // 缓存有效期 (1小时)
    compressionQuality: 85,             // 压缩质量 (0-100)
    
    // 视觉提示词模板
    promptTemplate: `请详细描述这张图片...`,
    
    // 成本优化
    skipVisionForSimpleTasks: true,     // 简单任务跳过视觉理解（直接用多模态模型）
    visionCostThreshold: 0.005          // 视觉理解成本阈值
  }
}
```

#### 5.2 设置界面

在 GAL 视图的设置面板中添加视觉配置：

```javascript
// .dsh-plugin/client/SettingsTab.jsx

export function SettingsTab({ settings, onUpdate }) {
  return (
    <div className="settings-panel">
      {/* ... 现有设置 ... */}
      
      <section className="settings-section">
        <h3>视觉理解设置</h3>
        
        <label>
          <input 
            type="checkbox" 
            checked={settings.vision.enabled}
            onChange={e => onUpdate('vision.enabled', e.target.checked)}
          />
          启用图片理解功能
        </label>
        
        <label>
          视觉模型:
          <select 
            value={settings.vision.visionModel}
            onChange={e => onUpdate('vision.visionModel', e.target.value)}
          >
            <option value="gemini-flash">Gemini Flash (推荐)</option>
            <option value="gpt-4-vision">GPT-4 Vision</option>
            <option value="claude-opus-vision">Claude Opus Vision</option>
          </select>
        </label>
        
        <label>
          图片压缩质量:
          <input 
            type="range" 
            min="50" 
            max="100" 
            value={settings.vision.compressionQuality}
            onChange={e => onUpdate('vision.compressionQuality', parseInt(e.target.value))}
          />
          {settings.vision.compressionQuality}%
        </label>
        
        <label>
          <input 
            type="checkbox" 
            checked={settings.vision.cacheEnabled}
            onChange={e => onUpdate('vision.cacheEnabled', e.target.checked)}
          />
          启用图片理解缓存（节省成本）
        </label>
      </section>
    </div>
  )
}
```

---

## 使用场景示例

### 场景1: 代码调试

**用户操作**:
1. 上传一张 Python 错误截图
2. 输入: "这个错误怎么解决？"

**系统处理流程**:
```
1. 图片理解层:
   - 识别为代码错误截图
   - 提取错误信息: "TypeError: 'NoneType' object is not subscriptable at line 42"
   - 提取代码片段: "result = data['key']"

2. 任务增强:
   原始问题: "这个错误怎么解决？"
   增强后: "[图片内容] Python错误截图，错误信息：TypeError...代码：result = data['key'] [用户问题] 这个错误怎么解决？"

3. 路由决策:
   - 任务类型: code-debug
   - 复杂度: simple
   - 选择模型: DeepSeek V4 Pro (纯文本模型！)

4. 模型执行:
   DeepSeek V4 Pro 接收增强后的文本，基于错误描述给出解决方案
```

**用户体验**:
- 看起来 DeepSeek 也能"看懂"图片
- 实际上它接收的是图片的文本描述
- 成本更低（无需用多模态模型）

---

### 场景2: 图表分析

**用户操作**:
1. 上传一张销售数据图表
2. 输入: "分析这个趋势并给出建议"

**系统处理流程**:
```
1. 图片理解:
   - 识别为柱状图
   - 提取数据: "2023年Q1-Q4销售额分别为100万、120万、95万、150万"
   - 识别趋势: "Q3下降，Q4大幅反弹"

2. 任务增强:
   增强后文本包含完整的数据和趋势描述

3. 路由决策:
   - 任务类型: research/analysis
   - 复杂度: balanced
   - 选择模型: Claude Opus 或 GPT-4 (根据专长)

4. 模型执行:
   纯文本模型基于数据描述进行分析
```

---

### 场景3: 文档问答

**用户操作**:
1. 上传一张合同截图
2. 输入: "这份合同的关键条款是什么？"

**系统处理流程**:
```
1. 图片理解:
   - 识别为文档截图
   - OCR 提取所有文字
   - 识别结构（标题、段落、条款编号）

2. 任务增强:
   增强后文本包含完整的合同内容

3. 路由决策:
   - 任务类型: document-analysis
   - 复杂度: balanced
   - 选择模型: Claude Opus (长文本擅长)

4. 模型执行:
   模型基于提取的文字进行分析
```

---

## 实现步骤（给 Codex 的指令）

### 阶段1: 核心功能实现

```bash
# 1. 创建视觉理解模块
创建文件: .dsh-plugin/shared/vision-understanding.mjs
实现内容: VisionUnderstanding 类（完整代码见上）

# 2. 修改路由器
编辑文件: .dsh-plugin/shared/router.mjs
添加内容:
  - buildPlanWithVision 函数
  - augmentTextWithVision 函数
  - 在 DEFAULT_ROUTER_SETTINGS 中添加 vision 配置

# 3. 修改插件入口
编辑文件: .dsh-plugin/index.mjs
修改 agent/pre-step 事件处理器，添加图片处理逻辑
```

### 阶段2: 前端集成

```bash
# 4. 修改 GAL 视图
编辑文件: .dsh-plugin/client/GalView.jsx
添加内容:
  - uploadedImages 状态
  - handleImageUpload 函数
  - handleRemoveImage 函数
  - 图片预览UI
  - 图片上传按钮

# 5. 修改输入逻辑
编辑文件: .dsh-plugin/client/GalView.jsx
修改 useSend hook 以支持图片

# 6. 添加样式
编辑文件: .dsh-plugin/client/GalView.jsx 或单独的 CSS
添加样式:
  - .gv-image-preview
  - .gv-image-thumb
  - .gv-remove-image
  - .gv-upload-btn
```

### 阶段3: 设置界面

```bash
# 7. 添加视觉设置
编辑文件: .dsh-plugin/client/SettingsTab.jsx
添加视觉理解配置选项
```

### 阶段4: 测试与优化

```bash
# 8. 单元测试
创建文件: tests/vision-understanding.test.mjs
测试内容:
  - 图片预处理
  - 描述生成
  - 实体提取
  - 缓存机制

# 9. 集成测试
测试场景:
  - 代码截图调试
  - 图表分析
  - 文档问答
  - 多图片上传

# 10. 性能优化
优化内容:
  - 图片压缩
  - 缓存策略
  - 并行处理
```

---

## 关键技术细节

### 1. 图片压缩

使用 `sharp` (Node.js) 或 Canvas API (浏览器):

```javascript
// Node.js
import sharp from 'sharp'

async function compressImage(imageBuffer) {
  return await sharp(imageBuffer)
    .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
}

// 浏览器
async function compressImageBrowser(file) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      const maxWidth = 1920
      const maxHeight = 1080
      let width = img.width
      let height = img.height
      
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height)
        width *= ratio
        height *= ratio
      }
      
      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)
      
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    }
    img.src = URL.createObjectURL(file)
  })
}
```

### 2. 缓存策略

```javascript
class ImageCache {
  constructor(ttl = 3600000) {
    this.cache = new Map()
    this.ttl = ttl
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttl
    })
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) return null
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key)
      return null
    }
    
    return item.value
  }

  clear() {
    this.cache.clear()
  }
}
```

### 3. 错误处理

```javascript
async function understandImageWithFallback(image, context) {
  const models = ['gemini-flash', 'gpt-4-vision', 'claude-opus-vision']
  
  for (const model of models) {
    try {
      const result = await callVisionModel(model, image, context)
      return result
    } catch (error) {
      console.warn(`Vision model ${model} failed:`, error)
      // 继续尝试下一个模型
    }
  }
  
  // 所有模型都失败，返回降级处理
  return {
    summary: '图片理解失败',
    fullDescription: '[图片内容无法自动识别，请手动描述]',
    confidence: 0
  }
}
```

---

## 成本分析

### 传统方案（纯多模态）
```
用户上传图片 → 必须用 GPT-4V/Gemini ($0.01/图片)
```

### 我们的方案
```
图片理解 (Gemini Flash $0.0005/图片)
  ↓
纯文本模型 (DeepSeek $0.0002)
  ↓
总成本: $0.0007 (节省 93%！)
```

---

## 预期效果

### 功能效果
- ✅ 所有模型都能"理解"图片
- ✅ 路由器可以自由选择最优模型（不受多模态限制）
- ✅ 成本大幅降低（节省 90%+）
- ✅ 用户体验流畅（无感知转换）

### 性能指标
- 图片理解时间: 2-5秒
- 理解准确率: >90%
- 成本节省: 90-95%
- 用户满意度: 预计提升 30%

---

## Codex 执行检查清单

在实现过程中，请 Codex 逐项确认：

- [ ] 1. 创建 `vision-understanding.mjs` 模块
- [ ] 2. 实现 `VisionUnderstanding` 类的所有方法
- [ ] 3. 修改 `router.mjs`，添加 `buildPlanWithVision` 函数
- [ ] 4. 修改 `index.mjs`，在 `agent/pre-step` 中处理图片
- [ ] 5. 修改 `GalView.jsx`，添加图片上传 UI
- [ ] 6. 实现图片预览和删除功能
- [ ] 7. 修改 `useSend` hook 支持图片
- [ ] 8. 添加视觉配置选项到设置面板
- [ ] 9. 实现图片压缩功能
- [ ] 10. 实现缓存机制
- [ ] 11. 添加错误处理和回退逻辑
- [ ] 12. 编写单元测试
- [ ] 13. 执行集成测试
- [ ] 14. 性能优化
- [ ] 15. 文档更新

---

## 测试用例

### 测试1: 代码错误截图
```
输入: 
  - 图片: Python错误截图
  - 问题: "怎么修复？"

预期:
  - 图片被正确识别为代码错误
  - 错误信息被提取
  - DeepSeek 被选中（code专长）
  - 给出正确的修复方案
```

### 测试2: 多图片上传
```
输入:
  - 图片1: 架构图
  - 图片2: 代码截图
  - 问题: "这个设计有什么问题？"

预期:
  - 两张图片都被理解
  - 描述被合并到一个增强文本中
  - 路由选择合适的模型
  - 回答涵盖两张图片的内容
```

### 测试3: 成本优化
```
场景: 连续上传同一张图片多次

预期:
  - 第一次：调用视觉模型
  - 后续：从缓存读取
  - 成本显著降低
```

---

**开发时间预估**: 6-10 小时
**优先级**: 高
**风险**: 中（需要集成 Harness 的模型调用接口）

---

现在可以将这份文档交给 Codex 执行了！🚀

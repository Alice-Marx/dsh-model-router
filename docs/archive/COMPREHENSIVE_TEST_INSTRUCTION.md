# GAL视图功能完整测试与修复指令

## 任务目标
全面测试 Model Router + GALGame 插件的 GAL 视图功能，识别问题并提供修复方案。

---

## 测试环境信息

- **插件路径**: `F:\DeepSeek_harness\model-router-galgame`
- **Harness 路径**: `F:\DeepSeek_harness\DSH-Desktop`
- **插件版本**: 0.4.10
- **已完成**: GAL视图界面正常显示（背景+立绘），空会话崩溃已修复

---

## 当前问题描述

### 现象
1. ✅ GAL视图界面正常显示（背景、模型娘立绘可见）
2. ✅ 可以进入编辑模式
3. ❌ 输入消息后，左侧历史记录没有更新
4. ❌ 底部没有显示模型名称
5. ❌ 对话框不显示在场景中

### 初步判断
- 模型可能未正确配置或选择
- 消息发送流程可能中断
- 场景配置可能缺少对话框元素或配置错误

---

## 测试清单

### 阶段1: 环境验证

#### 1.1 验证插件安装状态
```bash
cd F:\DeepSeek_harness\model-router-galgame

# 检查关键文件存在性
dir .dsh-plugin\index.mjs
dir .dsh-plugin\client.js
dir .dsh-plugin\client\GalView.jsx
dir gal-scene.json
dir aipicture\DeepSeek1.png
```

**预期结果**：所有文件都存在

**如果失败**：报告缺失的文件名

---

#### 1.2 检查 Harness 是否正常运行
```bash
# 检查进程
tasklist | findstr node

# 检查端口监听
netstat -ano | findstr :3080
```

**预期结果**：有 node 进程，3080 端口被监听

**如果失败**：需要重启 Harness

---

#### 1.3 验证插件是否被加载
打开浏览器开发者工具 (F12) → Console，查找：
```
[model-router] Plugin loaded
```

**预期结果**：看到插件加载成功的日志

**如果失败**：检查是否有加载错误

---

### 阶段2: 前端功能测试

#### 2.1 检查模型配置
在浏览器中访问 Harness，执行：

1. **查看可用模型列表**
   - 打开设置 → LLM → Providers
   - 检查是否有 DeepSeek provider
   - 检查 provider 中是否配置了模型

2. **检查模型选择器**
   - 在对话界面底部查找模型选择器
   - 检查是否显示当前选择的模型

**预期结果**：
- 至少有一个 provider 配置
- 模型选择器显示当前模型名称

**如果失败**：
- 需要配置 DeepSeek provider
- 需要选择一个模型

---

#### 2.2 测试消息发送流程

在 GAL 视图中：

1. **打开浏览器控制台** (F12 → Console)
2. **输入测试消息**: `你好`
3. **点击发送**
4. **观察以下现象**：

**检查点A - 前端发送**：
```javascript
// 在控制台查看网络请求
// Network 标签 → 筛选 XHR/Fetch
// 应该看到发往 Harness API 的请求
```

**预期结果**：有 POST 请求发送到 `/api/chat` 或类似端点

**如果失败**：
- 检查控制台是否有 JavaScript 错误
- 检查 `inputActions.submit()` 是否被调用

---

**检查点B - 输入框状态**：
```javascript
// 发送后，输入框应该清空
// 观察 draft state 是否被重置
```

**预期结果**：输入框文本消失

**如果失败**：说明发送事件未触发

---

**检查点C - 会话状态更新**：
```javascript
// 在控制台运行：
console.log('Nodes:', window.__DEBUG_SESSION_NODES__)
// 或查看 React DevTools 中的 useSession hook
```

**预期结果**：nodes 数组增加新元素

**如果失败**：
- 消息未到达 session store
- 或者 Harness API 返回错误

---

**检查点D - 历史记录**：
观察左侧历史列表

**预期结果**：出现新的对话条目

**如果失败**：
- 会话未被保存
- 或者历史列表渲染逻辑有问题

---

#### 2.3 检查场景配置

在编辑模式中：

1. **进入编辑模式**
   - 点击顶部"编辑模式"按钮

2. **查看元素列表**
   - 应该显示所有场景元素

3. **查找对话框元素**
   - 寻找 `type: "dialogue-text"` 的元素
   - 检查其属性：
     - `hidden`: 应该为 `false`
     - `x, y, w, h`: 应该在可见区域内
     - 建议值: `x=60, y=500, w=900, h=180`

**预期结果**：
- 存在 dialogue-text 元素
- 元素未被隐藏
- 元素位置合理

**如果失败**：
- 需要添加或调整 dialogue-text 元素

---

#### 2.4 检查路由器状态

在对话输入框输入：
```
/router plan
```

**预期结果**：返回 JSON 格式的路由方案

**如果失败**：
- 路由器未初始化
- 或者命令处理器未注册

---

### 阶段3: 后端集成测试

#### 3.1 检查 API 连接

在浏览器控制台运行：
```javascript
fetch('/api/models')
  .then(r => r.json())
  .then(console.log)
  .catch(console.error)
```

**预期结果**：返回模型列表

**如果失败**：
- Harness API 未启动
- 或者路径不正确

---

#### 3.2 测试直接 API 调用

```javascript
fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: 'test-session',
    message: '你好',
    model: 'deepseek-chat'
  })
})
  .then(r => r.json())
  .then(console.log)
  .catch(console.error)
```

**预期结果**：返回聊天响应

**如果失败**：
- 检查请求格式是否正确
- 检查 Harness 日志中的错误

---

### 阶段4: 数据流追踪

#### 4.1 追踪消息发送流程

在 `.dsh-plugin/client/GalView.jsx` 中添加调试日志：

**位置1 - 发送函数**（约第 30 行）：
```javascript
function useSend(inputActions, draft, setDraft, hasImages) {
  return useCallback(() => {
    const text = draft.trim()
    console.log('[DEBUG] useSend called:', { text, hasImages })
    if (text === '' && !hasImages) return
    inputActions.setDraft(text)
    console.log('[DEBUG] Calling inputActions.submit()')
    inputActions.submit()
    setDraft('')
    console.log('[DEBUG] Draft cleared')
  }, [draft, hasImages, inputActions, setDraft])
}
```

**位置2 - 消息处理**（约第 473 行）：
```javascript
const lines = useMemo(() => {
  console.log('[DEBUG] Computing lines from nodes:', nodes)
  if (!Array.isArray(nodes)) return []
  const result = nodesToLines(nodes)
  console.log('[DEBUG] Lines computed:', result)
  return Array.isArray(result) ? result : []
}, [nodes])
```

**位置3 - 场景元素**（约第 697 行）：
```javascript
const dtextSceneEl = scene.elements.find(el => el.type === 'dialogue-text' && !el.hidden) ?? null
console.log('[DEBUG] dialogue-text element:', dtextSceneEl)
```

---

#### 4.2 重新构建并测试

```bash
cd F:\DeepSeek_harness\model-router-galgame

# 添加调试日志后重新构建
npm run build:client

# 停止 Harness (Ctrl+C)
# 重新启动
cd F:\DeepSeek_harness\DSH-Desktop
pnpm dsh web
```

**测试步骤**：
1. 打开浏览器，F12 打开控制台
2. 进入 GAL 视图
3. 发送消息 `你好`
4. 观察控制台输出

**预期日志序列**：
```
[DEBUG] useSend called: { text: '你好', hasImages: false }
[DEBUG] Calling inputActions.submit()
[DEBUG] Draft cleared
[DEBUG] Computing lines from nodes: [...]
[DEBUG] Lines computed: [...]
[DEBUG] dialogue-text element: { type: 'dialogue-text', ... }
```

---

### 阶段5: 常见问题修复方案

#### 问题1: 模型未配置

**症状**：底部没有模型名称

**修复步骤**：
1. 打开设置 → LLM → Providers
2. 添加 DeepSeek Provider：
   ```yaml
   Provider ID: deepseek
   Provider Name: DeepSeek
   Type: openai-compatible
   API Key: sk-your-key
   Base URL: https://api.deepseek.com
   
   Models:
     - ID: deepseek-chat
       Name: DeepSeek V3
   ```
3. 保存配置
4. 在对话界面选择模型

---

#### 问题2: 对话框不显示

**症状**：消息发送成功，但界面没有对话框

**修复步骤**：

**方法A - 在编辑模式中修复**：
1. 点击"编辑模式"
2. 查找 `dialogue-text` 元素
3. 如果不存在，添加新元素：
   - Type: dialogue-text
   - ID: dialogue-1
   - X: 60, Y: 500
   - Width: 900, Height: 180
   - Hidden: false
4. 如果存在但被隐藏，取消隐藏
5. 保存并返回游戏模式

**方法B - 直接修改配置文件**：
```bash
cd F:\DeepSeek_harness\model-router-galgame

# 备份
copy gal-scene.json gal-scene.json.backup

# 使用文本编辑器打开 gal-scene.json
# 查找 "dialogue-text" 元素
# 确保 "hidden": false
# 确保位置参数合理
```

---

#### 问题3: 消息未发送到 API

**症状**：输入框清空，但无网络请求

**修复步骤**：

1. **检查 inputActions 绑定**
   - 查看 `GalView.jsx` 中 `inputActions` prop 是否正确传入
   - 确认 `inputActions.submit()` 存在

2. **检查表单提交事件**（约第 1003 行）：
   ```javascript
   <form
     className="gv-input"
     onSubmit={e => {
       e.preventDefault()
       console.log('[DEBUG] Form submitted')
       send()
     }}
   >
   ```

3. **检查发送按钮**（约第 1024 行）：
   ```javascript
   <button 
     type="submit" 
     className="gv-btn gv-btn-accent gv-send" 
     disabled={draft.trim() === '' && !hasImages}
     onClick={() => console.log('[DEBUG] Send button clicked')}
   >
     发送
   </button>
   ```

---

#### 问题4: 历史记录不更新

**症状**：消息发送成功，但左侧无历史

**修复步骤**：

1. **检查 session state 更新**：
   ```javascript
   // 在 GalView.jsx 中添加：
   useEffect(() => {
     console.log('[DEBUG] Nodes changed:', nodes)
   }, [nodes])
   ```

2. **检查存档系统**（约第 565 行）：
   ```javascript
   useEffect(() => {
     console.log('[DEBUG] Updating archive:', {
       sessionId,
       latestUserText,
       routerMode,
       activeRoute
     })
     // ... 原有代码
   }, [activeRoute?.model, latestUserText, routerMode, routerPlan?.complexity?.value, routerPlan?.taskType, sessionId])
   ```

3. **检查 ArchiveRail 组件渲染**（约第 1043 行）：
   ```javascript
   {archiveOpen && (
     <>
       {console.log('[DEBUG] Rendering ArchiveRail:', archiveRows)}
       <ArchiveRail archives={archiveRows} currentId={String(sessionId ?? '')} onOpen={id => { /* ... */ }} onClose={() => setArchiveOpen(false)} />
     </>
   )}
   ```

---

### 阶段6: 完整性验证

完成所有修复后，执行以下完整测试：

#### 6.1 功能测试清单

- [ ] 打开 GAL 视图，界面正常显示
- [ ] 底部显示当前模型名称
- [ ] 发送消息 `你好`
- [ ] 输入框清空
- [ ] 对话框显示用户消息
- [ ] 模型开始响应（显示思考状态）
- [ ] 对话框显示模型回复（打字机效果）
- [ ] 左侧历史记录更新
- [ ] 点击"日志"按钮，能看到完整对话
- [ ] 切换到"对话"标签，能看到相同内容
- [ ] 切换回"GAL视图"，状态保持

#### 6.2 路由器测试清单

- [ ] 发送 `/router plan`，返回路由方案
- [ ] 发送 `/router mode collective`，切换为协作模式
- [ ] 发送 `/router mode single`，切换为单独模式
- [ ] 在集体模式下，复杂任务触发协作（发送"设计一个电商系统架构"）
- [ ] 点击底部"路由任务栏"，能看到详细分析

#### 6.3 场景功能测试清单

- [ ] 对话框正确显示用户和AI消息
- [ ] 打字机效果流畅
- [ ] 模型娘立绘正确显示
- [ ] 点击对话框能翻页（如果内容长）
- [ ] 点击"历史"能查看完整对话
- [ ] 点击"设置"能调整打字速度等
- [ ] 进入"编辑模式"能看到所有场景元素
- [ ] 编辑模式中的修改能实时同步到游戏模式

---

## 调试工具

### 工具1: React DevTools

安装 React DevTools 浏览器扩展，可以查看：
- Component 树
- Props 和 State
- Hooks 值

**关键组件**：
- `GalView` - 主组件
- `StageView` - 舞台渲染
- `RouterPanel` - 路由面板

### 工具2: Harness 日志

查看 Harness 后端日志：
```bash
# 如果使用 pnpm dsh web，日志会直接输出到终端
# 或查看日志文件（如果有）
```

### 工具3: 网络监控

在浏览器 DevTools → Network：
- 查看所有 API 请求
- 检查请求参数
- 查看响应内容

---

## 报告格式

### 测试结果报告

请按以下格式提供测试结果：

```markdown
# GAL视图功能测试报告

## 环境信息
- Harness 版本: [版本号]
- 插件版本: 0.4.10
- 浏览器: [Chrome/Edge/Firefox] [版本]
- 操作系统: Windows [版本]

## 测试结果摘要
- 阶段1 环境验证: ✅/❌
- 阶段2 前端功能: ✅/❌
- 阶段3 后端集成: ✅/❌
- 阶段4 数据流追踪: ✅/❌

## 详细问题清单

### 问题1: [问题描述]
- **症状**: [具体现象]
- **复现步骤**: [1. 2. 3.]
- **错误日志**: 
  ```
  [粘贴错误信息]
  ```
- **修复尝试**: [已尝试的方法]
- **状态**: 未解决/已解决

### 问题2: ...

## 控制台日志
```
[粘贴关键日志]
```

## 网络请求
- 请求URL: [URL]
- 请求方法: [GET/POST]
- 请求体: [JSON]
- 响应状态: [200/400/500]
- 响应体: [JSON]

## 截图
[附上关键界面截图]

## 建议
[对插件的改进建议]
```

---

## 优先级排序

如果遇到多个问题，按以下优先级修复：

1. **P0 - 阻塞性问题**
   - 插件无法加载
   - Harness 无法启动
   - 界面完全崩溃

2. **P1 - 核心功能问题**
   - 消息无法发送
   - 模型无法配置
   - 对话框不显示

3. **P2 - 次要功能问题**
   - 历史记录不更新
   - 路由器命令失效
   - 打字机效果异常

4. **P3 - 体验优化问题**
   - 界面样式问题
   - 动画不流畅
   - 文本显示问题

---

## 紧急联系

如果遇到无法解决的问题，请提供：
1. 完整的测试报告（使用上面的格式）
2. 浏览器控制台截图
3. Harness 后端日志
4. `gal-scene.json` 文件（如果涉及场景问题）

---

**测试开始时间**: [填写]
**预计完成时间**: [填写]
**测试执行者**: Codex / AI Agent

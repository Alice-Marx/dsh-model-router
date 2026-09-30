export const CHARACTER_LABELS = Object.freeze({
  harness: 'DeepSeek Harness',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  deepseek: 'DeepSeek',
  doubao: '豆包',
  ernie: 'ERNIE',
  gemini: 'Gemini',
  glm: 'GLM',
  grok: 'Grok',
  kimi: 'Kimi',
  mimo: 'MiMo',
  minimax: 'MiniMax',
  opencode: 'OpenCode Zen',
  qwen: 'Qwen',
  huggingface: 'Hugging Face', llama: 'Llama', rwkv: 'RWKV', perplexity: 'Perplexity',
  github: 'GitHub', gitlab: 'GitLab', gitee: 'Gitee', cloudflare: 'Cloudflare',
  zcode: 'ZCode',
  hy: 'HY', comfyui: 'ComfyUI', novelai: 'NovelAI', gptimage: 'GPT-image',
  jev: 'JEV',
})

// Story script aliases and model routing are separate contracts. Narrators and
// unknown IDs deliberately stay unknown instead of becoming another character.
const CHARACTER_ALIASES = Object.freeze({
  deepseekharness: 'harness', deepseek_harness: 'harness', xianxue: 'harness', '衔雪': 'harness',
  ds_myst: 'deepseek', 'ds-myst': 'deepseek', minmax: 'minimax', minmaxalt: 'minimax', perp: 'perplexity', cf: 'cloudflare', hf: 'huggingface',
  comfy: 'comfyui', nai: 'novelai', 'gpt-image': 'gptimage', gpt_image: 'gptimage', gittee: 'gitee',
})
export function normalizeCharacterKey(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/^c_/, '')
  return CHARACTER_ALIASES[key] || key
}

/** Resolve a provider/model id to the corresponding maid character key. */
export function characterKeyForModel(model, provider = '') {
  const value = `${String(provider ?? '')} ${String(model ?? '')}`.toLowerCase()
  if (value.includes('harness') || value.includes('router')) return 'harness'
  if (value.includes('zcode')) return 'zcode'
  if (value.includes('claude')) return 'claude'
  if (value.includes('gpt') || value.includes('openai')) return 'chatgpt'
  if (value.includes('deepseek')) return 'deepseek'
  if (value.includes('doubao') || value.includes('seedream') || value.includes('volcengine')) return 'doubao'
  if (value.includes('ernie') || value.includes('wenxin') || value.includes('baidu')) return 'ernie'
  if (value.includes('gemini')) return 'gemini'
  if (value.includes('glm') || value.includes('zhipu') || value.includes('bigmodel')) return 'glm'
  if (value.includes('grok')) return 'grok'
  if (value.includes('kimi') || value.includes('moonshot')) return 'kimi'
  if (value.includes('mimo')) return 'mimo'
  if (value.includes('minimax')) return 'minimax'
  // Match the model family before the OpenCode provider. A Qwen model routed
  // through Zen is still Qwen娘; only otherwise-unmatched Zen models use the
  // generic OpenCode character.
  if (value.includes('qwen') || value.includes('dashscope')) return 'qwen'
  if (value.includes('opencode') || value.includes('zen')) return 'opencode'
  return 'harness'
}

export function characterLabelForModel(model, provider = '') {
  return CHARACTER_LABELS[characterKeyForModel(model, provider)]
}

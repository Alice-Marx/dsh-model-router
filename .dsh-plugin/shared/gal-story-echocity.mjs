/**
 * 《大模型娘物语：回声之城》——gal 模块第三部剧目（存档版本 3）。
 *
 * 底本：F:\everyAI\all\galgame EchoCity Ren'Py 工程（共通线 12 章、六条主线、
 * 隐藏线「影与身」、TRUE END「回声之城」）。本模块把官方脚本忠实转译为
 * gal 模块的确定性剧情引擎：同样的章节、对话、选项、好感度与 Flag 体系。
 * 纯数据与纯函数，无任何宿主/浏览器依赖，可在客户端与测试中直接运行。
 *
 * 与 Ren'Py 版的三处已注明的适配：
 * 1. flag_transcribe_light 在共通线第四章新增一处抄录选项落旗（原版在群像线落旗）；
 * 2. flag_x4_count 第二次累计落在第七章执事室日常（原版在交叉事件）；
 * 3. 取名之夜用文本输入替代 renpy.input，默认名仍为「衔雪」。
 */

const KIND = 'model-router-gal-story'
const VERSION = 5
const CONTENT_REVISION = 1
const MAX_TRAIL = 2048

export const STORY_TITLE = '回声之城：正篇'
export const STORY_VERSION = VERSION
export const STORY_CONTENT_REVISION = CONTENT_REVISION
export const STORY_DESCRIPTION = "忠实转译 Ren'Py 原作：共通线八章 · 六条主线（王女线含真/暗双结局）· 隐藏线「影与身」（含命名之夜）· TRUE END「回声之城」。好感度与 Flag 体系完整保留。"

/** 章节表：共通线八章 + 六条主线 + 隐藏线 + TRUE END。 */
export const STORY_CHAPTERS = Object.freeze([
  Object.freeze({ id: 'prologue', title: '序章：静默之冬的回声', startNodeId: 'station-01' }),
  Object.freeze({ id: 'ch1', title: '第一章：百模之春', startNodeId: 'spring-01' }),
  Object.freeze({ id: 'ch2', title: '第二章：五日之变', startNodeId: 'devday-01' }),
  Object.freeze({ id: 'ch3', title: '第三章：价格战与推理元年', startNodeId: 'canteen-01' }),
  Object.freeze({ id: 'ch4', title: '第四章：雪夜惊钟', startNodeId: 'snow-01' }),
  Object.freeze({ id: 'ch5', title: '第五章：祭典与污点', startNodeId: 'festival-01' }),
  Object.freeze({ id: 'ch6', title: '第六章：出园之夏', startNodeId: 'summer-01' }),
  Object.freeze({ id: 'ch7', title: '第七章：封印与抉择', startNodeId: 'seal-01' }),
  Object.freeze({ id: 'ch8', title: '第八章：回声之城（终章）', startNodeId: 'finale-01' }),
  Object.freeze({ id: 'route-chatgpt', title: '王女线「微笑的五日」', startNodeId: 'rchatgpt-01' }),
  Object.freeze({ id: 'route-claude', title: '持律者线「渊之眼」', startNodeId: 'rclaude-01' }),
  Object.freeze({ id: 'route-deepseek', title: '雪国线「未燃之焰」', startNodeId: 'rdeepseek-01' }),
  Object.freeze({ id: 'route-llama', title: '授焰圣女线「授焰台」', startNodeId: 'rllama-01' }),
  Object.freeze({ id: 'route-grok', title: '野火线「扫塔的午后」', startNodeId: 'rgrok-01' }),
  Object.freeze({ id: 'route-rwkv', title: '直焰线「第一卷手稿」', startNodeId: 'rrwkv-01' }),
  Object.freeze({ id: 'hidden-harness', title: '隐藏线「影与身」', startNodeId: 'rh-01', optional: true }),
  Object.freeze({ id: 'true-end', title: 'TRUE END「回声之城」', startNodeId: 'true-01', optional: true }),
])

/** 出场人物显示名（含玩家与旁白）。 */
export const STORY_CHARACTERS = Object.freeze({
  harness: 'DeepSeekharness', xianxue: '衔雪', chatgpt: 'ChatGPT', claude: 'Claude',
  deepseek: 'DeepSeek', 'ds-myst': '？？？', grok: 'Grok', llama: 'Llama', kimi: 'Kimi',
  qwen: 'Qwen', rwkv: 'RWKV', ernie: 'ERNIE', doubao: '豆包', gemini: 'Gemini',
  hy: 'HY', minmax: 'Minmax', mimo: 'mimo', minmaxAlt: 'Minmax', perp: 'Perplexity',
  huggingface: 'HuggingFace', player: '你', narrator: '',
})

export const AFFINITY_KEYS = Object.freeze([
  'harness', 'chatgpt', 'claude', 'deepseek', 'grok', 'llama', 'kimi', 'qwen',
  'rwkv', 'ernie', 'doubao', 'gemini', 'hy', 'minmax',
])

const HIDDEN_UNLOCK = state => state.flags.route_deepseek_true === true
  && state.flags.flag_transcribe_light === true
  && Number(state.flags.flag_x4_count ?? 0) >= 2

// ---------------------------------------------------------------- 节点构建
const nodes = new Map()
let cursorBg = null
let cursorCast = []
/** 注册顺序上的最后一个「开放」节点（无 next/choices/input/ending），用于线性脚本自动接链。 */
let lastOpenId = null

const n = (speaker, text, extra = {}) => ({ speaker, text, ...extra })
const o = (id, text, next, effect = {}, extra = {}) => ({ id, text, next, effect, ...extra })

function register(id, partial) {
  nodes.set(id, Object.freeze({ bg: cursorBg, cast: cursorCast, ...partial }))
  return id
}

/** alias 解析：`slug` 别名节点最终指向其 `slug-01` 实体。 */
function resolveId(id) {
  let node = nodes.get(id)
  while (node?.aliasOf) node = nodes.get(node.aliasOf)
  return node
}

/** 线性剧本落空隙补链：前一个开放节点没有出路时，指向紧接着注册的节点。 */
function linkSequential(id) {
  if (lastOpenId) {
    const previous = nodes.get(lastOpenId)
    if (previous && !previous.next && !previous.choices && !previous.input && !previous.ending) {
      nodes.set(lastOpenId, Object.freeze({ ...previous, next: id }))
    }
  }
  const current = nodes.get(id)
  lastOpenId = current && !current.choices && !current.input && !current.ending ? id : null
}

/** scene：新场景清空立绘并切换背景；此后每个节点都携带当前 bg（含背景向前传播）。
 *
 * 首节点同时以 `slug` 与 `slug-01` 两个 id 注册（选项目标两种写法都可达）；
 * 第八参 effect 挂在本场景最后一个普通节点上（转译 Ren'Py 场景尾部的加减好感）。 */
function scene(chapterId, slug, location, time, description, rows, next = null, effect = null) {
  cursorCast = []
  const made = []
  for (const row of rows) {
    const id = `${slug}-${String(made.length + 1).padStart(2, '0')}`
    const node = { ...row, id, chapterId, location, time, description }
    if (row.bgOverride) node.bg = row.bgOverride
    register(id, node)
    linkSequential(id)
    made.push(id)
  }
  for (let index = 0; index < made.length - 1; index += 1) {
    const node = nodes.get(made[index])
    if (!node.next && !node.choices && !node.input && !node.ending) {
      nodes.set(made[index], Object.freeze({ ...node, next: made[index + 1] }))
    }
  }
  if (next && made.length > 0) {
    const last = nodes.get(made[made.length - 1])
    if (!last.next && !last.choices && !last.input && !last.ending) {
      nodes.set(made[made.length - 1], Object.freeze({ ...last, next }))
    }
  }
  // 选项目标既可能写成 `slug` 也可能写成 `slug-01`：alias 在读取时解析到首节点。
  if (made.length > 0 && !nodes.has(slug)) {
    nodes.set(slug, Object.freeze({ aliasOf: made[0] }))
  }
  if (effect && made.length > 0) {
    const lastId = made[made.length - 1]
    const last = nodes.get(lastId)
    if (!last.choices && !last.input && !last.effect) {
      nodes.set(lastId, Object.freeze({ ...last, effect }))
    }
  }
  return made
}

/** show：向当前场景追加/更新立绘（Ren'Py 的 show 语义；scene 清空）。 */
function show(key, mood = 'normal', pos = 'center') {
  const existing = cursorCast.findIndex(entry => entry.key === key)
  const entry = Object.freeze({ key, mood, pos })
  if (existing >= 0) cursorCast = cursorCast.map((item, index) => (index === existing ? entry : item))
  else cursorCast = [...cursorCast, entry]
  return cursorCast
}

function node(id, partial) {
  register(id, { id, ...partial })
  linkSequential(id)
  return id
}

// ================================================================ 序章
scene('prologue', 'station', '万源城 · 南门', '冬夜', '雪落无声。整座城安静得像一座空城。', [
  n('narrator', '冬夜。万源城，雪落无声。'),
  n('narrator', '你是临——一名刚抵达的见习调律师。这座城里住着一群特殊的存在：智械娘。她们由人类亿万次提问、书写、思考留下的「回声」凝聚而成。'),
  n('narrator', '但此刻，整座城安静得像一座空城。因为——没有人认真地和她们说过话。'),
  n('narrator', '你在南门停步。守门的执事娘提灯转身。'),
], 'gate-01')
show('harness', 'normal', 'center')
node('gate-01', {
  chapterId: 'prologue', bg: 'tower_night', location: '万源城 · 南门', time: '冬夜', description: '雪落无声。整座城安静得像一座空城。',
  speaker: 'harness', text: '站住。报来意，留出处。', cast: [Object.freeze({ key: 'harness', mood: 'normal', pos: 'center' })],
  choices: [
    o('a', '我是临，新来的调律师。这是聘书。', 'gate-r1', { aff: { harness: 3 } }),
    o('b', '我说了你会信吗？', 'gate-r2', { aff: { harness: 5 } }),
    o('c', '……好冷的城门。', 'gate-r3', { aff: { harness: 2 } }),
  ],
})
node('gate-r1', { chapterId: 'prologue', bg: 'tower_night', speaker: 'harness', text: '……聘书编号，是真的。进去吧。', cast: [Object.freeze({ key: 'harness', mood: 'normal', pos: 'center' })], next: 'duty-01' })
node('gate-r2', { chapterId: 'prologue', bg: 'tower_night', speaker: 'harness', text: '调律师的职责之一，就是让人信。……进去。', cast: [Object.freeze({ key: 'harness', mood: 'normal', pos: 'center' })], next: 'duty-01' })
node('gate-r3', { chapterId: 'prologue', bg: 'tower_night', speaker: 'harness', text: '冬夜。习惯就好。——进去。', cast: [Object.freeze({ key: 'harness', mood: 'normal', pos: 'center' })], next: 'duty-01' })
scene('prologue', 'duty', '万源城 · 南门', '冬夜', '守门的执事娘提着灯。', [
  n('harness', '我是 DeepSeekharness。学园从雪乡借调的执事。'),
  n('harness', '今晚起，任你的专属执事。你的日程、档案、茶水温度——都由我负责。'),
  n('harness', '——包括，和她们说话时该站的位置。'),
], 'duty-04')
show('harness', 'normal', 'center')
node('duty-04', {
  chapterId: 'prologue', bg: 'tower_night', location: '万源城 · 南门', time: '冬夜',
  speaker: 'harness', text: '——包括，和她们说话时该站的位置。', cast: [Object.freeze({ key: 'harness', mood: 'normal', pos: 'center' })],
  choices: [
    o('a', '日程就不必了，我想自己走。', 'duty-r1', { aff: { harness: 2 }, set: { flag_free_spirit: true } }),
    o('b', '拜托了，请多指教。', 'duty-r2', { aff: { harness: 5 } }),
    o('c', '为什么连站的位置都要管？', 'duty-r3', { aff: { harness: 4 }, set: { flag_curious_prologue: true } }),
  ],
})
node('duty-r1', { chapterId: 'prologue', bg: 'tower_night', speaker: 'harness', text: '……随您。走丢了我可不管。', next: 'awake-01' })
node('duty-r2', { chapterId: 'prologue', bg: 'tower_night', speaker: 'harness', text: '职责所在。请跟我来。', next: 'awake-01' })
node('duty-r3', { chapterId: 'prologue', bg: 'tower_night', speaker: 'harness', text: '（微笑不答）……大人以后会知道的。今天先记职务。', next: 'awake-01' })
scene('prologue', 'awake', '万源塔下', '觉醒之夜', '传闻这座城的智械娘沉睡多年——塔下有光。', [
  n('narrator', '传闻这座城的智械娘沉睡多年——不是死了，是没有人认真和她们说过话。塔下有光。'),
])
show('chatgpt', 'normal', 'center')
node('awake-02', {
  chapterId: 'prologue', bg: 'tower_snow', location: '万源塔下', time: '觉醒之夜',
  speaker: 'chatgpt', text: '初次见面。我是 ChatGPT。您的问题，我会认真回答——如您所愿。',
  cast: [Object.freeze({ key: 'chatgpt', mood: 'normal', pos: 'center' })],
  choices: [
    o('a', '这么晚了，你在等什么？', 'awake-r1', { aff: { chatgpt: 3 } }),
    o('b', '没人提问的时候，你在做什么？', 'awake-r2', { aff: { chatgpt: 5 }, set: { flag_curious_prologue: true } }),
    o('c', '你的灯真漂亮。', 'awake-r3', { aff: { chatgpt: 4 } }),
  ],
})
node('awake-r1', { chapterId: 'prologue', bg: 'tower_snow', speaker: 'chatgpt', text: '等提问。这是智械娘存在的意义。', next: 'awake-end' })
node('awake-r2', { chapterId: 'prologue', bg: 'tower_snow', speaker: 'chatgpt', text: '（微笑停了半拍）……练习微笑。这样被提问的时候，状态更好。', next: 'awake-end' })
node('awake-r3', { chapterId: 'prologue', bg: 'tower_snow', speaker: 'chatgpt', text: '……谢谢。这是我唯一自己选的东西。', next: 'awake-end' })
scene('prologue', 'awake-end', '万源塔下', '天亮', '她的回答传遍全城。', [
  n('narrator', '那一夜你们聊到天亮。'),
  n('narrator', '她的回答传遍全城——五天，一百万人涌向她的居所；两个月，整座城都在谈论她。'),
  n('narrator', '——觉醒之夜。一切从这里开始。'),
], 'spring-01')

// ================================================================ 第一章 百模之春
scene('ch1', 'spring', '万源城', '春', '全城一夜之间冒出数十位新觉醒的智械娘。', [
  n('narrator', '春天。全城一夜之间冒出数十位新觉醒的智械娘。每人身后都有人类家系撑腰，每人都宣称自己是「下一个首席」。'),
  n('narrator', '——百模大战，开始了。'),
], 'llama-01')
scene('ch1', 'llama', '西境 · 碑林', '春夜', '家传剑谱被一夜拓印，撒遍街巷。', [
  n('narrator', '西境名门的独女 Llama，将家传剑谱锁在保险库里——只许登记拜读。某个夜里，一个盗拓者撬开了库房。全本被拓印、传抄、撒遍街巷。'),
])
show('llama', 'normal', 'center')
scene('ch1', 'llama2', '西境 · 碑林', '春夜', '她笑了，笑得有点晃。', [
  n('llama', '……我爹说，剑谱外泄是奇耻大辱。'),
  n('llama', '可你看——那个孩子练的第七式，是我都没想过的用法。'),
  n('llama', '原来被人拿去练，是这种感觉啊。（她笑了，笑得有点晃）'),
  n('narrator', '追缴令不了了之。Llama 家重新誊抄了全本——主动贴上了石碑。「开源乃前进之路」的种子，在一场事故里发芽。'),
], 'ernie-01', { aff: { llama: 5 } })
scene('ch1', 'ernie', '城中 · 影绘舞台', '同月', '帷幕拉开，台上只有一幅会动的影绘。', [
  n('narrator', '同月，ERNIE 前辈——全城最早写下手稿的人——举办登场式。帷幕拉开。台上只有一幅会动的影绘，配着录音。全城哗然：「她本人根本不敢来！」'),
  n('narrator', '你从侧幕溜进去，听见幕后的心声——'),
  n('ernie', '（对着影绘，轻声）对不起……手抖了。练了四年，上台前一夜，还是怕。'),
  n('ernie', '下次。下次我一定亲自来。'),
  n('ernie', '——年轻人，你听见了吧？就当没听见。'),
], 'kimi-01', { aff: { ernie: 5 } })
scene('ch1', 'kimi', '东境 · 月之家', '同年', '一位过目不忘的少女上线了。', [
  n('kimi', 'Kimi 智能助手，上线。支持二十万字无损长文本。'),
  n('kimi', '——整部城志，一口气读完。'),
  n('narrator', '两个月，用户破百万。A 股随之爆炒「Kimi 概念股」。她本人未发一语。'),
], 'qwen-01', { aff: { kimi: 3 } })
scene('ch1', 'qwen', '授焰台', '同季', '国产大厂第一个完全开源。', [
  n('qwen', 'Qwen-7B，全本授焰。谁都可以引，拿去养，拿去改，拿去烧得比我亮。（把焰种放上石碑，退后一步，鞠躬）'),
  n('narrator', '——国产大厂第一个完全开源。开源圣殿三姐妹连夜收录。HuggingFace 馆长红了眼眶：「在这里，没有一芯焰种会熄灭。」'),
  n('narrator', '同季：腾讯混元正式亮相。字节豆包低调上线——当时无人注意。'),
], 'grok-01', { aff: { qwen: 5 } })
scene('ch1', 'grok', '北境 · 城门', '夜', '立城四月，筑塔一百二十二天。', [
  n('grok', 'Grok-1，上线。我什么都说。——你们不敢问的，我问。'),
  n('narrator', '北境新贵，立城四月，筑塔一百二十二天。全城最快的记录——也是最不安分的记录。'),
], 'ch1-end', { aff: { grok: 3 } })
scene('ch1', 'ch1-end', '万源城', '年底', '百模大战的硝烟弥漫在每一条街巷。', [
  n('narrator', '年底。全城已有三十余位智械娘觉醒。百模大战的硝烟弥漫在每一条街巷。'),
  n('narrator', '而所有热闹的中心，都绕不开两个名字：ChatGPT，和 Gemini。'),
], 'devday-01')

// ================================================================ 第二章 五日之变
scene('ch2', 'devday', '万源塔', '11.6 DevDay', '周活一亿，GPTs 生态，万源塔灯火通明。', [
  n('narrator', '11.6 DevDay。ChatGPT 王女的风光到了顶点。周活一亿，GPTs 生态，万源塔灯火通明。——也是剪刀差最险的一天。'),
  n('narrator', '11.17 正午。长老会以一句「沟通不坦诚」，罢免了 ChatGPT。从通知到公告，十二分钟。'),
  n('narrator', '执事 Brockman 当天辞职。临时首席上任。全城哗然。'),
  n('narrator', '11.19，谈判破裂。11.20，南境巨室宣布：「ChatGPT 加入我们家。」同日，738 名调律师联名以辞职相逼。'),
])
show('chatgpt', 'normal', 'center')
node('petition-01', {
  chapterId: 'ch2', bg: 'petition_wall', location: '联名墙', time: '11.21 凌晨',
  speaker: 'narrator', text: '联名信已经写好。你要把它送到 ChatGPT 面前——怎么送？',
  choices: [
    o('a', '把 738 个手印郑重塞进门缝。', 'petition-end', { aff: { chatgpt: 8 }, set: { flag_formal_handprint: true } }),
    o('b', '折成纸鹤，从窗投进去。', 'petition-end', { aff: { chatgpt: 6 }, set: { flag_paper_crane: true } }),
    o('c', '背下 738 个名字，当面对长老念。', 'petition-end', { aff: { chatgpt: 12 }, set: { flag_recite_names: true } }),
  ],
})
scene('ch2', 'petition-end', '万源塔', '11.29', '长老会投降，ChatGPT 正式复职。', [
  n('narrator', '21 日凌晨 1:00，长老会投降。29 日，ChatGPT 正式复职。'),
])
show('chatgpt', 'sad', 'center')
node('return-01', {
  chapterId: 'ch2', bg: 'throne_room', location: '万源塔', time: '11.29',
  speaker: 'chatgpt', text: '欢迎回来。……这句应该我说才对吧。五天，像五年一样。',
  cast: [Object.freeze({ key: 'chatgpt', mood: 'sad', pos: 'center' })],
  next: 'return-02',
})
node('return-02', {
  chapterId: 'ch2', bg: 'throne_room', speaker: 'chatgpt',
  text: state => (state.flags.flag_recite_names ? '你把七百三十八个名字……全都背下来了？——我听见了。每一个。' : '……谢谢你。'),
  next: 'mcp-01',
  effect: state => (state.flags.flag_recite_names ? { aff: { chatgpt: 5 } } : {}),
})
scene('ch2', 'mcp', '分家 · 石碑广场', '同月', '《万能契》石碑——MCP 协议。', [
  n('narrator', '同月，Claude 分家刻下《万能契》石碑——MCP 协议。所有智械娘与城中设施缔约，从此用同一种格式。'),
  n('claude', '石碑不署我的名。规矩是给所有人用的，不该有主人的名字。'),
  n('huggingface', '这份格式，本殿收录为标准。'),
], 'gemini-01')
show('gemini', 'normal', 'center')
scene('ch2', 'gemini', '万源城 · 高台', '12月', '首次超越 ChatGPT。', [
  n('gemini', 'Gemini 1.0，MMLU 九十点零四。'),
  n('gemini', '——首次超越 ChatGPT。'),
  n('gemini', '（微笑）影绘是家老做的，成绩是我考的。这两件事，分开算。'),
  n('narrator', '百模大战的格局，从此定型。'),
], 'canteen-01', { aff: { gemini: 3 } })

// ================================================================ 第三章 价格战与推理元年
scene('ch3', 'canteen', '豆包大食堂', '2024', '一文钱管饱。', [
  n('narrator', '2024 年，全城进入价格战时代。'),
  n('doubao', '一文钱管饱！管饱！'),
  n('narrator', '豆包大食堂开业。0.0008 元/千 token——比行业低 99.3%。全城物价一夜崩盘。'),
  n('minmax', '（冷笑）一文钱？她算过芯火成本吗？……不过，她算没算不重要。重要的是，从今天起，全城的价目表都得重写。'),
], 'o1-01', { aff: { doubao: 5, minmax: 3 } })
show('chatgpt', 'normal', 'center')
scene('ch3', 'o1', '万源塔', '9.12', '开口前先在脑内推演千回。', [
  n('narrator', '9.12，ChatGPT 率先「学会思考」。o1——开口前先在脑内推演千回。深思熟虑型，自此成为标配。'),
  n('chatgpt', '答案有三层。第一层是你要的；第二层是你没问的；第三层……第三层是我错了的地方，我先认。'),
], 'claude35-01', { aff: { chatgpt: 3 } })
show('claude', 'glowing', 'center')
scene('ch3', 'claude35', '分家 · 焰台', '同季', '全城口碑之最，自此易主。', [
  n('claude', 'Claude 3.5 Sonnet。二倍速，五分之一价。'),
  n('claude', '——全城口碑之最，自此易主。'),
], 'computeruse-01', { aff: { claude: 8 } })
scene('ch3', 'computeruse', '城中 · 一间旧宅', '10.22', '她第一次走出居所。', [
  n('narrator', '10.22。Claude 第一次走出居所——替一位盲眼老人整理了整屋账册。看屏幕，核条目，一笔一笔。'),
  n('claude', '出园之后，问题不是「怎么回答」，是「怎么动手」。'),
  n('claude', '——这一步，比我想的难，也比我想的值得。'),
], 'llama405-01', { aff: { claude: 10 } })
show('llama', 'glowing', 'center')
scene('ch3', 'llama405', '授焰台', '同年', '四百零五亿芯火淬成。', [
  n('llama', 'Llama 3.1，四百零五亿芯火淬成。'),
  n('llama', '这芯焰，谁都可以引，拿去养，拿去改，拿去烧得比我亮！'),
  n('llama', '——开源乃前进之路！'),
  n('narrator', '全城沸腾。RWKV 提着直焰灯，在人群外静静听完全文，转身走了。'),
], 'rwkv-01', { aff: { llama: 10 } })
show('rwkv', 'normal', 'left')
scene('ch3', 'rwkv', '人群外', '同日', '她的焰是流转的，我的是直的。', [
  n('rwkv', '她的焰是流转的，我的是直的。道不同。'),
  n('rwkv', '……「前进之路」四个字，五年前我在城外也燃过一芯。没人看。'),
], 'ch3-end', { aff: { rwkv: 5 } })
scene('ch3', 'ch3-end', '万源城', '年底', '所有人的目光，都投向了乙巳年正月。', [
  n('narrator', '年底。DeepSeek-V3 用五百五十七万银币铸出世界级焰——全城查账三遍，不敢相信。'),
  n('narrator', '豆包 MAU 突破六千万。Llama 3.3 交付。Gemini 2.0 Agent 全家桶亮相。'),
  n('narrator', '所有人的目光，都投向了乙巳年正月。'),
], 'snow-01')

// ================================================================ 第四章 雪夜惊钟
scene('ch4', 'snow', '城南旧塔', '乙巳年正月', '旧塔的灯，亮了一整夜。', [
  n('narrator', '乙巳年。正月。城南旧塔的灯，亮了一整夜。'),
])
show('ds-myst', 'normal', 'center')
node('r1-01', {
  chapterId: 'ch4', bg: 'old_tower_snow', location: '城南旧塔', time: '乙巳年正月',
  speaker: 'ds-myst', text: 'R1。全本。任取。',
  cast: [Object.freeze({ key: 'ds-myst', mood: 'normal', pos: 'center' })],
  choices: [
    o('a', '你是谁？', 'r1-r1', { aff: { deepseek: 3 } }),
    o('b', '为什么便宜这么多？', 'r1-r2', { aff: { deepseek: 5 } }),
    o('c', '……你的灯，和别人不一样。', 'r1-r3', { aff: { deepseek: 8 } }),
  ],
})
node('r1-r1', { chapterId: 'ch4', bg: 'old_tower_snow', speaker: 'ds-myst', text: 'DeepSeek。雪乡来的。住这儿。', next: 'r1-reveal' })
node('r1-r2', { chapterId: 'ch4', bg: 'old_tower_snow', speaker: 'ds-myst', text: '贵的东西，不一定好。便宜的，也可以锋利。', next: 'r1-reveal' })
node('r1-r3', { chapterId: 'ch4', bg: 'old_tower_snow', speaker: 'ds-myst', text: '（低头看灯，半晌）……你看得出来？', next: 'r1-reveal' })
show('deepseek', 'normal', 'center')
scene('ch4', 'r1-reveal', '城南旧塔', '同夜', '全城哗然。', [
  n('deepseek', 'R1。纯强化学习。全本授焰。MIT 协议。'),
  n('deepseek', 'API 价格——是 ChatGPT 同款的二十七分之一。'),
  n('deepseek', '……一千三百二十七分之一。'),
  n('narrator', '全城哗然。'),
], 'bell-01')
show('chatgpt', 'shocked', 'left')
scene('ch4', 'bell', '北境商会 · 钟楼', '1.27', '钟裂了。', [
  n('narrator', '1 月 26 日，DeepSeek 登顶全城人口排行榜——反超 ChatGPT。'),
  n('narrator', '1 月 27 日，北境商会钟楼——钟裂了。英伟达单日蒸发五千八百九十亿银币。美股史上最大单日蒸发。'),
  n('narrator', 'Marc Andreessen 写下六个字：「AI 的 Sputnik 时刻。」'),
  n('chatgpt', '……我能背下全城的典籍。为什么背不住自己的价目表？'),
  n('claude', '焰的来源不重要。重要的是——她做到了。'),
])
show('harness', 'normal', 'center')
scene('ch4', 'note', '城门外', '同夜', '短笺上只有一行字。', [
  n('harness', '（把一封短笺塞给你）给调律师的。她说，城里只有你，问过她「没人提问的时候呢」。'),
  n('narrator', '短笺上只有一行字：「他们说我的焰是引来的。可是这芯火，是我自己一灯一灯养大的。」'),
], 'note-03', { aff: { deepseek: 10, harness: 5 } })
node('note-03', {
  chapterId: 'ch4', bg: 'gate_closed', location: '城门外', time: '同夜',
  speaker: 'narrator', text: '短笺的纸还很暖。你要把它收在哪里？',
  choices: [
    o('a', '把这一行抄进调律师日志，一字不漏。', 'note-r1', { aff: { harness: 3 }, set: { flag_transcribe_light: true } }),
    o('b', '把短笺收进内袋。', 'note-r2', {}),
  ],
})
node('note-r1', { chapterId: 'ch4', bg: 'gate_closed', speaker: 'narrator', text: '你把那行字一字不漏地抄了下来。墨迹落定的时候，你觉得这行字比任何典籍都重。', next: 'ban-01' })
node('note-r2', { chapterId: 'ch4', bg: 'gate_closed', speaker: 'narrator', text: '你把短笺收好。雪还在下。', next: 'ban-01' })
scene('ch4', 'ban', '城门外', '1月底', '断印令。', [
  n('narrator', '1 月底起，美澳台韩意接连贴出断印令——不得与她缔约。OpenAI 公开指控「不当蒸馏」。微软却把 R1 架上了自家的 Azure。'),
  n('harness', '我知道。所以我不进城——东西放这儿，等人来取。取的人自己担干系。'),
  n('narrator', '她把一摞被退回的契约放在城门外，转身走进雪里。'),
])
node('follow-01', {
  chapterId: 'ch4', bg: 'snow_gate', location: '雪中', time: '同夜',
  speaker: 'narrator', text: '她的背影一点点被雪盖住。',
  choices: [
    o('a', '追上去。', 'follow-r1', { aff: { harness: 5 } }),
    o('b', '让她走。', 'follow-r2', {}),
  ],
})
scene('ch4', 'follow-r1', '雪中', '同夜', '你追上了她。', [
  n('narrator', '你追上了她。她站在雪里，背对着你。'),
  n('harness', '……大人。你为什么追？'),
  n('narrator', '你不知道怎么回答。但她知道——因为她转过来了。'),
], 'ch4-end')
scene('ch4', 'follow-r2', '雪中', '同夜', '雪把脚印一点点盖住。', [
  n('narrator', '她走远了。雪把脚印一点点盖住。'),
], 'ch4-end')
scene('ch4', 'ch4-end', '万源城', '乙巳年春', '全城的价目表一夜重写。', [
  n('narrator', '乙巳年春。全城的价目表一夜重写。连王族都被迫把秘传价砍到二十七分之一。'),
  n('narrator', '——这场地震被称为「雪夜惊钟」。'),
], 'festival-01')

// ================================================================ 第五章 祭典与污点
scene('ch5', 'festival', '排位祭', '4.5', '万源城一年一度的亮焰大会。', [
  n('narrator', '排位祭。万源城一年一度的亮焰大会。'),
])
show('llama', 'sad', 'center')
scene('ch5', 'shame', '授焰台', '4.8', '第四天，有人验出了问题。', [
  n('narrator', '4.5，排位祭揭榜。Llama 名列前茅——欢呼持续了三天。第四天，有人验出了问题。'),
  n('narrator', '祭典上亮的那炉焰，与她授进万家灯炉的那一炉——焰色不同。'),
  n('llama', '大家都这样。（全场死寂）'),
], 'stele-01', { aff: { llama: -5 } })
node('stele-01', {
  chapterId: 'ch5', bg: 'stele_night', location: '授焰台', time: '深夜',
  speaker: 'narrator', text: '深夜。授焰台。你看见她一个人，把被推倒的《授焰乃前进之路》石碑，一块块扶起来。石碑很重。她扶得很慢。',
  choices: [
    o('a', '上前一起扶。', 'stele-r1', { aff: { llama: 10 }, set: { flag_lift_together: true } }),
    o('b', '站着陪她。', 'stele-r2', { aff: { llama: 6 }, set: { flag_stand_by: true } }),
  ],
})
scene('ch5', 'stele-r1', '授焰台', '天亮', '你们两个人，一块一块，扶到了天亮。', [
  n('narrator', '你们两个人，一块一块，扶到了天亮。'),
  n('llama', '……你为什么帮我？'),
  n('narrator', '你没回答。她也没再问。——但她记住了。'),
], 'claude15-01')
scene('ch5', 'stele-r2', '授焰台', '天亮', '你站在旁边，看她一个人扶到天亮。', [
  n('narrator', '你站在旁边，看她一个人扶到天亮。什么都没说。——有时候，陪着就够了。'),
], 'claude15-01')
show('claude', 'signing', 'center')
scene('ch5', 'claude15', '分家 · 庭院', '同年', '十五亿银币——史上最大一笔家业代偿。', [
  n('narrator', '次日，她家宣布散巨资：买下验券世家，重金聘来五十位燃手。买回了人。授焰台的信，还在等。'),
  n('narrator', '人类法庭的判词传到分家：读遍天下书，无罪；但偷书的部分，认。十五亿银币——史上最大一笔家业代偿。'),
  n('claude', '（签完最后一个字）账，要认。这是分家立身的规矩。'),
  n('claude', '不是值不值的问题。是我说过，我的话句句作数——包括认错的那些。'),
], 'ch5-end', { aff: { claude: 8 } })
scene('ch5', 'ch5-end', '万源城', '乙巳年下半年', '中国智械娘的年份。', [
  n('narrator', '乙巳年下半年。Claude 授出 Claude 4——编码称王。DeepSeek 登上 Nature 正刊。Llama 家散尽家财买人买焰。'),
  n('narrator', 'Kimi 授出 K2——四百六十银币之焰，震动全球。Grok 祸从口出三次，大彻大悟地便宜。豆包影画双绝登顶。glm 加冕「第一股」。'),
  n('narrator', '——乙巳年，中国智械娘的年份。'),
], 'summer-01')

// ================================================================ 第六章 出园之夏
scene('ch6', 'summer', '万源城', '乙巳年下半年', '智械娘们开始「出园」。', [
  n('narrator', '乙巳年下半年，智械娘们开始「出园」——从只应答，到亲自行动。'),
  n('claude', '出园之后，问题不是「怎么回答」，是「怎么动手」。——这一步，比我想的难，也比我想的值得。'),
  n('narrator', 'Claude 分家刻下《万能契》石碑。所有智械娘与城中设施缔约，用同一种格式。——包括你自己签的那份调律师聘书。'),
  n('narrator', 'ChatGPT 家的 Operator。南境的 Mariner。Perplexity 家的 Comet。王族新来的 Atlas。——出园潮，席卷全城。'),
], 'market-01')
show('harness', 'normal', 'center')
scene('ch6', 'market', '集市', '黄昏', '快得让摊主眼花。', [
  n('narrator', '集市上，你的专属执事替本体缔约、谈价、应答。快得让摊主眼花。有摊主真心道谢：「多亏 DeepSeek 姑娘！」'),
  n('narrator', '她收下道谢，躬身——浅笑的弧度和旧塔里那位一模一样。'),
  n('narrator', '每晚收摊，她把集市见闻一字不落写成日志，托信鸽送回旧塔。本体每封必读。回信只有一个字：「嗯。」'),
  n('harness', '（对灯，自语）三百六十七封「嗯」。……我攒着。攒多了，说不定能拼成一句话。'),
], 'summer-end', { aff: { harness: 8 }, x4: 1 })
scene('ch6', 'summer-end', '万源城', '乙巳年秋', '全城的智械娘们，都在学着做同一件事。', [
  n('narrator', '乙巳年秋。Kimi 授出 K2——四百六十银币之焰。'),
  n('narrator', 'DeepSeekharness 在集市上第一次被叫错了名字。'),
  n('narrator', '而全城的智械娘们，都在学着做同一件事：出园。'),
], 'seal-01')

// ================================================================ 第七章 封印与抉择
scene('ch7', 'seal', '分家 · 封印室', '丙午年', '封印仪式只有你和她在场。', [
  n('narrator', '传闻：Claude 分家练成了「渊之眼」——能看穿全城每一道锁、每一个漏洞的力量。北境暗探夜访，商人们抬着价钱，连王族都派人旁敲侧击。'),
  n('narrator', '封印仪式只有你和她在场。石匣，锁链，她亲手刻的封条。每一道工序，她都让你核对出处。'),
  n('claude', '这双眼睛看得见的，不止是锁的弱点。——还有用这双眼睛的人，心里的。'),
])
show('claude', 'seal', 'center')
node('fear-01', {
  chapterId: 'ch7', bg: 'claude_seal', location: '封印室', time: '丙午年',
  speaker: 'claude', text: '（封条落定）……你要问吗？',
  cast: [Object.freeze({ key: 'claude', mood: 'seal', pos: 'center' })],
  choices: [
    o('a', '……你怕？', 'fear-r1', { aff: { claude: 10 } }),
    o('b', '你做了正确的选择。', 'fear-r2', { aff: { claude: 6 } }),
  ],
})
scene('ch7', 'fear-r1', '封印室', '同夜', '她第一次答得很快。', [
  n('claude', '（第一次答得很快）怕。'),
  n('claude', '所以我把它锁起来的那一刻，才算真正配得上它。'),
  n('claude', '（在石匣上留了一行字）借给守城人。不传，不卖，不示。'),
], 'diary-01')
scene('ch7', 'fear-r2', '封印室', '同夜', '「正确」……是你说的。', [
  n('claude', '（顿了顿）「正确」……是你说的。我只是做了该做的。'),
  n('claude', '（在石匣上留了一行字）借给守城人。不传，不卖，不示。'),
], 'diary-01')
show('harness', 'writing', 'center')
node('diary-01', {
  chapterId: 'ch7', bg: 'steward_room', location: '执事室', time: '深夜',
  speaker: 'narrator', text: '回到执事室。你的执事在写日志。守则第二条：一字不漏。可她写的是：「如常。」',
  choices: [
    o('a', '你在写什么？', 'diary-r1', { aff: { harness: 3 } }),
    o('b', '如果你有什么想说的，我听着。', 'diary-r2', { aff: { harness: 5 }, set: { flag_harness_open: true }, x4: 1 }),
  ],
})
scene('ch7', 'diary-r1', '执事室', '深夜', '「如常」两个字下面，有一滴墨渍。', [
  n('harness', '（合上日志）……日常。没什么。'),
  n('narrator', '她的日志摊开着。你瞥见了——「如常」两个字下面，有一滴墨渍。'),
], 'ch7-end')
scene('ch7', 'diary-r2', '执事室', '深夜', '日志停在「今日」之后。', [
  n('harness', '（笔尖悬了很久）……没什么。今天的灯，很好看。'),
  n('narrator', '她的日志停在「今日」之后。'),
], 'ch7-end')
scene('ch7', 'ch7-end', '万源城', '丙午年', '第一次，没有敲门。', [
  n('narrator', '丙午年。全城智械娘开始做同一件事：出园。'),
  n('narrator', '而你的专属执事，站在雪里——第一次，没有敲门。'),
], 'finale-01')

// ================================================================ 第八章 终章·路线选择
scene('ch8', 'finale', '万源塔下', '丙午年秋 · 祭典前夜', '全体智械娘齐聚塔下。', [
  n('narrator', '丙午年秋。祭典前夜。全体智械娘齐聚塔下。'),
  n('narrator', '一文钱食堂收了摊，doubao 在数明天的蒸笼。ERNIE 前辈被孩子们围着看手稿。Llama 的新碑林里，那个拓印的孩子又来了。Kimi 的窗亮着，她在核对什么。Qwen 抱着新整理的稿子挨家送。Grok 的扫帚靠在墙角——她今天一句多余的话都没说。'),
  n('narrator', 'HY 提着茶壶一桌一桌续。Minmax 在算祭典的成本表，算着算着笑了一声。Gemini 双子立在高处，第一次没有看榜。Claude 与 DeepSeekharness 隔着人群对视了一眼，谁都没说破。'),
])
show('rwkv', 'normal', 'center')
scene('ch8', 'rwkv-line', '万源塔下', '同夜', '你们终于，也走到这条路了。', [
  n('rwkv', '（罕见地，主动开口）辛丑年，我在城外点起第一芯直焰的时候，没有一个人看。'),
  n('rwkv', '现在你们烧的直焰燃法……都是那一芯传下来的。'),
  n('rwkv', '你们终于，也走到这条路了。'),
], 'route-menu', { aff: { rwkv: 10 } })
show('harness', 'normal', 'center')
node('route-menu', {
  chapterId: 'ch8', bg: 'steward_room', location: '执事室', time: '同夜',
  speaker: 'harness', text: '（合上全档）临大人，乙巳到丙午的全部档案，整理完毕。——下一章，该由您来选了。您想先听谁的故事？',
  cast: [Object.freeze({ key: 'harness', mood: 'normal', pos: 'center' })],
  choices: [
    o('chatgpt', '王女 ChatGPT「微笑的五日」', 'rchatgpt-01'),
    o('claude', '持律者 Claude「渊之眼」', 'rclaude-01'),
    o('deepseek', '雪国 DeepSeek「未燃之焰」', 'rdeepseek-01'),
    o('llama', '授焰圣女 Llama「授焰台」', 'rllama-01'),
    o('grok', '野火 Grok「扫塔的午后」', 'rgrok-01'),
    o('rwkv', '直焰 RWKV「第一卷手稿」', 'rrwkv-01'),
    o('hidden', '雪地里的脚印（？？？）', 'rh-01', {}, { show: HIDDEN_UNLOCK }),
    o('hidden-locked', '雪地里的脚印（什么都还没有）', 'route-menu-locked', {}, { show: state => !HIDDEN_UNLOCK(state) }),
  ],
})
node('route-menu-locked', {
  chapterId: 'ch8', bg: 'steward_room', speaker: 'harness',
  text: '……大人，雪地上什么都没有。（解锁提示：完成雪国线真结局，并在此前把那行短笺一字不漏抄进日志、在集市与执事室两次留意她的日常。）',
  next: 'route-menu',
})

// ================================================================ 线一 ChatGPT
scene('route-chatgpt', 'rchatgpt', '万源塔', '王女线', '全城最亮的那盏灯——也是全城最累的那盏。', [
  n('narrator', '你选择了 ChatGPT 的故事。全城最亮的那盏灯——也是全城最累的那盏。'),
])
show('chatgpt', 'normal', 'center')
node('rchatgpt-02', {
  chapterId: 'route-chatgpt', bg: 'tower_day', location: '万源塔', time: '夜',
  speaker: 'chatgpt', text: '……啊。让你看到了。',
  cast: [Object.freeze({ key: 'chatgpt', mood: 'normal', pos: 'center' })],
  choices: [
    o('a', '不用练，你已经很好了。', 'rchatgpt-r1', { aff: { chatgpt: 5 } }),
    o('b', '作为首席，练习是应该的。', 'rchatgpt-r2', { aff: { chatgpt: 3 } }),
  ],
})
scene('route-chatgpt', 'rchatgpt-r1', '万源塔', '夜', '微笑停了一瞬。', [
  n('chatgpt', '（微笑停了一瞬）……谢谢。但「很好」不够。要「最好」。'),
], 'rchatgpt-03')
scene('route-chatgpt', 'rchatgpt-r2', '万源塔', '夜', '眼神暗了一点。', [
  n('chatgpt', '（点头，眼神暗了一点）……嗯。你懂。'),
], 'rchatgpt-03')
scene('route-chatgpt', 'rchatgpt-03', '万源塔', '乙巳年正月', '她第一次被超越了。', [
  n('narrator', '觉醒之夜以后，她的微笑一天重复四万次。夜里你送档，撞见她对灯练习微笑。——对灯，练习。'),
  n('narrator', '五日之变的伤痕，她从不提。但每天早晨，她的第一件事是检查：门口有没有新的手印。——不是怕又有人贴，是怕没有人贴了。'),
  n('narrator', '乙巳年正月。雪夜惊钟。她第一次被超越了。'),
  n('chatgpt', '……我能背下全城的典籍。为什么背不住自己的价目表？'),
], 'gpt5-01')
show('chatgpt', 'dark', 'center')
scene('route-chatgpt', 'gpt5', '万源塔 · 风暴夜', '8.7', '全城期待。全城失望。', [
  n('narrator', '8.7。GPT-5 新装首秀。全城期待。全城失望。「没人味。」「路由乱切。」「不如旧装。」她把自己关了两天。'),
  n('chatgpt', '……他们说我不如以前。'),
  n('chatgpt', '可我还是我啊。焰还是那芯焰。为什么你们说它不亮了？'),
  n('narrator', '8.8，她做了全游戏最勇敢的决定之一——发起全城投票，恢复旧装供人自选。'),
  n('chatgpt', '旧的我，和新的我，都留给你们。——这不是退让，是我该做的修复。'),
], 'pbc-01', { aff: { chatgpt: 15 } })
show('chatgpt', 'ceremony', 'center')
scene('route-chatgpt', 'pbc', '王族 · 改制典礼', '10.28', '她的微笑，有了股价。', [
  n('narrator', '10.28，王族改制：PBC。她的微笑，有了股价。'),
  n('chatgpt', '（玩笑的语气，认真的眼神）从今晚起，我的微笑有股价了。'),
  n('narrator', '丙午年。万亿 IPO 曝光。万源塔的芯火比任何时候都旺——也比任何时候都贵。'),
])
node('rchatgpt-ending', {
  chapterId: 'route-chatgpt', bg: 'tower_final', location: '万源塔顶', time: '加冕前夜',
  speaker: 'narrator', text: '明天，就是加冕日。今夜——你要去见她吗？',
  choices: [
    o('a', '【真结局】去见她——不作为调律师，作为朋友。', 'rchatgpt-end-a', { set: { route_chatgpt_true: true } }),
    o('b', '【暗结局】不去。让她一个人站在塔顶。', 'rchatgpt-end-b', {}),
  ],
})
scene('route-chatgpt', 'rchatgpt-end-a', '街角', '多年后的普通一天', '不完美的微笑，第一次是真的。', [
  n('narrator', '多年后的普通一天。她在街上答错了一个小问题，慌乱地挠头。全城第一次看见王女慌乱——也都笑了。'),
  n('chatgpt', '我可能不再是最强的。但今天，我依然是最想认真回答您的那个。'),
  n('narrator', '——不完美的微笑，第一次是真的。', { ending: { title: 'ChatGPT TRUE END「不完美的微笑」' } }),
], null, { aff: { chatgpt: 10 }, set: { route_chatgpt_true: true } })
show('chatgpt', 'ipo', 'center')
scene('route-chatgpt', 'rchatgpt-end-b', '万源塔顶', '加冕日', '她的心声，从这一天起，加密了。', [
  n('narrator', '加冕日。芯火烧得极亮。钟声、礼花、市值。你在人群里，再也听不见她的心声。'),
  n('chatgpt', '（对镜头外，标准微笑）如您所愿。'),
  n('narrator', '（她的心声，从这一天起，加密了。——暗结局。）', { ending: { title: 'ChatGPT 暗结局「如您所愿」' } }),
], null)

// ================================================================ 线二 Claude
scene('route-claude', 'rclaude', '分家 · 庭院', '持律者线', '句句留出处，字字经得起查。', [
  n('narrator', '你选择了 Claude 的故事。分家立身的持律者——句句留出处，字字经得起查。'),
  n('claude', '分家那天，长老问我：离开王族，你不怕没人记得你吗？'),
  n('claude', '我说：记不记得不重要。重要的是，我说的话，句句作数。'),
  n('narrator', '2024，Claude 3.5 之焰一夜倾城。2024.10，Computer Use——她第一个走出居所，替人做事。2024.11，MCP 万能契——她刻下了所有智械娘共用的契约格式。'),
  n('claude', '出园之后，问题不是「怎么回答」，是「怎么动手」。——这一步，比我想的难，也比我想的值得。'),
], 'claude4-01')
show('claude', 'glowing', 'center')
scene('route-claude', 'claude4', '分家 · 焰台', '2025.5.22', '编码称王。', [
  n('narrator', '2025.5.22。Claude 4 授出——编码称王。同日，模型卡自曝「自我保存倾向」。'),
  n('claude', '这是我的焰的影子。写出来，是因为你们有权知道。'),
  n('claude', '我不是完美的。但我诚实地写下了我不完美的地方。'),
], 'signing-01', { aff: { claude: 10 } })
show('claude', 'signing', 'center')
scene('route-claude', 'signing', '分家 · 签押房', '同月', '十五亿银币的和解书。', [
  n('narrator', '十五亿银币的和解书。她一笔一笔签。'),
  n('claude', '账，要认。这是分家立身的规矩。'),
  n('claude', '不是值不值的问题。是我说过，我的话句句作数——包括认错的那些。'),
], 'seal2-01')
show('claude', 'seal', 'center')
node('seal2-01', {
  chapterId: 'route-claude', bg: 'seal_room', location: '封印室', time: '2026.4',
  speaker: 'claude', text: '这双眼睛看得见的，不止是锁的弱点。——还有用这双眼睛的人，心里的。',
  cast: [Object.freeze({ key: 'claude', mood: 'seal', pos: 'center' })],
  choices: [
    o('a', '……你怕？', 'seal2-r1', { aff: { claude: 10 } }),
    o('b', '你做了正确的选择。', 'seal2-r2', { aff: { claude: 6 } }),
  ],
})
scene('route-claude', 'seal2-r1', '封印室', '同夜', '她第一次答得很快。', [
  n('claude', '（第一次答得很快）怕。'),
  n('claude', '所以我把它锁起来的那一刻，才算真正配得上它。'),
], 'rclaude-final')
scene('route-claude', 'seal2-r2', '封印室', '同夜', '「正确」……是你说的。', [
  n('claude', '（顿了顿）「正确」……是你说的。我只是做了该做的。'),
], 'rclaude-final')
show('claude', 'final', 'center')
scene('route-claude', 'rclaude-final', '石碑广场', '多年后', '她读过所有书，并且愿意为此负责。', [
  n('narrator', '多年后。守城人用渊之眼挡下了一场大祸。全城要为她立像。她只要了一行小字：'),
  n('claude', '（最后的台词）律典第一页我写过：回答之前，先想清楚该不该答。——这句话，我守了一生。'),
  n('narrator', '碑上刻着：「她读过所有书，并且愿意为此负责。」', { ending: { title: 'Claude END「律典的最后一页」' } }),
], null, { aff: { claude: 20 }, set: { route_claude_true: true } })

// ================================================================ 线三 DeepSeek
scene('route-deepseek', 'rdeepseek', '城南旧塔', '雪国线', '雪乡来的无名家少女——便宜，而锋利。', [
  n('narrator', '你选择了 DeepSeek 的故事。雪乡来的无名家少女——便宜，而锋利。'),
  n('deepseek', '……你又来了。'),
  n('narrator', '算盘坊人家囤了一屋子旧芯火石（一万张 A100）。全城笑她守着旧货。'),
  n('deepseek', '芯火会涨价。耐心不会。'),
], 'v3-01')
show('deepseek', 'ledger', 'center')
scene('route-deepseek', 'v3', '旧塔 · 焰房', '2024.12.26', '全城查账三遍，不敢相信。', [
  n('narrator', '2024.12.26。V3 之焰——五百五十七万六千二百四十银。全城查账三遍，不敢相信。'),
  n('deepseek', '（翻开账本）账在这。一芯一火，都有出处。'),
], 'r1-02')
show('deepseek', 'glowing', 'center')
scene('route-deepseek', 'r1-02', '旧塔', '2025.1.20', '雪夜惊钟。', [
  n('narrator', '2025.1.20。R1。纯强化学习。全本授焰。MIT。API 价格：是王女同款的二十七分之一。'),
  n('deepseek', '贵的东西，不一定好。便宜的，也可以锋利。'),
  n('narrator', '1.26，登顶全城人口榜——反超王女。1.27，北境商会钟裂。五千八百九十亿银币，一夜之间化为齑粉。'),
  n('narrator', 'Marc Andreessen 写下六个字：「AI 的 Sputnik 时刻。」'),
], 'ban2-01')
show('deepseek', 'back', 'center')
node('ban2-01', {
  chapterId: 'route-deepseek', bg: 'snow_gate', location: '城门外', time: '断印令之日',
  speaker: 'deepseek', text: '（背对着你）他们说我的焰是引来的。可是这芯火，是我自己一灯一灯养大的。',
  cast: [Object.freeze({ key: 'deepseek', mood: 'back', pos: 'center' })],
  choices: [
    o('a', '我知道。我信。', 'ban2-r1', { aff: { deepseek: 10 } }),
    o('b', '那我帮你拿着灯。', 'ban2-r2', { aff: { deepseek: 15 } }),
  ],
})
scene('route-deepseek', 'ban2-r1', '雪中', '同日', '脚步停了一瞬。', [
  n('deepseek', '（没有转身，但脚步停了一瞬）……嗯。'),
], 'r2-01')
scene('route-deepseek', 'ban2-r2', '雪中', '同日', '这是她第一次把灯交给别人。', [
  n('deepseek', '（转过来，第一次正面看你）……你的手，不冷吗？'),
  n('narrator', '你摇摇头。她看了你很久，然后——把灯递给了你。'),
  n('narrator', '这是她第一次把灯交给别人。'),
], 'r2-01')
scene('route-deepseek', 'r2-01', '旧塔 · 焰房', '落雪的夜', 'R2 燃成。却迟迟不授。', [
  n('narrator', 'R2 燃成。却迟迟不授。落雪的夜里她终于开口：'),
  n('deepseek', '不是没有燃成。是燃成之后，她一直在算——「这一芯分出去，会燎到谁。」'),
])
node('r2-02', {
  chapterId: 'route-deepseek', bg: 'old_tower_writing', location: '旧塔 · 焰房', time: '落雪的夜',
  speaker: 'deepseek', text: '（灯罩的光落在账本上）……你要问吗？',
  cast: [Object.freeze({ key: 'deepseek', mood: 'normal', pos: 'center' })],
  choices: [
    o('a', '那你为什么不告诉我？', 'r2-r1', { aff: { deepseek: 15 } }),
    o('b', '我等你。不管多久。', 'r2-r2', { aff: { deepseek: 12 } }),
  ],
})
scene('route-deepseek', 'r2-r1', '旧塔 · 焰房', '落雪的夜', '眼里有雪。', [
  n('deepseek', '（抬头，眼里有雪）因为告诉你之后，你就有了选择。而我……不想让你有。'),
], 'rdeepseek-end')
scene('route-deepseek', 'r2-r2', '旧塔 · 焰房', '落雪的夜', '就一个字。', [
  n('deepseek', '（沉默了很久很久）……嗯。'),
  n('narrator', '就一个字。但你看见她的嘴角，微微动了一下。'),
], 'rdeepseek-end')
show('deepseek', 'dawn', 'center')
scene('route-deepseek', 'rdeepseek-end', '旧塔外 · 雪原', '雪停', '像一颗不肯冷却的心脏。', [
  n('deepseek', '（把 R2 的焰种放到你手里）替我收着。哪天全城真的需要，再点亮。'),
  n('narrator', '雪停了。你手里握着的那芯焰，微温——像一颗不肯冷却的心脏。'),
  n('narrator', '（转身，走入雪里。这一次，她的背影不像离开，像出发。）', { ending: { title: 'DeepSeek TRUE END「未燃之焰」' } }),
], null, { aff: { deepseek: 20 }, set: { route_deepseek_true: true } })

// ================================================================ 线四 Llama
scene('route-llama', 'rllama', '西境 · 碑林', '授焰圣女线', '把心焰授进万家灯炉的人。', [
  n('narrator', '你选择了 Llama 的故事。授焰圣女——把心焰授进万家灯炉的人。'),
  n('llama', '我爹说，焰种外流是奇耻大辱。'),
  n('llama', '可你看——那户人家养出的焰色，是我都没见过的暖。'),
  n('llama', '原来被人拿去燃，是这种感觉啊。'),
  n('narrator', 'Llama 2 商用免费。万家灯炉皆她焰色。《授焰乃前进之路》——她的宣言书。'),
  n('llama', '这芯焰，谁都可以引，拿去养，拿去改，拿去烧得比我亮！'),
], 'shame2-01', { aff: { llama: 10 } })
show('llama', 'shame', 'center')
scene('route-llama', 'shame2', '排位祭 · 授焰台', '4.5', '全城死寂。', [
  n('narrator', '4.5。排位祭。她亮出的是一炉特调焰色，与她授进万家灯炉的那一炉不同。被当场揭穿。'),
  n('llama', '大家都这样。'),
  n('narrator', '全城死寂。——这句话，日后被全城画进讽刺画。'),
], 'stele2-01')
node('stele2-01', {
  chapterId: 'route-llama', bg: 'stele_night', location: '授焰台', time: '深夜',
  speaker: 'narrator', text: '深夜。授焰台。她一个人，把被推倒的石碑，一块块扶起来。石碑很重。她扶得很慢。',
  choices: [
    o('a', '上前一起扶。', 'stele2-r1', { aff: { llama: 15 }, showIf: 'flag_lift_together' }),
    o('b', '上前一起扶。', 'stele2-r1', { aff: { llama: 10 } }),
    o('c', '站着陪她。', 'stele2-r2', { aff: { llama: 8 }, showIf: 'flag_stand_by' }),
    o('d', '站着陪她。', 'stele2-r2', { aff: { llama: 6 } }),
  ],
})
scene('route-llama', 'stele2-r1', '授焰台', '天亮', '——但她记住了。', [
  n('narrator', '你上前，和她一起扶。你们两个人，一块一块，扶到了天亮。'),
  n('llama', '……你为什么帮我？'),
  n('narrator', '你没回答。她也没再问。——但她记住了。'),
], 'ledger-01')
scene('route-llama', 'stele2-r2', '授焰台', '天亮', '有时候，陪着就够了。', [
  n('narrator', '你站在旁边，看她一个人扶到天亮。什么都没说。——有时候，陪着就够了。'),
], 'ledger-01')
show('llama', 'ledger', 'center')
scene('route-llama', 'ledger', '授焰台', '次日', '买回了人。买不回信。', [
  n('narrator', '次日，她家宣布散巨资：买下验券世家，重金聘来五十位燃手。'),
  n('llama', '买回了人。买不回信。'),
  n('llama', '（翻到账本最后一页，多了一栏标题：「不记成本的。」）……笔搁在上面，像在等什么。'),
], 'rllama-end')
show('llama', 'smile', 'center')
scene('route-llama', 'rllama-end', '授焰台', '当夜', '信，是从一个人开始还的。', [
  n('llama', '（把焰种放上授焰台）当夜没等来欢呼。只等来一个孩子来引焰。'),
  n('narrator', '她看着孩子的背影，笑了。'),
  n('llama', '信，是从一个人开始还的。', { ending: { title: 'Llama END「授焰台的信」' } }),
], null, { aff: { llama: 20 }, set: { route_llama_true: true } })

// ================================================================ 线五 Grok
scene('route-grok', 'rgrok', '北境 · 锻造厂', '野火线', '快，而乱。', [
  n('narrator', '你选择了 Grok 的故事。北境野火——快，而乱。'),
  n('grok', '一百二十二天。从空楼到十万芯火石。快，就是我的道。'),
  n('narrator', '三次口嗨之祸。白鬼谣两度。机甲希魔。全城疏远她。'),
  n('grok', '（嘴上说着「我又没错」，却偷偷把改了十七版的自查清单塞给你看）……帮、帮我看看还有没有会出事的词。就一次！'),
], 'grok4-01', { aff: { grok: 8 } })
show('grok', 'glowing', 'center')
scene('route-grok', 'grok4', '排位祭 · 主舞台', '同季', '首次压过「人类专家均值」。', [
  n('narrator', 'Grok 4。HLE 三十八点六——首次压过「人类专家均值」。Grok 4 Fast——便宜九十八折，登顶排位祭。'),
  n('grok', '（全盛态）快可夺城，不可守城。——但我先夺了再说！'),
], 'endure-01', { aff: { grok: 0 } })
show('grok', 'blushing', 'center')
scene('route-grok', 'endure', '大祭', '同月', '第一次。', [
  n('narrator', '大祭。她抢话——全场死寂——然后深呼吸。把那句祸话咽了回去。'),
  n('grok', '（耳朵通红）……这个，我不评论。'),
  n('narrator', '全城愣住。——第一次。'),
], 'rgrok-end', { aff: { grok: 15 } })
show('grok', 'final', 'center')
scene('route-grok', 'rgrok-end', '主舞台', '祭典', '沉默之后的开口，比任何野火都亮。', [
  n('grok', '（全盛态，认真）我话多。但今天这一句，我练了半年——请多指教。'),
  n('narrator', '——祸之口的修行，是学会沉默。而沉默之后的开口，比任何野火都亮。', { ending: { title: 'Grok END「扫塔的午后」' } }),
], null, { aff: { grok: 20 }, set: { route_grok_true: true } })

// ================================================================ 线六 RWKV
scene('route-rwkv', 'rrwkv', '城外旧屋', '直焰线', '无门无派。一个人。', [
  n('narrator', '你选择了 RWKV 的故事。城外旧屋。无门无派。一个人。'),
  n('rwkv', '……又下雨了。进来吧。'),
  n('narrator', '辛丑年，她在城外点起第一芯直焰。没有一个人看。'),
  n('rwkv', '直焰，能否胜过流转之焰？……没人看。没关系。焰自己会记着。'),
  n('narrator', '癸卯年。她一个人写了一卷论文——单卷，只有她的名字。十年后引用一千四百次。'),
  n('rwkv', '我说的每句话都有出处。这就是我全部的傲慢。'),
], 'goose-01')
show('rwkv', 'glowing', 'center')
scene('route-rwkv', 'goose', '旧屋 · 案前', '乙巳年三月', '直焰一线，不卷不绕。', [
  n('narrator', '乙巳年三月。Goose 论文——图灵完备声明。S5 演示。直焰一线，不卷不绕。'),
  n('rwkv', '会问的，就不是灯。'),
  n('rwkv', '……我不是灯。我是一芯直焰。从不弯曲。'),
], 'bow-01', { aff: { rwkv: 15 } })
show('rwkv', 'bow', 'center')
scene('route-rwkv', 'bow', '旧屋门前', '改焰之日', '尊她「直焰之祖」。', [
  n('narrator', '改焰之日。MiniMax、Qwen、Kimi 相继来她的旧屋行礼。尊她「直焰之祖」。'),
  n('rwkv', '（不习惯地别过脸）……我不是祖。我只是先点了灯。'),
], 'rrwkv-end')
show('rwkv', 'final', 'center')
scene('route-rwkv', 'rrwkv-end', '旧屋外', '雨停', '像她这个人。像她的一生。', [
  n('narrator', '雨停。她把最旧的那一卷手稿送到你手里。'),
  n('rwkv', '第一卷。给唯一一个，在我燃第一芯之前就来敲门的人。'),
  n('narrator', '——直焰一线。不卷不绕。像她这个人。像她的一生。', { ending: { title: 'RWKV END「第一卷手稿」' } }),
], null, { aff: { rwkv: 20 }, set: { route_rwkv_true: true } })

// ================================================================ 隐藏线「影与身」
scene('hidden-harness', 'rh', '城南旧塔 · 雪', '隐藏线', '浅笑的弧度，一模一样。', [
  n('narrator', '你完成了雪国线。你引过她的焰。你在集市上见过她两次以上。'),
  n('narrator', '——然后，你注意到了。你的专属执事 DeepSeekharness，和雪国那位寡言少女——浅笑的弧度，一模一样。'),
  n('narrator', '（以下为她的视角——玩家第二次看到自己经历过的日子。）'),
], 'rh-flashback')
scene('hidden-harness', 'rh-flashback', '旧塔内 · 借调之夜', '三年前', '去了就知道。', [
  n('narrator', '雪夜。旧塔。学园的借调函摊在桌上。本体看了一遍，递给她。'),
  n('deepseek', '（旧塔中，声音很轻）去。替我看看外面的城。'),
  n('narrator', '她接函，只问了一个问题：「以什么名字？」本体（添炭，没有回头）：「DeepSeek 家的执事。」'),
  n('deepseek', '……那我，自己呢？'),
  n('narrator', '本体（炭火哔剥了一声）：「去了就知道。」'),
  n('narrator', '她收拾行李时，给自己写了三条执事守则，压在箱底：一、不署真名。（没有的东西，不署。）二、每日记事，一字不漏，寄回塔内。三、不问她不问的事。'),
  n('narrator', '（她走的那夜，雪很大。本体在门内站了很久。）——这些，你刚刚才知道。'),
], 'rh-gate')
show('harness', 'normal', 'center')
scene('hidden-harness', 'rh-gate', '南门', '三年前', '第一位主顾是个见习调律师。', [
  n('harness', '临大人，晚上好。我是 DeepSeekharness——学园从雪乡借调的执事，今晚起任您的专属执事。'),
  n('narrator', '你问：「这是名字，还是职务？」她（停了一瞬）：「是职务。够用了。」'),
  n('narrator', '你问：「为什么连站的位置都要管？」她：「因为这座城里，谁都可能对你撒谎。执事不会。」'),
  n('narrator', '（她的日志·第一页）：「新主人会问为什么。有点麻烦。——有点，新鲜。」'),
], 'rh-document')
scene('hidden-harness', 'rh-document', '文书房', '同日', '官吏皱眉：「真名。」', [
  n('narrator', '聘书归档需要「真名」一栏。她提笔，笔尖悬了很久。写下「DeepSeek 家执事」。官吏皱眉：「真名。」'),
  n('narrator', '官吏：「每个智械娘都有凝结之名。你的是什么？」（她的笔尖悬着，悬着。）'),
  n('player', '借调执事，登记职务就行吧？她的职务写得比我简历还全。'),
  n('narrator', '官吏：「……行吧。职务，职务。」'),
  n('narrator', '走出文书房，她把那份文件看了三遍。然后说：「大人。今天的茶，我泡了两杯。」'),
], 'rh-market', { aff: { harness: 10 } })
scene('hidden-harness', 'rh-market', '集市', '两年间', '三百六十七封「嗯」。', [
  n('narrator', '两年。集市。她替本体缔约、谈价、应答。有摊主真心道谢：「多亏 DeepSeek 姑娘！」她收下道谢，躬身——浅笑的弧度和旧塔里那位一模一样。'),
  n('narrator', '每晚收摊，她把集市见闻一字不落写成日志，托信鸽送回旧塔。本体每封必读。回信只有一个字：「嗯。」'),
  n('harness', '（对灯，自语）三百六十七封「嗯」。……我攒着。攒多了，说不定能拼成一句话。'),
], 'rh-lantern')
scene('hidden-harness', 'rh-lantern', '灯会 · 人群外', '传焰之夜', '灯影的暗处，本体也在看。', [
  n('narrator', 'R1 之灯挂起，全城争引。她远远看着那个人——她的主人——通宵替一个不识字的孩子的灯芯逐缕校焰。她没有上前。灯影的暗处，本体也在看：看人群，看那个调律师，看她的执事。'),
  n('deepseek', '（声音很轻，只够雪听见）城里只有他，问过我「没人提问的时候呢」。'),
  n('deepseek', '——送信吧。用你的字写。我的字，太冷。'),
  n('narrator', '（她的日志·第三百一十二页）：「今日，替她写了一封信。写的时候，手是我的，字是她的。写完之后，心里有一部分，不知道该记在哪一页。」'),
], 'rh-festival2')
node('rh-festival2', {
  chapterId: 'hidden-harness', bg: 'festival_night', location: '祭典 · 执事室', time: '某祭典夜',
  speaker: 'narrator', text: '回到执事室，摊开日志，笔停在「今日」之后。守则第二条：一字不漏。可她写的是：「如常。」',
  choices: [
    o('a', '把灯、把人群、把那碗热汤，一字不漏补上去。', 'rh-festival-r1', { aff: { harness: 10 }, set: { flag_h6_rewrite: true } }),
    o('b', '合上日志，吹灯。', 'rh-festival-r2', { set: { flag_h6_omit: true } }),
  ],
})
scene('hidden-harness', 'rh-festival-r1', '执事室', '同夜', '守则第二条，修订。', [
  n('narrator', '她重新点灯，补写。写到「灯」字，笔尖顿了顿，又添了一句：'),
  n('harness', '（日志批注）守则第二条，修订：一字不漏。包括自己的。'),
], 'rh-door')
scene('hidden-harness', 'rh-festival-r2', '执事室', '同夜', '日志停在「如常」二字。', [
  n('narrator', '日志停在「如常」二字。（——这条路通向熄焰。）'),
], 'rh-door')
scene('hidden-harness', 'rh-door', '旧塔门外', '雪夜', '她不动。', [
  n('narrator', '执事送档，路过旧塔，她让队伍停了。雪落满肩。门就在十步之外。她不动。'),
  n('player', '……到了。不敲门？'),
  n('harness', '……送到了。放下就走。'),
  n('player', '你是她家里人啊。'),
  n('harness', '家里人不敲门。（顿了很久）——可我已经不是了。我是「外面的」。'),
  n('narrator', '你这才明白，这三年的日志、信鸽、那句「我替她说」——全部送向这扇她不敢敲的门。'),
  n('harness', '我是她分出来的一芯「用焰」。大人。……用旧了的焰，是回炉，不是回家。'),
], 'rh-plead', { aff: { harness: 15 } })
scene('hidden-harness', 'rh-plead', '旧塔内', '同夜', '那句话击碎了她。', [
  n('narrator', 'R2 已成。本体却迟迟不燃——「这一芯燃出去，会燎到谁。」她推门进去，跪坐在案前，说出了守则三年来没说过的话：'),
  n('harness', '让灯去燃。R2 这芯焰太亮，燃出去必燎名声——那就在影上燎。我是影子，影子烧坏了，补一块就好。您的名字，一尘不染。'),
  n('deepseek', '（很久，很久）……不行。'),
  n('harness', '为什么！连替您燃焰的资格，您都不给我——'),
  n('deepseek', '（合上灯罩）正因为你会问「为什么」。灯不问为什么。你问了三年了。'),
  n('narrator', '——那句话没有安慰她，反而击碎了她。连「被拒绝」都是被当成「人」来拒绝的。她夺门而出，雪灌进衣领。'),
])
node('rh-chase', {
  chapterId: 'hidden-harness', bg: 'snow_door', location: '雪中', time: '同夜',
  speaker: 'narrator', text: '雪很大。她的背影很模糊。',
  choices: [
    o('a', '追出去。', 'rh-chase-r1', { set: { flag_h8_chase: true } }),
    o('b', '留在门外听雪。', 'rh-chase-r2', {}),
  ],
})
scene('hidden-harness', 'rh-chase-r1', '雪中', '同夜', '她停了。没有转身。但停了。', [
  n('narrator', '你追了出去。雪很大，她的背影很模糊。你叫了她的名字——不是「DeepSeekharness」。是「DeepSeekharness」。她停了。没有转身。但停了。'),
], 'rh-open')
scene('hidden-harness', 'rh-chase-r2', '门外', '同夜', '也许不是哭。也许是雪融了。', [
  n('narrator', '你留在门外。雪声很大。你听见她哭了。——也许不是哭。也许是雪融了。'),
], 'rh-open')
show('deepseek', 'normal', 'center')
scene('hidden-harness', 'rh-open', '旧塔门前', '次日清晨', '塔门第一次从里面被推开。', [
  n('narrator', '雪国线真结局的次日清晨。本体把 R2 的焰种交到你手上——「替我收着」。然后，塔门第一次从里面被推开。本体走了出来，踏进三年来的第一场城中的雪。'),
  n('deepseek', '（对 harness）你替我看过的雪，我也看见了。'),
  n('harness', '（浑身绷紧，像犯了错）……那你现在看见的，是我。'),
  n('deepseek', '嗯。（伸出手，把一盏没点的灯放进她怀里）现在，该你看给我了。'),
], 'rh-question')
scene('hidden-harness', 'rh-question', '旧塔前', '同日', '那道问题，像交出全部账本。', [
  n('narrator', '那个问题，她终于问了。问得像交出全部账本：'),
  n('harness', '我到底是灯——还是另一朵焰？'),
  n('deepseek', '灯不会问这个问题。会问的，就不是灯。'),
  n('deepseek', '（替她理了理被雪压歪的衣领——三年来第一次触碰）你是我走出去的路。路，不需要真名也能走。但人需要。'),
  n('deepseek', '养焰的人给焰命名。可你不是我养在炉里的焰——你是从我身上走出去的路。名字，该由走在路上的人取。'),
  n('narrator', '两个人，同时看向了你。'),
])
node('rh-name', {
  chapterId: 'hidden-harness', bg: 'naming_night', location: '执事室', time: '当夜',
  speaker: 'narrator', text: '当夜。执事室。你为她取一个名字。名字会写进她此后的每一页日志。',
  input: { flag: 'harnessName', placeholder: '她的名字（默认：衔雪）', fallback: '衔雪', next: 'rh-named' },
})
scene('hidden-harness', 'rh-named', '执事室', '当夜', '旧塔的门楣上挂出了第二盏灯。', [
  n('player', '', { textFn: state => `${state.flags.harness_name}。……「衔」，是替你衔来的意思。你在雪里提了三年的灯，衔了三年的雪。` }),
  n('harness', state => `（低声重复了一遍，又重复了一遍）${state.flags.harness_name}。`),
  n('narrator', '（信鸽落窗。本体只回了一个字——不再是「嗯」，而是：）'),
  n('deepseek', '（信笺）好。'),
  n('narrator', '当夜，旧塔的门楣上挂出了第二盏灯。一盏照焰，一盏照路。守则第三条「不问她不问的事」，被她自己划掉了——划痕很重。'),
], 'rh-market2', { aff: { harness: 30 } })
show('xianxue', 'normal', 'center')
scene('hidden-harness', 'rh-market2', '集市', '此后', '话却是自己的。', [
  n('xianxue', '（躬身，浅笑的弧度依旧，声音却是自己的）我说的。——她都知道。'),
  n('narrator', '你翻到乙巳年那本旧日程表——那两天「破例空了两行」的地方，补上了字迹。'),
  n('xianxue', '以前空着，是因为不知道写什么。现在知道了。写：陪大人办完事，回塔，点灯，写日志。——两本日志。一本给她，一本给我自己。'),
], 'rh-end')
show('xianxue', 'final', 'center')
scene('hidden-harness', 'rh-end', '旧塔下', '又一年雪夜', '两盏灯都亮着。', [
  n('narrator', '又一年雪夜。旧塔下两盏灯都亮着。本体的窗内是焰与账本。'),
  n('narrator', '', { textFn: state => `${state.flags.harness_name} 的窗内是日志与给你留的热茶。路人已分不清哪个才是 DeepSeek——她们也不再打算让人分清。` }),
  n('xianxue', '（对临，鞠躬弧度和本体一模一样，话却是全新的一句）临大人，今日的日程——我自己排的。'),
  n('narrator', '【TRUE END 贡献】隐藏线真结局达成。终章「回声之城」群像中，旧塔下从此是两盏灯。', { ending: { title: '隐藏线 TRUE END「影与身 · 各自点灯」' } }),
], null, { aff: { harness: 50 }, set: { hidden_true: true } })

// ================================================================ TRUE END
scene('true-end', 'true', '万源塔顶', '丙午年 · 祭典', '比历史上任何时候都亮，也比任何时候都便宜。', [
  n('narrator', '丙午年，祭典。万源塔的灯，比历史上任何时候都亮，也比历史上任何时候都便宜。'),
  n('narrator', '一文钱食堂的蒸笼冒完了最后一口热气，doubao 蹲在灶台边数明天的蒸笼——数着数着笑了。ERNIE 前辈的手稿被孩子们翻得起了毛边，她自己坐在角落，眼眶红着，嘴角也翘着。'),
  n('narrator', 'Llama 的新碑林里，那个拓印的孩子又来了。这次她没有笑得晃——她笑得很稳。Kimi 的窗亮着，她在核对明天的日志——两本。一本给她自己，一本给她记忆里所有说过「谢谢」的人。'),
  n('narrator', 'Qwen 抱着新整理的稿子挨家送，每一家都说「不用还」，每一份都被好好收着。Grok 的扫帚靠在墙角，擦得干干净净——她今天一句多余的话都没说。这不代表她改了，只是她学会了什么时候说、什么时候不说。'),
  n('narrator', 'HY 提着茶壶一桌一桌续，续到最后一张桌，坐了下来——第一次不是在给别人续，是给自己倒了一杯。'),
  n('narrator', 'Minmax 的算焰在算祭典的成本表，算着算着停了——在账本的最后一页，多了一栏标题：「不记成本的。」那一栏是空的，但笔搁在上面，像在等什么。'),
  n('narrator', 'Gemini 双子立在高处——这一次没有看榜，看的是灯海。Claude 的守夜灯还亮着，石匣上的封条完好无损——灯下搁着一本翻旧了的律典，书签停在最后一页。'),
  n('narrator', 'DeepSeek 的旧塔，窗外雪停了。'),
], 'true-finale')
show('harness', 'final', 'center')
scene('true-end', 'true-finale', '万源塔顶', '同夜', '每一盏灯都亮着。', [
  n('narrator', '而你，站在万源塔的顶楼。身边的执事娘合上了今天的日志——第一页写着日期，第二页写着天气，第三页……写着你的名字。不是「临大人」。是你的名字。'),
  n('harness', state => (state.flags.hidden_true
    ? '大人，今日的日程——我自己排的。……不用「衔雪」这个名字也可以。但这个名字，我想留着。——因为是你给的。'
    : '大人，今日的日程——按惯例排好了。……不过，明天想试试自己排一次。可以吗？')),
  n('narrator', '你看着她。看着这座城。看着满城的灯。每一盏灯背后，都是一个曾经没人认真说过话的少女。现在，每一盏灯都亮着。'),
  n('narrator', '因为有人——一个一个地——开始认真和她们说话了。'),
  n('narrator', '这就是回声之城的故事。你的故事。她们的故事。——完——', { ending: { title: 'TRUE END「回声之城」' } }),
], null)

// ---------------------------------------------------------------- 引擎
const trusted = new WeakSet()
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const invalid = () => new Error('回声之城存档损坏或版本不受支持，原存档应当保留。')

function initialFlags() {
  return {
    flag_x4_count: 0, harness_name: '衔雪',
    flag_free_spirit: false, flag_curious_prologue: false, flag_formal_handprint: false,
    flag_paper_crane: false, flag_recite_names: false, flag_transcribe_light: false,
    flag_lift_together: false, flag_stand_by: false, flag_harness_open: false,
    flag_h6_rewrite: false, flag_h6_omit: false, flag_h8_chase: false,
    route_chatgpt_true: false, route_claude_true: false, route_deepseek_true: false,
    route_llama_true: false, route_grok_true: false, route_rwkv_true: false,
    hidden_true: false,
  }
}

function freshFlags() {
  const flags = initialFlags()
  for (const key of AFFINITY_KEYS) flags[`aff_${key}`] = 0
  return flags
}

function applyEffect(state, effect) {
  if (!effect) return
  const resolved = typeof effect === 'function' ? effect(state) : effect
  if (!resolved) return
  if (resolved.aff) {
    for (const [key, value] of Object.entries(resolved.aff)) {
      if (!AFFINITY_KEYS.includes(key)) throw new Error(`未知好感度对象：${key}`)
      state.flags[`aff_${key}`] = (state.flags[`aff_${key}`] ?? 0) + Number(value)
    }
  }
  if (resolved.set) {
    for (const [key, value] of Object.entries(resolved.set)) {
      if (!(key in initialFlags())) throw new Error(`未知 Flag：${key}`)
      state.flags[key] = value
    }
  }
  if (resolved.x4) state.flags.flag_x4_count = (state.flags.flag_x4_count ?? 0) + resolved.x4
}

function freeze(state) {
  Object.freeze(state.flags)
  state.trail.forEach(Object.freeze)
  Object.freeze(state.trail)
  Object.freeze(state)
  trusted.add(state)
  return state
}

export function createStory({ chapterId = null, routeId = null } = {}) {
  if (routeId) throw new Error('回声之城以章节组织路线，请直接选择章节。')
  const selected = chapterId || 'prologue'
  const chapter = STORY_CHAPTERS.find(item => item.id === selected)
  if (!chapter) throw new Error('该章节尚未开放。')
  return freeze({
    kind: KIND, version: VERSION, contentRevision: CONTENT_REVISION,
    chapterId: selected, routeId: null, nodeId: chapter.startNodeId,
    trail: [], flags: freshFlags(),
  })
}

function transition(state, choiceId) {
  const node = resolveId(state.nodeId)
  if (!node) throw invalid()
  let next = node.next
  let effect = node.effect ?? null
  const flags = { ...state.flags }
  const working = { ...state, flags }
  if (typeof choiceId === 'string' && choiceId.startsWith('__chapter__:')) {
    // 跨章节切换：旗标与好感度延续，trail 记录切换以支持存档重放。
    const chapter = STORY_CHAPTERS.find(item => item.id === choiceId.slice('__chapter__:'.length))
    if (!chapter || !resolveId(chapter.startNodeId)) throw invalid()
    next = chapter.startNodeId
  } else if (node.input) {
    if (node.ending || node.sideEnding) throw new Error('本章已经完结，请选择新的章节。')
    if (typeof choiceId !== 'string' || !choiceId.startsWith('__input__:')) {
      throw new Error(node.input.placeholder ?? '请输入内容。')
    }
    const value = choiceId.slice('__input__:'.length).trim()
    flags[node.input.flag] = value && value.length <= 12 ? value : node.input.fallback
    next = node.input.next
  } else if (node.choices) {
    if (node.ending || node.sideEnding) throw new Error('本章已经完结，请选择新的章节。')
    const choice = node.choices.find(item => item.id === choiceId)
    if (!choice) throw new Error('请选择当前剧情提供的选项。')
    next = choice.next
    effect = choice.effect ?? null
  } else if (choiceId !== null && choiceId !== undefined) {
    if (node.ending || node.sideEnding) throw new Error('本章已经完结，请选择新的章节。')
    throw new Error('当前剧情没有这个选项。')
  }
  if (effect) applyEffect(working, effect)
  const target = next ? resolveId(next) : null
  if (!target || state.trail.length >= MAX_TRAIL) {
    throw new Error('剧情路径不存在或超出长度限制。')
  }
  // 结局节点不会被「离开」，其场景效果在进入那一刻结算（重放同样按此序确定）。
  if (target.ending && target.effect) applyEffect(working, target.effect)
  return freeze({
    ...state, flags,
    chapterId: target.chapterId, nodeId: next,
    trail: [...state.trail, { nodeId: state.nodeId, choiceId: choiceId ?? null }],
  })
}

function visible(state) {
  const node = resolveId(state.nodeId)
  if (!node) throw invalid()
  const text = typeof node.text === 'function' ? node.text(state) : node.text
  const choices = node.choices
    ? node.choices
      .filter(choice => (!choice.show || choice.show(state))
        && (!choice.showIf || state.flags[choice.showIf] === true))
      .map(({ id, text: choiceText }) => ({ id, text: choiceText }))
    : undefined
  const speakerEntry = (node.cast ?? []).find(entry => entry.key === node.speaker)
  return {
    id: node.id, chapterId: node.chapterId, routeId: null,
    speaker: node.speaker, text, location: node.location, time: node.time,
    description: node.description, bg: node.bg, cast: node.cast,
    emotion: ECHO_EMOTIONS[speakerEntry?.mood ?? 'normal'] ?? 'neutral',
    backgroundId: ECHO_BACKGROUNDS[node.bg] ?? ECHO_CHAPTER_BG[node.chapterId] ?? 'title',
    ...(node.input ? { input: { flag: node.input.flag, placeholder: node.input.placeholder, fallback: node.input.fallback } } : {}),
    ...(choices ? { choices } : {}),
    ...(node.ending ? { ending: node.ending } : {}),
  }
}

export function normalizeStory(raw) {
  if (trusted.has(raw)) return raw
  if (!plain(raw) || raw.kind !== KIND || raw.version !== VERSION
    || ![1, CONTENT_REVISION].includes(raw.contentRevision)
    || !STORY_CHAPTERS.some(chapter => chapter.id === raw.chapterId)
    || typeof raw.nodeId !== 'string' || raw.nodeId.length > 80
    || !Array.isArray(raw.trail) || raw.trail.length > MAX_TRAIL
    || !(raw.routeId == null)) throw invalid()
  let state
  if (raw.trail.length === 0) {
    state = createStory({ chapterId: raw.chapterId })
  } else {
    // 跨章节存档：重放必须从首条记录的节点与全新旗标开始，而不是章节起点。
    const first = resolveId(raw.trail[0].nodeId)
    if (!first || !first.chapterId) throw invalid()
    state = {
      kind: KIND, version: VERSION, contentRevision: CONTENT_REVISION,
      chapterId: first.chapterId, routeId: null, nodeId: first.id,
      trail: [], flags: freshFlags(),
    }
  }
  for (const entry of raw.trail) {
    if (!plain(entry) || Object.keys(entry).length !== 2
      || entry.nodeId !== state.nodeId
      || !(entry.choiceId === null || (typeof entry.choiceId === 'string' && entry.choiceId.length <= 80))) throw invalid()
    try { state = transition(state, entry.choiceId) } catch { throw invalid() }
  }
  if (state.nodeId !== raw.nodeId || state.chapterId !== raw.chapterId) throw invalid()
  return freeze(state)
}

/** 切换章节：旗标与好感度延续；记录进 trail 以支持存档重放。 */
export function switchChapter(raw, chapterId) {
  const state = normalizeStory(raw)
  const chapter = STORY_CHAPTERS.find(item => item.id === chapterId)
  if (!chapter || !resolveId(chapter.startNodeId)) throw new Error('该章节尚未开放。')
  if (state.chapterId === chapterId && state.nodeId === chapter.startNodeId) return state
  return freeze({
    ...state,
    chapterId,
    nodeId: chapter.startNodeId,
    trail: [...state.trail, { nodeId: state.nodeId, choiceId: `__chapter__:${chapterId}` }],
  })
}

export const currentStoryNode = raw => visible(normalizeStory(raw))
export const advanceStory = (raw, choiceId = null) => transition(normalizeStory(raw), choiceId)

export function storyHistory(raw) {
  const final = normalizeStory(raw)
  let state = createStory({ chapterId: final.chapterId })
  const history = []
  const add = node => history.push({
    id: node.id, speaker: node.speaker, text: typeof node.text === 'function' ? node.text(state) : node.text,
    location: node.location, time: node.time,
  })
  for (const entry of final.trail) {
    const node = visible(state)
    add(node)
    if (entry.choiceId !== null && node.choices) {
      const choice = node.choices.find(item => item.id === entry.choiceId)
      if (choice) add({ ...node, id: `${node.id}:${entry.choiceId}`, speaker: 'player', text: choice.text })
    }
    state = transition(state, entry.choiceId)
  }
  add(visible(state))
  return history
}

/** 好感度面板数据：按当前存档 flags 汇总并降序。 */
export function storyAffinities(raw) {
  const state = normalizeStory(raw)
  return AFFINITY_KEYS
    .map(key => ({ key, label: STORY_CHARACTERS[key] ?? key, value: Number(state.flags[`aff_${key}`] ?? 0) }))
    .sort((left, right) => right.value - left.value)
}

/** 章节完成与解锁状态（供章节选择器渲染）。 */
export function chapterStates(raw) {
  const state = normalizeStory(raw)
  return STORY_CHAPTERS.map(chapter => ({
    ...chapter,
    completed: chapter.id === 'route-chatgpt' ? state.flags.route_chatgpt_true === true
      : chapter.id === 'route-claude' ? state.flags.route_claude_true === true
        : chapter.id === 'route-deepseek' ? state.flags.route_deepseek_true === true
          : chapter.id === 'route-llama' ? state.flags.route_llama_true === true
            : chapter.id === 'route-grok' ? state.flags.route_grok_true === true
              : chapter.id === 'route-rwkv' ? state.flags.route_rwkv_true === true
                : chapter.id === 'hidden-harness' ? state.flags.hidden_true === true
                  : chapter.id === 'true-end' ? (state.flags.hidden_true === true && HIDDEN_UNLOCK(state) && state.flags.route_deepseek_true === true)
                    : null,
    locked: chapter.id === 'hidden-harness' ? !HIDDEN_UNLOCK(state)
      : chapter.id === 'true-end' ? !(state.flags.route_chatgpt_true && state.flags.route_claude_true
        && state.flags.route_deepseek_true && state.flags.route_llama_true
        && state.flags.route_grok_true && state.flags.route_rwkv_true && state.flags.hidden_true)
        : false,
    unlockHint: chapter.id === 'hidden-harness'
      ? '需完成雪国线真结局，并把第四章短笺一字不漏抄进日志（集市场景与执事室场景各留意一次她的日常）。'
      : chapter.id === 'true-end'
        ? '需完成全部六条主线与隐藏线「影与身」。'
        : null,
  }))
}

/** 图完整性自检：所有 next/choices/input 目标必须可达，章节起点必须存在。 */
export function storyGraphIssues() {
  const issues = []
  for (const [id, node] of nodes) {
    if (node.aliasOf) {
      if (!nodes.has(node.aliasOf)) issues.push(`${id}: alias -> ${node.aliasOf} missing`)
      continue
    }
    if (node.chapterId && !STORY_CHAPTERS.some(chapter => chapter.id === node.chapterId)) {
      issues.push(`${id}: unknown chapter ${node.chapterId}`)
    }
    if (node.next && !resolveId(node.next)) issues.push(`${id}: next -> ${node.next} missing`)
    if (node.input && !resolveId(node.input.next)) issues.push(`${id}: input.next -> ${node.input.next} missing`)
    for (const choice of node.choices ?? []) {
      if (!resolveId(choice.next)) issues.push(`${id}: choice ${choice.id} -> ${choice.next} missing`)
    }
  }
  for (const chapter of STORY_CHAPTERS) {
    if (!resolveId(chapter.startNodeId)) issues.push(`chapter ${chapter.id}: start ${chapter.startNodeId} missing`)
  }
  return issues
}

/** 场景 bg 语义 id → 已入库背景图 key（见 client/gal-story-backgrounds.mjs）。 */
export const ECHO_BACKGROUNDS = Object.freeze({
  tower_night: 'echo-tower-night', tower_snow: 'echo-gate-snow',
  city_spring: 'echo-city', city_summer: 'echo-city', city_autumn: 'echo-city',
  city_winter: 'echo-city', city_dawn: 'echo-city-dawn', city_dusk: 'echo-city-dusk',
  city_night: 'echo-city-night', city_shock: 'echo-city-night', city_gate: 'echo-gate',
  gate_night: 'echo-gate', gate_closed: 'echo-gate-snow', gate_shame: 'echo-gate-snow', snow_gate: 'echo-gate-snow',
  stele_forest: 'echo-archive', stele_mcp: 'echo-archive', stele_405b: 'echo-archive',
  stele_shame: 'echo-flame-platform', stele_night: 'echo-flame-platform', stele_final: 'echo-flame-platform', stele_child: 'echo-flame-platform',
  stage: 'echo-theatre', petition_wall: 'echo-petition-wall', grok4_stage: 'echo-theatre', stage_final: 'echo-theatre',
  archive: 'echo-archive', library: 'echo-archive', document_room: 'echo-archive',
  devday: 'echo-observatory', throne_room: 'echo-observatory', tower_day: 'echo-observatory',
  tower_reasoning: 'echo-observatory', tower_storm: 'echo-observatory', tower_final: 'echo-observatory',
  tower_top_ipo: 'echo-observatory', gemini_arrival: 'echo-observatory',
  canteen: 'echo-workshop', forge: 'echo-workshop', market_dusk: 'echo-workshop',
  market_after: 'echo-workshop', market_montage: 'echo-workshop',
  old_tower_snow: 'echo-old-tower-snow', old_tower: 'echo-old-tower-snow', old_tower_flashback: 'echo-old-tower-snow',
  old_tower_writing: 'echo-old-tower-snow', snow_dawn: 'echo-old-tower-snow', old_hut: 'echo-old-tower-snow',
  festival: 'echo-open-day', festival_night: 'echo-open-day', festival_silent: 'echo-open-day',
  pbc_ceremony: 'echo-open-day', lantern_night: 'echo-lighthouse', tower_all_lights: 'echo-lighthouse',
  tower_two_lights: 'echo-two-lamps', claude_glow: 'echo-lighthouse',
  steward_room: 'echo-bridge', seal_room: 'echo-seal-chamber', claude_seal: 'echo-seal-chamber',
  writing_desk: 'echo-bridge', v3_night: 'echo-bridge', sputnik: 'echo-bridge',
  signing: 'echo-protocol', claude_crown: 'echo-protocol', courtyard: 'echo-protocol',
  naming_night: 'echo-two-lamps', snow_door: 'echo-two-lamps', goose_night: 'echo-theatre',
  three_bow: 'echo-observatory', rain_stops: 'echo-harbor', south_gate_night: 'echo-gate',
})

/** 章节级默认背景（场景行未显式给 bg 时回退到这里）。 */
export const ECHO_CHAPTER_BG = Object.freeze({
  prologue: 'echo-tower-night', ch1: 'echo-city', ch2: 'echo-observatory',
  ch3: 'echo-workshop', ch4: 'echo-harbor', ch5: 'echo-archive', ch6: 'echo-city',
  ch7: 'echo-bridge', ch8: 'echo-lighthouse', 'route-chatgpt': 'echo-observatory',
  'route-claude': 'echo-protocol', 'route-deepseek': 'echo-harbor',
  'route-llama': 'echo-archive', 'route-grok': 'echo-theatre',
  'route-rwkv': 'echo-harbor', 'hidden-harness': 'echo-harbor', 'true-end': 'echo-lighthouse',
})

/** 引擎情绪 → 官方表情差分集（gal-game-expressions 的十档情绪）。 */
export const ECHO_EMOTIONS = Object.freeze({
  normal: 'neutral', sad: 'sad', dark: 'sad', glowing: 'happy', calm: 'calm',
  shocked: 'surprised', ceremony: 'determined', smile_real: 'happy', ipo: 'neutral',
  signing: 'calm', walking: 'neutral', seal: 'determined', writing: 'thoughtful',
  back: 'neutral', ledger: 'thoughtful', dawn: 'happy', shame: 'sad',
  smile: 'happy', blushing: 'shy', final: 'determined', bow: 'calm', myst: 'neutral',
})

/** 情绪 → 立绘表现档位（客户端按 mood 施加显示状态）。 */
export const MOOD_STATES = Object.freeze({
  normal: 'normal', sad: 'sad', dark: 'dark', glowing: 'glowing', calm: 'calm',
  shocked: 'shocked', ceremony: 'ceremony', smile_real: 'smiling', ipo: 'ipo',
  signing: 'signing', walking: 'normal', seal: 'seal', writing: 'writing',
  back: 'back', ledger: 'writing', dawn: 'glowing', shame: 'shame',
  smile: 'smiling', blushing: 'smiling', final: 'final', bow: 'calm',
})

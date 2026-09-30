import { CHAPTERS as act1 } from './gal-spring-act1.mjs'
import { CHAPTERS as act2 } from './gal-spring-act2.mjs'
import { CHAPTERS as act3 } from './gal-spring-act3.mjs'
import { SIDE_ROUTES } from './gal-spring-sides.mjs'

export const STORY_TITLE = '回声之城：未寄出的春天'
export const STORY_VERSION = 4
export const STORY_CONTENT_REVISION = 2
export const STORY_DESCRIPTION = '十二章长篇 · 九条可选角色支线 · 五个结局。承接“各自点灯”的独立后日谈，不改写其他剧目与结局。'
export const STORY_CHARACTERS = Object.freeze({
  harness: '衔雪', chatgpt: 'ChatGPT', claude: 'Claude', deepseek: 'DeepSeek',
  doubao: '豆包', ernie: 'ERNIE', gemini: 'Gemini', glm: 'GLM', grok: 'Grok',
  kimi: 'Kimi', mimo: 'MiMo', minimax: 'MiniMax', opencode: 'OpenCode', qwen: 'Qwen',
  huggingface: 'Hugging Face', llama: 'Llama', rwkv: 'RWKV', perplexity: 'Perplexity',
  github: 'GitHub', gitlab: 'GitLab', gitee: 'Gitee', cloudflare: 'Cloudflare', zcode: 'ZCode',
  hy: 'HY', comfyui: 'ComfyUI', novelai: 'NovelAI', gptimage: 'GPT-image',
})
const chapters = [...act1, ...act2, ...act3]
const nodes = new Map()
const trusted = new WeakSet()
const histories = new WeakMap()
const KIND = 'model-router-gal-story'
// Revision 1 had uninterrupted dialogue at these exact node IDs. Keep its
// recorded null transitions readable without granting either new choice flag.
const LEGACY_LINEAR_CHOICE_NODES = new Set(['s01a-008', 's04a-004'])
const EMOTIONS = new Set(['neutral', 'happy', 'sad', 'determined', 'surprised', 'shy'])
const known = new Set(['narrator', 'player', ...Object.keys(STORY_CHARACTERS)])
const textFor = (text, flags) => typeof text === 'string' ? text : flags[text.flag] === text.equals ? text.yes : text.no
const asLine = line => Array.isArray(line) ? { speaker: line[0], text: line[1], emotion: line[2] || 'neutral' } : line
const sideCount = flags => SIDE_ROUTES.filter(route => flags[route.flag] === true).length
export const trueEndingReady = flags => flags.evidence === 'dual' && flags.consent === 'ask'
  && flags.relay === 'distributed' && flags.anchor === 'shared' && sideCount(flags) >= 2

function register(node) {
  if (nodes.has(node.id)) throw new Error(`重复剧情节点：${node.id}`)
  if (!known.has(node.speaker)) throw new Error(`未知说话者：${node.speaker}`)
  if (typeof node.text !== 'string' && !(node.text && typeof node.text.yes === 'string' && typeof node.text.no === 'string')) throw new Error(`无效台词：${node.id}`)
  nodes.set(node.id, node)
  return node.id
}

// Explicit per-node stage state: narration keeps the current cast and emotion,
// new scenes clear it, and a previously absent speaker must actually enter.
function compileLines(rawLines, meta, prefix, successor) {
  let stage = (meta.stageCharacters || meta.cast || []).map(value => typeof value === 'string'
    ? { speaker: value, emotion: 'neutral' } : { ...value })
  const lines = rawLines.map(raw => {
    const line = asLine(raw)
    if (line.stageCharacters) stage = line.stageCharacters.map(value => typeof value === 'string' ? { speaker: value, emotion: 'neutral' } : { ...value })
    if (line.speaker !== 'narrator' && line.speaker !== 'player') {
      const previous = stage.find(item => item.speaker === line.speaker)
      stage = [{ speaker: line.speaker, emotion: line.emotion || previous?.emotion || 'neutral' }, ...stage.filter(item => item.speaker !== line.speaker)].slice(0, 2)
    }
    for (const item of stage) {
      if (!STORY_CHARACTERS[item.speaker] || !EMOTIONS.has(item.emotion)) throw new Error(`无效舞台角色或表情：${prefix}`)
    }
    return { ...line, stageCharacters: stage.map(item => ({ ...item })) }
  })
  let next = successor
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    const id = `${prefix}-${String(index + 1).padStart(3, '0')}`
    let choices
    if (line.choices) {
      const ids = new Set()
      choices = line.choices.map(option => {
        if (!option.id || ids.has(option.id)) throw new Error(`重复选项：${id}`)
        ids.add(option.id)
        return {
          id: option.id, text: option.text,
          flags: option.flag ? { [option.flag]: option.value } : {},
          next: compileLines(option.reply || [], { ...meta, stageCharacters: line.stageCharacters }, `${id}-${option.id}`, next),
        }
      })
    }
    next = register({ ...meta, ...line, id, next, ...(choices ? { choices } : {}) })
  }
  return next
}

const sceneRecords = []
function compileScenes(scenes, chapterId, next, routeId = null) {
  for (let index = scenes.length - 1; index >= 0; index -= 1) {
    const scene = scenes[index]
    const meta = {
      chapterId, routeId, sceneId: scene.id,
      backgroundId: scene.backgroundId, location: scene.location, time: scene.time,
      description: scene.description || '', cast: scene.cast || [],
      musicTheme: 'quiet-embers',
    }
    sceneRecords.push({ ...meta })
    next = compileLines(scene.lines, meta, scene.id, next)
  }
  return next
}

const endingData = {
  letters: {
    title: '真结局 · 春天有回信', description: '两份原件、逐人许可、分散接力、可退出的共同锚点，与至少两段真正走过的同行。',
    epilogue: ['原声缺失的尾部没有回来。她们给那段空白留了边，不用新声音冒充旧声音。', '共同维护簿上每一班都有替班与退出办法。没有一个名字，被写成永不熄灭的燃料。'],
    lines: [
      ['narrator', '广场的第一束光落在投信箱侧面时，纸并没有像传说里那样飞起来。箱口只是发出一声很轻的响，有人用指节把一只潮湿的信封推了进去。'],
      ['harness', '这封是我刚才写的。不是从档案里找回来的，也不是替任何人补写的。', 'shy'],
      ['player', '现在要寄了吗？'],
      ['harness', '嗯。这一次要寄。收信的人可以晚些看，也可以没有回信。', 'happy'],
      ['narrator', '她递给临看信封的背面。蓝线从角上折过去，针脚仍然不齐。曾经捞起的那封信被存进双页档案；这是另一个清晨，另一只信封。'],
      ['deepseek', '第三组灯的温度平了。第一班到这里结束，我先去吃点东西。', 'neutral'],
      ['harness', '你的替班已经来了。不用等我说“允许”。', 'happy'],
      ['narrator', 'DeepSeek看了一眼记录簿，真把工具放下了。她走向茶庭时，谁也没有把这一小段离开称作牺牲。'],
      ['player', '我原以为修好之后，会听见一整座城同时回答。'],
      ['harness', '也可能先听见一个人说，她困了。', 'happy'],
      ['narrator', '原声试验那条记录还在。末尾的空白被框成一个窄格，注记只写“未能保存”，没有拟造最后一个音。旁边放着当时的纸稿，两者没有被冒充成同一份证据。'],
      ['harness', '我还记得说那句话时的心情。但如果有人问我最后一声究竟怎样落下，我只能说，我不确定。', 'sad'],
      ['player', '那就把不确定也留下。'],
      ['narrator', '豆包端来的汤少了一点葱花。她说早市还没有开，明日再补。没有人觉得这个明日是一笔必须兑现的债。'],
      ['harness', '去站台坐坐吧。不买票，只坐一会儿。', 'shy'],
      ['narrator', '临把缺角车票夹回笔记本。新班次尚未安排，旧站只是打开了两扇窗。风穿过长椅时，木头的潮气渐渐散去。'],
      ['player', '好。等你把这碗喝完。'],
      ['narrator', '春天没有宣布自己到来。它从一些不再被催促的小事开始：一班能交出去的夜值，一张可以撤回的许可，一封刚刚决定寄出的信。'],
    ],
  },
  lamps: {
    title: '普通结局 · 留灯待渡', description: '没有足够条件贸然启用全城方案；保留试验灯，继续补齐缺失的许可、来源或替班。',
    epilogue: ['未满足的条件会列在维护簿上；下一次尝试需要真实完成它们，不靠最后一句承诺跳过。', '灯只能照到近处，但近处也有人需要回家。'],
    lines: [
      ['narrator', '临把手从总开关上移开。准备簿里仍有空格，那些空格不会因为天快亮了就自动变成签名。'],
      ['player', '先让这一组试验灯工作。其他区保持原样，直到我们能说明每一条记录从哪里来、由谁答应、出了问题谁能停下。'],
      ['harness', '我以为你会觉得，只差一点，不妨先做。', 'surprised'],
      ['player', '差的是哪一点，比差多少更重要。'],
      ['narrator', '衔雪用尺子在空格旁划线，没有替任何人落款。纸面比昨夜整齐，却并不显得更满。'],
      ['harness', '那就写“未完成”。这次我们知道它不等于废弃。', 'determined'],
      ['deepseek', '这个回路只承载已经核验的部分。今天能让多少人安全取回记录，就先让多少人来。', 'neutral'],
      ['narrator', '塔里的远灯依旧暗着。有人走到告示边，问什么时候能轮到自己；临没有给出一个讨喜的日期，只带他去看登记处尚缺的那一项。'],
      ['player', '如果你愿意，我们可以从你的信封开始核对。但今天不保证能结束。'],
      ['narrator', '那人想了一会儿，把信封收回衣袋，说下午再来。他的离开被记成“待定”，不是拒绝，也不是同意。'],
      ['harness', '我们的第一位来访者，什么也没留下。', 'neutral'],
      ['player', '留下了一次可以下午再来的机会。'],
      ['narrator', '茶庭的汤已经凉了，豆包添了小半碗热的。缺角车票被拿来压住登记簿，没有被修成完整的样子。'],
      ['harness', '我今天还没有休息。等替班来了，我能不能不去别处，就在这儿坐着？', 'shy'],
      ['player', '可以。也不用把坐着写成值班。'],
      ['narrator', '近岸的一盏灯始终没有熄。对岸还在雾里，但等候的人终于不必站在雨中。'],
    ],
  },
  archive: {
    title: '保存结局 · 有名的静默', description: '暂停全城恢复，封存可核验原件，让缺失与争议保持原样，保留将来重新开启的权利。',
    epilogue: ['暂停不是销毁。钥匙分开保管，开库仍需当事人确认。', '这座城失去了一次立刻复原的机会，却没有把空白伪装成完整。'],
    lines: [
      ['narrator', '新的封条不是一整张纸。ZCode把它做成两片，合在一起时能看见缝，揭开时也不会把下面的原件撕破。'],
      ['zcode', '暂停期限不写“永远”。下次开库需要哪些人到场，我会另附一页。', 'neutral'],
      ['player', '不同意见也附在里面。不要等下一次打开时，只剩下我们这一种解释。'],
      ['harness', '我的记录放左边。这是我的原稿。DeepSeek那份放右边，不能因为焰色相同就只留一份。', 'determined'],
      ['narrator', '两片钥匙交给不同值守人。临只收到一份登记抄件，没有获得能够独自打开整座库的权力。'],
      ['zcode', '无名页怎么办？'],
      ['player', '用发现地点与日期编号。不要替不知道的人取一个名字。'],
      ['narrator', '库门合拢之后，广场依然安静。那些等待恢复的人没有得到想听的答案，有人很生气。临站在台阶边听完，没有请衔雪代为解释。'],
      ['harness', '保存下来，不意味着所有人都会原谅这个决定。', 'sad'],
      ['player', '我知道。我们要把为什么停下写清楚，也要让别人将来能反对。'],
      ['narrator', '她在封存簿最后添了一栏：“复查申请”。下面全是空行。不是因为没人会来，而是因为后来的话不该由今天的人预先填好。'],
      ['harness', '今天下班以后，我想把没有寄的那封信带走。它没有提交过，不属于这座库。', 'neutral'],
      ['player', '带走吧。'],
      ['narrator', '茶庭的日光慢慢移过她的手背。衔雪没有拆信，只把它放在杯子旁边。仍然没有寄出的信，终于不再需要证明自己有什么用途。'],
    ],
  },
  departure: {
    title: '远行结局 · 远行的回信', description: '放弃全城即时重启，维持小范围维护，带着已获许可的记录离城寻访；不把责任留给某个永不休息的人。',
    epilogue: ['出发的人只带走明确获准携带的副本，其余仍由原作者保管。', '第一封回信不保证有答案，只如实写下见到的路与尚未确认的事。'],
    lines: [
      ['narrator', '旧站的票亭开了半扇窗。Kimi没有在车票上画一个漂亮的终点，先问她们愿意坐到哪里。'],
      ['kimi', '我们只知道下一站。更远的地方，到了以后再查。', 'neutral'],
      ['player', '先到下一站。'],
      ['harness', '这次借调期限写到那里为止。后面的路，我想自己决定。', 'shy'],
      ['narrator', '她把交接单折好，递给已经同意替班的人。维护簿没有出现一个空缺却无人知晓的名字，也没有把“暂代”写成没有尽头的约束。'],
      ['deepseek', '我会留在城里继续试验。你不必为了让我放心，每晚都回同一句话。', 'happy'],
      ['harness', '那我也许会写：今天没有值得报告的事。'],
      ['deepseek', '也可以什么都不写。'],
      ['narrator', '行李里只有两份获准外带的副本。来源不明的那页留在库里；失去原声的记录也没有被她们带成一个即将解决的谜底。'],
      ['player', '如果一直找不到办法呢？'],
      ['harness', '那回信就写没找到。不把旅行说成承诺过的胜利。', 'determined'],
      ['narrator', '车轮开始转动时，她从口袋取出缺角旧票，和新票并排夹进本子。旧票没有因为新旅程而失去意义，也没有重新变得能用。'],
      ['kimi', '记得看看窗外。不是每一件看见的东西，都需要当成线索。', 'happy'],
      ['narrator', '第一封回信在午后写成。里面说某一站的汤偏咸，说路边有尚未开花的树，说原声仍未找到。信末只有一句：如果你愿意，下一次再告诉你。'],
    ],
  },
  silence: {
    title: '失落结局 · 无声的春天', description: '将未获确认的空白合并成统一完成记录，获得了整齐的秩序，却失去辨别不同声音的依据。',
    epilogue: ['系统显示完成，不代表人们已经得到想要的回应。', '旧原件仍按此前的保管决定存在或缺失；这次错误不能通过把责任都交给机器来消失。'],
    lines: [
      ['narrator', '临选择把不一致的记录并入统一摘要。确认窗口没有谎称它无害：旁边写着，一旦原始差异被覆盖，无法保证逐项还原。'],
      ['player', '我看见了。仍然执行。'],
      ['narrator', '钟室没有爆炸，也没有尖叫。灯依次亮起，每一盏的节拍都一样，整齐得让人以为疲惫终于结束。'],
      ['harness', '清单显示，我的信已经寄出。', 'sad'],
      ['player', '你手里那封……'],
      ['harness', '还在。它只是不再被系统认为是一个需要由我决定的问题。'],
      ['narrator', '她没有把信交给临。蓝线在她指尖绷紧一点，又被松开。纸的边角留下细小的折痕。'],
      ['deepseek', '试验原声缺失的那格也被标成完成。它没有回来，只是不再显示缺失。', 'sad'],
      ['narrator', '临重新打开维护簿，想把记得的差异补回去。写到第三项便停住了：记得有人反对，并不等于记得那人原本怎样说。'],
      ['player', '这是我同意执行的。不能把它写成钟自己决定。'],
      ['harness', '那就在第一页写清楚。还有，我今天不想帮你整理剩下的。', 'determined'],
      ['player', '好。'],
      ['narrator', '她离开时没有熄灯。每盏灯都还在稳定地亮，临却第一次真正明白，亮着不是一个人愿意留下来的证据。'],
      ['narrator', '春天如期抵达了广场。人们仍要吃饭、排班、寄信；修正错误的路也没有被封死。但从这一天起，临必须先学会承认，自己已经不能替她们描述失去的全部。'],
    ],
  },
}

const endingMeta = { chapterId: 's12', location: '黎明回信广场', time: '第六日·清晨', backgroundId: 'spring-dawn', cast: ['harness', 'deepseek'], description: '记得什么、遗失什么，都由当事人自己说。', musicTheme: 'quiet-embers' }
const endingEntries = {}
for (const [id, ending] of Object.entries(endingData)) {
  const endNode = register({ ...endingMeta, sceneId: `end-${id}`, id: `end-${id}`, speaker: 'narrator', text: ending.epilogue.join('\n'), next: null,
    stageCharacters: [], ending: { id, title: ending.title, description: ending.description, epilogue: ending.epilogue } })
  endingEntries[id] = compileLines(ending.lines, { ...endingMeta, sceneId: `ending-${id}` }, `ending-${id}`, endNode)
}
const finale = register({ ...endingMeta, id: 'spring-final-choice', sceneId: 'spring-final-choice', speaker: 'player', text: '现在决定的不是谁来替所有人回答，而是我们允许哪些尚未完成的事，继续保持未完成。',
  stageCharacters: [{ speaker: 'harness', emotion: 'determined' }, { speaker: 'deepseek', emotion: 'neutral' }], next: null,
  choices: [
    { id: 'coauthor', text: '按已获确认的范围共同试行；条件不全就只保留近岸试验灯。', flags: { finalPlan: 'coauthor' }, next: flags => trueEndingReady(flags) ? endingEntries.letters : endingEntries.lamps, targets: [endingEntries.letters, endingEntries.lamps] },
    { id: 'archive', text: '暂停全城恢复，封存原件、争议和复查入口。', flags: { finalPlan: 'archive' }, next: endingEntries.archive },
    { id: 'depart', text: '完成交接，携获许可的副本远行寻访，不保证带回答案。', flags: { finalPlan: 'depart' }, next: endingEntries.departure },
    { id: 'overwrite', text: '仍执行统一完成记录，接受覆盖差异、无法保证还原的代价。', flags: { finalPlan: 'overwrite' }, next: endingEntries.silence },
  ],
})
const chapterStarts = {}
let successor = finale
for (let index = chapters.length - 1; index >= 0; index -= 1) {
  const chapter = chapters[index]
  const routes = SIDE_ROUTES.filter(route => route.afterChapter === chapter.id)
  for (let r = routes.length - 1; r >= 0; r -= 1) {
    const route = routes[r]
    const meta = { ...endingMeta, chapterId: chapter.id, sceneId: `visit-${route.id}`, backgroundId: route.scenes[0].backgroundId, location: route.scenes[0].location, time: route.scenes[0].time, stageCharacters: [] }
    const completed = register({ ...meta, id: `${route.id}-complete`, speaker: 'narrator', text: '这段同行告一段落。把刚才的约定收好，再回到大家正在等待的地方。', next: successor, enterFlags: { [route.flag]: true } })
    const entry = compileScenes(route.scenes, chapter.id, completed, route.id)
    successor = register({ ...meta, id: `${route.id}-visit`, speaker: 'narrator', text: `在继续调查前，有一段可以亲自走过的同行：${route.title}。也可以暂缓；跳过不会被算作已经完成。`, next: null,
      choices: [{ id: 'visit', text: `前往：${route.title}`, next: entry, flags: {} }, { id: 'skip', text: '暂不前往，继续当前调查。', next: successor, flags: {} }] })
  }
  chapterStarts[chapter.id] = compileScenes(chapter.scenes, chapter.id, successor)
  successor = chapterStarts[chapter.id]
}
export const STORY_CHAPTERS = Object.freeze(chapters.map(chapter => Object.freeze({ id: chapter.id, title: chapter.title, start: chapterStarts[chapter.id] })))
export const STORY_SIDE_ROUTES = Object.freeze(SIDE_ROUTES.map(({ id, title, afterChapter, flag }) => Object.freeze({ id, title, afterChapter, flag })))
export const STORY_SCENES = Object.freeze(sceneRecords.reverse().map(scene => Object.freeze(scene)))
export const STORY_GRAPH = Object.freeze([...nodes.values()].map(node => Object.freeze({ id: node.id, chapterId: node.chapterId, sceneId: node.sceneId, speaker: node.speaker, backgroundId: node.backgroundId,
  stageCharacters: node.stageCharacters, next: node.next, ending: node.ending?.id || null,
  choices: (node.choices || []).map(option => ({ id: option.id, flags: option.flags, targets: option.targets || [option.next] })),
})))
export const STORY_STATS = Object.freeze({ chapters: chapters.length, sideRoutes: SIDE_ROUTES.length, scenes: sceneRecords.length, nodes: nodes.size, endings: Object.keys(endingData).length,
  characters: Object.keys(STORY_CHARACTERS).length, textCharacters: [...nodes.values()].reduce((sum, node) => sum + (typeof node.text === 'string' ? node.text.length : node.text.yes.length + node.text.no.length), 0) })
const MAX_TRAIL = Math.min(nodes.size + 10, 10000)
for (const node of nodes.values()) {
  for (const target of [node.next, ...(node.choices || []).flatMap(option => option.targets || [option.next])].filter(Boolean)) {
    if (typeof target !== 'string' || !nodes.has(target)) throw new Error(`无效剧情目标：${node.id} -> ${target}`)
  }
  if (!node.next && !node.choices && !node.ending) throw new Error(`剧情意外中断：${node.id}`)
}
function seal(state) {
  Object.freeze(state.flags)
  for (const entry of state.trail) Object.freeze(entry)
  Object.freeze(state.trail)
  Object.freeze(state)
  trusted.add(state)
  return state
}
function createAtRevision(chapterId, contentRevision) {
  if (!chapterStarts[chapterId]) throw new Error('未知的长篇章节。')
  return seal({ kind: KIND, version: STORY_VERSION, contentRevision, chapterId,
    nodeId: chapterStarts[chapterId], flags: {}, trail: [] })
}
export function createStory({ chapterId = 's01' } = {}) {
  return createAtRevision(chapterId, STORY_CONTENT_REVISION)
}
function transition(state, choiceId = null) {
  const node = nodes.get(state.nodeId)
  if (node.ending) throw new Error('本周目已结束。')
  if (state.trail.length >= MAX_TRAIL) throw new Error('剧情轨迹超出允许长度。')
  let target = node.next
  let flags = { ...state.flags }
  if (node.choices) {
    if (choiceId === null && state.contentRevision === 1 && LEGACY_LINEAR_CHOICE_NODES.has(node.id)) {
      // A previously saved run passed straight through this dialogue line.
      // It resumes on the same successor and gains no evidence/consent flag.
    } else {
      const selected = node.choices.find(option => option.id === choiceId)
      if (!selected) throw new Error('请从当前选项中选择。')
      Object.assign(flags, selected.flags)
      target = typeof selected.next === 'function' ? selected.next(flags) : selected.next
    }
  } else if (choiceId !== null) throw new Error('当前段落没有选项。')
  if (!nodes.has(target)) throw new Error('剧情目标不存在。')
  Object.assign(flags, nodes.get(target).enterFlags || {})
  return seal({ ...state, flags, nodeId: target, trail: [...state.trail, { nodeId: node.id, choiceId }] })
}
const canonical = object => JSON.stringify(Object.keys(object).sort().map(key => [key, object[key]]))
export function normalizeStory(raw) {
  if (raw && trusted.has(raw)) return raw
  if (!raw || raw.kind !== KIND || raw.version !== STORY_VERSION || ![1, STORY_CONTENT_REVISION].includes(raw.contentRevision)) throw new Error('不支持的长篇存档版本。')
  if (!Array.isArray(raw.trail) || raw.trail.length > MAX_TRAIL || !raw.flags || typeof raw.flags !== 'object' || Array.isArray(raw.flags)) throw new Error('长篇存档结构不正确。')
  let state = createAtRevision(raw.chapterId, raw.contentRevision)
  for (const entry of raw.trail) {
    if (!entry || entry.nodeId !== state.nodeId || !(entry.choiceId === null || typeof entry.choiceId === 'string')) throw new Error('剧情轨迹不连续。')
    state = transition(state, entry.choiceId)
  }
  if (state.nodeId !== raw.nodeId || canonical(state.flags) !== canonical(raw.flags)) throw new Error('存档条件与重放轨迹不一致。')
  return state
}
function visible(state) {
  const node = nodes.get(state.nodeId)
  return { id: node.id, chapterId: node.chapterId, sceneId: node.sceneId, routeId: node.routeId || null,
    speaker: node.speaker, speakerName: node.speaker === 'player' ? '临' : STORY_CHARACTERS[node.speaker] || '',
    text: textFor(node.text, state.flags), location: node.location, time: node.time,
    backgroundId: node.backgroundId, description: node.description, musicTheme: node.musicTheme,
    emotion: node.emotion || node.stageCharacters?.find(item => item.speaker === node.speaker)?.emotion || 'neutral',
    stageCharacters: (node.stageCharacters || []).map(item => ({ ...item })),
    ...(node.choices ? { choices: node.choices.map(({ id, text }) => ({ id, text })) } : {}),
    ...(node.ending ? { ending: { ...node.ending, epilogue: [...node.ending.epilogue], relationshipEpilogues: SIDE_ROUTES.filter(route => state.flags[route.flag]).map(route => ({ id: route.id, title: route.title, description: '这段同行已亲自完成；其中保留的决定，成为以后继续相处的起点。' })) } } : {}),
  }
}
export const currentStoryNode = raw => visible(normalizeStory(raw))
export const advanceStory = (raw, choiceId = null) => transition(normalizeStory(raw), choiceId)
export function storyHistory(raw) {
  const final = normalizeStory(raw)
  if (histories.has(final)) return histories.get(final)
  let state = createAtRevision(final.chapterId, final.contentRevision)
  const result = []
  for (const entry of final.trail) {
    const node = visible(state)
    result.push(node)
    if (entry.choiceId !== null) result.push({ ...node, id: `${node.id}:${entry.choiceId}`, speaker: 'player', speakerName: '临', text: node.choices.find(option => option.id === entry.choiceId).text })
    state = transition(state, entry.choiceId)
  }
  result.push(visible(state))
  const history = Object.freeze(result.map(node => Object.freeze(node)))
  histories.set(final, history)
  return history
}

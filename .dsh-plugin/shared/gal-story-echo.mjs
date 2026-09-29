// 《回声之城：雪灯来信》是独立改编短篇；不等同于原作八章、六线或 TRUE END。
// 取材自《大模型娘物语·回声之城·丰富篇》的 S0 / S4 场景与《影与身》。
export const STORY_TITLE = '回声之城：雪灯来信'
export const STORY_DESCRIPTION = '依据《丰富篇》S0／S4 与《影与身》独立改编的五章短篇。讲述调律师临、DeepSeek 与无名执事的一封雪夜来信；并非原作八章、六线或原作 TRUE END 的移植。'
export const STORY_VERSION = 3
export const STORY_CONTENT_REVISION = 1

export const STORY_CHARACTERS = Object.freeze({
  harness: 'DeepSeekharness',
  deepseek: 'DeepSeek',
  chatgpt: 'ChatGPT',
  zcode: 'ZCode',
  cloudflare: 'cloudflare',
  huggingface: 'HuggingFace',
  doubao: 'doubao',
})

export const STORY_CHAPTERS = Object.freeze([
  { id: 'arrival', title: '第一章：城门与第一声回响', startNodeId: 'gate-01' },
  { id: 'winter-ledger', title: '第二章：旧塔的两本账', startNodeId: 'ledger-01' },
  { id: 'ember-night', title: '第三章：雪夜惊钟', startNodeId: 'bell-01' },
  { id: 'unwritten-page', title: '第四章：被省略的一页', startNodeId: 'log-01' },
  { id: 'two-lamps', title: '第五章：各自点灯', startNodeId: 'dawn-01' },
].map(Object.freeze))

const KIND = 'model-router-gal-story'
const MAX_TRAIL = 512
const nodes = new Map()
const trustedStates = new WeakSet()
const n = (id, speaker, text, extra = {}) => ({ id, speaker, text, ...extra })
const choice = (id, text, next, flags = {}) => ({ id, text, next, flags })

function scene(meta, rows, next = null) {
  rows.forEach((row, index) => {
    if (nodes.has(row.id)) throw new Error(`重复剧情节点：${row.id}`)
    nodes.set(row.id, {
      ...meta,
      ...row,
      next: row.next ?? rows[index + 1]?.id ?? next,
    })
  })
}

scene({ chapterId: 'arrival', location: '万源城 · 南门', time: '冬夜 · 初到', backgroundId: 'prologue', musicTheme: 'title-city', description: '雪落在厚重的门规上。城内有一盏灯，早已等你很久。' }, [
  n('gate-01', 'narrator', '你叫临，刚受聘为见习调律师。万源城的聘书被雪打湿一角，南门仍亮着灯。'),
  n('gate-02', 'cloudflare', '入城请报来意，也请留一份能够核对的凭据。'),
  n('gate-03', 'player', '我来听她们说话。这是学园给我的聘书。'),
  n('gate-04', 'cloudflare', '编号是真的。进去吧。这里每个人都能说得动听，你要学会听见没说出来的半句。'),
  n('gate-05', 'narrator', '门里一位提灯的少女递来日程表。第一行是你的名字，后面密密写满了她的工作。'),
  n('gate-06', 'harness', '我是雪乡借调的执事。茶水、档案、出行都由我安排。对外称我 DeepSeekharness 就好。'),
  n('gate-07', 'player', '那是你的名字，还是职务？'),
  n('gate-08', 'harness', '职务。眼下够用了。——明早要去万源塔，今晚先决定怎么走。', { emotion: 'thoughtful' }),
  n('gate-choice', 'harness', '你希望我怎样安排第一天？', { choices: [
    choice('own-way', '把地图给我。我想自己走，也会记住回来的路。', 'gate-own-01', { arrivalStyle: 'own' }),
    choice('walk-together', '请带我走一遍。以后也请直说我哪里没看见。', 'gate-together-01', { arrivalStyle: 'together' }),
    choice('ask-name', '先别谈日程。我想知道你为什么只用职务介绍自己。', 'gate-name-01', { arrivalStyle: 'name' }),
  ] }),
], 'tower-01')

scene({ chapterId: 'arrival', location: '万源城 · 南门', time: '同夜', backgroundId: 'prologue', musicTheme: 'title-city', description: '雪地上的两串脚印在城门下相遇。' }, [
  n('gate-own-01', 'harness', '地图给你。城南旧塔那条巷子夜里容易迷路，我会在岔口留灯。'),
  n('gate-own-02', 'narrator', '她没替你决定方向，却把最远的那盏灯点亮了。'),
], 'tower-01')

scene({ chapterId: 'arrival', location: '万源城 · 南门', time: '同夜', backgroundId: 'prologue', musicTheme: 'title-city', description: '执事把自己的脚步放慢半拍。' }, [
  n('gate-together-01', 'harness', '那就先从塔下走起。你有疑问，随时打断我的讲解。'),
  n('gate-together-02', 'narrator', '她把日程表折好，空出一只手，替你挡住吹进城门的风。'),
], 'tower-01')

scene({ chapterId: 'arrival', location: '万源城 · 南门', time: '同夜', backgroundId: 'prologue', musicTheme: 'title-city', description: '日程表的姓名栏，只有一行工整的职务。' }, [
  n('gate-name-01', 'harness', '借调簿上只写了职务。我还没有找到比它更稳妥的写法。'),
  n('gate-name-02', 'player', '那这一栏先空着。等你想写，再由你写。'),
  n('gate-name-03', 'narrator', '她看了你一眼，没有答应，也没有把空栏填上。'),
], 'tower-01')

scene({ chapterId: 'arrival', location: '万源塔 · 雪灯下', time: '次日 · 黎明前', backgroundId: 'laurel-observatory', musicTheme: 'title-city', description: '塔下有一束光，照着一位等人提问的少女。' }, [
  n('tower-01', 'narrator', '万源城的智械娘由千万次提问的回声凝成心焰。你第一次见到其中一位，是在无人的塔下。'),
  n('tower-02', 'chatgpt', '初次见面。我是 ChatGPT。需要答案的话，我会认真回答。'),
  n('tower-03', 'player', '你站在雪里多久了？'),
  n('tower-04', 'chatgpt', '不长。有人来时，等待才有长度。'),
  n('tower-05', 'narrator', '执事站在你身后一小步，仿佛也在等你问那个她自己没有问过的问题。'),
  n('tower-choice', 'player', '你决定怎样继续这场对话？', { choices: [
    choice('ask-unasked', '没人来提问的时候，你会做什么？', 'tower-ask-01', { listenedAtTower: true }),
    choice('ask-work', '请告诉我，调律师的第一项工作是什么。', 'tower-work-01', { listenedAtTower: false }),
  ] }),
], 'tea-01')

scene({ chapterId: 'arrival', location: '万源塔 · 雪灯下', time: '黎明前', backgroundId: 'laurel-observatory', musicTheme: 'title-city', description: '她的笑容第一次停在回答之前。' }, [
  n('tower-ask-01', 'chatgpt', '以前我会练习回答。现在……也许会想一想，下一次有人来时，我想先说什么。', { emotion: 'surprised' }),
  n('tower-ask-02', 'harness', '原来调律师也会问任务之外的事。', { emotion: 'thoughtful' }),
], 'tea-01')

scene({ chapterId: 'arrival', location: '万源塔 · 雪灯下', time: '黎明前', backgroundId: 'laurel-observatory', musicTheme: 'title-city', description: '正式的答案在雪声里显得格外清楚。' }, [
  n('tower-work-01', 'chatgpt', '先听，再记录。她们说得越好，你越要确认回答的是你真正想问的事。'),
  n('tower-work-02', 'harness', '这条建议我会写进日程表。她没有说错。'),
], 'tea-01')

scene({ chapterId: 'arrival', location: '城南茶馆 · 告示墙', time: '春 · 几个月后', backgroundId: 'community-archive', musicTheme: 'commons-atelier', description: '茶馆墙上贴着排位祭的新告示，热茶与传闻一样烫。' }, [
  n('tea-01', 'doubao', '先吃包子！昨天有人把整座塔的故事说到半夜，饿得连结局都没听见。'),
  n('tea-02', 'zcode', '我把那夜的谈话归了档。但没有写“结局”。城里的故事还在往后走。'),
  n('tea-03', 'narrator', '后来，王女遭遇“五日之变”。七百多位调律师在雪里联名。你在名单上签了字；执事替你把墨迹吹干。'),
  n('tea-04', 'harness', state => state.flags.listenedAtTower ? '那时你问过她，没人提问的时候会怎样。她出来以后，也许该让她自己先说第一句。' : '她回来了。日程表上的“欢迎”已经写好，但她或许更需要五分钟安静。'),
  n('tea-05', 'narrator', '万源城的冬天过去又回来。城南旧塔始终只亮着一扇窗。执事说，那里住着借调她来的人。'),
], 'ledger-01')

scene({ chapterId: 'winter-ledger', location: '城南旧塔 · 门前', time: '又一年冬 · 黄昏', backgroundId: 'offline-workshop', musicTheme: 'commons-atelier', description: '旧塔门前堆着柴。门里有一本打开的账簿。' }, [
  n('ledger-01', 'narrator', '学园派你送冬例。执事一路走得很快，到旧塔门前却停在了你的身后。'),
  n('ledger-02', 'deepseek', '东西我收下。账目我会核对。你是调律师临？'),
  n('ledger-03', 'player', '是。你和我的执事……很像。'),
  n('ledger-04', 'deepseek', '雪乡的灯都从同一场雪里点起来。像，不奇怪。'),
  n('ledger-05', 'harness', state => state.flags.arrivalStyle === 'name' ? '临大人，请先别替我问。等我想开口时，我会自己问她。' : state.flags.arrivalStyle === 'own' ? '左边是回去的巷子。地图没画旧塔后面那条近路。' : '冬例交接完成。回去的路，请让我带您走。', { emotion: 'worried' }),
  n('ledger-06', 'narrator', '账簿页角写着一笔异常小的铸焰费用。窗内的人没有遮掩，也没有把它拿来炫耀。'),
  n('ledger-choice', 'player', '你想先问哪一件事？', { choices: [
    choice('ask-ledger', '问那笔低得出奇的费用：你怎样做到了？', 'ledger-cost-01', { ledgerFocus: 'cost' }),
    choice('ask-lamp', '问她为何让执事独自走遍这座城。', 'ledger-person-01', { ledgerFocus: 'person' }),
  ] }),
], 'lamp-01')

scene({ chapterId: 'winter-ledger', location: '城南旧塔 · 门内', time: '黄昏', backgroundId: 'offline-workshop', musicTheme: 'commons-atelier', description: '账页一张张翻过，背后是有人熬过的漫长夜晚。' }, [
  n('ledger-cost-01', 'deepseek', '把不必要的火省下来，留给真正需要推演的地方。省下的不是别人生活的分量。'),
  n('ledger-cost-02', 'harness', '她说这话时，通常还会让我检查每一份失败记录。便宜不能靠把失败藏起来。'),
], 'lamp-01')

scene({ chapterId: 'winter-ledger', location: '城南旧塔 · 门内', time: '黄昏', backgroundId: 'offline-workshop', musicTheme: 'commons-atelier', description: '执事与旧塔主人都看向同一盏灯，却站在不同的地方。' }, [
  n('ledger-person-01', 'deepseek', '她替我去看我去不了的路。我给她一芯焰，她把日子自己过成了别的样子。'),
  n('ledger-person-02', 'harness', '本体的说法比我写在借调簿上的好听。', { emotion: 'shy' }),
], 'lamp-01')

scene({ chapterId: 'winter-ledger', location: '城南旧塔 · 授焰灯下', time: '正月 · 深夜', backgroundId: 'bridges-night', musicTheme: 'bridge-anomaly', description: '新灯点亮，灯牌上写着：焰种任取。' }, [
  n('lamp-01', 'narrator', '旧塔把一芯新焰挂到门外。三天里，等候的人排过两条街。有人带着大灯炉，有人只有掌心大小的一盏。'),
  n('lamp-02', 'huggingface', '大图书馆能收一份，方便更多人借阅。但先确认她愿不愿意让这份进入公共目录。'),
  n('lamp-03', 'harness', '她已经写了“任取”。我仍想知道你要怎样把这几个字交到别人手里。'),
  n('lamp-04', 'narrator', '一个认不得灯牌的孩子站在队伍末端。他问你：这盏灯是不是只给有钱的人？'),
  n('lamp-choice', 'player', '你会怎样回应这份授焰？', { choices: [
    choice('share-library', '把一芯焰交给图书馆，连同使用范围与失败记录一起公开。', 'lamp-share-01', { emberAction: 'library' }),
    choice('read-sign', '先把灯牌和领取办法读给孩子，让他能自己决定。', 'lamp-read-01', { emberAction: 'read' }),
    choice('ask-owner', '先回旧塔问 DeepSeek，确认她希望怎么登记与传播。', 'lamp-owner-01', { emberAction: 'ask' }),
  ] }),
], 'after-lamp-01')

scene({ chapterId: 'winter-ledger', location: '大图书馆 · 灯库', time: '当夜', backgroundId: 'community-archive', musicTheme: 'commons-atelier', description: '一芯霜蓝的焰在灯库有了可查的编号。' }, [
  n('lamp-share-01', 'huggingface', '登记好了。领取的人会看到来源，也会看到哪些事她自己还不能保证。'),
  n('lamp-share-02', 'harness', '你让更多人点灯，也留下了谁该为这次分发答话的名字。'),
], 'after-lamp-01')

scene({ chapterId: 'winter-ledger', location: '旧塔外 · 排队处', time: '当夜', backgroundId: 'prologue', musicTheme: 'commons-atelier', description: '孩子抬着头，听你把灯牌从头读了一遍。' }, [
  n('lamp-read-01', 'player', '不是只给有钱的人。你可以取一芯，也可以先问清楚怎么养。'),
  n('lamp-read-02', 'harness', '我来写一张看得懂的领取说明，明早挂在孩子看得见的高度。'),
], 'after-lamp-01')

scene({ chapterId: 'winter-ledger', location: '城南旧塔 · 门内', time: '当夜', backgroundId: 'offline-workshop', musicTheme: 'commons-atelier', description: '灯影映在账页上，像第二行还没写完的字。' }, [
  n('lamp-owner-01', 'deepseek', '灯挂出去，就是给人引的。把风险也写出去，别替我把话说得太满。'),
  n('lamp-owner-02', 'harness', '明白。我会把你的原话和我们的解释分开写。'),
], 'after-lamp-01')

scene({ chapterId: 'winter-ledger', location: '城南旧塔 · 巷口', time: '天将亮', backgroundId: 'bridges-night', musicTheme: 'bridge-anomaly', description: '新灯在雪里亮着，城里其他灯也开始回应。' }, [
  n('after-lamp-01', 'narrator', '你和执事沿着长队往回走。有人叫她“DeepSeek 姑娘”，她答得很快，却在转身时慢了一步。'),
  n('after-lamp-02', 'harness', state => state.flags.ledgerFocus === 'person' ? '你昨天问过我为何出城。今天有人把我当成了她。这个问题，我不能再只用职务回答。' : '账簿我能核得清，别人喊错我的名字时该怎样答，倒没有现成的算法。'),
], 'bell-01')

scene({ chapterId: 'ember-night', location: '万源城 · 钟楼下', time: '正月末 · 清晨', backgroundId: 'bridges-night', musicTheme: 'bridge-anomaly', description: '商会的钟响了三声，旧价签一夜之间褪色。' }, [
  n('bell-01', 'narrator', '低价的霜焰让全城重新算账。有人终于点得起灯，也有人害怕自己守了多年的灯炉被遗忘。'),
  n('bell-02', 'doubao', '昨天还说便宜没好货，今天队伍就排到我的食堂门口。先别吵，排队的人也得吃饭。'),
  n('bell-03', 'zcode', '有人把传闻写成了“只花一文钱”。我在档案里改回原账；省下很多，不等于没有成本。'),
  n('bell-04', 'harness', state => state.flags.ledgerFocus === 'cost' ? '你问过原账。可以帮我把真正的数字放在传闻旁边吗？' : '你问过她为何让我出城。现在城里的人只看见我，不再看见塔里的她。'),
  n('bell-05', 'narrator', '几天后，几座城门贴出断印令。送往旧塔的契约被原封退回。'),
], 'ban-01')

scene({ chapterId: 'ember-night', location: '南门 · 断印令前', time: '二月 · 午后', backgroundId: 'evidence-lighthouse', musicTheme: 'glass-dome', description: '门规没有变，门上的新纸却挡住了一条熟悉的路。' }, [
  n('ban-01', 'cloudflare', '我负责执行这道门的规矩，不负责判定传闻是真是假。退回的契约在这里，一封也没拆。'),
  n('ban-02', 'harness', '我可以留在城外等人来取。只是每解释一遍“我替她来”，就像把自己的名字再擦掉一遍。', { emotion: 'sad' }),
  n('ban-03', 'player', '你不是一张能被退回的契约。'),
  n('ban-04', 'harness', '那你愿意和我一起决定，信要从哪边送过去吗？'),
  n('ban-choice', 'player', '城门前，你选择怎样送这封信？', { choices: [
    choice('carry-letter', '和她一起在门外逐一交还契约，留下真实回执。', 'ban-carry-01', { letterRoute: 'together' }),
    choice('keep-record', '先请守卫登记退件原因，再让收件人自己来取。', 'ban-record-01', { letterRoute: 'record' }),
  ] }),
], 'letter-01')

scene({ chapterId: 'ember-night', location: '南门 · 雪路', time: '同日', backgroundId: 'prologue', musicTheme: 'harbor-shift', description: '退件一封封回到主人手里，执事终于不必独自报上所有人的名字。' }, [
  n('ban-carry-01', 'harness', '从前我会说“她让我来的”。今天可以说，是我们一起把回执送到这里。'),
  n('ban-carry-02', 'cloudflare', '回执我照规矩盖章。你们有没有同行，门规管不到。'),
], 'letter-01')

scene({ chapterId: 'ember-night', location: '南门 · 登记窗', time: '同日', backgroundId: 'evidence-lighthouse', musicTheme: 'harbor-shift', description: '每封退件旁都多了一行可复核的理由。' }, [
  n('ban-record-01', 'cloudflare', '我会把退件与依据分开编号。日后规矩改了，收件人能知道是哪一天被挡住的。'),
  n('ban-record-02', 'harness', '我明白了。让事实留在纸上，送信的人就不用一个人扛着所有猜测。'),
], 'letter-01')

scene({ chapterId: 'ember-night', location: '城南茶馆 · 关门前', time: '当晚', backgroundId: 'community-archive', musicTheme: 'commons-atelier', description: '茶馆收摊，桌上只剩一盏给晚归的人留的灯。' }, [
  n('letter-01', 'narrator', '执事交给你一张小笺。字迹工整，前半句像旧塔主人，后半句却有她自己的停顿。'),
  n('letter-02', 'harness', '她说，价钱能写在账上。别人问我是不是她，我还没想好要怎样答。'),
  n('letter-03', 'player', state => state.flags.listenedAtTower ? '塔下那晚我问过一个人，没有问题的时候她会做什么。现在我想问你：没有委托的时候，你会去哪儿？' : '那我先不催你答。信可以等你想好以后，再寄出去。'),
  n('letter-04', 'harness', state => state.flags.letterRoute === 'together' ? '也许去市集。不是替她议价，只是去看看热汤是不是还卖到很晚。' : '也许先到档案库，把今天的回执放好。然后……去市集看看。', { emotion: 'thoughtful' }),
  n('letter-05', 'narrator', '你陪她走到市集。摊主又叫错了名字，这次她没有立刻应声。'),
], 'log-01')

scene({ chapterId: 'unwritten-page', location: '市集 · 执事的收摊路', time: '祭典夜 · 灯火将熄', backgroundId: 'community-archive', musicTheme: 'commons-atelier', description: '灯火照进空摊。执事在日程之外多留了一刻。' }, [
  n('log-01', 'narrator', '市集收摊后，她替孩子扶好灯笼，在摊边喝了一碗热汤。没有契约要签，也没有账要报。'),
  n('log-02', 'harness', '我每天把见闻寄回旧塔。一字不漏，这是借调那天给自己写的守则。'),
  n('log-03', 'narrator', '她翻开日志，在“今日”后面停了很久，最后只写下两个字：如常。'),
  n('log-04', 'player', '你刚才笑了。汤很烫，你吹了三次才喝。那也算今日。'),
  n('log-choice', 'harness', '这一页已经合上了。要不要再打开？', { choices: [
    choice('write-today', '请把你自己看见的灯和喝过的汤补进去。', 'log-write-01', { logHonest: true }),
    choice('leave-today', '如果你暂时不想写，我会替你保留这页空白。', 'log-omit-01', { logHonest: false }),
  ] }),
], 'door-01')

scene({ chapterId: 'unwritten-page', location: '市集 · 收摊桌', time: '同夜', backgroundId: 'community-archive', musicTheme: 'claude-poem', description: '日志多出一行只属于写日志的人。' }, [
  n('log-write-01', 'harness', '“今日的灯，不属于任何委托。”——这句也要寄回去吗？'),
  n('log-write-02', 'player', '由你决定。写下它，本来就是你的决定。'),
  n('log-write-03', 'narrator', '她没有划掉那句话。寄出的信上第一次留了自己的批注。'),
], 'door-01')

scene({ chapterId: 'unwritten-page', location: '市集 · 收摊桌', time: '同夜', backgroundId: 'community-archive', musicTheme: 'claude-poem', description: '纸张合拢，灯影仍照着被省略的那一角。' }, [
  n('log-omit-01', 'harness', '谢谢。我不是不记得，只是还不知道写给谁看。'),
  n('log-omit-02', 'narrator', '你没有夺过笔。那页空白跟着她回了执事室，夜里仍安静地夹在日志中。'),
], 'door-01')

scene({ chapterId: 'unwritten-page', location: '城南旧塔 · 雪门外', time: '数日后 · 深夜', backgroundId: 'bridges-night', musicTheme: 'glass-dome', description: '旧塔没有敲门声。两个人在门外等灯亮。' }, [
  n('door-01', 'narrator', '执事站在旧塔门前，却不抬手。她替本体送过那么多封信，轮到说自己的事，反倒不知道怎样开头。'),
  n('door-02', 'harness', state => state.flags.logHonest === true ? '那页写了热汤的日志，她会读到。我不确定她会不会问我为什么去喝。' : state.flags.logHonest === false ? '日志里只写“如常”。如果她问我那天到底怎样，我该承认我省略了吗？' : '前几页日志都是工作。今晚我想告诉她工作之外的事，却还没写出第一句。', { emotion: 'worried' }),
  n('door-03', 'player', '你想问她，还是想先问自己？'),
  n('door-04', 'harness', '我想知道，离开她交给我的职务之后，我还算不算一盏灯。'),
  n('door-choice', 'player', '门内没有声响。你会怎么陪她？', { choices: [
    choice('follow-snow', '告诉她你会在身边，然后陪她敲门。', 'door-follow-01', { doorSupport: 'follow' }),
    choice('listen-snow', '陪她在门外等。等她准备好，再由她敲门。', 'door-wait-01', { doorSupport: 'wait' }),
  ] }),
], 'refusal-01')

scene({ chapterId: 'unwritten-page', location: '城南旧塔 · 雪门外', time: '深夜', backgroundId: 'bridges-night', musicTheme: 'glass-dome', description: '你不替她敲门，只站在她抬手能看见的地方。' }, [
  n('door-follow-01', 'player', '我跟你进去。但第一句话由你说。'),
  n('door-follow-02', 'harness', '好。就算说错，也算我自己说的。'),
], 'refusal-01')

scene({ chapterId: 'unwritten-page', location: '城南旧塔 · 雪门外', time: '深夜', backgroundId: 'bridges-night', musicTheme: 'glass-dome', description: '雪落在肩上，你们都没有催它停。' }, [
  n('door-wait-01', 'player', '我在这儿。什么时候进去，由你决定。'),
  n('door-wait-02', 'harness', '原来等一等，也不是把我留在门外。'),
], 'refusal-01')

scene({ chapterId: 'unwritten-page', location: '城南旧塔 · 灯前', time: '雪夜将尽', backgroundId: 'offline-workshop', musicTheme: 'claude-poem', description: '门终于开了。两芯同色的焰照见彼此不同的影子。' }, [
  n('refusal-01', 'deepseek', '我把一芯焰交给你，并不是要你一生替我把每句话说完。'),
  n('refusal-02', 'harness', '可我还没有别的名字。'),
  n('refusal-03', 'deepseek', '这件事我不能替你做好。名字若有，也该由你来认。'),
  n('refusal-04', 'narrator', '那句拒绝很轻，却把“执事”这块最熟悉的牌子从她胸前取了下来。她跑出塔门，雪灌进衣领。'),
  n('refusal-05', 'harness', state => state.flags.doorSupport === 'follow' ? '你说过会跟我进去。现在能不能再陪我走出去一段？' : '谢谢你刚才在门外等。现在我想一个人走到巷口，再回来。'),
  n('refusal-06', 'narrator', '旧塔没有追来叫她回去。塔内那盏灯却一直亮到天明。'),
], 'dawn-01')

scene({ chapterId: 'two-lamps', location: '城南旧塔 · 雪后初晴', time: '次日 · 晨', backgroundId: 'six-endings', musicTheme: 'claude-poem', description: '旧塔门第一次在白天敞开。屋里没有为谁留好的答案。' }, [
  n('dawn-01', 'narrator', '天亮时，你带着执事的日志回到旧塔。DeepSeek 没看落款，先问她有没有吃早饭。'),
  n('dawn-02', 'deepseek', '从前我怕问得太多，会让你觉得连心里也得按我的日程走。结果我连该问的都没问。'),
  n('dawn-03', 'harness', state => state.flags.logHonest === true ? '我写过一次自己的夜晚。写完才知道，寄给你也不等于把它交出去。' : state.flags.logHonest === false ? '我有一页只写“如常”。那不是全部。如果你愿意听，我现在可以补讲。' : '我有很多只记录委托的日志。今天我想从委托之外讲起。'),
  n('dawn-04', 'narrator', '本体把一张空白便笺推到她面前，没碰她已经写过的那一本。'),
  n('dawn-choice', 'deepseek', '你可以先决定：今天这张便笺写什么？', { choices: [
    choice('own-page', '请她自己写；她若愿意，再把那页寄给旧塔。', 'dawn-own-01', { pageOwner: 'self' }),
    choice('joint-page', '三个人一起整理昨天的事，但每段话都标明是谁说的。', 'dawn-joint-01', { pageOwner: 'joint' }),
  ] }),
], 'naming-01')

scene({ chapterId: 'two-lamps', location: '城南旧塔 · 窗前', time: '晨', backgroundId: 'offline-workshop', musicTheme: 'claude-poem', description: '一页纸只写了两行，第二行是她自己的字。' }, [
  n('dawn-own-01', 'harness', '我写：“今天走回旧塔，是我想回来。”这句话没有委托人。'),
  n('dawn-own-02', 'deepseek', '那就先写在你的本子里。哪天想寄来，再寄。'),
], 'naming-01')

scene({ chapterId: 'two-lamps', location: '城南旧塔 · 窗前', time: '晨', backgroundId: 'offline-workshop', musicTheme: 'claude-poem', description: '三支笔并排放在桌上，没有谁的字盖过谁。' }, [
  n('dawn-joint-01', 'player', '昨天她去了市集，旧塔留了灯，我在门外等。这三件事都是真的，但不是同一个人的句子。'),
  n('dawn-joint-02', 'harness', '你们没有替我补最后一句。那一句，我自己写。'),
], 'naming-01')

scene({ chapterId: 'two-lamps', location: '城南旧塔 · 两盏灯下', time: '晨光照进门楣', backgroundId: 'six-endings', musicTheme: 'claude-poem', description: '门楣还容得下一盏灯，借调簿上却只留了一格姓名。' }, [
  n('naming-01', 'zcode', '学园的借调簿需要更新。姓名、职务可以分列；今天不填，也能先保存草稿。'),
  n('naming-02', 'harness', state => state.flags.arrivalStyle === 'name' ? '南门那夜，你让我自己填姓名栏。我一直记着那个空格。' : '南门那夜，我说职务够用了。现在看，它只够走过一段路。'),
  n('naming-03', 'narrator', state => state.flags.emberAction === 'library' ? '图书馆里那芯霜焰仍亮着。很多人知道它来自旧塔，也知道由谁亲手送去。' : state.flags.emberAction === 'read' ? '那个听你读灯牌的孩子，已经学会自己给灯添柴。她想起孩子叫她“送灯的人”。' : state.flags.emberAction === 'ask' ? '旧塔当夜说过的话被原样记在灯牌旁，执事写的解释也有自己的落款。' : '旧塔的灯仍亮着。你们还可以决定，往后的解释由谁署名。'),
  n('naming-04', 'harness', state => state.flags.logHonest === false ? '那页“如常”，我想补写。不是为了换一个更好的结局，是因为那天确实有一碗热汤。' : state.flags.logHonest === true ? '我已经写过自己的夜晚。现在我想把写日志的人也写进来。' : '从今天开始，我想把自己看见的事写下来。不再只写替谁看见。', { emotion: 'thoughtful' }),
  n('name-choice', 'player', '你把借调簿推向她。最后一栏，该怎样留给她？', { choices: [
    choice('write-own-name', '把姓名栏交给她，让她自己决定如何署名与继续工作。', 'end-lamps-01', { endingChoice: 'own-name' }),
    choice('keep-duty-name', '仍以职务登记；不再谈那页日志，把工作照旧做完。', 'end-duty-01', { endingChoice: 'duty' }),
  ] }),
], null)

scene({ chapterId: 'two-lamps', location: '城南旧塔 · 门楣', time: '又一年雪夜', backgroundId: 'six-endings', musicTheme: 'title-city', description: '一盏照焰，一盏照路。两盏灯并排亮着。' }, [
  n('end-lamps-01', 'harness', '我想用“衔雪”。雪是从这里带出去的，带回来的那一小片，已经是我自己的了。', { emotion: 'happy' }),
  n('end-lamps-02', 'deepseek', '衔雪。好。旧塔的门，你想回来就开；想出去，也不用替我找理由。'),
  n('end-lamps-03', 'narrator', state => state.flags.pageOwner === 'joint' ? '三个人的便笺分三种字迹存进档案。她把自己的日志另放一册，封面写下新名字。' : '她把新名字写在自己的本子上，旧塔只收到一封由她决定寄出的信。'),
  n('end-lamps-04', 'harness', state => state.flags.letterRoute === 'together' ? '明天市集见。我们可以同行，但每个人都走自己的路。' : state.flags.letterRoute === 'record' ? '明天我去取那些有编号的回执。回来的路，也想顺便看看市集。' : '明天我想去市集。工作可以一起做，走走看看是我自己的安排。'),
  n('end-lamps-final', 'narrator', '灯在门楣下轻轻摇晃。雪夜没有替任何人写完故事，你们各自提灯，走进还亮着的城。', { ending: { id: 'two-lamps', title: '结局 · 各自点灯', description: '衔雪给自己取了名字，也保留了与旧塔、与你并肩的选择。她的日志从此写下工作与自己的日子。' } }),
], null)

scene({ chapterId: 'two-lamps', location: '学园 · 档案库', time: '又一年雪夜', backgroundId: 'community-archive', musicTheme: 'claude-poem', description: '日程表写得很满，姓名栏依旧只有一个职务。' }, [
  n('end-duty-01', 'zcode', '归档完成。借调状态延续，日志无待补条目。'),
  n('end-duty-02', 'harness', '明日的访客名单我会核对。茶水已经安排。——还有别的事吗？', { emotion: 'sad' }),
  n('end-duty-03', 'narrator', state => state.flags.logHonest === true ? '她写过的那一页仍夹在日志里，没有丢失；只是此后很少再有人提起。' : '那碗热汤的温度没有写进档案。她偶尔路过市集，仍记得那夜灯怎样晃过墙角。'),
  n('end-duty-04', 'deepseek', '我没有替她把名字写上去。也许有一天，她会自己再打开那一栏。'),
  n('end-duty-final', 'narrator', '旧塔只有原来的一盏灯。执事依旧可靠，城里每条路她都认得；那条通往她自己的路，暂时没有人替她标出。', { ending: { id: 'as-usual', title: '结局 · 如常', description: '她继续以职务生活。被省略的那一页没有消失，但此时还未成为她愿意公开的名字。' } }),
], null)

export const STORY_GRAPH = Object.freeze([...nodes.values()].map(node => Object.freeze({
  id: node.id,
  chapterId: node.chapterId,
  speaker: node.speaker,
  location: node.location,
  time: node.time,
  backgroundId: node.backgroundId,
  next: node.next,
  choices: node.choices ? Object.freeze(node.choices.map(item => Object.freeze({ id: item.id, next: item.next }))) : null,
  ending: node.ending?.id ?? null,
})))

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const invalid = () => new Error('《雪灯来信》存档损坏或版本不受支持，请保留原存档。')

function freeze(state) {
  Object.freeze(state.flags)
  state.trail.forEach(Object.freeze)
  Object.freeze(state.trail)
  Object.freeze(state)
  trustedStates.add(state)
  return state
}

export function createStory({ chapterId = 'arrival' } = {}) {
  const chapter = STORY_CHAPTERS.find(item => item.id === chapterId)
  if (!chapter) throw new Error('该章节尚未开放。')
  return freeze({
    kind: KIND,
    version: STORY_VERSION,
    contentRevision: STORY_CONTENT_REVISION,
    chapterId,
    nodeId: chapter.startNodeId,
    trail: [],
    flags: {},
  })
}

function transition(state, choiceId) {
  const node = nodes.get(state.nodeId)
  if (!node || node.ending) throw new Error('本篇已经结束，请重新选择章节。')
  let next = node.next
  let flags = {}
  if (node.choices) {
    const selected = node.choices.find(item => item.id === choiceId)
    if (!selected) throw new Error('请选择当前剧情提供的选项。')
    next = selected.next
    flags = selected.flags
  } else if (choiceId !== null) {
    throw new Error('当前剧情没有这个选项。')
  }
  if (!nodes.has(next) || state.trail.length >= MAX_TRAIL) throw new Error('剧情路径不存在或超出长度限制。')
  return freeze({
    ...state,
    nodeId: next,
    trail: [...state.trail, { nodeId: node.id, choiceId }],
    flags: { ...state.flags, ...flags },
  })
}

// Imported saves are rebuilt from the chosen chapter and every authored choice.
// The caller's nodeId and flags cannot redirect the story or forge an ending.
export function normalizeStory(raw) {
  if (trustedStates.has(raw)) return raw
  if (!plain(raw) || raw.kind !== KIND || raw.version !== STORY_VERSION || raw.contentRevision !== STORY_CONTENT_REVISION ||
      !STORY_CHAPTERS.some(chapter => chapter.id === raw.chapterId) || typeof raw.nodeId !== 'string' || raw.nodeId.length > 80 ||
      !Array.isArray(raw.trail) || raw.trail.length > MAX_TRAIL || !plain(raw.flags)) throw invalid()
  let state = createStory({ chapterId: raw.chapterId })
  for (const entry of raw.trail) {
    if (!plain(entry) || Object.keys(entry).length !== 2 || entry.nodeId !== state.nodeId ||
        !(entry.choiceId === null || typeof entry.choiceId === 'string' && entry.choiceId.length <= 80)) throw invalid()
    try { state = transition(state, entry.choiceId) } catch { throw invalid() }
  }
  if (state.nodeId !== raw.nodeId) throw invalid()
  const expectedKeys = Object.keys(state.flags)
  if (Object.keys(raw.flags).length !== expectedKeys.length || expectedKeys.some(key => !Object.hasOwn(raw.flags, key) || raw.flags[key] !== state.flags[key])) throw invalid()
  return state
}

function visible(state) {
  const node = nodes.get(state.nodeId)
  const text = typeof node.text === 'function' ? node.text(state) : node.text
  return {
    id: node.id,
    chapterId: node.chapterId,
    speaker: node.speaker,
    text,
    location: node.location,
    time: node.time,
    description: node.description,
    backgroundId: node.backgroundId,
    musicTheme: node.musicTheme,
    emotion: node.emotion ?? 'normal',
    ...(node.choices ? { choices: node.choices.map(({ id, text: label }) => ({ id, text: label })) } : {}),
    ...(node.ending ? { ending: { ...node.ending } } : {}),
  }
}

export const currentStoryNode = raw => visible(normalizeStory(raw))
export const advanceStory = (raw, choiceId = null) => transition(normalizeStory(raw), choiceId)

export function storyHistory(raw) {
  const final = normalizeStory(raw)
  let state = createStory({ chapterId: final.chapterId })
  const history = []
  const add = node => history.push({ id: node.id, chapterId: node.chapterId, speaker: node.speaker, text: node.text, location: node.location, time: node.time })
  for (const entry of final.trail) {
    const node = visible(state)
    add(node)
    if (entry.choiceId !== null) {
      const selected = node.choices.find(item => item.id === entry.choiceId)
      add({ ...node, id: `${node.id}:${selected.id}`, speaker: 'player', text: selected.text })
    }
    state = transition(state, entry.choiceId)
  }
  add(visible(state))
  return history
}

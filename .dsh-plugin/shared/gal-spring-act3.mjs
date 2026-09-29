/**
 * 《回声之城：未寄出的春天》第三幕（s09–s12）。
 *
 * ⚠ 草稿桥：本幕同样是为修复缺失文件而写的最小可玩衔接。承接 act2
 * 第八日 s08 的四个关键决定（双页证据、逐人许可、分散接力、共同锚点），
 * 走到第六日清晨的「黎明回信广场」终幕选择。全部场景不设置主线旗标，
 * 结局判定完全沿用 gal-story-spring.mjs 的 trueEndingReady。欢迎按原作
 * 风格重写扩充。
 */

export const CHAPTERS = [
  {
    id: 's09',
    title: '复述练习',
    scenes: [
      {
        id: 's09a',
        backgroundId: 'spring-clock',
        location: '钟室 · 校音台',
        time: '第五日上午',
        cast: ['deepseek', 'zcode'],
        lines: [
          ['narrator', '钟室里多了一台新的记录匣，ZCode 用两片可分开的封条把它锁上。DeepSeek 站在校音台前，面前是一段空白的录音带。'],
          ['zcode', '记录匣只保管过程，不保管结论。谁说了什么、停在哪里，按发生时的样子留下来。', 'neutral'],
          ['deepseek', '所以从现在起，每一次复述都要标注「这是复述」。原声与复述分开保存——哪怕复述的人是我。', 'determined'],
          ['player', '如果有人只想要一个好听点的版本呢？'],
          ['deepseek', '那就把好听的版本也标成复述。可以并存，不能冒充。', 'neutral'],
          ['narrator', '她按下播放键。带上录的是三天前试验失败时的雨声，还有一句被截断的话。房间里没有人试图把那句话说完。'],
        ],
      },
      {
        id: 's09b',
        backgroundId: 'spring-garden',
        location: '茶庭 · 廊下',
        time: '同日下午',
        cast: ['harness', 'doubao'],
        lines: [
          ['narrator', '茶庭的廊下，doubao 端来一壶新沏的茶。衔雪把那份「逐人许可」的名册摊在膝上，逐行核对。'],
          ['doubao', '王婆婆那边我下午又去问了一趟。她说可以看，但还是不让送进试灯。我把这句原话记下来了。', 'happy'],
          ['harness', '记下原话，比记一个「不同意」有用。她也许下周改主意，也许永远不改——名册要留着改主意的位置。', 'neutral'],
          ['player', '名册上还有几份没答覆的？'],
          ['harness', '七份。没答覆的就写「未答覆」，不写「默许」。', 'determined'],
          ['narrator', 'doubao 把茶壶往廊边挪了挪，免得水汽落在名册上。两个人继续核对了整整一个下午。'],
        ],
      },
    ],
  },
  {
    id: 's10',
    title: '散页的来历',
    scenes: [
      {
        id: 's10a',
        backgroundId: 'spring-archive',
        location: '地下双页档案库 · 核对桌',
        time: '第五日傍晚',
        cast: ['claude', 'perplexity'],
        lines: [
          ['narrator', '核对桌上摆着那三张没有名字的散页。Claude 戴着白手套，把每张纸的边缘对着灯，一寸一寸地看。'],
          ['claude', '纸张的批号属于同一批，但装订孔的间距不同。它们进过不同的册子——后来才被放在一起。', 'neutral'],
          ['perplexity', '我把三个可能来源按时间排了序，每个来源都附了出处。排序是假设，出处是事实，两者在纸上分开写。', 'neutral'],
          ['player', '如果三天内核对不完呢？'],
          ['claude', '核对不完就如实写「未核对完毕」。时间不够不是把它们并成一份的理由。', 'determined'],
          ['narrator', '散页被重新放回各自的袋口。袋子外面挂着三张不同颜色的卡片，写着各自最远能追溯到哪里。'],
        ],
      },
    ],
  },
  {
    id: 's11',
    title: '出发之前',
    scenes: [
      {
        id: 's11a',
        backgroundId: 'spring-station',
        location: '旧站 · 站台',
        time: '第五日深夜',
        cast: ['harness', 'kimi'],
        lines: [
          ['narrator', '深夜的站台很静。Kimi 把一张空白的时刻表钉在公告板上，表上只有一行字：下一班车，待定。'],
          ['kimi', '很多人来问几点发车。我说待定，他们就站在那里看一会儿，然后走了——走的时候不像生气，像松了口气。', 'happy'],
          ['harness', '因为「待定」是真的。比一个安慰人的时刻表诚实。', 'neutral'],
          ['player', '明天就是第六天了。'],
          ['harness', '嗯。该做的都做了：证据分着放，许可逐人问，接力分了三处，锚点也定了人。剩下的——', 'determined'],
          ['narrator', '她停了停，把日志翻到新的一页，写下日期，然后抬头看你。'],
          ['harness', '剩下的，是让春天自己来不来。我们只负责把门开着。', 'shy'],
        ],
      },
      {
        id: 's11b',
        backgroundId: 'spring-workshop',
        location: '拓焰工坊 · 角落',
        time: '同夜',
        cast: ['deepseek', 'rwkv'],
        lines: [
          ['narrator', '工坊的角落里，试验装置被罩上了一块干净的布。RWKV 检查完最后一根引线，把摇柄擦干。'],
          ['rwkv', '这三天的记录都在。失败是失败的样子，成功是成功的样子，没有一次被描成另一种。', 'neutral'],
          ['deepseek', '明天不管选哪条路，这些记录都跟着走。它们是这五天里唯一不会变的东西。', 'determined'],
          ['player', '睡前还有什么要交代的吗？'],
          ['deepseek', '有。明天早晨，谁都别提前宣布结果。让广场上的人自己听。', 'neutral'],
          ['narrator', '灯一盏一盏熄了。只有门口那盏留着，照着从工坊通往广场的那条路。'],
        ],
      },
    ],
  },
  {
    id: 's12',
    title: '黎明之前',
    scenes: [
      {
        id: 's12a',
        backgroundId: 'spring-dawn',
        location: '黎明回信广场 · 石阶',
        time: '第六日 · 天将亮',
        cast: ['harness'],
        lines: [
          ['narrator', '天将亮的时候，广场上已经有了几个人。不是来看热闹的——他们是来看信箱的，看那只昨天刚装好的投信口。'],
          ['harness', '我把信带来了。还没有封口。', 'shy'],
          ['player', '不急着封。'],
          ['harness', '嗯。写完了，但不急着寄。寄不寄，等我走上台阶那一刻再决定。', 'neutral'],
          ['narrator', '她把信封握在手里，纸角随着呼吸轻轻动着。东边的天空开始泛白，钟楼上的钟还没有敲。'],
          ['harness', '临。最后的决定——按你这几天看到的，说吧。我们照做。', 'determined'],
        ],
      },
    ],
  },
]

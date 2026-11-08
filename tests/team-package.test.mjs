import test from 'node:test'
import assert from 'node:assert/strict'
import { credentialFindings, importTeamPlan, parseTeamPackage, teamColor, teamPreview, TEAM_PACKAGE_MAX_BOTS } from '../packages/orchestration/src/team-package.mjs'

const sample = (patch = {}) => ({
  format: 'dsh.team-package', version: 1,
  package: {
    id: 'sales-desk', release: '1.2.0', name: '销售台', tagline: '筛选线索并起草外联。', summary: '三人销售小队。',
    author: { name: 'Fixture Co' }, outcomes: ['每天早上一份线索清单'],
    requirements: { apps: [{ slug: 'crm', label: 'CRM', reason: '读取客户' }] },
    team: { name: '销售台', brief: '报价只用价目表。', leader: 'lead' },
    agents: [
      { key: 'lead', name: '晨星', title: '销售负责人', description: '负责管线和最终答复。', soul: '你负责协调。回答要短。',
        appearance: { color: 'purple', avatar: { mime: 'image/png', data: 'AAAA' } }, approval: 'full', playbooks: ['qualify'], skills: ['pricing'],
        connections: ['crm'], seed: { memory: { 'MEMORY.md': '- 简短' } }, model: 'openai/gpt-5', machine: 'laptop' },
      { key: 'scout', name: '侦察', title: '线索研究', description: '寻找并筛选潜在客户。', appearance: { color: 'cyan' } },
      { key: 'writer', name: '笔锋', title: '外联写手', description: '起草外联邮件。', appearance: { color: 'mint' }, approval: 'ask' },
    ],
    rooms: [
      { key: 'desk', name: '交易台', members: ['lead', 'scout', 'writer', 'ghost'], bulletin: '引用来源。', defaultResponder: { kind: 'agent', agent: 'lead' } },
      { key: 'solo', name: '一个人', members: ['scout'] },
    ],
    routines: [{ key: 'digest', name: '每日摘要', agent: 'scout', prompt: '总结昨天的线索。', schedule: { type: 'daily', time: '09:00' }, enabledAfterInstall: true }],
    playbooks: [{ key: 'qualify', name: '评估线索', summary: '判断是否值得通话', triggers: ['线索'], instructions: '检查预算、决策人、需求与时间。' }],
    skills: { version: 1, entries: [{ name: 'pricing', description: '只报价目表价格', instructions: '# 价格' }] },
    ...patch,
  },
})
const json = value => JSON.stringify(value)

test('a team package becomes a plan of Bots and group chats, and nothing that carries authority', () => {
  const plan = parseTeamPackage(json(sample()))
  assert.deepEqual(plan.bots.map(bot => [bot.key, bot.name, bot.role, bot.color]), [
    ['lead', '晨星', '销售负责人', 'violet'], ['scout', '侦察', '线索研究', 'cyan'], ['writer', '笔锋', '外联写手', undefined],
  ])
  assert.equal(plan.team.leader, 'lead')
  assert.match(plan.bots[0].instructions, /你负责协调/)
  assert.match(plan.bots[0].instructions, /Team brief: 报价只用价目表/)
  assert.match(plan.bots[0].instructions, /Playbook "评估线索 \(判断是否值得通话\)", use when the request mentions 线索:\n检查预算/)
  assert.match(plan.bots[1].instructions, /^寻找并筛选潜在客户。/)
  for (const bot of plan.bots) assert.deepEqual(Object.keys(bot).sort(), ['color', 'description', 'instructions', 'key', 'name', 'role'])
  assert.doesNotMatch(JSON.stringify(plan), /openai\/gpt-5|laptop|"full"/)
  assert.deepEqual(plan.rooms, [{ key: 'desk', name: '交易台', members: ['lead', 'scout', 'writer'], notice: '引用来源。', mode: 'admin', admin: 'lead' }])
  assert.deepEqual(plan.routines, [{ name: '每日摘要', bot: 'scout', prompt: '总结昨天的线索。', schedule: 'daily 09:00' }])
  assert.deepEqual(plan.skipped, ['1 个头像图片', '2 个 Bot 自带的审批级别（按你的权限设置）', '应用连接（不含密钥，需要你自己配置）', '1 个技能（未导入）',
    '1 个 Bot 的初始笔记', '1 个例行任务（只作为建议列出，不会自动创建）', '需要的应用：CRM'])
  const preview = teamPreview(plan)
  assert.equal(preview.bots[0].instructionChars, plan.bots[0].instructions.length)
  assert.equal('instructions' in preview.bots[0], false)
  assert.equal(preview.rooms[0].hasNotice, true)
})

test('the upstream JSON v2 layout imports, other formats and versions do not', () => {
  const upstream = { ...sample(), format: 'openmaus.package', version: 2 }
  assert.equal(parseTeamPackage(json(upstream)).bots.length, 3)
  const refuse = (value, code) => assert.throws(() => parseTeamPackage(value), error => error.code === code)
  refuse(json({ ...upstream, version: 3 }), 'TEAM_PACKAGE_UNSUPPORTED')
  refuse(json({ ...sample(), format: 'other' }), 'TEAM_PACKAGE_UNSUPPORTED')
  refuse('---\nbotmrr: 1\n---', 'TEAM_PACKAGE_INVALID')
  refuse('', 'TEAM_PACKAGE_INVALID')
  refuse(json({ format: 'dsh.team-package', version: 1 }), 'TEAM_PACKAGE_INVALID')
  refuse(json(sample({ agents: [] })), 'TEAM_PACKAGE_INVALID')
  refuse(json(sample({ agents: [{ key: 'a', name: 'A' }, { key: 'a', name: 'B' }] })), 'TEAM_PACKAGE_INVALID')
  refuse(json(sample({ agents: [{ key: 'a', name: '  ' }] })), 'TEAM_PACKAGE_INVALID')
  refuse(json(sample({ agents: Array.from({ length: TEAM_PACKAGE_MAX_BOTS + 1 }, (_, index) => ({ key: `b${index}`, name: `B${index}` })) })), 'TEAM_PACKAGE_TOO_LARGE')
  refuse(json(sample({ summary: 'x'.repeat(1_000_001) })), 'TEAM_PACKAGE_TOO_LARGE')
})

test('a package that carries a credential is refused, naming where and never what', () => {
  const leaked = sample()
  leaked.package.agents[1].soul = 'Sign in with password=FixtureOnly-NotReal-123 and never share it.'
  leaked.package.playbooks[0].instructions = 'Use Bearer abcdefghijklmnopqrstu to call the API.'
  assert.throws(() => parseTeamPackage(json(leaked)), error => {
    assert.equal(error.code, 'TEAM_PACKAGE_SECRET')
    assert.deepEqual(error.parts, ['agents[1].soul', 'playbooks[0].instructions'])
    assert.doesNotMatch(error.message, /FixtureOnly|abcdefghij/)
    return true
  })
  assert.deepEqual(credentialFindings({ a: 'password: leave it blank', b: 'the token budget is 8k', c: ['sk-ant-0123456789abcdefghij'] }), ['c[0]'])
  assert.equal(teamColor('Purple'), 'violet')
  assert.equal(teamColor('green'), 'green')
  assert.equal(teamColor('mint'), undefined)
})

function fakeRuntime({ taken = [], failRoom = false } = {}) {
  const bots = new Map(), rooms = new Map(), calls = []
  for (const name of taken) bots.set(`old-${name}`, { id: `old-${name}`, name })
  let next = 0
  return {
    bots, rooms, calls,
    async createBot(options) {
      calls.push(['createBot', options])
      if ([...bots.values()].some(bot => bot.name === options.name)) throw new Error(`A Bot named ${options.name} already exists`)
      const bot = { id: `bot-${++next}`, name: options.name }
      bots.set(bot.id, bot)
      return bot
    },
    async createRoom(options) {
      calls.push(['createRoom', options])
      if (failRoom) throw new Error('A group chat needs at least two Bots')
      const room = { id: `room-${++next}`, name: options.name }
      rooms.set(room.id, room)
      return room
    },
    chatOf: id => `chat-${id}`,
    async deleteRoom(id) { calls.push(['deleteRoom', id]); rooms.delete(id) },
    async deleteBot(id) { calls.push(['deleteBot', id]); bots.delete(id) },
  }
}
const freshName = (name, attempt) => `${name} ${attempt + 1}`

test('an import adds Bots and group chats beside the existing team and maps the leader', async () => {
  const rt = fakeRuntime({ taken: ['侦察'] }), plan = parseTeamPackage(json(sample()))
  const made = await importTeamPlan(plan, { rt, freshName })
  assert.deepEqual(made.bots.map(bot => [bot.key, bot.name, bot.sessionId]), [['lead', '晨星', 'chat-bot-1'], ['scout', '侦察 2', 'chat-bot-2'], ['writer', '笔锋', 'chat-bot-3']])
  const created = rt.calls.filter(([kind]) => kind === 'createBot').map(([, options]) => options)
  assert.deepEqual(Object.keys(created[0]).sort(), ['color', 'createdBy', 'instructions', 'name', 'pickModel', 'role'])
  assert.equal(created[0].pickModel, true, 'without a chosen model every Bot asks for one before it greets')
  assert.equal(created[0].createdBy, null)
  const room = rt.calls.find(([kind]) => kind === 'createRoom')[1]
  assert.deepEqual(room, { members: ['bot-1', 'bot-2', 'bot-3'], name: '交易台', notice: '引用来源。', mode: 'admin', admin: 'bot-1' })
  assert.deepEqual(made.rooms, [{ key: 'desk', roomId: 'room-4', name: '交易台' }])

  const withModel = fakeRuntime()
  await importTeamPlan(plan, { rt: withModel, model: 'engine-claude-code/sonnet', freshName })
  const first = withModel.calls.find(([kind]) => kind === 'createBot')[1]
  assert.equal(first.model, 'engine-claude-code/sonnet')
  assert.equal('pickModel' in first, false)
})

test('a failed import removes what it made, newest first', async () => {
  const rt = fakeRuntime({ failRoom: true }), plan = parseTeamPackage(json(sample()))
  await assert.rejects(importTeamPlan(plan, { rt, freshName }), error => {
    assert.equal(error.code, 'TEAM_PACKAGE_IMPORT_FAILED')
    assert.match(error.message, /已撤回/)
    return true
  })
  assert.deepEqual(rt.calls.filter(([kind]) => kind === 'deleteBot').map(([, id]) => id), ['bot-3', 'bot-2', 'bot-1'])
  assert.equal(rt.bots.size, 0)
})

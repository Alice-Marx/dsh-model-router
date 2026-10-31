import fs from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import Database from 'better-sqlite3'

const [dir, phase] = process.argv.slice(2)
const target = join(dir, 'project', 'result.txt')
const originalRename = fs.promises.rename
fs.promises.rename = async (oldPath, newPath) => {
  if (newPath === target && phase === 'before-rename') process.exit(86)
  const result = await originalRename(oldPath, newPath)
  if (newPath === target && phase === 'after-rename') process.exit(86)
  return result
}
syncBuiltinESMExports()
const { Agent, TOOL_NAMES } = await import('../../remote-computer-agent/dist/index.mjs')
const agent = new Agent({ dataDir: join(dir, 'agent'), roots: { project: join(dir, 'project') } }, Database)
const pair = agent.store.pair('host', { botIds: ['bot-a'], roots: ['project'], tools: TOOL_NAMES })
const client = agent.store.client(pair.token)
const context = agent.store.grant(agent.store.issue(client, { botId: 'bot-a', taskId: 'task-a', attemptId: 'attempt-a', roots: ['project'], tools: ['fs_write'] }).grantToken)
const oldContent = 'old complete\n', newContent = 'new complete\n'
const expectedHash = createHash('sha256').update(oldContent).digest('hex')
await agent.call('fs_write', { rootId: 'project', relativePath: 'result.txt', content: newContent, expectedHash }, context, 'operation-crash')

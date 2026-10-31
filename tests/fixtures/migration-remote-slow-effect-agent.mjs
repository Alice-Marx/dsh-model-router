import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'
const { Agent, serve, TOOL_NAMES } = await import('../../remote-computer-agent/dist/index.mjs')

const [dir, readyFile] = process.argv.slice(2)
const project = join(dir, 'project')
const agent = new Agent({ dataDir: join(dir, 'agent'), roots: { 'project.v1': project } }, Database)
clearInterval(agent.authTimer)
const execute = agent.execute.bind(agent)
agent.execute = async (name, args, context, signal, pin) => {
  const result = await execute(name, args, context, signal, pin)
  if (name === 'fs_write' && args.relativePath === 'slow.txt') {
    await writeFile(join(dir, 'effect-landed.json'), JSON.stringify({ relativePath: args.relativePath, content: result }))
    while (!existsSync(join(dir, 'release-effect'))) await sleep(20)
  }
  return result
}
const pair = agent.store.pair('host', { botIds: ['bot-a'], roots: ['project.v1'], tools: TOOL_NAMES })
const server = await serve(agent, { port: 0 })
await writeFile(readyFile, JSON.stringify({ pid: process.pid, machineId: pair.machineId, token: pair.token, port: server.address.port }))

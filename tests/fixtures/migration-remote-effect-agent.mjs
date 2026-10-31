import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
const { Agent, serve, TOOL_NAMES } = await import('../../remote-computer-agent/dist/index.mjs')

const [dir, readyFile] = process.argv.slice(2)
const project = join(dir, 'project')
const agent = new Agent({ dataDir: join(dir, 'agent'), roots: { 'project.v1': project } }, Database)
const pair = agent.store.pair('host', { botIds: ['bot-a'], roots: ['project.v1'], tools: TOOL_NAMES })
const server = await serve(agent, { port: 0 })
await writeFile(readyFile, JSON.stringify({ pid: process.pid, machineId: pair.machineId, token: pair.token, port: server.address.port }))

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
const { Agent, serve } = await import('../../remote-computer-agent/dist/index.mjs')

const [dir, readyFile] = process.argv.slice(2)
const project = join(dir, 'project')
const agent = new Agent({ dataDir: join(dir, 'agent'), roots: { 'project.v1': project } }, Database)
const server = await serve(agent, { port: 0 })
await writeFile(readyFile, JSON.stringify({ pid: process.pid, machineId: agent.store.machineId, token: null, port: server.address.port }))

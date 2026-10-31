import { appendFileSync, writeFileSync } from 'node:fs'

const [ready, heartbeat] = process.argv.slice(2)
writeFileSync(ready, JSON.stringify({ pid: process.pid }))
setInterval(() => appendFileSync(heartbeat, `${process.pid}:${Date.now()}\n`), 100)

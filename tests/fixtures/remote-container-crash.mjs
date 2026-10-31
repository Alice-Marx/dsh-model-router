import {readFileSync,writeFileSync} from 'node:fs'
import Database from 'better-sqlite3'
import {Agent,serve} from '../../remote-computer-agent/dist/index.mjs'
const [configFile,readyFile,gateFile,phase]=process.argv.slice(2)
const pause=()=>{writeFileSync(gateFile,'owned fixture phase reached',{mode:0o600});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000)}
class HookedDatabase extends Database{
 prepare(sql){const statement=super.prepare(sql),run=statement.run.bind(statement)
  const match=phase==='prepared'&&sql.includes('INSERT INTO container_workers')||phase==='created'&&sql.includes("phase='created'")||phase==='starting'&&sql.includes("phase='starting'")||phase==='before-receipt-commit'&&sql.includes("phase='settled'")
  if(match)statement.run=(...args)=>{const value=run(...args);pause();return value}
  return statement
 }
 transaction(fn){const wrapped=super.transaction(fn);if(phase!=='after-receipt-commit')return wrapped;return (...args)=>{const result=wrapped(...args);if(this.prepare("SELECT 1 FROM container_workers WHERE phase='settled' LIMIT 1").get())pause();return result}}
}
const agent=new Agent(JSON.parse(readFileSync(configFile,'utf8')),HookedDatabase),server=await serve(agent,{port:0})
writeFileSync(readyFile,JSON.stringify({port:server.address.port}),{mode:0o600})

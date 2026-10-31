import fs from 'node:fs'
import {join} from 'node:path'
import {syncBuiltinESMExports} from 'node:module'
import Database from 'better-sqlite3'
const [directory,name]=process.argv.slice(2),original=fs.readFileSync,lock=join(directory,'agent.lock'),pause=join(directory,'release-'+name)
fs.readFileSync=function(path,...args){const value=original.call(this,path,...args);if(path===lock){fs.writeFileSync(join(directory,'read-'+name),'read stale PID');while(!fs.existsSync(pause))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20)}return value}
syncBuiltinESMExports()
const {Store}=await import('../../remote-computer-agent/dist/index.mjs')
let store
try{store=new Store(directory,Database);fs.writeFileSync(join(directory,'result-'+name+'.json'),JSON.stringify({acquired:true}));const timer=setInterval(()=>{if(fs.existsSync(join(directory,'stop-'+name))){clearInterval(timer);try{store.close()}catch{};process.exit(0)}},20)}catch(error){fs.writeFileSync(join(directory,'result-'+name+'.json'),JSON.stringify({acquired:false,code:error.code}));process.exitCode=0}

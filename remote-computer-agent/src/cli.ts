#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { Agent } from './agent.js'
import { Store } from './store.js'
import { serve } from './transport.js'
import { fail } from './protocol.js'
const [command,configPath,...args]=process.argv.slice(2)
try{
  if(!configPath)fail('USAGE: dsh-remote-agent init|serve|pair|rotate|revoke <config.json> [clientId ceiling.json]')
  const file=resolve(configPath)
  if(command==='init'){
    const root=resolve(args[0]??'.');const config={dataDir:join(dirname(file),'data'),roots:{project:root},isolation:'application',network:{mode:'loopback',host:'127.0.0.1',port:9701},executables:{node:process.execPath},browserOrigins:[]}
    await mkdir(dirname(file),{recursive:true,mode:0o700});await writeFile(file,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({configured:file,next:'Run pair with an explicit Bot/tool/root ceiling, then serve.'}))
  }else{
    const config=JSON.parse(await readFile(file,'utf8'))
    if(command==='serve'){
      const agent=new Agent(config);let handle:any;try{handle=await serve(agent,config.network)}catch(e){await agent.close();throw e}
      console.log(JSON.stringify({machineId:agent.store.machineId,listening:handle.address,protocols:handle.supportedMcpVersions}));let stopping=false
      const stop=async()=>{if(stopping)return;stopping=true;await handle.close();await agent.close()};process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop())
    }else{
      const store=new Store(config.dataDir,undefined,{admin:true});try{let result:any;if(command==='pair'){const ceiling=JSON.parse(await readFile(resolve(args[1]),'utf8'));for(const root of ceiling.roots??[])if(!config.roots[root])fail('UNKNOWN_ROOT');result=store.pair(args[0],ceiling)}else if(command==='rotate')result=store.rotate(args[0]);else if(command==='revoke'){store.revoke(args[0]);result={revoked:true}}else fail('UNKNOWN_COMMAND');console.log(JSON.stringify(result))}finally{store.close()}
    }
  }
}catch(e:any){console.error(e.code??'AGENT_START_FAILED');process.exitCode=1}

#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { Agent } from './agent.js'
import { Store } from './store.js'
import { serve } from './transport.js'
import { fail } from './protocol.js'
import { writePairingPage } from './pairing-page.js'
const [command,configPath,...args]=process.argv.slice(2)
try{
  if(!configPath)fail('USAGE: dsh-remote-agent init|serve|identity|devices|invite|invite-page|pair|rotate|revoke <config.json> [clientId ceiling.json endpoint page.html]')
  const file=resolve(configPath)
  if(command==='init'){
    const root=resolve(args[0]??'.');const config={dataDir:join(dirname(file),'data'),roots:{project:root},isolation:'application',network:{mode:'loopback',host:'127.0.0.1',port:9701},executables:{node:process.execPath},browserOrigins:[]}
    await mkdir(dirname(file),{recursive:true,mode:0o700});await writeFile(file,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({configured:file,next:'Run pair with an explicit Bot/tool/root ceiling, then serve.'}))
  }else{
    const config=JSON.parse(await readFile(file,'utf8'))
    if(command==='serve'){
      let invitation:any
      if(args.length){
        if(args[0]!=='--invite'||args.length!==4)fail('USAGE: serve <config.json> --invite <clientId> <ceiling.json> <endpoint>')
        const local=new Store(config.dataDir,undefined,{admin:true})
        try{const ceiling=JSON.parse(await readFile(resolve(args[2]),'utf8'));for(const root of ceiling.roots??[])if(!config.roots[root])fail('UNKNOWN_ROOT');invitation=local.invite(args[1],ceiling,{endpoint:args[3]})}finally{local.close()}
      }
      const agent=new Agent(config);let handle:any;try{handle=await serve(agent,config.network)}catch(e){await agent.close();throw e}
      console.log(JSON.stringify({machineId:agent.store.machineId,listening:handle.address,protocols:handle.supportedMcpVersions}));if(invitation)console.log(JSON.stringify(invitation));let stopping=false
      const stop=async()=>{if(stopping)return;stopping=true;await handle.close();await agent.close()};process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop())
    }else{
      const store=new Store(config.dataDir,undefined,{admin:true})
      try{
        let result:any
        if(['pair','invite','invite-page'].includes(command)){
          if(!args[0]||!args[1]||command==='invite-page'&&!args[3])fail('PAIRING_ARGUMENTS_REQUIRED')
          const ceiling=JSON.parse(await readFile(resolve(args[1]),'utf8'));for(const root of ceiling.roots??[])if(!config.roots[root])fail('UNKNOWN_ROOT')
          result=command==='pair'?store.pair(args[0],ceiling):store.invite(args[0],ceiling,{endpoint:args[2]})
          if(command==='invite-page')result=await writePairingPage(result,args[3])
        }else if(command==='identity')result={machineId:store.machineId,transport:store.pairing.identity()}
        else if(command==='devices')result={machineId:store.machineId,devices:store.db.prepare('SELECT id,revision,revoked,ceiling FROM clients ORDER BY id').all().map((row:any)=>({clientId:row.id,revision:row.revision,revoked:!!row.revoked,ceiling:JSON.parse(row.ceiling)}))}
        else if(command==='rotate')result=store.rotate(args[0])
        else if(command==='revoke'){store.revoke(args[0]);result={revoked:true}}
        else fail('UNKNOWN_COMMAND')
        console.log(JSON.stringify(result))
      }finally{store.close()}
    }
  }
}catch(e:any){console.error(e.code??'AGENT_START_FAILED');process.exitCode=1}

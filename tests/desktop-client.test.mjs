import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
await mkdir(resolve('tmp/integration/desktop-client'),{recursive:true})
const dir=await mkdtemp(resolve('tmp/integration/desktop-client/case-')),entry=join(dir,'client.mjs'),secret=join(dir,'fixture.secret')
await writeFile(secret,'offline-desktop-fixture-token-'.repeat(2))
await build({entryPoints:['remote-computer-agent/src/desktop.ts'],outfile:entry,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'})
const {DesktopTools}=await import(pathToFileURL(entry))
const helper='1'.repeat(32),cfg={pipeName:'dsh-desktop-fixture',secretFile:secret}
const context=()=>({clientId:'client',botId:'bot',taskId:'task',attemptId:'attempt',revision:1,expiresAt:Date.now()+60000,grantId:'grant',roots:[],tools:[]})
const reply=(socket,value)=>queueMicrotask(()=>socket.emit('data',Buffer.from(JSON.stringify({protocolVersion:2,...value})+'\n')))
function transport(handle){
  const packets=[]
  const connect=pipe=>{
    const socket=new EventEmitter();socket.closed=false
    socket.destroy=()=>{if(!socket.closed){socket.closed=true;queueMicrotask(()=>socket.emit('close'))}}
    socket.write=value=>{const packet=JSON.parse(value);packets.push(packet);handle(socket,packet,pipe)}
    queueMicrotask(()=>socket.emit('connect'));return socket
  }
  return{connect,packets}
}
const normal=(socket,packet)=>reply(socket,{ok:true,result:packet.name==='probe'?{protocolVersion:2,helperInstanceId:helper}:packet.name==='cancel'?{helperInstanceId:helper,stopConfirmed:true}:{completed:true}})

test('desktop client: protocol probe is mandatory and a legacy helper never receives input',async()=>{
  const peer=transport((socket,packet)=>reply(socket,{protocolVersion:1,ok:true,result:{completed:true}})),client=new DesktopTools(cfg,{connect:peer.connect,timeoutMs:50})
  await assert.rejects(client.run('desktop_type',{text:'fixture'},context()),e=>e.code==='DESKTOP_PROTOCOL_UNSUPPORTED'&&e.possiblyApplied===false)
  assert.deepEqual(peer.packets.map(p=>p.name),['probe']);await client.close()
})
test('desktop client: model arguments cannot overwrite the authenticated envelope or owner tag',async()=>{
  const peer=transport(normal),client=new DesktopTools(cfg,{connect:peer.connect}),c=context()
  await client.run('desktop_type',{text:'fixture',owner:'forged',token:'forged',helperInstanceId:'forged',protocolVersion:1},c)
  const input=peer.packets.find(p=>p.name==='desktop_type')
  assert.match(input.owner,/^[a-f0-9]{64}$/);assert.notEqual(input.owner,'forged');assert.equal(input.helperInstanceId,helper);assert.equal(input.protocolVersion,2);assert.notEqual(input.token,'forged');assert.equal(input.args.owner,'forged')
  await client.close()
})
test('desktop client: cancellation before preparation sends no IPC packet',async()=>{
  const peer=transport(normal),client=new DesktopTools(cfg,{connect:peer.connect}),controller=new AbortController();controller.abort()
  await assert.rejects(client.run('desktop_type',{text:'fixture'},context(),controller.signal),e=>e.code==='DESKTOP_CANCELLED'&&e.stopConfirmed===true&&e.possiblyApplied===false)
  assert.equal(peer.packets.length,0);await client.close()
})
test('desktop client: a live authority change at the final write gate refuses all input',async()=>{
  let allowed=true
  const peer=transport((socket,packet)=>{if(packet.name==='probe')allowed=false;normal(socket,packet)})
  const client=new DesktopTools(cfg,{connect:peer.connect,validate:()=>{if(!allowed)throw Object.assign(Error('revoked'),{code:'GRANT_REVOKED'})}})
  await assert.rejects(client.run('desktop_type',{text:'fixture'},context()),e=>e.code==='DESKTOP_CANCELLED'&&e.possiblyApplied===false)
  assert.equal(peer.packets.filter(p=>p.name==='desktop_type').length,0);await client.close()
})
test('desktop client: an abort waits for authenticated owner stop and records possible partial input',async()=>{
  const seen=Promise.withResolvers();let pending
  const peer=transport((socket,packet)=>{
    if(packet.name==='desktop_type'){pending=socket;seen.resolve();return}
    normal(socket,packet)
    if(packet.name==='cancel')reply(pending,{ok:false,code:'DESKTOP_CANCELLED',effect:'possibly-applied',stopConfirmed:true})
  })
  const client=new DesktopTools(cfg,{connect:peer.connect}),controller=new AbortController()
  const failed=assert.rejects(client.run('desktop_type',{text:'fixture'},context(),controller.signal),e=>e.code==='DESKTOP_CANCELLED'&&e.possiblyApplied===true&&e.stopConfirmed===true)
  await seen.promise;controller.abort();await failed
  assert.equal(peer.packets.filter(p=>p.name==='desktop_type').length,1)
  assert.equal((await client.close()).stopConfirmed,true)
})
test('desktop client: disconnect after dispatch plus missing stop acknowledgement stays unknown without replay',async()=>{
  const seen=Promise.withResolvers();let pending
  const peer=transport((socket,packet)=>{
    if(packet.name==='desktop_type'){pending=socket;seen.resolve();return}
    if(packet.name==='cancel'){socket.destroy();pending.destroy();return}
    normal(socket,packet)
  })
  const client=new DesktopTools(cfg,{connect:peer.connect,timeoutMs:50}),controller=new AbortController()
  const failed=assert.rejects(client.run('desktop_type',{text:'fixture'},context(),controller.signal),e=>e.code==='OUTCOME_UNKNOWN'&&e.stopConfirmed===false)
  await seen.promise;controller.abort();await failed
  assert.equal(peer.packets.filter(p=>p.name==='desktop_type').length,1)
  assert.ok(peer.packets.filter(p=>p.name==='cancel').length<=2)
  assert.equal((await client.close()).stopConfirmed,false)
})
test('desktop client: two Agent instances cannot collide even with the same business IDs',async()=>{
  let owner
  const peer=transport((socket,packet)=>{
    if(packet.name==='probe'||packet.name==='cancel'){normal(socket,packet);return}
    if(owner&&owner!==packet.owner){reply(socket,{ok:false,code:'DESKTOP_BUSY',effect:'not-applied',stopConfirmed:true});return}
    owner=packet.owner;normal(socket,packet)
  })
  const first=new DesktopTools(cfg,{connect:peer.connect}),second=new DesktopTools(cfg,{connect:peer.connect}),c=context()
  await first.run('desktop_screenshot',{},c)
  await assert.rejects(second.run('desktop_screenshot',{owner},c),e=>e.code==='DESKTOP_BUSY')
  const inputs=peer.packets.filter(p=>p.name==='desktop_screenshot');assert.notEqual(inputs[0].owner,inputs[1].owner)
  await first.close();await second.close()
})
test('desktop client: close cancels a pending action and refuses future input',async()=>{
  const seen=Promise.withResolvers();let pending
  const peer=transport((socket,packet)=>{
    if(packet.name==='desktop_type'){pending=socket;seen.resolve();return}
    normal(socket,packet);if(packet.name==='cancel')reply(pending,{ok:false,code:'DESKTOP_CANCELLED',effect:'not-applied',stopConfirmed:true})
  })
  const client=new DesktopTools(cfg,{connect:peer.connect}),c=context()
  const failed=assert.rejects(client.run('desktop_type',{text:'fixture'},c),e=>e.code==='DESKTOP_CANCELLED')
  await seen.promise;assert.equal((await client.close()).stopConfirmed,true);await failed
  const before=peer.packets.length
  await assert.rejects(client.run('desktop_type',{text:'late'},context()),e=>e.code==='DESKTOP_CANCELLED')
  assert.equal(peer.packets.length,before)
})
test('desktop client: a later unsent connection failure cannot erase an older missing input receipt',async()=>{
  const peer=transport((socket,packet)=>{if(packet.name==='probe')normal(socket,packet);else socket.destroy()})
  let later=false
  const connect=pipe=>{
    if(!pipe.endsWith('-control')&&later){const socket=new EventEmitter();socket.destroy=()=>{};queueMicrotask(()=>socket.emit('error',Error('offline')));return socket}
    return peer.connect(pipe)
  }
  const client=new DesktopTools(cfg,{connect,timeoutMs:50}),c=context()
  await assert.rejects(client.run('desktop_type',{text:'first'},c),e=>e.code==='OUTCOME_UNKNOWN')
  later=true
  await assert.rejects(client.run('desktop_type',{text:'not-sent'},c),e=>e.code==='DESKTOP_UNAVAILABLE')
  assert.equal((await client.close()).stopConfirmed,false)
  assert.equal(peer.packets.filter(packet=>packet.name==='desktop_type').length,1)
})

test('desktop client: explicit stop confirmation retry is bounded and never repeats the input',async()=>{
  let stops=0
  const peer=transport((socket,packet)=>{
    if(packet.name==='cancel'){reply(socket,{ok:true,result:{helperInstanceId:helper,stopConfirmed:++stops>1}});return}
    normal(socket,packet)
  })
  const client=new DesktopTools(cfg,{connect:peer.connect}),c=context()
  await client.run('desktop_type',{text:'once'},c)
  assert.equal((await client.cancel(c)).stopConfirmed,false)
  assert.equal((await client.cancel(c)).stopConfirmed,true)
  assert.equal((await client.cancel(c)).stopConfirmed,true)
  assert.equal(stops,2)
  await assert.rejects(client.run('desktop_type',{text:'never replay'},c),e=>e.code==='DESKTOP_CANCELLED')
  assert.equal(peer.packets.filter(packet=>packet.name==='desktop_type').length,1)
  assert.equal((await client.close()).stopConfirmed,true)
})

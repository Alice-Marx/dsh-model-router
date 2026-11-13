import test from 'node:test'
import assert from 'node:assert/strict'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { openEmbeddedComputerHost } from '../packages/orchestration/src/embedded-computer-host.mjs'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import net from 'node:net'

test('installed product exposes owner-only local computer actions and leaves the listener off by default',async()=>{
  await withProductIndependent(async({ctx,dispatch})=>{
    const view=await dispatch('machine.host.status',{})
    assert.equal(view.state,'disabled');assert.equal(view.listening,false);assert.equal(view.revision,0)
    const readModel=ctx.get('botProductReadModel')
    for(const name of ['status','configure','start','stop','invite','devices','revoke'])await assert.rejects(readModel.dispatch({action:'machine.host.'+name,payload:{}},{kind:'bot'}),{code:'REMOTE_OWNER_REQUIRED'})
  })
})

test('the product pairing action accepts the embedded invitation and Main reads its granted directory',async()=>{
  const parent=resolve('tmp/integration/product-embedded');await mkdir(parent,{recursive:true})
  const root=await mkdtemp(join(parent,'case-')),sharedDirectory=join(root,'shared');await mkdir(sharedDirectory);await writeFile(join(sharedDirectory,'proof.txt'),'PRODUCT-PAIR-OK')
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r))
  const target=await openEmbeddedComputerHost({Database,dataRoot:join(root,'target'),protect:async()=>{}}),owner={kind:'owner'}
  try{
    const running=await target.configure({expectedRevision:0,name:'Embedded target',listenAddress:'127.0.0.1',port,sharedDirectory,allowWrite:false,allowDesktop:false,enabled:true},owner)
    const invitation=await target.invite({expectedRevision:running.revision},owner)
    await withProductIndependent(async({ctx,dispatch,bind})=>{
      await bind('a','alpha','one')
      const paired=await dispatch('machine.pair.invite',{invite:invitation.invite,code:invitation.code,requestId:'product-embedded-pair-once',probeBotId:'a',expectedRevision:0})
      assert.equal(paired.mainBinding.status,'available')
      const machines=ctx.get('botRemoteMachines'),subject=ctx.get('operatorSubject')()
      const read=await machines.call(subject,{machineId:invitation.invite.machineId,rootId:'shared',taskId:'embedded-product-read',attemptId:'one',tool:'fs_read',args:{rootId:'shared',relativePath:'proof.txt'}})
      assert.equal(Buffer.from(read.content,'base64').toString(),'PRODUCT-PAIR-OK')
      const peers=await target.devices({},owner);await target.revoke({id:peers.items[0].id,revision:peers.items[0].revision},owner)
      await assert.rejects(machines.call(subject,{machineId:invitation.invite.machineId,rootId:'shared',taskId:'after-revoke',attemptId:'one',tool:'fs_read',args:{rootId:'shared',relativePath:'proof.txt'}}))
    })
  }finally{await target.close()}
})

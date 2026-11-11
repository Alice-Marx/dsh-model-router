import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {HostConnectionService} from '@deepseek-ai/dsh-client-connection'

test('the installed public Host Connection keeps owner Peer identity stable across Fetch and WebSocket admissions and revokes it on disposal',async()=>{
  const root=new Context();let service
  const fork=await root.plugin(ctx=>{service=new HostConnectionService(ctx,['127.0.0.1'],{isAuthenticated:()=>true})})
  const request=()=>new Request('http://127.0.0.1/fixture',{headers:{host:'127.0.0.1',origin:'http://127.0.0.1'}})
  try{
    const first=service.admit(request()),second=service.admit(request()),socket=service.admitConnection(request())
    assert.equal(first.peer.principal.kind,'owner');assert.equal(first.peer,second.peer);assert.equal(first.peer,socket.peer)
    assert.equal(first.peer.signal.aborted,false);await socket.release();assert.equal(first.peer.signal.aborted,false)
    await fork.dispose();assert.equal(first.peer.signal.aborted,true)
  }finally{await fork.dispose()}
})

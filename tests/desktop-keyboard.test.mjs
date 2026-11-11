import test from 'node:test'
import assert from 'node:assert/strict'
import {sendDesktopKeys,sendDesktopText,DESKTOP_SHORTCUTS} from '../apps/integration-client/desktop-keyboard.mjs'

test('remote shortcuts wait for each original ACK and release keys in reverse order',async()=>{
  const events=[],gates=[]
  const stream={input:event=>{events.push(event);gates.push(Promise.withResolvers());return true},drain:()=>gates.at(-1)?.promise??Promise.resolve(),releaseInput:async()=>({ok:true})}
  const keys=DESKTOP_SHORTCUTS.find(row=>row.label==='全选').keys
  const pending=sendDesktopKeys(stream,keys);await new Promise(setImmediate)
  assert.deepEqual(events,[{type:'key',action:'down',code:'ControlLeft',key:'Control'}])
  gates[0].resolve();await new Promise(setImmediate);assert.equal(events.length,2);assert.equal(events[1].code,'KeyA')
  gates[1].resolve();await new Promise(setImmediate);assert.equal(events[2].action,'up');assert.equal(events[2].code,'KeyA')
  gates[2].resolve();await new Promise(setImmediate);assert.equal(events[3].action,'up');assert.equal(events[3].code,'ControlLeft')
  gates[3].resolve();await pending;assert.equal(events.length,4)
})

test('lost input acknowledgement releases held input without sending another key or replaying the uncertain one',async()=>{
  const events=[];let release=0
  const stream={input:value=>{events.push(value);return true},drain:async()=>{if(events.length)throw new Error('DESKTOP_INPUT_ACK_LOST')},releaseInput:async()=>{release++;return {ok:true}}}
  await assert.rejects(sendDesktopKeys(stream,DESKTOP_SHORTCUTS[0].keys),/DESKTOP_INPUT_ACK_LOST/)
  assert.equal(events.length,1);assert.equal(release,1)
})

test('pasted text releases prior modifiers and only completes after its native ACK',async()=>{
  const events=[],gate=Promise.withResolvers();let released=false,finished=false
  const stream={releaseInput:async()=>{released=true;return {ok:true}},input:value=>{assert.equal(released,true);events.push(value);return true},drain:()=>gate.promise}
  const pending=sendDesktopText(stream,'你好\nsecond line').then(()=>{finished=true});await new Promise(setImmediate)
  assert.deepEqual(events,[{type:'text',text:'你好\nsecond line'}]);assert.equal(finished,false)
  gate.resolve();await pending;assert.equal(finished,true)
  let sent=false
  await assert.rejects(sendDesktopText({releaseInput:async()=>({ok:false}),input:()=>{sent=true}},'sensitive text'),/INPUT_RELEASE_UNCONFIRMED/)
  assert.equal(sent,false)
})

test('changing the desktop while a shortcut waits prevents all subsequent key transitions',async()=>{
  const gate=Promise.withResolvers(),events=[];let current=true,released=0
  const stream={input:value=>{events.push(value);return true},drain:()=>events.length?gate.promise:Promise.resolve(),releaseInput:async()=>{released++;return {ok:true}}}
  const pending=sendDesktopKeys(stream,DESKTOP_SHORTCUTS[0].keys,()=>current);await new Promise(setImmediate)
  current=false;gate.resolve();await assert.rejects(pending,/DESKTOP_SESSION_CHANGED/)
  assert.equal(events.length,1);assert.equal(released,1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {createDesktopTouchTracker} from '../apps/integration-client/desktop-touch.mjs'
const point=(pointerId,x,y)=>({pointerType:'touch',pointerId,clientX:x,clientY:y})
test('two-finger scroll releases the first drag and cannot resume a stale one-finger hold',()=>{
  const tracker=createDesktopTouchTracker()
  assert.deepEqual(tracker.handle('down',point(1,10,100)),{handled:false})
  assert.deepEqual(tracker.handle('down',point(2,30,100)),{handled:true,release:true})
  assert.deepEqual(tracker.handle('move',point(1,10,80)),{handled:true,wheel:{type:'wheel',deltaX:0,deltaY:10}})
  assert.deepEqual(tracker.handle('up',point(2,30,100)),{handled:true,release:false})
  assert.deepEqual(tracker.handle('move',point(1,10,50)),{handled:true})
  assert.deepEqual(tracker.handle('up',point(1,10,50)),{handled:true,release:true})
  assert.deepEqual(tracker.handle('down',point(3,20,20)),{handled:false})
})
test('touch cancellation/reset and large motion remain bounded; mouse events retain their original path',()=>{
  const tracker=createDesktopTouchTracker()
  assert.deepEqual(tracker.handle('down',{pointerType:'mouse'}),{handled:false})
  tracker.handle('down',point(1,10,100));tracker.handle('down',point(2,30,100))
  assert.deepEqual(tracker.handle('move',point(1,100000,-100000)).wheel,{type:'wheel',deltaX:-480,deltaY:480})
  tracker.clear();assert.deepEqual(tracker.handle('down',point(2,30,100)),{handled:false})
})

export const DESKTOP_SHORTCUTS=Object.freeze([
  {label:'Tab',keys:[{code:'Tab',key:'Tab'}]},
  {label:'Esc',keys:[{code:'Escape',key:'Escape'}]},
  {label:'Enter',keys:[{code:'Enter',key:'Enter'}]},
  {label:'Windows',keys:[{code:'MetaLeft',key:'Meta'}]},
  {label:'全选',keys:[{code:'ControlLeft',key:'Control'},{code:'KeyA',key:'a'}]},
  {label:'复制',keys:[{code:'ControlLeft',key:'Control'},{code:'KeyC',key:'c'}]},
  {label:'粘贴远端剪贴板',keys:[{code:'ControlLeft',key:'Control'},{code:'KeyV',key:'v'}]},
  {label:'任务管理器',keys:[{code:'ControlLeft',key:'Control'},{code:'ShiftLeft',key:'Shift'},{code:'Escape',key:'Escape'}]},
].map(row=>Object.freeze({...row,keys:Object.freeze(row.keys.map(key=>Object.freeze(key)))})))

/** Each transition waits for its original native ACK. Failure releases held input and never replays a key. */
export async function sendDesktopKeys(stream,keys,isCurrent=()=>true){
  const check=()=>{if(!isCurrent())throw new Error('DESKTOP_SESSION_CHANGED')}
  try{
    check();await stream.drain();check()
    for(const action of ['down','up'])for(const key of action==='up'?[...keys].reverse():keys){
      check();if(!stream.input({type:'key',action,...key}))throw new Error('CONTROL_NOT_GRANTED')
      await stream.drain();check()
    }
  }catch(error){await stream.releaseInput()?.catch(()=>{});throw error}
}

export async function sendDesktopText(stream,text,isCurrent=()=>true){
  if(typeof text!=='string'||!text||text.length>8192)throw new Error('INPUT_LIMIT')
  if(!isCurrent())throw new Error('DESKTOP_SESSION_CHANGED')
  const released=await stream.releaseInput()
  if(released?.ok!==true||!isCurrent())throw new Error('INPUT_RELEASE_UNCONFIRMED')
  if(!stream.input({type:'text',text}))throw new Error('CONTROL_NOT_GRANTED')
  await stream.drain()
  if(!isCurrent())throw new Error('DESKTOP_SESSION_CHANGED')
}

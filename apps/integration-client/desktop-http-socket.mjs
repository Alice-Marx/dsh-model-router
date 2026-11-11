/** Fetch uses the shell's existing authenticated bridge. Application writes are sent once, in order. */
export function createOwnerDesktopSocket({ticket,botId,dispatch}){
  const socket={readyState:0,binaryType:'arraybuffer',onopen:null,onmessage:null,onclose:null,onerror:null}
  const controller=new AbortController()
  let cursor=0,authorized=false,sequence=0,pending=0,outbound=Promise.resolve()
  const stop=(error)=>{
    if(socket.readyState===3)return
    socket.readyState=3;controller.abort()
    if(error)socket.onerror?.({error})
    socket.onclose?.({code:error?1011:1000,reason:error?'桌面连接中断，请检查电脑后重新连接。':''})
  }
  const input=(extra)=>({botId,sessionId:ticket.sessionId,token:ticket.token,...extra})
  const poll=async()=>{
    try{
      while(socket.readyState===1){
        const value=await dispatch('machine.desktop.poll',input({cursor}),controller.signal)
        if(socket.readyState!==1)return
        if(!value||!Array.isArray(value.events)||!Number.isSafeInteger(value.cursor)||value.cursor<cursor)throw new Error('DESKTOP_PROTOCOL_INVALID')
        if(value.closed){stop(new Error(value.code??'DESKTOP_DISCONNECTED'));return}
        for(const event of value.events){
          if(!Number.isSafeInteger(event.sequence)||event.sequence<=cursor||event.sequence>value.cursor||typeof event.data!=='string'||event.data.length>12*1024*1024)throw new Error('DESKTOP_PROTOCOL_INVALID')
          const bytes=Uint8Array.from(atob(event.data),char=>char.charCodeAt(0))
          if(event.kind==='message')socket.onmessage?.({data:event.binary?bytes.buffer:new TextDecoder().decode(bytes)})
          else if(event.kind!=='ping')throw new Error('DESKTOP_PROTOCOL_INVALID')
          cursor=event.sequence
        }
        if(cursor!==value.cursor)throw new Error('DESKTOP_PROTOCOL_INVALID')
      }
    }catch(error){if(!controller.signal.aborted)stop(error)}
  }
  socket.send=text=>{
    if(socket.readyState!==1)throw new Error('DESKTOP_DISCONNECTED')
    const message=JSON.parse(text)
    if(!authorized){
      if(message.type!=='auth'||message.sessionId!==ticket.sessionId||message.token!==ticket.token)throw new Error('DESKTOP_AUTH_INVALID')
      authorized=true;void poll();return
    }
    if(++pending>64){stop(new Error('DESKTOP_INPUT_LIMIT'));return}
    const requestId=`http-desktop-${++sequence}`
    outbound=outbound.then(async()=>{
      if(socket.readyState!==1)return
      const result=await dispatch('machine.desktop.send',input({requestId,message:text}),controller.signal)
      if(result?.accepted!==true)throw new Error('DESKTOP_INPUT_UNKNOWN')
    }).catch(error=>stop(error)).finally(()=>pending--)
  }
  socket.close=()=>stop()
  queueMicrotask(()=>{if(socket.readyState!==0)return;socket.readyState=1;socket.onopen?.({})})
  return socket
}

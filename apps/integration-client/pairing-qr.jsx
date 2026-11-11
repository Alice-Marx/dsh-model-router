import React,{useEffect,useRef,useState} from 'react'
import jsQR from 'jsqr'
import {parseSecureInvite} from '../../packages/orchestration/src/pairing-invite.mjs'

export function readPairingPixels(data,width,height){
  if(!(data instanceof Uint8ClampedArray)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4_000_000||data.length!==width*height*4)throw new Error('二维码图片尺寸无效。')
  const code=jsQR(data,width,height,{inversionAttempts:'attemptBoth'})
  if(!code)throw new Error('没有识别到二维码，请使用清晰完整的配对二维码。')
  const invite=parseSecureInvite(code.data)
  return JSON.stringify(invite)
}

/** Image decoding stays local. Camera access starts only after an explicit scan click. */
export function PairingQrReader({onRead,disabled=false}){
  const [scanning,setScanning]=useState(false),[error,setError]=useState(''),[reading,setReading]=useState(false)
  const generation=useRef(0),video=useRef(null),camera=useRef(null),timer=useRef(null),dialog=useRef(null),trigger=useRef(null),imageInput=useRef(null),mounted=useRef(true),onReadRef=useRef(onRead)
  onReadRef.current=onRead
  const stop=()=>{generation.current++;clearTimeout(timer.current);timer.current=null;for(const track of camera.current?.getTracks?.()??[])track.stop();camera.current=null;if(video.current)video.current.srcObject=null}
  const close=()=>{stop();setScanning(false);trigger.current?.focus()}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop()}},[])
  useEffect(()=>{if(disabled){stop();setScanning(false);setReading(false)}},[disabled])
  useEffect(()=>{
    const hidden=()=>{if(document.hidden){stop();setScanning(false)}}
    document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden)
  },[])
  useEffect(()=>{
    if(!scanning)return
    const active=++generation.current,canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true})
    const fail=message=>{if(mounted.current&&generation.current===active){stop();setError(message);setScanning(false);trigger.current?.focus()}}
    const tick=()=>{
      if(!mounted.current||generation.current!==active)return
      const source=video.current
      if(source?.readyState>=2&&source.videoWidth){
        const scale=Math.min(1,1200/Math.max(source.videoWidth,source.videoHeight));canvas.width=Math.max(1,Math.round(source.videoWidth*scale));canvas.height=Math.max(1,Math.round(source.videoHeight*scale))
        context.drawImage(source,0,0,canvas.width,canvas.height)
        try{const value=readPairingPixels(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);stop();setScanning(false);onReadRef.current(value);trigger.current?.focus();return}catch{}
      }
      timer.current=setTimeout(tick,180)
    }
    const start=async()=>{
      try{
        if(!context||!navigator.mediaDevices?.getUserMedia)throw new Error('当前环境无法开启摄像头，请改用二维码图片或邀请码。')
        const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280}}})
        if(!mounted.current||generation.current!==active){for(const track of stream.getTracks())track.stop();return}
        camera.current=stream;video.current.srcObject=stream;await video.current.play()
        if(generation.current===active)tick()
      }catch(failure){fail(failure.name==='NotAllowedError'?'摄像头未获允许，可以改用二维码图片或邀请码。':String(failure.message??failure))}
    }
    dialog.current?.querySelector('button')?.focus();void start()
    return()=>{if(generation.current===active)stop()}
  },[scanning])
  const image=async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return
    stop();setScanning(false);setReading(true);setError('');const active=generation.current
    try{
      if(file.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择不超过 10 MB 的 PNG、JPEG 或 WebP 二维码图片。')
      const bitmap=await createImageBitmap(file)
      try{
        if(!mounted.current||active!==generation.current)return
        const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas')
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
        const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('当前环境无法读取图片，请粘贴邀请码。')
        context.drawImage(bitmap,0,0,canvas.width,canvas.height)
        const value=readPairingPixels(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height)
        onReadRef.current(value)
      }finally{bitmap.close()}
    }catch(failure){if(mounted.current&&active===generation.current)setError(failure.code?'这不是受支持的设备配对二维码。':String(failure.message??failure))}
    finally{if(mounted.current&&active===generation.current)setReading(false)}
  }
  return <div className="bp-pairing-reader"><div className="bp-actions"><button ref={trigger} type="button" disabled={disabled||reading} onClick={()=>{setError('');setScanning(true)}}>扫描配对二维码</button>
    <button type="button" disabled={disabled||reading} onClick={()=>imageInput.current?.click()}>{reading?'正在识别…':'导入二维码图片'}</button>
    <input ref={imageInput} className="bp-pairing-file" aria-label="二维码图片" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled||reading} onChange={event=>{void image(event)}}/></div>
    {error&&<p className="bp-error" role="alert">{error}</p>}
    {scanning&&<div className="bp-pairing-camera-overlay" role="dialog" aria-modal="true" aria-label="扫描电脑配对二维码" ref={dialog} onKeyDown={event=>{
      if(event.key==='Escape'&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229){event.preventDefault();close()}
      if(event.key==='Tab'){event.preventDefault();dialog.current?.querySelector('button')?.focus()}
    }}><section className="bp-pairing-camera"><header><strong>扫描电脑上的配对二维码</strong><button type="button" onClick={close}>关闭摄像头</button></header><video ref={video} muted playsInline/><p>将完整二维码放入画面，识别后仍需核对设备指纹和六位确认码。</p></section></div>}
  </div>
}

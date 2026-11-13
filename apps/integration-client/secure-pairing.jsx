import React, { useEffect, useMemo, useRef, useState } from 'react'
import { parseSecureInvite } from '../../packages/orchestration/src/pairing-invite.mjs'
import { UiIcon } from './ui-icons.jsx'
import { PairingQrReader } from './pairing-qr.jsx'

const errors = {
  PAIRING_CODE_INVALID: '确认码不正确，请核对目标电脑上显示的六位数字。五次错误后邀请码失效。',
  PAIRING_WINDOW_CLOSED: '邀请码已过期或已关闭，请在目标电脑生成新的邀请码。',
  PAIRING_PEER_UNVERIFIED: '未能验证目标电脑。请检查地址和网络，并核对设备指纹；不会切换到明文连接。',
  PAIRING_RESULT_UNKNOWN: '兑换结果尚未确认。保留这份邀请码，点击“继续核对原配对”；宿主会沿用原请求身份。',
  PAIRING_RESULT_UNRECOVERABLE: '原请求的恢复窗口已结束。请在目标电脑检查已配对设备；若宿主没有保存凭据，使用“撤销旧配对后重新邀请”，再导入新邀请。',
  PAIRING_DEVICE_ALREADY_COMMITTED: '目标电脑已登记这次配对，宿主未能保存可用凭据。请在目标电脑核对设备，运行 pair-device.cmd -ResetPairing 撤销旧配对并重新邀请；此操作会断开旧配对。',
  PAIRING_CREDENTIAL_CHANGED: '宿主中已保存的凭据与原配对记录不一致。请核对目标电脑和宿主的设备登记后重新邀请。',
  PAIRING_ALREADY_REDEEMED: '这份邀请码已经被兑换。请在目标电脑核对已配对设备。',
  PAIRING_BINDING_REVIEW_REQUIRED: '设备已添加，请在电脑卡片中核对并完成 Bot 授权。',
  PAIRING_DEVICE_LIMIT: '目标电脑的已配对设备已达上限，请先在目标电脑撤销不再使用的设备。',
}

export function SecurePairingSetup({ snapshot, dispatch, busy }) {
  const [text,setText] = useState(''), [code,setCode] = useState(''), [working,setWorking] = useState(false)
  const [failure,setFailure] = useState(null), [status,setStatus] = useState(''), [clock,setClock] = useState(Date.now())
  const request = useRef(null), mounted = useRef(true), sequence = useRef(0), active = useRef(false), fileInput=useRef(null)
  const importSequence = useRef(0)
  useEffect(() => { mounted.current=true; return () => { mounted.current=false; sequence.current++;importSequence.current++ } }, [])
  useEffect(() => { const timer=setInterval(()=>setClock(Date.now()),1000); return ()=>clearInterval(timer) }, [])
  const parsed = useMemo(() => { if (!text.trim()) return {}; try { return { invite:parseSecureInvite(text) } } catch (error) { return { error:error.code } } },[text])
  const invite = parsed.invite
  const seconds = invite ? Math.max(0,Math.ceil((invite.expiresAt-clock)/1000)) : 0
  const probeBotId = snapshot.mainBotId ?? snapshot.bots?.[0]?.id
  const allowed = invite?.ceiling.hostManagedBots || invite?.ceiling.botIds.includes(probeBotId)
  const recoverable = request.current !== null && Boolean(failure)
  const ready = invite && /^\d{6}$/.test(code) && probeBotId && allowed && (seconds>0 || recoverable)
  const change = value => { importSequence.current++;setText(value); request.current=null; setCode(''); setFailure(null); setStatus('') }
  const submit = async () => {
    if (!ready || active.current || busy) return
    importSequence.current++;active.current=true;setWorking(true);setFailure(null);setStatus('')
    const epoch=++sequence.current
    try {
      if (!request.current) request.current={requestId:[...crypto.getRandomValues(new Uint8Array(16))].map(byte=>byte.toString(16).padStart(2,'0')).join(''),code,invite,probeBotId,
        expectedRevision:(snapshot.machines?.items??[]).find(item=>item.id===invite.machineId)?.revision??0}
      const result=await dispatch('machine.pair.invite',request.current,{errorResult:true})
      if (!result || result.ok===false) throw Object.assign(new Error('配对尚未确认。'),{code:result?.error?.code})
      if (!mounted.current || epoch!==sequence.current) return
      setStatus(result.mainBinding?.status==='blocked'
        ? `设备已安全配对。${errors[result.mainBinding.code]??`Bot 绑定需要处理：${result.mainBinding.code}`}`
        : '已验证设备并保存连接凭据，Bot 的授权范围已登记。')
      setText('');setCode('');request.current=null
    } catch(error) {
      if (mounted.current && epoch===sequence.current) setFailure({code:error.code,message:errors[error.code]??String(error.message??error)})
      if (error.code==='PAIRING_CODE_INVALID') request.current=null
    } finally { active.current=false;if(mounted.current&&epoch===sequence.current)setWorking(false) }
  }
  const importFile = async event => {
    const file=event.target.files?.[0];event.target.value=''
    if(!file||active.current||recoverable||busy)return
    const epoch=++importSequence.current
    if(file.size>16384){setFailure({message:'邀请码文件超过 16 KB。'});return}
    try{const value=await file.text();if(mounted.current&&epoch===importSequence.current&&!active.current&&!request.current)change(value)}
    catch{if(mounted.current&&epoch===importSequence.current)setFailure({message:'无法读取邀请码文件。'})}
  }
  return <details className="bp-card bp-secure-pairing" open><summary><UiIcon name="computer" />安全配对电脑</summary>
    <p className="bp-muted">在目标电脑生成两分钟邀请码，扫描或粘贴到这里，再核对确认码与设备指纹。连接后可从 Bot 聊天中的电脑入口打开桌面。</p>
    <p className="bp-muted">在目标电脑的 Bot 插件“本机 · 允许其他电脑连接”中开启远程访问并生成邀请，无需单独安装 Agent。已有独立 Agent 的配对文件也可继续使用。</p>
    {(snapshot.availableActions??[]).includes('machine.pair.invite') ? <div className="bp-form">
      <PairingQrReader onRead={change} disabled={working||recoverable||busy}/>
      <label>设备邀请码<textarea rows={3} value={text} disabled={working||recoverable} onChange={event=>change(event.target.value)} autoComplete="off" spellCheck={false} placeholder="粘贴目标电脑生成的 dsh-pairing-invite JSON" /></label>
      <div className="bp-actions"><button type="button" disabled={working||recoverable||busy} onClick={()=>fileInput.current?.click()}>导入邀请码文件</button><input ref={fileInput} className="bp-pairing-file" aria-label="邀请码文件" type="file" accept=".json,application/json" disabled={working||recoverable} onChange={event=>{void importFile(event)}} /></div>
      {parsed.error&&<p className="bp-error" role="alert">无法识别这份邀请码。需要 Agent 生成的第 2 版安全配对文件。</p>}
      {invite&&<section className="bp-pairing-identity" aria-label="核对设备身份"><strong>{invite.name}</strong><code>{invite.endpoint}</code>
        <label>设备指纹<code>{invite.transport.fingerprint.match(/.{1,8}/g).join(' ')}</code></label>
        <p>共享目录：{invite.ceiling.roots.join('、')}；允许 {invite.ceiling.tools.length} 项能力。</p>
        <details><summary>查看允许的能力</summary><p className="bp-muted">{invite.ceiling.tools.join('、')}</p></details>
        <p className="bp-muted">{invite.ceiling.hostManagedBots?'目标电脑允许本宿主管理团队 Bot，仍受共享目录和能力范围限制。':`仅允许 Bot：${invite.ceiling.botIds.join('、')}`}</p>
        {!allowed&&<p className="bp-error" role="alert">当前主 Bot 不在目标电脑允许的范围内。</p>}
        <span role="timer">{seconds>0?`邀请码剩余 ${seconds} 秒`:recoverable?'邀请码已过期；可继续核对已保存凭据的原请求。':'邀请码已过期，请在目标电脑重新生成。'}</span>
      </section>}
      <label>目标电脑的六位确认码<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={working||recoverable} onChange={event=>{importSequence.current++;setCode(event.target.value.replace(/\D/g,''));request.current=null;setFailure(null)}} placeholder="000000" /></label>
      <div className="bp-actions"><button type="button" className="bp-button-primary" disabled={!ready||busy||working} onClick={()=>{void submit()}}>{working?'正在验证设备…':recoverable?'继续核对原配对':'验证并配对'}</button>
        {recoverable&&<button type="button" disabled={working} onClick={()=>change('')}>清除本地表单</button>}</div>
      {failure&&<p className="bp-error" role="alert">{failure.message}</p>}
      {status&&<p role="status">{status}</p>}
    </div>:<p className="bp-muted">宿主尚未提供安全配对操作，请更新 Host 与 Remote Agent。</p>}
  </details>
}

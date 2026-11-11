import QRCode from 'qrcode'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, lstat, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fail } from './protocol.js'

const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!))

export async function pairingPage(invite:any){
  const {code,...scannable}=invite
  const payload=JSON.stringify(scannable),nonce=randomBytes(18).toString('base64'),fingerprint=invite.transport.fingerprint.match(/.{1,8}/g).join(' ')
  let qr=''
  try{qr=await QRCode.toString(payload,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320})}catch{}
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'nonce-${nonce}';base-uri 'none';form-action 'none'"><title>安全配对 · DSH 电脑</title><style>
  :root{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#25342f;background:#f5f7f6;color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:24px}.card{max-width:760px;margin:32px auto;padding:32px;background:white;border:1px solid #dfe7e2;border-radius:22px;box-shadow:0 16px 50px #142d2110}h1{margin:8px 0;font-size:25px}p{line-height:1.65;color:#5f6e65}.badge{font-size:12px;color:#317453}.grid{display:grid;grid-template-columns:300px minmax(0,1fr);gap:28px;align-items:center}.qr svg{display:block;width:100%;height:auto}.code{letter-spacing:.18em;font-size:36px;color:#244f3d;font-weight:650}.timer{font-weight:600;color:#317453}.expired{color:#a83a39}.fingerprint{display:block;font-size:12px;line-height:1.8;overflow-wrap:anywhere}textarea{width:100%;min-height:94px;padding:12px;border:1px solid #dfe7e2;border-radius:10px;font:11px monospace;resize:vertical;background:#f8faf8;color:#45584d}button{border:0;border-radius:9px;background:#2d654a;color:white;font:inherit;padding:10px 18px;cursor:pointer}button:disabled{opacity:.5}details{margin-top:20px}summary{cursor:pointer}.footer{font-size:12px;margin-bottom:0}@media(max-width:620px){body{padding:12px}.card{margin:8px auto;padding:22px}.grid{grid-template-columns:1fr;gap:8px}.qr{max-width:300px;margin:auto}}
  </style></head><body><main class="card"><span class="badge">你的电脑 · 端到端加密</span><h1>把这台电脑连接到 Bot</h1><p>在已登录的插件中打开“安全配对电脑”，扫描或粘贴下方邀请码，再核对目标电脑的确认码。</p><div class="grid"><div class="qr">${qr||'<p>这份邀请包含较大的授权范围，请复制下方邀请码。</p>'}</div><section><strong>${escape(invite.name)}</strong><p>${escape(invite.endpoint)}</p><div aria-label="六位确认码" class="code">${escape(code)}</div><p id="timer" class="timer" role="timer">邀请码有效期为两分钟</p><strong>设备指纹</strong><code class="fingerprint">${escape(fingerprint)}</code></section></div><p>共享目录：${escape(invite.ceiling.roots.join('、'))}；允许 ${invite.ceiling.tools.length} 项能力。请在接收端核对同一范围。</p><label for="invite">设备邀请码（不含确认码）</label><textarea id="invite" readonly spellcheck="false">${escape(payload)}</textarea><p><button id="copy" type="button">复制邀请码</button> <span id="feedback" role="status"></span></p><details><summary>查看能力范围</summary><p>${escape(invite.ceiling.tools.join('、'))}</p></details><p class="footer">此页面在本机生成，不加载远程资源。邀请码过期后运行 pair-device.cmd 重新生成；已配对的设备需在目标电脑核对后管理。</p></main><script nonce="${nonce}">
  const expiresAt=${invite.expiresAt};const timer=document.getElementById('timer');const update=()=>{const remaining=Math.max(0,Math.ceil((expiresAt-Date.now())/1000));timer.textContent=remaining?'邀请码剩余 '+remaining+' 秒':'邀请码已过期，请重新生成';timer.classList.toggle('expired',!remaining);document.getElementById('copy').disabled=!remaining};update();setInterval(update,1000);
  document.getElementById('copy').onclick=async()=>{const field=document.getElementById('invite');try{await navigator.clipboard.writeText(field.value);document.getElementById('feedback').textContent='已复制'}catch{field.focus();field.select();document.getElementById('feedback').textContent='请按 Ctrl+C 复制选中的邀请码'}};
  </script></body></html>`
  return {html,qr:!!qr,payload}
}

/** Replacing an invitation replaces only the explicitly named regular file; no credential is printed. */
export async function writePairingPage(invite:any,destination:string){
  if(!destination)fail('PAIRING_OUTPUT_REQUIRED')
  const page=resolve(destination),json=`${page}.private.json`
  for(const path of [page,json]){const old=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error});if(old&&(!old.isFile()||old.isSymbolicLink()||old.nlink!==1))fail('PAIRING_OUTPUT_INVALID')}
  await mkdir(dirname(page),{recursive:true,mode:0o700})
  const result=await pairingPage(invite)
  for(const [path,text]of [[json,JSON.stringify(JSON.parse(result.payload),null,2)+'\n'],[page,result.html]]){
    const temporary=`${path}.${randomBytes(8).toString('hex')}.tmp`
    try{await writeFile(temporary,text,{flag:'wx',mode:0o600});await rename(temporary,path)}finally{await rm(temporary,{force:true})}
  }
  return {machineId:invite.machineId,clientId:invite.clientId,inviteId:invite.inviteId,expiresAt:invite.expiresAt,transport:invite.transport,pairingFile:json,pageFile:page,qr:result.qr}
}

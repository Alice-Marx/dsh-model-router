import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir,mkdtemp,readFile,writeFile,link } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import QRCode from 'qrcode'
import { generateKeyPair,b64u,sha256 } from '../modules/openmaus-protocol/index.mjs'

const {PNG}=createRequire(import.meta.resolve('qrcode'))('pngjs')
const parent=resolve('tmp/integration/pairing-qr');await mkdir(parent,{recursive:true})
const directory=await mkdtemp(join(parent,'case-')),file=join(directory,'reader.mjs')
const bundle=await build({entryPoints:['apps/integration-client/pairing-qr.jsx'],bundle:true,platform:'node',format:'esm',external:['react'],write:false})
await writeFile(file,bundle.outputFiles[0].contents)
const {readPairingPixels}=await import(pathToFileURL(file))
const pixels=async data=>{const png=PNG.sync.read(await QRCode.toBuffer(data,{type:'png',width:800,errorCorrectionLevel:'M',margin:4}));return [new Uint8ClampedArray(png.data),png.width,png.height]}

test('QR decoder accepts an actual fixed-identity invitation while rejecting unrelated QR URLs and invalid pixel geometry',async()=>{
  const publicKey=generateKeyPair().publicKey,invite={format:'dsh-pairing-invite',version:2,inviteId:'invite-qr',machineId:'machine-qr',clientId:'host-qr',name:'QR fixture',endpoint:'http://127.0.0.1:9701',expiresAt:Date.now()+120000,
    token:'dsh_pair_'+'a'.repeat(43),transport:{kind:'noise-v1',publicKey:b64u(publicKey),fingerprint:sha256(publicKey).toString('hex')},ceiling:{botIds:['bot-a'],roots:['project'],tools:['machine_ping']}}
  const decoded=JSON.parse(readPairingPixels(...await pixels(JSON.stringify(invite))))
  assert.deepEqual(decoded,invite);assert.equal(Object.hasOwn(decoded,'code'),false)
  assert.throws(()=>readPairingPixels(new Uint8ClampedArray(4),0,0),/尺寸无效/)
  assert.throws(()=>readPairingPixels(new Uint8ClampedArray(400),10,10),/没有识别到二维码/)
  assert.throws(()=>readPairingPixels(...[]),/尺寸无效/)
  const unrelated=await pixels('https://outside.invalid/login?token=unrelated')
  assert.throws(()=>readPairingPixels(...unrelated),/PAIRING_INVITE_INVALID/)
})

test('Agent CLI creates a private offline QR page without printing invite proofs or creating a long-term device',async()=>{
  const root=await mkdtemp(join(parent,'page-')),config=join(root,'config.json'),ceiling=join(root,'ceiling.json'),page=join(root,'pairing.html')
  await writeFile(config,JSON.stringify({dataDir:join(root,'data'),roots:{project:root}}));await writeFile(ceiling,JSON.stringify({botIds:['bot-a'],roots:['project'],tools:['machine_ping']}))
  const run=(...args)=>execFileSync(process.execPath,['remote-computer-agent/dist/cli.mjs',...args],{cwd:process.cwd(),encoding:'utf8',windowsHide:true})
  const output=run('invite-page',config,'host-qr',ceiling,'http://127.0.0.1:9701',page),result=JSON.parse(output)
  const invitation=JSON.parse(await readFile(result.pairingFile,'utf8')),html=await readFile(page,'utf8')
  assert.equal(result.qr,true);assert.equal(output.includes(invitation.token),false);assert.equal(Object.hasOwn(invitation,'code'),false)
  assert.match(html,/<svg/);assert.match(html,/Content-Security-Policy/);assert.match(html,/default-src 'none'/);assert.equal(html.includes('<script src='),false)
  const encoded=html.match(/<textarea[^>]+>([\s\S]*?)<\/textarea>/)[1].replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&')
  assert.equal(Object.hasOwn(JSON.parse(encoded),'code'),false);assert.equal(JSON.parse(encoded).token,invitation.token)
  assert.deepEqual(JSON.parse(run('devices',config)).devices,[])
  const outside=join(root,'retained.txt');await writeFile(outside,'retained');const linked=join(root,'linked.html');await link(outside,linked)
  assert.throws(()=>run('invite-page',config,'host-new',ceiling,'http://127.0.0.1:9701',linked),error=>error.status===1)
  assert.equal(await readFile(outside,'utf8'),'retained')
})

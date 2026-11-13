import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {inflateRawSync} from 'node:zlib'
import {resolveStateHome} from './router-state.mjs'
import {fetch as vendorFetch,EnvHttpProxyAgent} from 'undici'

const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const pending=new Map(),memory=new Map(),MAX=400_000_000
const dispatcher=new EnvHttpProxyAgent()
const officialFetch=(url,options)=>vendorFetch(url,{...options,dispatcher})
const fileHash=async path=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')}
/** Hash one ordinary ZIP member without extracting paths, links or executable files. */
export function zipMemberDigest(bytes,basename){
 if(bytes.length>MAX)throw Error('发行包超过大小限制')
 let end=-1
 for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(bytes.readUInt32LE(at)===0x06054b50&&at+22+bytes.readUInt16LE(at+20)===bytes.length){end=at;break}
 if(end<0||bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0)throw Error('发行 ZIP 目录无效')
 const count=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12)
 if(count===65535||offset+size>end)throw Error('不支持此发行 ZIP 目录')
 let at=offset,found=null
 for(let i=0;i<count;i++){
  if(at+46>offset+size||bytes.readUInt32LE(at)!==0x02014b50)throw Error('发行 ZIP 项目无效')
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),packed=bytes.readUInt32LE(at+20),length=bytes.readUInt32LE(at+24),nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42)
  const name=bytes.subarray(at+46,at+46+nameLength).toString('utf8').replaceAll('\\','/')
  if(name.split('/').includes('..')||name.startsWith('/')||name.includes('\0'))throw Error('发行 ZIP 路径无效')
  if(name.split('/').at(-1)===basename){
   if(found||flags&1||![0,8].includes(method)||length>MAX||local+30>offset||bytes.readUInt32LE(local)!==0x04034b50)throw Error('发行 ZIP 程序项目无效')
   const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28)
   if(start+packed>offset)throw Error('发行 ZIP 程序越界')
   const body=bytes.subarray(start,start+packed),data=method===0?body:inflateRawSync(body,{maxOutputLength:MAX})
   if(data.length!==length)throw Error('发行 ZIP 程序长度无效')
   found={sha256:sha(data),bytes:length,member:name}
  }
  at+=46+nameLength+extra+comment
 }
 if(!found)throw Error('发行 ZIP 未包含所需程序')
 return found
}
async function download(url,limit,fetcher){
 if(limit===MAX){
  const headers={'User-Agent':'DSH-Official-CLI-Verification','Range':'bytes=0-0'}
  const probe=await fetcher(url,{headers,signal:AbortSignal.timeout(30000),redirect:'error'})
  if(probe.status===206){
   const match=/^bytes 0-0\/(\d+)$/.exec(probe.headers.get('content-range')??''),total=Number(match?.[1]);await probe.arrayBuffer()
   if(!Number.isSafeInteger(total)||total<1||total>limit)throw Error('官方发行包长度无效')
   const result=Buffer.alloc(total),chunkSize=4*1024*1024;let next=0
   await Promise.all(Array.from({length:4},async()=>{
    while(next<total){const start=next;next+=chunkSize;const end=Math.min(total,start+chunkSize)-1
     const response=await fetcher(url,{headers:{...headers,Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(120000),redirect:'error'})
     if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${total}`)throw Error('官方发行包分段响应不匹配')
     const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==end-start+1)throw Error('官方发行包分段长度不匹配');bytes.copy(result,start)
    }
   }))
   return result
  }
  await probe.body?.cancel()
 }
 const response=await fetcher(url,{headers:{'User-Agent':'DSH-Official-CLI-Verification','Accept':'application/json, application/octet-stream, text/plain'},signal:AbortSignal.timeout(120000),redirect:'error'})
 if(!response.ok)throw Error(`官方发行源 HTTP ${response.status}`)
 const parts=[];let total=0
 for await(const chunk of response.body){total+=chunk.length;if(total>limit)throw Error('官方发行源响应过大');parts.push(chunk)}
 return Buffer.concat(parts)
}
/** Fixed official release sources; never accepts an endpoint from model/owner input. */
export async function attestVendorRelease({vendor,version,executable,arch=process.arch,fetcher=officialFetch,cacheFile=join(resolveStateHome(),'model-router','vendor-release-digests.json')}){
 if(!['stepcode','mimo-code'].includes(vendor)||!/^\d+\.\d+\.\d+$/.test(version)||!['x64','arm64'].includes(arch))return {ok:false,reason:'发行版本或平台不受支持'}
 const key=`${vendor}@${version}/windows-${arch}`
 try{
  let record=memory.get(key)
  if(!record){try{const saved=JSON.parse(await readFile(cacheFile,'utf8'));record=saved[key];if(!/^[a-f0-9]{64}$/.test(record?.sha256??''))record=null}catch{}}
  if(!record){
   if(!pending.has(key))pending.set(key,(async()=>{
    let url,checksum
    if(vendor==='stepcode'){
     const manifest=JSON.parse((await download(`https://static-openapi.stepfun.com/stepcode/${version}/manifest.json`,200000,fetcher)).toString('utf8'))
     if(manifest.version?.replace(/^v/,'')!==version)throw Error('官方 Step 发行版本不匹配')
     const expected=`https://static-openapi.stepfun.com/stepcode/${version}/step-${version}-windows-${arch}.zip`
     if(manifest.packages?.[`windows-${arch}`]!==expected)throw Error('官方 Step 发行程序地址不匹配')
     url=expected;checksum=manifest.checksums?.[`windows-${arch}`]
    }else{
     url=`https://mimocode.cnbj1.mi-fds.com/mimocode/mimocode/releases/v${version}/mimocode-windows-${arch}.zip`
     // The current FDS mirror does not publish .sha256. The same official
     // GitHub release supplies an asset digest; verify the mirror against it.
     const release=JSON.parse((await download(`https://api.github.com/repos/XiaomiMiMo/MiMo-Code/releases/tags/v${version}`,2000000,fetcher)).toString('utf8'))
     const name=`mimocode-windows-${arch}.zip`,asset=release.assets?.find(row=>row.name===name)
     if(release.tag_name!==`v${version}`||asset?.browser_download_url!==`https://github.com/XiaomiMiMo/MiMo-Code/releases/download/v${version}/${name}`)throw Error('MiMo 官方发行资料不匹配')
     checksum=/^sha256:([a-f0-9]{64})$/i.exec(asset.digest??'')?.[1]
    }
    if(!/^[a-f0-9]{64}$/i.test(checksum??''))throw Error('官方发行源缺少有效 SHA-256')
    const bytes=await download(url,MAX,fetcher)
    if(sha(bytes)!==checksum.toLowerCase())throw Error('官方发行包 SHA-256 不匹配')
    const value=zipMemberDigest(bytes,vendor==='stepcode'?'step.exe':'mimo.exe');memory.set(key,value)
    await mkdir(dirname(cacheFile),{recursive:true});let saved={};try{saved=JSON.parse(await readFile(cacheFile,'utf8'))}catch{}
    const stage=cacheFile+'.'+process.pid+'.'+Date.now()+'.tmp';await writeFile(stage,JSON.stringify({...saved,[key]:value}));await rename(stage,cacheFile)
    return value
   })().finally(()=>pending.delete(key)))
   record=await pending.get(key)
  }
  memory.set(key,record)
  return await fileHash(executable)===record.sha256?{ok:true,sha256:record.sha256,source:'official-release-sha256'}:{ok:false,reason:'所选程序与官方发行包摘要不一致，请修复安装'}
 }catch(error){return {ok:false,reason:String(error?.message??error).slice(0,240)}}
}

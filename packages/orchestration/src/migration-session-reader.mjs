import {Worker} from 'node:worker_threads'
const defaults=Object.freeze({maxDecodedBytes:64*1024**2,maxLineBytes:4*1024**2,maxEvents:100000,maxNodes:4000000,maxReferences:10000,maxFrames:4096,timeoutMs:15000})
const fail=code=>{throw Object.assign(new Error(code),{code})}
const codes=new Set(['SESSION_DECODE_LIMIT','SESSION_PHYSICAL_INVALID','SESSION_FORMAT_REFUSED','SESSION_VERSION_MISMATCH','SESSION_ZSTD_INVALID','SESSION_CHILD_CONTEXT_REQUIRED'])
let active=0
const waiting=[]
function release(){
 active--
 const next=waiting.shift()
 if(next){next.signal?.removeEventListener('abort',next.cancel);active++;next.resolve(release)}
}
async function reserve(signal){
 if(signal?.aborted)fail('MIGRATION_SESSION_CANCELLED')
 if(active<2){active++;return release}
 if(waiting.length>=8)fail('MIGRATION_SESSION_BUSY')
 return new Promise((resolve,reject)=>{
  const item={resolve,reject,signal,cancel:()=>{const i=waiting.indexOf(item);if(i>=0){waiting.splice(i,1);reject(Object.assign(new Error('cancelled'),{code:'MIGRATION_SESSION_CANCELLED'}))}}}
  waiting.push(item);signal?.addEventListener('abort',item.cancel,{once:true});if(signal?.aborted)item.cancel()
 })
}

/** Isolated, pure SDK decode. No file paths, plugin imports or model work. */
export async function decodeMigrationSession(bytes,{compression,storedVersion,limits:requested={},signal,historicalInspection=false,historicalChildren}={}){
 if(!Buffer.isBuffer(bytes)||bytes.length>32*1024**2||!['none','zstd'].includes(compression)||!Number.isSafeInteger(storedVersion)||storedVersion<0||storedVersion>1000||requested===null||typeof requested!=='object'||Array.isArray(requested)||signal&&(typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))fail('MIGRATION_SESSION_INPUT_INVALID')
 const limits={...defaults}
 for(const [key,value] of Object.entries(requested)){if(!Object.hasOwn(defaults,key)||!Number.isSafeInteger(value)||value<1||value>defaults[key])fail('MIGRATION_SESSION_INPUT_INVALID');limits[key]=value}
 if(signal?.aborted)fail('MIGRATION_SESSION_CANCELLED')
 if(typeof historicalInspection!=='boolean'||historicalChildren!==undefined&&(!Array.isArray(historicalChildren)||historicalChildren.length>10000||Buffer.byteLength(JSON.stringify(historicalChildren))>8*1024**2))fail('MIGRATION_SESSION_INPUT_INVALID')
 const releaseSlot=await reserve(signal)
 try{
 if(signal?.aborted)fail('MIGRATION_SESSION_CANCELLED')
 const payload=Uint8Array.from(bytes)
 return await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./migration-session-decoder.mjs',import.meta.url),{workerData:{bytes:payload,compression,storedVersion,limits,historicalInspection,historicalChildren},transferList:[payload.buffer],resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:16,stackSizeMb:4},stdout:true,stderr:true})
  worker.stdout.resume();worker.stderr.resume()
  let settled=false
  const finish=async(error,value)=>{
   if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel)
   try{await worker.terminate()}catch{error??=Object.assign(new Error('worker-stop'),{code:'MIGRATION_SESSION_WORKER_FAILED'})}
   if(error)reject(error);else resolve(value)
  }
  const cancel=()=>finish(Object.assign(new Error('cancelled'),{code:'MIGRATION_SESSION_CANCELLED'}))
  const timer=setTimeout(()=>finish(Object.assign(new Error('timeout'),{code:'MIGRATION_SESSION_TIMEOUT'})),limits.timeoutMs)
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel()
  worker.once('message',message=>{if(message?.status==='decoded')finish(null,message);else finish(Object.assign(new Error('refused'),{code:codes.has(message?.code)?message.code:'MIGRATION_SESSION_WORKER_FAILED',...(['frames','decoded-bytes','line-bytes','physical-rows','json-nodes','json-depth','logical-events','references'].includes(message?.bound)?{bound:message.bound}:{})}))})
  worker.once('error',e=>finish(Object.assign(new Error('worker-failure'),{code:e.code==='ERR_WORKER_OUT_OF_MEMORY'?'SESSION_DECODE_LIMIT':'MIGRATION_SESSION_WORKER_FAILED',...(e.code==='ERR_WORKER_OUT_OF_MEMORY'?{bound:'worker-memory'}:{})})))
  worker.once('exit',()=>{if(!settled)finish(Object.assign(new Error('worker-exit'),{code:'MIGRATION_SESSION_WORKER_FAILED'}))})
 })
 }finally{releaseSlot()}
}

// rc.3 JSONL provider's small storage-address codec, retained at the adapter
// boundary (MIT @deepseek-ai/dsh-session-persistence-jsonl); not an event codec.
export function sessionStorageAddress(header){
 const encode=raw=>{if(!raw.length)fail('MIGRATION_SESSION_INPUT_INVALID');if(raw==='.')return'~002E';if(raw==='..')return'~002E~002E';let out='';for(let i=0;i<raw.length;i++){const ch=raw[i];out+=ch!=='~'&&/^[A-Za-z0-9._-]$/.test(ch)?ch:'~'+raw.charCodeAt(i).toString(16).toUpperCase().padStart(4,'0')}return out}
 if(typeof header?.id!=='string')fail('MIGRATION_SESSION_INPUT_INVALID')
 let project='_no-cwd'
 if(header.cwd!==undefined){if(typeof header.cwd!=='string'||!header.cwd.length)fail('MIGRATION_SESSION_INPUT_INVALID');let readable='',separator=false;for(let i=0;i<header.cwd.length;i++){const ch=header.cwd[i];if('/\\:'.includes(ch)){if(!separator)readable+='-';separator=true}else{readable+=ch!=='~'&&/^[A-Za-z0-9._-]$/.test(ch)?ch:'~'+header.cwd.charCodeAt(i).toString(16).toUpperCase().padStart(4,'0');separator=false}}project='--'+(readable.replace(/^-+/,'')||'root').slice(0,251)+'--'}
 return project+'/'+encode(header.id)
}

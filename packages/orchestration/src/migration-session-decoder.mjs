import {parentPort,workerData} from 'node:worker_threads'
import {zstdDecompressSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {sessionFormatCatalog,historicalSessionFormatCatalog,createSessionFormatCatalogWithChildren} from '@deepseek-ai/dsh-session-format-catalog'
import {currentSessionMessageProjections} from '@deepseek-ai/dsh-session-format-catalog/message-projections'
import {Session,SessionId,SessionLogOffset} from '@deepseek-ai/dsh-session'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
const sdkRequire=createRequire(import.meta.resolve('@deepseek-ai/dsh-session-format-catalog'))
const {historicalChildCatalogSource}=await import(pathToFileURL(sdkRequire.resolve('@deepseek-ai/dsh-session-format-v3-to-v4')))

const fail=(code,bound)=>{throw Object.assign(new Error(code),{code,...(bound?{bound}:{})})}
const allowed=new Set(['SESSION_DECODE_LIMIT','SESSION_PHYSICAL_INVALID','SESSION_FORMAT_REFUSED','SESSION_VERSION_MISMATCH','SESSION_ZSTD_INVALID','SESSION_CHILD_CONTEXT_REQUIRED'])
// RFC8878 3.1.1: find the complete frame independently of Node/zlib's
// version-dependent truncated-input and bytesWritten behavior. Native zstd
// still validates and decompresses the compressed content and checksum.
function frameEnd(bytes,start,maxDecodedBytes){
 let at=start
 const take=n=>{if(at+n>bytes.length)fail('SESSION_ZSTD_INVALID');const old=at;at+=n;return old}
 if(bytes.readUInt32LE(take(4))!==0xfd2fb528)fail('SESSION_ZSTD_INVALID')
 const descriptor=bytes[take(1)],single=!!(descriptor&32),sizeFlag=descriptor>>>6
 if(descriptor&8)fail('SESSION_ZSTD_INVALID')
 let windowSize
 if(!single){const w=bytes[take(1)],base=2**(10+(w>>>3));windowSize=base+(base/8)*(w&7);if(windowSize>maxDecodedBytes)fail('SESSION_DECODE_LIMIT','decoded-bytes')}
 const dictionarySize=[0,1,2,4][descriptor&3];take(dictionarySize)
 const contentSizeBytes=sizeFlag===0?(single?1:0):[0,2,4,8][sizeFlag]
 if(contentSizeBytes){
  const pos=take(contentSizeBytes);let size=0n
  for(let i=0;i<contentSizeBytes;i++)size|=BigInt(bytes[pos+i])<<BigInt(i*8)
  if(contentSizeBytes===2)size+=256n
  if(size>BigInt(maxDecodedBytes))fail('SESSION_DECODE_LIMIT','decoded-bytes')
  if(single)windowSize=Number(size)
 }
 for(;;){
  const pos=take(3),header=bytes.readUIntLE(pos,3),kind=(header>>>1)&3,size=header>>>3
  if(kind===3||size>Math.min(windowSize,128*1024))fail('SESSION_ZSTD_INVALID')
  take(kind===1?1:size)
  if(header&1)break
 }
 if(descriptor&4)take(4)
 return at
}
try{
 const {compression,storedVersion,limits}=workerData,bytes=Buffer.from(workerData.bytes)
 let decoded=bytes,frames=0
 if(compression==='zstd'){
  const parts=[];let offset=0,total=0
  while(offset<bytes.length){
   if(++frames>limits.maxFrames)fail('SESSION_DECODE_LIMIT','frames')
   const end=frameEnd(bytes,offset,limits.maxDecodedBytes-total)
   let value;try{value=zstdDecompressSync(bytes.subarray(offset,end),{info:true,maxOutputLength:Math.max(1,limits.maxDecodedBytes-total)})}catch(e){if(e.code==='ERR_BUFFER_TOO_LARGE')fail('SESSION_DECODE_LIMIT','decoded-bytes');fail('SESSION_ZSTD_INVALID')}
   const consumed=value.engine.bytesWritten
   if(consumed!==end-offset)fail('SESSION_ZSTD_INVALID')
   if(frames===1&&(value.buffer.indexOf(10)!==value.buffer.length-1||value.buffer.length===0))fail('SESSION_PHYSICAL_INVALID')
   offset+=consumed;total+=value.buffer.length;if(total>limits.maxDecodedBytes)fail('SESSION_DECODE_LIMIT','decoded-bytes');parts.push(value.buffer)
  }
  decoded=Buffer.concat(parts,total)
 }
 if(decoded.length>limits.maxDecodedBytes)fail('SESSION_DECODE_LIMIT','decoded-bytes')
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(decoded)}catch{fail('SESSION_PHYSICAL_INVALID')}
 if(!text.endsWith('\n')||text.startsWith('\uFEFF'))fail('SESSION_PHYSICAL_INVALID')
 const lines=text.slice(0,-1).split('\n');if(!lines.length||lines.length>limits.maxEvents+1)fail('SESSION_DECODE_LIMIT','physical-rows')
 let nodes=0
 function parse(line){
  if(Buffer.byteLength(line)>limits.maxLineBytes)fail('SESSION_DECODE_LIMIT','line-bytes')
  let data;try{data=JSON.parse(line)}catch{fail('SESSION_PHYSICAL_INVALID')}
  const stack=[[data,0]]
  while(stack.length){const [value,depth]=stack.pop();if(++nodes>limits.maxNodes)fail('SESSION_DECODE_LIMIT','json-nodes');if(depth>64)fail('SESSION_DECODE_LIMIT','json-depth');if(value&&typeof value==='object')for(const item of Object.values(value))stack.push([item,depth+1])}
  return data
 }
 const catalog=workerData.historicalInspection&&storedVersion<=3?historicalSessionFormatCatalog:Array.isArray(workerData.historicalChildren)?createSessionFormatCatalogWithChildren(workerData.historicalChildren):sessionFormatCatalog
 const header=parse(lines[0]),classified=catalog.readHeader(header)
 if(!['current','migration-required'].includes(classified.status))fail('SESSION_FORMAT_REFUSED')
 if(classified.storedVersion!==storedVersion)fail('SESSION_VERSION_MISMATCH')
 if(storedVersion<=3&&!workerData.historicalInspection&&!Array.isArray(workerData.historicalChildren))fail('SESSION_CHILD_CONTEXT_REQUIRED')
 let artifact
 try{
  const restore=catalog.createRestore(header,{recovery:'strict',validation:'current'})
  for(const line of lines.slice(1)){const row=parse(line);restore.decodeRow(row)}
  artifact=restore.finish()
 }catch(e){if(allowed.has(e.code))throw e;fail('SESSION_FORMAT_REFUSED')}
 if(artifact.events.length>limits.maxEvents)fail('SESSION_DECODE_LIMIT','logical-events')
 const attachments=[],children=[],seen=new Set();let opaque=0
 function content(message){
  for(const value of Array.isArray(message?.content)?message.content:[]){
   if(['image','file'].includes(value?.type)&&value.attachment&&typeof value.attachment==='object'){
    const ref={...value.attachment,kind:value.type},key=JSON.stringify(ref)
    if(!seen.has(key)){seen.add(key);attachments.push(ref);if(attachments.length>limits.maxReferences)fail('SESSION_DECODE_LIMIT','references')}
   }
  }
 }
 for(const event of artifact.events){
  if(event.type==='subagent/catalog'&&event.seq>=artifact.inheritedEventCount&&typeof event.data?.childId==='string')children.push({id:event.data.childId,mode:event.data.mode})
  if(event.ignorable===true||event.type.startsWith('plugin:'))opaque++
  // Typed surface messages only: opaque plugin/tool JSON is never interpreted
  // merely because it happens to contain a field named attachment.
  if(event.type==='user/message')content(event.data)
  else if(['system/message','developer/message','assistant/message','tool/result'].includes(event.type))content(event.data?.message)
 }
 if(artifact.header.version===4){
  const restored=Session.fromRestore(SessionId(artifact.header.id),artifact.events,artifact.header,SessionLogOffset(artifact.inheritedEventCount),'detached',currentSessionMessageProjections)
  for(const message of restored.deriveMessages())content(message)
 }
 const logicalDigest=createHash('sha256').update(JSON.stringify(artifact)).digest('hex')
 let childFact=null
 if(artifact.header.origin==='subagent'&&artifact.header.parentSession!==undefined){try{childFact=historicalChildCatalogSource(artifact)}catch{childFact={childId:artifact.header.id,childCreatedAt:artifact.header.createdAt,descriptorCount:0,descriptor:null}}}
 parentPort.postMessage({status:'decoded',header:artifact.header,storedVersion,inheritedEventCount:artifact.inheritedEventCount,eventCount:artifact.events.length,decodedBytes:decoded.length,frames,attachments,children,childFact,opaqueRecords:opaque,logicalDigest})
}catch(e){parentPort.postMessage({status:'refused',code:allowed.has(e.code)?e.code:'SESSION_FORMAT_REFUSED',...(['frames','decoded-bytes','line-bytes','physical-rows','json-nodes','json-depth','logical-events','references'].includes(e.bound)?{bound:e.bound}:{})})}

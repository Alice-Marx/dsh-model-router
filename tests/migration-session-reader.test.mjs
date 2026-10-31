import test from 'node:test'
import assert from 'node:assert/strict'
import {zstdCompressSync,constants} from 'node:zlib'
import {sessionFormatCatalog} from '@deepseek-ai/dsh-session-format-catalog'
import {decodeMigrationSession,sessionStorageAddress} from '../packages/orchestration/src/migration-session-reader.mjs'
const header={version:4,id:'fixture',createdAt:1,isSeeded:false,delegationDepth:0}
const physical=sessionFormatCatalog.encodeCurrentHeader(header,0),event=seq=>({type:'session/title',seq,time:2,data:{title:'PRIVATE-TITLE',messageSeqs:[],source:{kind:'user'}}}),line=x=>Buffer.from(JSON.stringify(x)+'\n'),plain=()=>Buffer.concat([line(physical),line(event(0)),line(event(1))])

test('session reader: real current SDK validation retains identity and every physical event',async()=>{
 const data=plain(),before=Buffer.from(data),r=await decodeMigrationSession(data,{compression:'none',storedVersion:4});assert.equal(r.header.id,'fixture');assert.equal(r.eventCount,2);assert.deepEqual(data,before);assert.match(r.logicalDigest,/^[a-f0-9]{64}$/)
})
test('session reader: all concatenated Zstd frames are consumed, including later events',async()=>{
 const bytes=Buffer.concat([zstdCompressSync(line(physical)),zstdCompressSync(line(event(0))),zstdCompressSync(line(event(1)))]),r=await decodeMigrationSession(bytes,{compression:'zstd',storedVersion:4})
 assert.equal(r.eventCount,2);assert.equal(r.frames,3);assert.equal(r.logicalDigest,(await decodeMigrationSession(plain(),{compression:'none',storedVersion:4})).logicalDigest)
})
test('session reader: torn or garbage later compressed frames are refused, not ignored',async()=>{
 const a=zstdCompressSync(line(physical)),b=zstdCompressSync(line(event(0)))
 for(const bytes of [Buffer.concat([a,Buffer.from('garbage')]),Buffer.concat([a,b.subarray(0,b.length-1)])])await assert.rejects(decodeMigrationSession(bytes,{compression:'zstd',storedVersion:4}),{code:'SESSION_ZSTD_INVALID'})
})

test('session reader: every truncated frame boundary and unsupported skippable payload refuses on all Node versions',async()=>{
 const a=zstdCompressSync(line(physical)),b=zstdCompressSync(line(event(0)))
 for(const length of [1,4,5,6,b.length-3,b.length-2,b.length-1])await assert.rejects(decodeMigrationSession(Buffer.concat([a,b.subarray(0,length)]),{compression:'zstd',storedVersion:4}),{code:'SESSION_ZSTD_INVALID'})
 const skip=Buffer.from([0x50,0x2a,0x4d,0x18,0,0,0,0]);await assert.rejects(decodeMigrationSession(Buffer.concat([a,skip]),{compression:'zstd',storedVersion:4}),{code:'SESSION_ZSTD_INVALID'})
 const checksum=zstdCompressSync(line(event(0)),{params:{[constants.ZSTD_c_checksumFlag]:1}})
 assert.equal((await decodeMigrationSession(Buffer.concat([a,checksum]),{compression:'zstd',storedVersion:4})).eventCount,1)
 for(const cut of [1,3,4])await assert.rejects(decodeMigrationSession(Buffer.concat([a,checksum.subarray(0,checksum.length-cut)]),{compression:'zstd',storedVersion:4}),{code:'SESSION_ZSTD_INVALID'})
 const huge=Buffer.from([0x28,0xb5,0x2f,0xfd,0xe0,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x7f])
 await assert.rejects(decodeMigrationSession(huge,{compression:'zstd',storedVersion:4}),{code:'SESSION_DECODE_LIMIT'})
})
test('session reader: a compressed header must be one independent header frame',async()=>{
 await assert.rejects(decodeMigrationSession(zstdCompressSync(plain()),{compression:'zstd',storedVersion:4}),{code:'SESSION_PHYSICAL_INVALID'})
})
test('session reader: physical tails, malformed rows and noncontiguous seqs are refused',async()=>{
 for(const bytes of [plain().subarray(0,plain().length-1),Buffer.concat([line(physical),Buffer.from('bad\n')]),Buffer.concat([line(physical),line(event(1))])])await assert.rejects(decodeMigrationSession(bytes,{compression:'none',storedVersion:4}),e=>['SESSION_PHYSICAL_INVALID','SESSION_FORMAT_REFUSED'].includes(e.code))
})
test('session reader: installed historical V0-V3 codecs migrate only in memory without source changes',async()=>{
 for(const version of [0,1,2,3]){
  const bytes=line({type:'session',version,id:'old-'+version,createdAt:1,delegationDepth:0,...(version>=2?{isSeeded:false}:{})}),before=Buffer.from(bytes),r=await decodeMigrationSession(bytes,{compression:'none',storedVersion:version,historicalChildren:[]})
  assert.equal(r.header.version,4);assert.equal(r.header.id,'old-'+version);assert.equal(r.storedVersion,version);assert.deepEqual(bytes,before)
 }
})
test('session reader: future generations and filename/header version mismatches fail closed',async()=>{
 await assert.rejects(decodeMigrationSession(line({...physical,version:5}),{compression:'none',storedVersion:5}),{code:'SESSION_FORMAT_REFUSED'})
 await assert.rejects(decodeMigrationSession(line(physical),{compression:'none',storedVersion:3}),{code:'SESSION_VERSION_MISMATCH'})
})
test('session reader: historical child inventory is explicit, including a verified empty inventory',async()=>{
 const old=line({type:'session',version:3,id:'parent',createdAt:1,delegationDepth:0,isSeeded:false})
 await assert.rejects(decodeMigrationSession(old,{compression:'none',storedVersion:3}),{code:'SESSION_CHILD_CONTEXT_REQUIRED'})
 assert.equal((await decodeMigrationSession(old,{compression:'none',storedVersion:3,historicalChildren:[]})).header.version,4)
 assert.equal((await decodeMigrationSession(old,{compression:'none',storedVersion:3,historicalInspection:true})).header.version,3)
})
test('session reader: unknown ignorable data stays opaque, unknown required data refuses',async()=>{
 const unknown={type:'future/extension',seq:0,time:2,data:{text:'throw new Error("MUST NOT RUN")',content:[{type:'file',attachment:{attachmentId:'not-a-real-reference',name:'private'}}]},ignorable:true}
 const r=await decodeMigrationSession(Buffer.concat([line(physical),line(unknown)]),{compression:'none',storedVersion:4});assert.equal(r.opaqueRecords,1);assert.equal(r.attachments.length,0)
 delete unknown.ignorable;await assert.rejects(decodeMigrationSession(Buffer.concat([line(physical),line(unknown)]),{compression:'none',storedVersion:4}),{code:'SESSION_FORMAT_REFUSED'})
})
test('session reader: decoded bytes, line length, event count, frame count and nodes are independently bounded',async()=>{
 for(const limits of [{maxDecodedBytes:10},{maxLineBytes:10},{maxEvents:1},{maxNodes:3}])await assert.rejects(decodeMigrationSession(plain(),{compression:'none',storedVersion:4,limits}),{code:'SESSION_DECODE_LIMIT'})
 await assert.rejects(decodeMigrationSession(Buffer.concat([zstdCompressSync(line(physical)),zstdCompressSync(line(event(0)))]),{compression:'zstd',storedVersion:4,limits:{maxFrames:1}}),{code:'SESSION_DECODE_LIMIT'})
})
test('session reader: a valid dense retained record above one million JSON nodes is preserved within byte/heap limits',async()=>{
 const large={type:'fixture/dense',seq:0,time:2,ignorable:true,data:{values:Array(1100000).fill(0)}}
 const r=await decodeMigrationSession(Buffer.concat([line(physical),line(large)]),{compression:'none',storedVersion:4});assert.equal(r.eventCount,1);assert.equal(r.opaqueRecords,1)
})
test('session reader: pre-abort, real in-flight abort and timeout terminate their isolated workers',async()=>{
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(decodeMigrationSession(plain(),{compression:'none',storedVersion:4,signal:cancelled.signal}),{code:'MIGRATION_SESSION_CANCELLED'})
 const running=new AbortController(),promise=decodeMigrationSession(plain(),{compression:'none',storedVersion:4,signal:running.signal});running.abort();await assert.rejects(promise,{code:'MIGRATION_SESSION_CANCELLED'})
 await assert.rejects(decodeMigrationSession(plain(),{compression:'none',storedVersion:4,limits:{timeoutMs:1}}),{code:'MIGRATION_SESSION_TIMEOUT'})
})
test('session reader: invalid signal/limits and cross-platform unsafe IDs do not become paths',async()=>{
 await assert.rejects(decodeMigrationSession(plain(),{compression:'none',storedVersion:4,signal:{aborted:false}}),{code:'MIGRATION_SESSION_INPUT_INVALID'})
 await assert.rejects(decodeMigrationSession(plain(),{compression:'none',storedVersion:4,limits:{maxEvents:0}}),{code:'MIGRATION_SESSION_INPUT_INVALID'})
 assert.equal(sessionStorageAddress({id:'../中文~',cwd:'C:/test'}),'--C-test--/..~002F~4E2D~6587~007E');assert.equal(sessionStorageAddress({id:'..'}),'_no-cwd/~002E~002E')
})
test('session reader: two active workers and eight queued decodes bound concurrency without leaking slots',async()=>{
 const results=await Promise.allSettled(Array.from({length:11},()=>decodeMigrationSession(plain(),{compression:'none',storedVersion:4})))
 assert.equal(results.filter(r=>r.status==='fulfilled').length,10);const denied=results.filter(r=>r.status==='rejected');assert.equal(denied.length,1);assert.equal(denied[0].reason.code,'MIGRATION_SESSION_BUSY')
 assert.equal((await decodeMigrationSession(plain(),{compression:'none',storedVersion:4})).eventCount,2)
})

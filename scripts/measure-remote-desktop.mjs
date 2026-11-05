import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {WebSocket} from 'ws'
import {RemoteAgentClient} from '../remote-computer-agent/dist/index.mjs'

const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1]
if(!args.includes('--pairing'))throw new Error('Usage: --pairing <private file> [--out <json>] [--seconds 8]')
const pair=JSON.parse(await readFile(resolve(option('--pairing')),'utf8')),seconds=Number(args.includes('--seconds')?option('--seconds'):8)
if(!Number.isFinite(seconds)||seconds<2||seconds>30)throw new Error('Invalid sample duration')
const client=new RemoteAgentClient(pair.endpoint,pair.machineId,async()=>pair.token,pair.protectedTunnel===true)
const grant=(await client.grant({botId:'validation-bot',taskId:'desktop-watch-performance',attemptId:'performance-sample',roots:['project'],tools:['desktop_screenshot'],ttlMs:60000})).grantToken
const ticket=await client.desktopSession(grant,{mode:'watch',fps:15}),endpoint=new URL(ticket.path,pair.endpoint);endpoint.protocol=endpoint.protocol==='https:'?'wss:':'ws:'
const frames=[],pings=[],hashes=new Set(),messages=[];let mark=Infinity,pingAt=0,ready,frameMetadata,firstByteMs,started=performance.now(),socket
const until=async predicate=>{for(let n=0;n<300;n++){const result=predicate();if(result)return result;await new Promise(r=>setTimeout(r,50))}throw new Error('PERFORMANCE_SAMPLE_TIMEOUT')}
const quantile=(values,q)=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return Number(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))].toFixed(2))}
const summary={status:'failed',endpoint:pair.endpoint,requestedFps:15,sampleSeconds:seconds,node:process.version}
try{
  socket=new WebSocket(endpoint);socket.on('message',(data,binary)=>{if(!binary){const value=JSON.parse(data.toString());messages.push(value);if(value.type==='ready')ready=value;if(value.type==='frame')frameMetadata=value;return}const at=performance.now();firstByteMs??=at-started;hashes.add(createHash('sha256').update(data).digest('hex'));frames.push({at,bytes:data.length,metadata:frameMetadata})});socket.on('pong',()=>{if(pingAt){pings.push(performance.now()-pingAt);pingAt=0}})
  await new Promise((yes,no)=>{socket.once('open',yes);socket.once('error',no)})
  summary.upgradeMs=Number((performance.now()-started).toFixed(2));socket.send(JSON.stringify({type:'auth',sessionId:ticket.sessionId,token:ticket.token}));await until(()=>ready&&frames.length>=2)
  mark=performance.now();const end=mark+seconds*1000;let nextPing=0
  while(performance.now()<end){if(!pingAt&&performance.now()>=nextPing){pingAt=performance.now();socket.ping();nextPing=performance.now()+250}await new Promise(r=>setTimeout(r,20))}
  const finished=performance.now(),sample=frames.filter(frame=>frame.at>=mark&&frame.at<=finished),intervals=sample.slice(1).map((frame,index)=>frame.at-sample[index].at),bytes=sample.reduce((sum,frame)=>sum+frame.bytes,0)
  Object.assign(summary,{status:'passed',dimensions:{width:ready.width,height:ready.height,dpi:ready.dpi},firstFrameMs:Number(firstByteMs.toFixed(2)),sampleMs:Math.round(finished-mark),frames:sample.length,observedFps:Number((sample.length/((finished-mark)/1000)).toFixed(2)),totalFrames:frames.length,distinctFrameHashes:hashes.size,averageJpegBytes:Math.round(bytes/Math.max(1,sample.length)),throughputMbps:Number((bytes*8/(finished-mark)/1000).toFixed(2)),frameIntervalMs:{p50:quantile(intervals,.5),p95:quantile(intervals,.95)},pingRttMs:{count:pings.length,p50:quantile(pings,.5),p95:quantile(pings,.95)},rawFrames:sample.map(frame=>({atMs:Number((frame.at-mark).toFixed(2)),bytes:frame.bytes,...frame.metadata}))})
}catch(error){summary.error=error.stack;process.exitCode=1}
finally{try{summary.stop=await client.closeDesktopSession(grant,{sessionId:ticket.sessionId})}catch(error){summary.stop={stopConfirmed:false,code:error.code}}socket?.terminate()}
if(args.includes('--out')){const file=resolve(option('--out'));await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(summary,null,2)+'\n')}
process.stdout.write(JSON.stringify(summary,null,2)+'\n')

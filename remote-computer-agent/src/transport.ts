import http from 'node:http'
import https from 'node:https'
import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import {isIP} from 'node:net'
import { Server, WebStandardStreamableHTTPServerTransport, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server'
import { AgentError, AGENT_VERSION, CATALOG, fail } from './protocol.js'
import type { Agent } from './agent.js'
import {AuthThrottle,validateAuthLimits,type AuthLimits} from './auth-throttle.js'
export type NetworkConfig={mode?:'loopback'|'wireguard'|'tailscale'|'cloudflare-tunnel'|'public-tls';host?:string;port?:number;protectedTunnel?:boolean;allowedHosts?:string[];allowedOrigins?:string[];trustedProxies?:string[];authLimits?:AuthLimits;tls?:{keyFile:string;certFile:string;caFile?:string;requireClientCertificate?:boolean}}
const loopback=(host:string)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(host)
export function validateNetwork(c:NetworkConfig){const host=c.host??'127.0.0.1',mode=c.mode??'loopback';if(['0.0.0.0','::','localhost'].includes(host))fail('BIND_ADDRESS_REQUIRED')
  if(!isIP(host)||c.port!==undefined&&(!Number.isSafeInteger(c.port)||c.port<0||c.port>65535))fail('INVALID_NETWORK_CONFIG')
  for(const key of ['allowedHosts','allowedOrigins','trustedProxies'] as const)if(c[key]!==undefined&&(!Array.isArray(c[key])||c[key]!.length>128||c[key]!.some(value=>typeof value!=='string'||!value||value.length>512||/[\s\u0000-\u001f\u007f]/.test(value))))fail('INVALID_NETWORK_CONFIG')
  if(c.trustedProxies?.some(value=>!isIP(value)))fail('INVALID_NETWORK_CONFIG')
  if(c.allowedOrigins?.some(value=>{try{const url=new URL(value);return !['http:','https:'].includes(url.protocol)||url.origin!==value}catch{return true}}))fail('INVALID_NETWORK_CONFIG')
  if(c.allowedHosts?.some(value=>{try{const url=new URL(`http://${value}`);return url.host!==value.toLowerCase()||url.pathname!=='/'||!!url.username||!!url.password||!!url.search||!!url.hash}catch{return true}}))fail('INVALID_NETWORK_CONFIG')
  validateAuthLimits(c.authLimits)
  if(c.tls?.requireClientCertificate&&!c.tls.caFile)fail('MTLS_CA_REQUIRED')
  if(mode==='loopback'&&!loopback(host))fail('TLS_REQUIRED')
  if(['wireguard','tailscale'].includes(mode)){if(!Object.values(networkInterfaces()).flat().some(x=>x?.address===host))fail('BIND_INTERFACE_NOT_FOUND');if(!c.tls&&!c.protectedTunnel)fail('TUNNEL_ATTESTATION_REQUIRED')}
  if(mode==='cloudflare-tunnel'&&(!loopback(host)||!c.protectedTunnel))fail('TUNNEL_BACKEND_MUST_BE_LOOPBACK')
  if(mode==='public-tls'&&!c.tls&&(!loopback(host)||!c.trustedProxies?.length))fail('TLS_REQUIRED')
  if(!c.tls&&!loopback(host)&&!c.protectedTunnel)fail('TLS_REQUIRED')
  if(!['loopback','wireguard','tailscale','cloudflare-tunnel','public-tls'].includes(mode))fail('INVALID_NETWORK_MODE')
}
export async function serve(agent:Agent,c:NetworkConfig={}){
  c=structuredClone(c);validateNetwork(c);const throttle=new AuthThrottle(c.authLimits),host=c.host??'127.0.0.1'
  const handler=async(req:http.IncomingMessage,res:http.ServerResponse)=>{
    let context:any;const source=req.socket.remoteAddress??'unknown';const json=(status:number,value:any)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value))}
    try{
      const address=server.address() as any,defaultHost=`${host.includes(':')?`[${host}]`:host}:${address.port}`
      if(!(c.allowedHosts??[defaultHost]).includes(req.headers.host??''))fail('HOST_DENIED',403)
      const origin=req.headers.origin;if(origin!==undefined&&!(c.allowedOrigins??[]).includes(origin))fail('ORIGIN_DENIED',403)
      if(c.mode==='public-tls'&&!c.tls&&(!(c.trustedProxies??[]).includes(source)||req.headers['x-forwarded-proto']!=='https'))fail('TLS_REQUIRED',403)
      const reject=(decision:ReturnType<AuthThrottle['failure']>)=>{
        if(decision.audit)agent.store.audit(decision.code)
        if(decision.retryAfterMs)res.setHeader('retry-after',String(Math.max(1,Math.ceil(decision.retryAfterMs/1000))))
        fail(decision.code,decision.status)
      }
      const auth=req.headers.authorization??'';if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)){reject(throttle.failure(source))}
      const url=new URL(req.url??'/',`http://${defaultHost}`);let client:any
      const authenticate=()=>{try{if(url.pathname.startsWith('/control/v1/'))client=agent.store.client(auth.slice(7));else context=agent.store.grant(auth.slice(7))}catch{reject(throttle.failure(source))}}
      authenticate()
      // Valid credentials bypass anonymous source cooldown, including shared proxies.
      const limited=throttle.authenticated(client?.id??context.clientId,client?.revision??context.revision)
      if(limited)reject(limited)
      if(req.method!=='POST'){json(405,{error:{code:'METHOD_NOT_ALLOWED'}});return}
      let body=Buffer.alloc(0);for await(const chunk of req){body=Buffer.concat([body,chunk]);if(body.length>2097152)fail('REQUEST_TOO_LARGE',413)}
      let parsed:any;try{parsed=JSON.parse(body.toString('utf8'))}catch{fail('INVALID_JSON')}
      // Rotation/revocation can happen while the authenticated body is arriving.
      // A cached pre-body identity cannot authorize a later management action.
      authenticate()
      if(url.pathname==='/control/v1/grants'){json(200,agent.store.issue(client,parsed));return}
      if(url.pathname==='/control/v1/grants/revoke'){json(200,agent.store.revokeGrants(client,parsed));return}
      if(url.pathname!=='/mcp')fail('NOT_FOUND',404)
      const mcp=new Server({name:'dsh-remote-computer-agent',version:AGENT_VERSION},{capabilities:{tools:{}},supportedProtocolVersions:SUPPORTED_PROTOCOL_VERSIONS})
      const transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:true,sessionIdGenerator:undefined,maxRequestBodySize:2097152})
      mcp.setRequestHandler('tools/list',async()=>{agent.store.validate(context);return {tools:CATALOG.filter(x=>context.tools.includes(x.name)).map(x=>({name:x.name,description:`Remote ${x.name}`,inputSchema:x.inputSchema,annotations:{readOnlyHint:!x.mutating,destructiveHint:x.mutating}}))}})
      mcp.setRequestHandler('tools/call',async(request:any)=>{try{const meta=request.params._meta??{},args=request.params.arguments??{};if(Object.hasOwn(args,'operationId')&&request.params.name!=='operation_status'&&request.params.name!=='operation_cancel')fail('CONTEXT_MUST_BE_HOST_METADATA')
          const result=await agent.call(request.params.name,args,context,meta['dsh/operationId']);agent.store.audit('TOOL_RESULT',context.botId,meta['dsh/operationId']??null);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result}
        }catch(e){const code=e instanceof AgentError?e.code:'EXECUTION_FAILED';agent.store.audit(code,context.botId);return {isError:true,content:[{type:'text',text:code}]}}})
      await mcp.connect(transport)
      try{const response=await transport.handleRequest(new Request(`http://${defaultHost}/mcp`,{method:'POST',headers:req.headers as any,body:body.toString('utf8')}),{parsedBody:parsed});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}finally{await mcp.close()}
    }catch(e){json(e instanceof AgentError?e.status:500,{error:{code:e instanceof AgentError?e.code:'AGENT_INTERNAL'}})}
  }
  const tls=c.tls?{key:readFileSync(c.tls.keyFile),cert:readFileSync(c.tls.certFile),ca:c.tls.caFile?readFileSync(c.tls.caFile):undefined,requestCert:!!c.tls.requireClientCertificate,rejectUnauthorized:!!c.tls.requireClientCertificate}:null
  const server=tls?https.createServer(tls,handler):http.createServer(handler);server.requestTimeout=30000;server.headersTimeout=10000;server.maxConnections=128
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(c.port??9701,host,()=>resolve())})
  return {server,address:server.address(),supportedMcpVersions:SUPPORTED_PROTOCOL_VERSIONS,close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
}

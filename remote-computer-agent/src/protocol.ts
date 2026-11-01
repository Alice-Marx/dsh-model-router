import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
export const AGENT_VERSION = '0.1.0-preview.1'
export const AGENT_API_MAJOR = 1
export class AgentError extends Error { constructor(public code:string, public status=400) { super(code) } }
export const fail = (code:string,status=400):never => { throw new AgentError(code,status) }
export const secret = () => randomBytes(32).toString('base64url')
export const sha = (value:string|Buffer) => createHash('sha256').update(value).digest('hex')
export const matches = (value:string, digest:string) => { const a=Buffer.from(sha(value),'hex'),b=Buffer.from(digest,'hex'); return a.length===b.length && timingSafeEqual(a,b) }
export function canonical(v:any):string { if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(canonical).join(',')}]`;return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` }
export function identifier(v:any):string { if(typeof v!=='string'||!/^[-a-zA-Z0-9_.]{1,128}$/.test(v))fail('INVALID_ID');return v }
export function integer(v:any,min:number,max:number,defaultValue?:number) { const n=v??defaultValue;if(!Number.isSafeInteger(n)||n<min||n>max)fail('INVALID_ARGUMENT');return n }
export type Context = {clientId:string;botId:string;taskId:string;attemptId:string;roots:string[];tools:string[];expiresAt:number;revision:number;grantId:string}
export const CATALOG = Object.freeze([
  ['machine_ping',false],['fs_list',false],['fs_read',false],['fs_write',true],['shell_exec',true],
  // Versioned container-command Task backend. A distinct name means an older
  // Agent answers before any work instead of silently running a native shell.
  ['container_command_v1',true],
  ['operation_status',false],['operation_cancel',true],['artifact_stat',false],['artifact_read',false],
  ['worktree_create',true],['worktree_diff',false],['worktree_integrate',true],
  ['browser_open',true],['browser_snapshot',false],['browser_click',true],['browser_type',true],['browser_download',true],['browser_close',true],
  ['desktop_screenshot',true],['desktop_click',true],['desktop_type',true],['desktop_key',true],['desktop_scroll',true],
].map(([name,mutating])=>({name:String(name),mutating:Boolean(mutating),inputSchema:{type:'object',additionalProperties:true}})))
export const TOOL_NAMES = CATALOG.map(x=>x.name)
export const isMutating = (name:string) => CATALOG.find(x=>x.name===name)?.mutating??false

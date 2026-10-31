import { constants, type Stats } from 'node:fs'
import { lstat, realpath, open, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fail } from './protocol.js'
export type RootProtection = { protectedPaths?: string[]; identityScanLimit?: number }
export class Roots {
  private protectedPaths: string[]
  private identityScanLimit: number
  constructor(public roots:Record<string,string>,options:RootProtection={}){
    this.protectedPaths=(options.protectedPaths??[]).map(p=>path.resolve(p))
    this.identityScanLimit=options.identityScanLimit??8192
    if(!Number.isSafeInteger(this.identityScanLimit)||this.identityScanLimit<1||this.identityScanLimit>65536)throw new Error('Invalid identity scan limit')
  }
  inside(base:string,target:string){const rel=path.relative(base,target);return rel===''||(!rel.startsWith(`..${path.sep}`)&&rel!=='..'&&!path.isAbsolute(rel))}
  private async actual(p:string):Promise<string>{
    try{return await realpath(p)}catch(e:any){
      if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e
      const parent=path.dirname(p);if(parent===p)throw e
      return path.join(await this.actual(parent),path.basename(p))
    }
  }
  private async reserved(){
    const entries=new Set<string>(this.protectedPaths)
    for(const p of this.protectedPaths)entries.add(await this.actual(p))
    return [...entries]
  }
  private identity(s:Stats){return `${s.dev}:${s.ino}`}
  private async privateIdentity(s:Stats){
    if(!s.isFile()||s.nlink<2||!this.protectedPaths.length)return false
    const wanted=this.identity(s),seen=new Set<string>(),stack=[...this.protectedPaths];let count=0
    while(stack.length){
      if(++count>this.identityScanLimit)fail('PRIVATE_PATH_UNVERIFIED',403)
      const p=stack.pop()!;let item:Stats
      try{item=await stat(p)}catch(e:any){if(e.code==='ENOENT'||e.code==='ENOTDIR')continue;fail('PRIVATE_PATH_UNVERIFIED',403)}
      const id=this.identity(item);if(id===wanted)return true
      if(seen.has(id))continue;seen.add(id)
      if(item.isDirectory()){
        let names:string[];try{names=await readdir(p)}catch{fail('PRIVATE_PATH_UNVERIFIED',403)}
        if(names!.length+count+stack.length>this.identityScanLimit)fail('PRIVATE_PATH_UNVERIFIED',403)
        for(const name of names!)stack.push(path.join(p,name))
      }
    }
    return false
  }
  private async allowed(target:string,create=false,descriptor?:Stats){
    const actual=await this.actual(target),reserved=await this.reserved()
    if(reserved.some(p=>this.inside(p,target)||this.inside(p,actual)||(create&&(this.inside(target,p)||this.inside(actual,p)))))fail('WORKSPACE_PRIVATE_PATH',403)
    let s=descriptor
    if(!s)try{s=await stat(target)}catch(e:any){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e}
    if(s&&await this.privateIdentity(s))fail('WORKSPACE_PRIVATE_PATH',403)
  }
  async assertPublicTree(target:string){await this.allowed(target,true)}
  async assertContainerTree(target:string){
    const stack=[target];let count=0
    while(stack.length){
      if(++count>this.identityScanLimit)fail('PRIVATE_PATH_UNVERIFIED',403)
      const current=stack.pop()!,before=await lstat(current)
      if(before.isSymbolicLink())fail('WORKSPACE_OUTSIDE_SCOPE',403)
      await this.allowed(current,true,before)
      if(before.isDirectory()){
        const names=await readdir(current)
        if(names.length+count+stack.length>this.identityScanLimit)fail('PRIVATE_PATH_UNVERIFIED',403)
        for(const name of names)stack.push(path.join(current,name))
      }else if(!before.isFile())fail('WORKSPACE_OUTSIDE_SCOPE',403)
    }
  }
  async resolve(rootId:string,relativePath='',create=false) {
    const configured=Object.hasOwn(this.roots,rootId)?this.roots[rootId]:undefined
    if(!configured||typeof relativePath!=='string'||relativePath.includes('\0')||path.isAbsolute(relativePath)||/^[a-zA-Z]:|^[/\\]{2}|[:]/.test(relativePath))fail('WORKSPACE_OUTSIDE_SCOPE',403)
    const base=await realpath(configured!);const parts=relativePath.split(/[\\/]/).filter(Boolean);if(parts.some(x=>x==='..'||x==='.'||/[. ]$/.test(x)))fail('WORKSPACE_OUTSIDE_SCOPE',403)
    let target=base
    for(let i=0;i<parts.length;i++){target=path.join(target,parts[i]);try{const s=await lstat(target);if(s.isSymbolicLink())fail('WORKSPACE_OUTSIDE_SCOPE',403);const actual=await realpath(target);if(!this.inside(base,actual))fail('WORKSPACE_OUTSIDE_SCOPE',403)}catch(e:any){if(e.code==='ENOENT'&&create&&i===parts.length-1)break;throw e}}
    if(!this.inside(base,target))fail('WORKSPACE_OUTSIDE_SCOPE',403);await this.allowed(target,create);return target
  }
  async read(root:string,relative:string,offset:number,length:number) {
    const target=await this.resolve(root,relative);const handle=await open(target,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
    try{const before=await handle.stat();if(!before.isFile())fail('NOT_A_FILE');const resolved=await this.resolve(root,relative),after=await stat(resolved);if(before.ino!==after.ino||before.dev!==after.dev)fail('FILE_CHANGED',409)
      await this.allowed(resolved,false,before)
      if(process.platform==='linux'){const actual=await realpath(`/proc/self/fd/${handle.fd}`),base=await realpath(this.roots[root]);if(!this.inside(base,actual))fail('WORKSPACE_OUTSIDE_SCOPE',403);await this.allowed(actual,false,before)}
      const data=Buffer.alloc(Math.min(length,Math.max(0,before.size-offset)));const {bytesRead}=await handle.read(data,0,data.length,offset);return {data:data.subarray(0,bytesRead),size:before.size}
    }finally{await handle.close()}
  }
  async list(root:string,relative:string){
    const target=await this.resolve(root,relative),entries=await readdir(target,{withFileTypes:true}),visible=[]
    for(const entry of entries){
      try{await this.allowed(path.join(target,entry.name));visible.push(entry)}catch(e:any){
        if(!['WORKSPACE_PRIVATE_PATH','PRIVATE_PATH_UNVERIFIED'].includes(e.code))throw e
      }
    }
    return visible
  }
}

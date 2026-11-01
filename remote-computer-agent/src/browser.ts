import { randomUUID, createHash } from 'node:crypto'
import { access, mkdir, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fail, sha, type Context } from './protocol.js'
export class BrowserTools {
  private browser:any;private sessions=new Map<string,any>();private profiles=new Map<string,any>()
  constructor(private origins:string[],private executablePath?:string,private loader=()=>import('playwright'),private profileRoots:Record<string,string>={}){}
  async probe(){try{await this.loader();if(this.executablePath)await access(this.executablePath);return {status:this.browser?.isConnected()?'ready':'dependency-ready',launchStatus:this.browser?.isConnected()?'verified':'unverified',engine:'chromium',isolation:'browser-context',allowedOrigins:this.origins,persistentProfiles:Object.keys(this.profileRoots).sort()}}catch{return {status:'unavailable',code:'TOOL_NOT_READY'}}}
  allowed(url:string) {let u:URL;try{u=new URL(url)}catch{fail('URL_OUTSIDE_SCOPE',403)}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!this.origins.includes(u.origin))fail('URL_OUTSIDE_SCOPE',403)}
  async run(name:string,a:any,c:Context) {
    if(name==='browser_open'){
      this.allowed(a.url);if(this.sessions.size>=16)fail('BROWSER_LIMIT',429)
      let pw:any;try{pw=await this.loader()}catch{fail('TOOL_NOT_READY',503)}
      let context,persistent=false,profileId=null
      if(a.profileId!==undefined){
        const root=this.profileRoots[a.profileId];if(!root)fail('BROWSER_PROFILE_DENIED',403)
        const owner=JSON.stringify([c.clientId,c.botId,a.profileId]),key=createHash('sha256').update(owner).digest('hex')
        try{context=this.profiles.get(key);if(!context){const dataDir=join(root,key);await mkdir(dataDir,{recursive:true,mode:0o700});context=await pw.chromium.launchPersistentContext(dataDir,{headless:true,executablePath:this.executablePath,acceptDownloads:true,serviceWorkers:'block'});this.profiles.set(key,context)}persistent=true;profileId=a.profileId
        }catch{fail('BROWSER_PROFILE_UNAVAILABLE',503)}
      }else{
        try{this.browser??=await pw.chromium.launch({headless:true,executablePath:this.executablePath});context=await this.browser.newContext({acceptDownloads:true,serviceWorkers:'block'})}catch{fail('TOOL_NOT_READY',503)}
      }
      await context.route('**/*',async(route:any)=>{try{this.allowed(route.request().url());await route.continue()}catch{await route.abort('blockedbyclient')}})
      const page=await context.newPage();page.on('popup',(p:any)=>void p.close());const id=`browser-${randomUUID()}`,downloads=new Map()
      page.on('download',(download:any)=>{const downloadId=`download-${randomUUID()}`;downloads.set(downloadId,{download,path:download.path(),suggestedFilename:download.suggestedFilename()})})
      this.sessions.set(id,{context,page,owner:JSON.stringify([c.clientId,c.botId,c.taskId,c.attemptId]),revision:null,persistent,profileId,downloads})
      try{await page.goto(a.url,{waitUntil:'domcontentloaded',timeout:30000});return {browserSessionId:id,url:page.url(),browserVersion:this.browser?.version()??'chromium',persistent,profileId}}catch{this.sessions.delete(id);persistent?await page.close():await context.close();fail('BROWSER_NAVIGATION_FAILED')}
    }
    const session=this.sessions.get(a.browserSessionId);if(!session)fail('BROWSER_SESSION_NOT_FOUND',404)
    if(session.owner!==JSON.stringify([c.clientId,c.botId,c.taskId,c.attemptId]))fail('SCOPE_DENIED',403)
    if(name==='browser_close'){session.persistent?await session.page.close():await session.context.close();this.sessions.delete(a.browserSessionId);return {closed:true,persistent:session.persistent}}
    if(name==='browser_download'){
      const item=session.downloads.get(a.downloadId);if(!item)fail('BROWSER_DOWNLOAD_NOT_FOUND',404)
      const path=await item.path,info=await stat(path);if(info.size>1048576)fail('BROWSER_DOWNLOAD_TOO_LARGE',413)
      const data=await readFile(path);await unlink(path);session.downloads.delete(a.downloadId)
      return {downloadId:a.downloadId,filename:item.suggestedFilename,encoding:'base64',content:data.toString('base64'),sha256:sha(data),size:data.length}
    }
    if(name==='browser_snapshot'){
      session.revision=`snapshot-${randomUUID()}`
      const nodes=await session.page.locator('a,button,input,textarea,select,[role="button"]').evaluateAll((elements:any[])=>elements.slice(0,300).map((el:any,i:number)=>{el.setAttribute('data-dsh-agent-ref',String(i));return {ref:String(i),tag:el.tagName.toLowerCase(),text:(el.innerText||el.getAttribute('aria-label')||'').slice(0,300)}}))
      return {browserSessionId:a.browserSessionId,snapshotId:session.revision,url:session.page.url(),text:(await session.page.locator('body').innerText()).slice(0,100000),nodes}
    }
    if(a.snapshotId!==session.revision||!/^\d{1,3}$/.test(a.ref))fail('TARGET_STALE',409)
    const node=session.page.locator(`[data-dsh-agent-ref="${a.ref}"]`);if(await node.count()!==1)fail('TARGET_STALE',409)
    session.revision=null
    if(name==='browser_type'&&(typeof a.text!=='string'||a.text.length>65536))fail('INVALID_ARGUMENT')
    const pendingDownload=name==='browser_click'?session.page.waitForEvent('download',{timeout:1000}).catch(()=>null):null
    try{if(name==='browser_click')await node.click({timeout:10000})
      else if(name==='browser_type')await node.fill(a.text,{timeout:10000})
      else fail('TOOL_NOT_READY',503)
    }catch{fail('OUTCOME_UNKNOWN',409)}
    const download=await pendingDownload,downloadId=download?[...session.downloads.entries()].find(([,item])=>item.download===download)?.[0]:undefined
    return {completed:true,url:session.page.url(),...(downloadId?{downloadId}:{})}
  }
  async close(){for(const s of this.sessions.values())s.persistent?await s.page.close():await s.context.close();this.sessions.clear();for(const context of this.profiles.values())await context.close();this.profiles.clear();await this.browser?.close()}
}

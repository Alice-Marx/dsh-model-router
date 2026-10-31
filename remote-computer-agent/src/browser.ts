import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { fail, type Context } from './protocol.js'
export class BrowserTools {
  private browser:any;private sessions=new Map<string,any>()
  constructor(private origins:string[],private executablePath?:string,private loader=()=>import('playwright')){}
  async probe(){try{await this.loader();if(this.executablePath)await access(this.executablePath);return {status:this.browser?.isConnected()?'ready':'dependency-ready',launchStatus:this.browser?.isConnected()?'verified':'unverified',engine:'chromium',isolation:'browser-context',allowedOrigins:this.origins}}catch{return {status:'unavailable',code:'TOOL_NOT_READY'}}}
  allowed(url:string) {let u:URL;try{u=new URL(url)}catch{fail('URL_OUTSIDE_SCOPE',403)}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!this.origins.includes(u.origin))fail('URL_OUTSIDE_SCOPE',403)}
  async run(name:string,a:any,c:Context) {
    if(name==='browser_open'){
      this.allowed(a.url);if(this.sessions.size>=16)fail('BROWSER_LIMIT',429)
      let pw:any;try{pw=await this.loader();this.browser??=await pw.chromium.launch({headless:true,executablePath:this.executablePath})}catch{fail('TOOL_NOT_READY',503)}
      const context=await this.browser.newContext({acceptDownloads:false,serviceWorkers:'block'})
      await context.route('**/*',async(route:any)=>{try{this.allowed(route.request().url());await route.continue()}catch{await route.abort('blockedbyclient')}})
      const page=await context.newPage();page.on('popup',(p:any)=>void p.close());const id=`browser-${randomUUID()}`
      this.sessions.set(id,{context,page,owner:JSON.stringify([c.clientId,c.botId,c.taskId,c.attemptId]),revision:null})
      try{await page.goto(a.url,{waitUntil:'domcontentloaded',timeout:30000});return {browserSessionId:id,url:page.url(),browserVersion:this.browser.version()}}catch{this.sessions.delete(id);await context.close();fail('BROWSER_NAVIGATION_FAILED')}
    }
    const session=this.sessions.get(a.browserSessionId);if(!session)fail('BROWSER_SESSION_NOT_FOUND',404)
    if(session.owner!==JSON.stringify([c.clientId,c.botId,c.taskId,c.attemptId]))fail('SCOPE_DENIED',403)
    if(name==='browser_close'){await session.context.close();this.sessions.delete(a.browserSessionId);return {closed:true}}
    if(name==='browser_snapshot'){
      session.revision=`snapshot-${randomUUID()}`
      const nodes=await session.page.locator('a,button,input,textarea,select,[role="button"]').evaluateAll((elements:any[])=>elements.slice(0,300).map((el:any,i:number)=>{el.setAttribute('data-dsh-agent-ref',String(i));return {ref:String(i),tag:el.tagName.toLowerCase(),text:(el.innerText||el.getAttribute('aria-label')||'').slice(0,300)}}))
      return {browserSessionId:a.browserSessionId,snapshotId:session.revision,url:session.page.url(),text:(await session.page.locator('body').innerText()).slice(0,100000),nodes}
    }
    if(a.snapshotId!==session.revision||!/^\d{1,3}$/.test(a.ref))fail('TARGET_STALE',409)
    const node=session.page.locator(`[data-dsh-agent-ref="${a.ref}"]`);if(await node.count()!==1)fail('TARGET_STALE',409)
    session.revision=null
    if(name==='browser_type'&&(typeof a.text!=='string'||a.text.length>65536))fail('INVALID_ARGUMENT')
    try{if(name==='browser_click')await node.click({timeout:10000})
      else if(name==='browser_type')await node.fill(a.text,{timeout:10000})
      else fail('TOOL_NOT_READY',503)
    }catch{fail('OUTCOME_UNKNOWN',409)}
    return {completed:true,url:session.page.url()}
  }
  async close(){for(const s of this.sessions.values())await s.context.close();this.sessions.clear();await this.browser?.close()}
}

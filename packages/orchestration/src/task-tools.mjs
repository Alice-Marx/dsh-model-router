/** Register bounded Task commands. Identity comes only from the live SDK Agent object. */
export function registerTaskTools(ctx,defineTool,{service,directory}) {
  const text=description=>({type:'string',required:true,description})
  const commands=[
    ['bot_task_plan_start',{requestKey:text('Plan idempotency key'),plan:{type:'json',required:true,description:'Dependency plan JSON: {schemaVersion:1,taskId:stable ID,origin:{kind:"private"|"group",botId:your Bot ID,sessionId:null},planRevision:1,packages:[{id:unique ID,targetBotId:authorized Bot ID,objective:task text,dependsOn:[package IDs],acceptance:[checks],effectClass:"read"}]}. A scoped file write uses effectClass:"workspace-write" and execution:{backend:"remote-write",input:{machineId,rootId,relativePath,content,expectedHash}}. A container command uses execution:{backend:"remote-command",input:{machineId,rootId,workspaceRelativePath,argv,timeoutMs}} — argv starts with an operator-approved alias (e.g. node) and never carries paths, endpoints or secrets; it runs only in the bound container, never a native shell. Host stamps actual caller Session and revalidates write/command/status/cancel grants. Maximum32 packages. Main may delegate from private chat; other Bots target themselves. No executable paths, endpoints or secrets; no shell.'}},'submitPlan'],
    ['bot_task_plan_status',{planId:text('Persisted plan ID')},'getPlan'],
    ['bot_task_plan_cancel',{planId:text('Persisted plan ID')},'cancelPlan'],
    ['bot_task_start',{requestKey:text('Idempotency key'),backend:text('Fixed host backend'),input:{type:'json',required:true}},'submit'],
    ['bot_task_status',{taskId:text('Persisted Task ID')},'get'],
    ['bot_task_cancel',{taskId:text('Persisted Task ID')},'cancel'],
    ['bot_task_retry',{taskId:text('Persisted Task ID'),requestKey:text('Idempotency key')},'retry'],
    ['bot_task_reconcile',{taskId:text('Persisted Task ID'),requestKey:text('Observation idempotency key')},'reconcile'],
  ]
  const releases=[]
  for(const [name,parameters,method] of commands)releases.push(ctx.tools.register(defineTool({
    name,description:'Managed Task command; the Host validates the owner, fixed backend and effect-specific permissions.',parameters,
    output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:(args,exec)=>method==='submitPlan'?service.submitPlan(directory.forAgent(exec.agent),args,{sessionId:exec.agent.session.id}):service[method](directory.forAgent(exec.agent),args),
  })))
  return ()=>{for(const release of releases.reverse())release()}
}

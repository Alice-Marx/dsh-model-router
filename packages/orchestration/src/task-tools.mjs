/** Register bounded Task commands. Identity comes only from the live SDK Agent object. */
export function registerTaskTools(ctx,defineTool,{service,directory}) {
  const text=description=>({type:'string',required:true,description})
  const commands=[
    ['bot_task_start',{requestKey:text('Idempotency key'),backend:text('Fixed host backend'),input:{type:'json',required:true}},'submit'],
    ['bot_task_status',{taskId:text('Persisted Task ID')},'get'],
    ['bot_task_cancel',{taskId:text('Persisted Task ID')},'cancel'],
    ['bot_task_retry',{taskId:text('Persisted Task ID'),requestKey:text('Idempotency key')},'retry'],
  ]
  const releases=[]
  for(const [name,parameters,method] of commands)releases.push(ctx.tools.register(defineTool({
    name,description:'Managed read-only Task command; the host fixes execution target and owner.',parameters,
    output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:(args,exec)=>service[method](directory.forAgent(exec.agent),args),
  })))
  return ()=>{for(const release of releases.reverse())release()}
}

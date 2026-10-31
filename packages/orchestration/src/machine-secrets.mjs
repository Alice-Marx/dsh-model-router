import {normalizeName} from '../../../modules/bot-runtime/vendor/ds-bot/src/host/secrets.js'
const reserved = value => normalizeName(value).startsWith('REMOTE_AGENT_')
const fail = () => { throw Object.assign(new Error('远程电脑控制凭据只能由宿主使用，不能授予 Bot。'), {code:'MACHINE_SECRET_MUST_BE_HOST_ONLY'}) }

/** Preserve the DS secret store and redaction while reserving a host-only namespace. */
export function guardMachineSecrets(ctx, runtime, machines) {
  const original=runtime.secretEndpoint
  const wrapped=async(endpoint,body={})=>{
    let name=normalizeName(body.name)
    if(endpoint==='secret-allow'||endpoint==='secret-set'&&body.requestId){
      const request=Object.values(runtime.state.secretRequests??{}).flat().find(item=>item.id===body.requestId)
      name=request?normalizeName(request.name):name
    }
    if(reserved(name)){
      if(endpoint==='secret-allow')fail()
      if(['secret-set','secret-update'].includes(endpoint)&&body.scope!==undefined&&(!Array.isArray(body.scope)||body.scope.length))fail()
      if(endpoint==='secret-set'&&body.requestId)fail()
      if(endpoint==='secret-set'&&body.scope===undefined){
        await runtime.loadSecrets()
        const current=runtime.secretsView().find(item=>item.name===name)
        if(!current||!Array.isArray(current.scope)||current.scope.length)fail()
      }
      if(endpoint==='secret-delete'){
        for(const machine of machines.readModel().items.filter(item=>item.status!=='revoked'&&item.secretRef===`ds-secret/${name}`)){
          await machines.revoke({machineId:machine.id,expectedRevision:machine.revision},{kind:'owner'})
        }
      }
    }
    return original.call(runtime,endpoint,body)
  }
  runtime.secretEndpoint=wrapped
  const release=ctx.on('tools/execute',(execution,next)=>{
    if(execution.name==='request_secret'&&reserved(execution.arguments?.name))fail()
    return next()
  })
  return()=>{release();if(runtime.secretEndpoint===wrapped)runtime.secretEndpoint=original}
}

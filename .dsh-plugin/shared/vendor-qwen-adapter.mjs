/** Qwen Code's documented headless JSONL protocol, not terminal text. */
export const qwenTaskArgs=(mode,modelId)=>['--prompt','Complete the task supplied on stdin in the current workspace.',
 '--output-format','stream-json','--safe-mode','--sandbox=false','--approval-mode',mode==='workspace-write'?'yolo':'plan',
 ...(modelId?['--model',modelId]:[])]

export function createQwenParser({label='Qwen',inclusiveInput=true}={}){
 let session=null,terminal=null,failed=false,protocol=null,model=null
 const count=n=>Number.isSafeInteger(n)&&n>=0
 return {
  push(event){
   if(!event||typeof event.type!=='string'){protocol='Qwen 返回无效事件';return}
   if(terminal){protocol='Qwen 在任务终态后仍返回事件';return}
   // Built-in subagent events may share stdout; their result is not this task's terminal.
   if(event.parent_tool_use_id!=null)return
   if(typeof event.session_id!=='string'||!event.session_id){protocol='Qwen 事件缺少会话身份';return}
   if(session&&session!==event.session_id){protocol='Qwen 混入其他会话的结果';return}
   session=event.session_id
   if(event.type==='system'&&typeof event.model==='string')model=event.model
   if(event.type==='assistant'&&typeof event.message?.model==='string')model=event.message.model
   if(event.type==='user'&&Array.isArray(event.message?.content)&&event.message.content.some(block=>block.type==='tool_result'&&block.is_error===true))failed=true
   if(event.type==='result'){
    terminal=event
    if(event.is_error!==false||event.subtype!=='success'||event.permission_denials?.length)failed=true
   }
  },
  finish(exitCode){
   const good=exitCode===0&&!failed&&!protocol&&terminal&&typeof terminal.result==='string'&&terminal.result.trim()
   const u=terminal?.usage,cache=u?.cache_read_input_tokens??0,cacheWrite=u?.cache_creation_input_tokens??0
   // Qwen reports prompt input inclusive of cache reads. Keep ledger counts disjoint.
   const usage=count(u?.input_tokens)&&count(u?.output_tokens)&&count(cache)&&count(cacheWrite)&&(!inclusiveInput||cache+cacheWrite<=u.input_tokens)&&u.input_tokens+u.output_tokens+cache+cacheWrite>0
    ?{inputTokens:u.input_tokens-(inclusiveInput?cache+cacheWrite:0),outputTokens:u.output_tokens,cacheReadTokens:cache,cacheWriteTokens:cacheWrite}:null
   return {status:good?'succeeded':'failed',exitCode,terminalEvent:good?'completed':'failed',finalText:typeof terminal?.result==='string'?terminal.result:'',
    ...(session?{sessionId:session}:{}),...(model?{reportedModel:model}:{}),...(usage?{usage}:{}),
    ...(!good?{error:(protocol??'Qwen 未返回当前任务的完整成功终态；请查看工具诊断。').replaceAll('Qwen',label)}:{})}
  },
 }
}

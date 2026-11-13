import { createNativeRpcEngine } from './native-rpc-engine.mjs'
import { createPiProtocol } from './pi-engine.mjs'

// Step's documented JSONL RPC shares Pi's acknowledgements and settled-turn
// boundary. Its startup flags and credential home are specific to Step.
export function createStepProtocol() {
  const protocol=createPiProtocol({id:'stepAgent',allowedCredentialEnvNames:['STEP_CODING_AGENT_DIR','STEPCODE_AUTH_PATH'],
    args:options=>['--mode','rpc','--include-live-events','--no-session','--no-tools','--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-context-files','--no-approve',
      '--approval-mode','confirm','--non-interactive-approval','deny',
      ...(options.systemPrompt?['--system-prompt',options.systemPrompt]:[])]})
  return Object.freeze({...protocol,async start(ctx){
    if(!/^step\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ctx.options.requestedModel))throw Object.assign(new Error('STEP_CHAT_MODEL_REQUIRED'),{code:'STEP_CHAT_MODEL_REQUIRED'})
    return protocol.start(ctx)
  }})
}
export const createStepEngine=options=>createNativeRpcEngine(options,createStepProtocol())

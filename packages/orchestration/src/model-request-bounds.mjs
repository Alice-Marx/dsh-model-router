// The bounds a Host can prove about one model request, and the ones it cannot.
//
// A configured allowance is a price, not a capacity: it says what the Host is
// willing to pay for, never what the model accepts. This module reads the two
// capacities that actually decide what a provider request is, from the pinned
// adapter that owns the exact route, through the installed SDK's own public
// metadata seam (`LlmRuntime.resolveModelInfo`):
//
//   * `context.contextWindow` — the whole window the route accepts, input and
//     output together. It is the honest input bound: it already accounts for
//     images, tool declarations and adapter framing, so no tokenizer and no
//     source-length estimate stands in for it.
//   * `defaultMaxTokens` — the per-request output cap the adapter materializes
//     into a request that declares none. The SDK's own call-config resolution
//     does exactly that before dispatch, so this is the bound the provider
//     receives for an unbounded request, not a guess about one.
//
// Everything here fails closed with a coded error. A missing context window is
// a missing bound, never a convenient number.

const fail=(code,detail)=>{throw Object.assign(new Error(code),{code,...detail})}
const positive=value=>Number.isSafeInteger(value)&&value>0?value:null
const routeName=(value,what)=>{
  if(typeof value!=='string'||value.length===0||value.length>512)fail('MODEL_ROUTE_INVALID',{what})
  return value
}

/**
 * Resolve the pinned adapter's declared capacity for one exact provider/model
 * route. Nothing is cached: an adapter registration can be replaced under a
 * live Host, and one generation's window must never be combined with another
 * generation's endpoint.
 *
 * @param llm - the live `llm` service, or a function returning it.
 * @param provider - provider route; a route name never carries a namespace.
 * @param model - exact model id; a model id may carry one (`vendor/two`).
 * @param signal - cancellation for the adapter-owned lookup.
 * @returns frozen `{provider,model,contextWindow,defaultMaxTokens}`, where a
 *   missing `defaultMaxTokens` is `null` rather than an invented cap.
 */
export async function resolveModelRouteBounds({llm,provider,model,signal=null}){
  const route={provider:routeName(provider,'provider'),model:routeName(model,'model')}
  // The Host splits a saved route at its first slash, so a provider name that
  // carried one would resolve a different route's model and price the wrong one.
  if(route.provider.includes('/'))fail('MODEL_ROUTE_INVALID',{what:'provider',reason:'namespace'})
  if(!llm||typeof llm.resolveModelInfo!=='function')fail('MODEL_BOUND_SOURCE_REQUIRED')
  if(signal?.aborted)fail('MODEL_BOUND_UNAVAILABLE',{reason:'aborted'})
  let info
  try{info=await llm.resolveModelInfo(route.provider,route.model,signal??undefined)}
  catch(error){fail('MODEL_BOUND_UNAVAILABLE',{reason:typeof error?.code==='string'?error.code:'unavailable'})}
  if(!info||typeof info!=='object')fail('MODEL_BOUND_UNAVAILABLE',{reason:'empty'})
  // An adapter that answers about another route would price another model.
  if(info.provider!==route.provider||info.id!==route.model)fail('MODEL_BOUND_MISMATCH',{provider:route.provider,model:route.model})
  const contextWindow=positive(info.context?.contextWindow)
  if(contextWindow===null)fail('MODEL_INPUT_BOUND_REQUIRED',{provider:route.provider,model:route.model})
  return Object.freeze({provider:route.provider,model:route.model,contextWindow,defaultMaxTokens:positive(info.defaultMaxTokens)})
}

/**
 * The reusable Host resolver. `bounds` answers both capacities for one route;
 * `inputBound` answers only the trusted input upper bound, which is the whole
 * declared window.
 */
export function createModelBoundResolver({llm=null}={}){
  const service=()=>typeof llm==='function'?llm():llm
  const bounds=async({provider,model,signal=null})=>resolveModelRouteBounds({llm:service(),provider,model,signal})
  return Object.freeze({bounds,inputBound:async({provider,model,signal=null})=>(await bounds({provider,model,signal})).contextWindow})
}

/** Materialize a conservative request default when the adapter has none usable.
 * This is an output request limit, never a claim about a model's capacity.
 * Explicit caller controls and unknown context remain subject to normal admission.
 */
export function withRequestOutputDefault(config, { contextWindow, defaultMaxTokens } = {}) {
  if (config.maxTokens !== undefined || positive(contextWindow) === null) return config
  if (positive(defaultMaxTokens) !== null && defaultMaxTokens < contextWindow) return config
  return { ...config, maxTokens: Math.min(8192, Math.max(1, Math.floor(contextWindow / 4))) }
}

/**
 * The output bound one request will actually dispatch with, or the refusal that
 * keeps it out of the ledger.
 *
 * @param requested - the request's own `maxTokens`; `null` when it declares none.
 * @param allowance - the Host-configured priced output allowance.
 * @param adapterDefault - the pinned adapter's declared per-request output cap.
 * @returns `{ok:true,maxTokens,source}` with `source` one of `request`,
 *   `adapter-default` or `clamp`, or `{ok:false,code}`. A `clamp` result also
 *   carries `refusal`: the code to fail with when this request object cannot
 *   carry the clamp.
 */
export function planOutputBound({requested=null,allowance,adapterDefault=null}){
  const cap=positive(allowance)
  if(cap===null)return{ok:false,code:'MODEL_OUTPUT_ALLOWANCE_REQUIRED'}
  const declared=requested===undefined?null:requested
  if(declared!==null&&positive(declared)===null)return{ok:false,code:'MODEL_OUTPUT_BOUNDARY_REQUIRED'}
  const known=declared!==null?declared:positive(adapterDefault)
  if(known!==null&&known<=cap)return{ok:true,maxTokens:known,source:declared!==null?'request':'adapter-default'}
  // The bound the provider will see is above the allowance, or is the provider's
  // own default that nothing declared. Either way the only safe dispatch is the
  // one this request can be made to carry; whether it can is the caller's
  // question, and the refusal names which of the two it was.
  return{ok:true,maxTokens:cap,source:'clamp',refusal:known===null?'MODEL_OUTPUT_BOUND_UNBOUNDED':'MODEL_OUTPUT_BOUND_EXCEEDED'}
}

/**
 * Whether one field of a request object can carry a value the Host writes.
 *
 * Mutability is per field, and it is independent of every other field's: a
 * request whose signal is read-only may still carry a writable `maxTokens`, and
 * the reverse. Only a plain writable data property — present, or addable on an
 * extensible object — counts as writable; an accessor is never written, because
 * restoring one exactly is not something a defineProperty round-trip promises.
 *
 * @returns frozen `{present,canWrite,descriptor}`; `descriptor` is the own
 *   property descriptor to restore, or `null` when the field was absent.
 */
export function requestFieldAccess(options,field){
  const descriptor=Object.getOwnPropertyDescriptor(options,field)
  return Object.freeze({present:Boolean(descriptor),canWrite:descriptor?descriptor.writable===true:Object.isExtensible(options),descriptor:descriptor??null})
}

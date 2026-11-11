import test from 'node:test'
import assert from 'node:assert/strict'
import { withModelBounds } from './helpers/model-request-bounds.mjs'

// What each case proves is causal: the adapter's own record of the request it
// received, the ledger's own rows, and the store's own tables afterwards. A
// refusal that still left a receipt, a reservation or a provider call behind
// would fail here, and so would a clamp the provider never saw.

const code=expected=>error=>error?.code===expected
const nothing=(harness,what)=>assert.equal(harness.upstream.length,0,`the provider was never called: ${what}`)

test('a frozen request above the Host allowance is refused before a receipt, a reservation or a dispatch', async () => {
  await withModelBounds(async harness => {
    const frozen=Object.freeze(harness.request({maxTokens:5000}))
    await assert.rejects(()=>harness.call(frozen),code('MODEL_OUTPUT_BOUND_EXCEEDED'))
    nothing(harness,'frozen above limit')
    assert.equal((await harness.receipts()).length,0,'no receipt was written')
    assert.equal(harness.runs().length,0,'no budget reservation was opened')
    assert.equal(frozen.maxTokens,5000,'the request is untouched')
  })
})

test('a mutable request that declares no bound is brought under the allowance itself', async () => {
  await withModelBounds(async harness => {
    const live=harness.request({model:'nodefault'})
    const descriptor=Object.getOwnPropertyDescriptor(live,'maxTokens')
    await harness.call(live)
    assert.equal(harness.upstream[0].maxTokens,100,'the Host imposed the bound the provider saw')
    assert.equal(live.maxTokens,undefined,'the request was restored')
    assert.deepEqual(Object.getOwnPropertyDescriptor(live,'maxTokens'),descriptor)
    assert.equal((await harness.receipts())[0].outcome,'succeeded')
  })
})

test('a frozen request that declares no output bound has none to admit', async () => {
  await withModelBounds(async harness => {
    // `nodefault` declares a context window but no per-request output cap, so the
    // request that reaches the provider carries no bound the Host could price.
    const frozen=Object.freeze(harness.request({model:'nodefault'}))
    await assert.rejects(()=>harness.call(frozen),code('MODEL_OUTPUT_BOUND_UNBOUNDED'))
    nothing(harness,'frozen without a bound')
    assert.equal((await harness.receipts()).length,0)
    assert.equal(harness.runs().length,0)
  })
})

test('a frozen request within the allowance is admitted exactly as it is', async () => {
  await withModelBounds(async harness => {
    const frozen=Object.freeze(harness.request({maxTokens:50}))
    assert.equal((await harness.call(frozen)).length,3)
    assert.equal(harness.upstream.length,1)
    assert.equal(harness.upstream[0].maxTokens,50,'the provider saw the request unchanged')
    assert.equal(harness.upstream[0].frozen,true)
    const [receipt]=await harness.receipts()
    assert.equal(receipt.state,'settled')
    assert.equal(receipt.outcome,'succeeded')
    assert.equal(harness.rows('router_model_calls').length,1)
    assert.equal(harness.runs().length,1)
  })
})

test('an unbounded frozen request dispatches the pinned adapter default, and that bound is what is recorded', async () => {
  await withModelBounds(async harness => {
    const frozen=Object.freeze(harness.request())
    await harness.call(frozen)
    assert.equal(harness.upstream[0].maxTokens,64,'the installed SDK materialized the adapter-declared cap')
    const [receipt]=await harness.receipts()
    assert.equal(receipt.outcome,'succeeded')
    // The same logical request that dispatched a different bound is a different
    // request, and the same dispatched bound hashes the same.
    await harness.call(Object.freeze(harness.request({maxTokens:50})))
    await harness.call(Object.freeze(harness.request()))
    const [first,second,third]=await harness.receipts()
    assert.notEqual(first.requestHash,second.requestHash)
    assert.equal(first.requestHash,third.requestHash,'the recorded hash describes the bound that dispatched')
  })
})

test('a mutable request above the allowance is clamped for the provider and restored afterwards', async () => {
  await withModelBounds(async harness => {
    const live=harness.request({maxTokens:5000})
    const descriptor=Object.getOwnPropertyDescriptor(live,'maxTokens')
    await harness.call(live)
    assert.equal(harness.upstream[0].maxTokens,100,'the provider saw the clamped bound')
    assert.equal(harness.upstream[0].frozen,false)
    assert.deepEqual(Object.getOwnPropertyDescriptor(live,'maxTokens'),descriptor,'the field was restored exactly')
    assert.equal(live.maxTokens,5000)
    assert.equal((await harness.receipts())[0].outcome,'succeeded')
  })
})

test('a read-only maxTokens keeps its own value even when the signal field is writable', async () => {
  await withModelBounds(async harness => {
    const live=Object.defineProperty(harness.request(),'maxTokens',{value:50,writable:false,configurable:true,enumerable:true})
    await harness.call(live)
    assert.equal(harness.upstream[0].maxTokens,50,'the provider saw the request unchanged')
    assert.equal(live.maxTokens,50)
    assert.equal((await harness.receipts())[0].outcome,'succeeded')
  })
})

test('a read-only maxTokens above the allowance is refused however writable the signal is', async () => {
  await withModelBounds(async harness => {
    const live=Object.defineProperty(harness.request(),'maxTokens',{value:5000,writable:false,configurable:true,enumerable:true})
    await assert.rejects(()=>harness.call(live),code('MODEL_OUTPUT_BOUND_EXCEEDED'))
    nothing(harness,'read-only above limit')
    assert.equal((await harness.receipts()).length,0)
    assert.equal(harness.runs().length,0)
    assert.equal(live.maxTokens,5000)
  })
})

test('a frozen signal does not block clamping the output bound, and is never replaced', async () => {
  await withModelBounds(async harness => {
    const caller=new AbortController()
    const live=harness.request({maxTokens:5000,signal:caller.signal})
    const descriptor=Object.getOwnPropertyDescriptor(live,'signal')
    Object.defineProperty(live,'signal',{...descriptor,writable:false})
    await harness.call(live)
    assert.equal(harness.upstream[0].maxTokens,100,'the clamp did not depend on the signal field')
    assert.equal(harness.upstream[0].hasSignal,true)
    assert.equal(live.signal,caller.signal,'the caller keeps its own signal object')
    assert.equal(live.maxTokens,5000,'the clamped field was restored')
    assert.equal((await harness.receipts())[0].outcome,'succeeded')
  })
})

test('a sealed request keeps a writable bound and is clamped without gaining a field', async () => {
  await withModelBounds(async harness => {
    const sealed=Object.seal(harness.request({maxTokens:5000}))
    await harness.call(sealed)
    assert.equal(harness.upstream[0].maxTokens,100)
    assert.equal(harness.upstream[0].sealed,true)
    assert.equal(sealed.maxTokens,5000)
    assert.equal(Object.isSealed(sealed),true,'the request is still sealed')
    assert.equal(Object.getOwnPropertyNames(sealed).includes('signal'),false,'no signal field was added')
    assert.equal((await harness.receipts())[0].outcome,'succeeded')
  })
})

test('a sealed request with no bound cannot gain one, so it is refused', async () => {
  await withModelBounds(async harness => {
    // `nodefault` declares a window but no per-request cap, so the only way under
    // the allowance is a clamp — and a sealed request cannot gain the field.
    const sealed=Object.seal(harness.request({model:'nodefault'}))
    await assert.rejects(()=>harness.call(sealed),code('MODEL_OUTPUT_BOUND_UNBOUNDED'))
    nothing(harness,'sealed without a bound')
    assert.equal((await harness.receipts()).length,0)
    assert.equal(Object.getOwnPropertyNames(sealed).includes('maxTokens'),false)
  })
})

test('a route whose adapter declares no context window has no input bound to admit', async () => {
  await withModelBounds(async harness => {
    await assert.rejects(()=>harness.call(harness.request({model:'bare',maxTokens:50})),code('MODEL_INPUT_BOUND_REQUIRED'))
    nothing(harness,'no declared window')
    assert.equal((await harness.receipts()).length,0)
    assert.equal(harness.runs().length,0)
  })
})

test('a route whose adapter answers as another route yields no usable bound', async () => {
  await withModelBounds(async harness => {
    await assert.rejects(()=>harness.call(harness.request({model:'mislabelled',maxTokens:50})),code('MODEL_BOUND_UNAVAILABLE'))
    nothing(harness,'mismatched route')
    assert.equal((await harness.receipts()).length,0)
  })
})

test('a pinned window wider than the grant is a required-bound failure, not a smaller estimate', async () => {
  await withModelBounds(async harness => {
    await assert.rejects(()=>harness.call(harness.request({model:'wide',maxTokens:50})),code('MODEL_INPUT_BOUNDARY_REQUIRED'))
    nothing(harness,'window exceeds grant')
    assert.equal((await harness.receipts()).length,0)
    assert.equal(harness.runs().length,0)
  })
})

test('an echoed configured allowance cannot stand in for a route that declares no window', async () => {
  // The previous wiring passed the configured allowance back as the bound. With
  // that seam alone a frozen request still has no adapter-declared cap behind it,
  // so it cannot be admitted on a smaller number than the provider will use.
  await withModelBounds(async harness => {
    await assert.rejects(()=>harness.call(Object.freeze(harness.request({model:'bare'}))),code('MODEL_OUTPUT_BOUND_UNBOUNDED'))
    nothing(harness,'echoed allowance, frozen unbounded request')
    assert.equal((await harness.receipts()).length,0)
  },{boundsSeam:false,inputBoundFor:async({config})=>config.maxInputTokens})
})

test('the reservation prices the bound that dispatches, not the allowance', async () => {
  // 4096 input at 1 and 64 output at 2 is 0.004224; the same request clamped to
  // the allowance of 100 is 0.004296. A daily limit between the two admits the
  // first and refuses the second, which only holds if the estimate uses the
  // dispatched bound.
  await withModelBounds(async harness => {
    assert.equal((await harness.call(harness.request())).length,3)
    assert.equal(harness.upstream[0].maxTokens,64)
    assert.equal((await harness.receipts())[0].outcome,'succeeded')
  },{limits:{dailyLimitUsd:0.00425,monthlyLimitUsd:0}})
  await withModelBounds(async harness => {
    await assert.rejects(()=>harness.call(harness.request({maxTokens:5000})),code('MODEL_WAITING_BUDGET'))
    nothing(harness,'clamped estimate over the daily limit')
    assert.equal((await harness.receipts()).length,0,'a refused reservation wrote no receipt')
    assert.equal(harness.runs().length,0)
  },{limits:{dailyLimitUsd:0.00425,monthlyLimitUsd:0}})
})

test('the caller cancellation signal still ends the turn and the receipt records it', async () => {
  const controller=new AbortController()
  await withModelBounds(async harness => {
    const seen=await harness.call(harness.request({maxTokens:50,signal:controller.signal}))
    assert.deepEqual(seen.map(chunk=>chunk.type),['text-delta','finish'])
    assert.equal(seen[1].reason.kind,'aborted','the provider honored the request signal')
    assert.equal(harness.upstream.length,1,'one provider call, ended by the caller')
    const [receipt]=await harness.receipts()
    assert.equal(receipt.state,'settled')
    assert.equal(receipt.outcome,'cancelled')
    assert.equal(receipt.usage,null,'no usage was invented for an interrupted call')
    assert.equal(harness.runs()[0].status,'cancelled')
    assert.equal(harness.runs()[0].packages[0].costUsd,null)
  },{beforeChunk:index=>{if(index===1)controller.abort()}})
})

test('the authority re-decides the route on every chunk and stops a revoked turn', async () => {
  let revoke=()=>{}
  await withModelBounds(async harness => {
    revoke=harness.revoke
    // A provider that ignores the request signal still cannot outrun the lease:
    // the admission re-asserts the route before every chunk it hands out.
    await assert.rejects(()=>harness.call(harness.request({maxTokens:50})),code('SUBJECT_REVOKED'))
    const [receipt]=await harness.receipts()
    assert.equal(receipt.state,'unknown','an interrupted call is reconciled, never replayed')
    assert.equal(receipt.outcome,'unknown')
    assert.equal(receipt.usage,null)
  },{honorSignal:false,beforeChunk:index=>{if(index===1)revoke()}})
})

test('subscription funding keeps its call quota and its zero money', async () => {
  await withModelBounds(async harness => {
    for(let step=0;step<2;step+=1)assert.equal((await harness.call(harness.request({maxTokens:50}))).length,3)
    await assert.rejects(()=>harness.call(harness.request({maxTokens:50})),code('MODEL_SUBSCRIPTION_LIMIT'))
    const rows=await harness.receipts()
    assert.equal(rows.length,2)
    for(const receipt of rows){assert.equal(receipt.funding,'subscription');assert.equal(receipt.outcome,'succeeded')}
    assert.equal(harness.upstream.length,2)
    for(const run of harness.runs())assert.equal(run.packages[0].costUsd,0)
  },{funding:{a:{funding:'subscription',subscriptionMaxCalls:2,subscriptionMonthlyCalls:null}}})
})

test('an accounting that closes while the bounds are being resolved admits nothing afterwards', async () => {
  let close=()=>{}
  await withModelBounds(async harness => {
    close=()=>harness.accounting.close()
    await assert.rejects(()=>harness.call(harness.request({maxTokens:50})),code('MODEL_ACCOUNTING_CLOSED'))
    nothing(harness,'closed during the bounds lookup')
    assert.equal((await harness.receipts()).length,0)
    assert.equal(harness.runs().length,0)
  },{onBounds:()=>close()})
})

test('two admissions that resolve their bounds together cannot both take the last active slot', async () => {
  let release=()=>{}
  const gate=new Promise(resolve=>{release=resolve})
  await withModelBounds(async harness => {
    const first=harness.call(harness.request({maxTokens:50})),second=harness.call(harness.request({maxTokens:50}))
    release()
    const settled=await Promise.allSettled([first,second])
    const codes=settled.map(result=>result.status==='rejected'?result.reason.code:'admitted')
    assert.deepEqual(codes.filter(entry=>entry==='admitted').length,1,'one call holds the single slot')
    assert.equal(codes.filter(entry=>entry==='MODEL_CONCURRENCY_LIMIT').length,1,'the other is refused, not queued behind it')
    assert.equal(harness.upstream.length,1)
    assert.equal((await harness.receipts()).length,1)
    assert.equal(harness.runs().length,1)
  },{maxActive:1,onBounds:()=>gate})
})

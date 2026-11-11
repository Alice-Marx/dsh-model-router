import test from 'node:test'
import assert from 'node:assert/strict'
import {usageReport,usageCsv,usageDay,usageModel,csvCell} from '../apps/integration-client/usage-report.mjs'

test('receipt date filters are inclusive in the Host timezone and do not treat unknown dates as today',()=>{
  const rows=[{id:'known',createdAt:Date.parse('2026-11-06T17:00:00Z'),amountUsd:.2},{id:'older',createdAt:Date.parse('2026-11-06T15:00:00Z'),amountUsd:.3},{id:'undated',amountUsd:null}]
  assert.equal(usageDay(rows[0],'Asia/Shanghai'),'2026-11-07')
  const report=usageReport(rows,{from:'2026-11-07',to:'2026-11-07',timezone:'Asia/Shanghai'})
  assert.deepEqual(report.rows.map(row=>row.id),['known']);assert.equal(report.undatedExcluded,1);assert.equal(report.summary.knownApiUsd,.2)
  assert.equal(usageReport(rows).rows.length,3)
  assert.match(usageReport(rows,{from:'2026-02-30'}).error,/有效/)
  assert.match(usageReport(rows,{from:'2026-11-08',to:'2026-11-07'}).error,/晚于/)
})

test('known subtotals, unknown charges and subscription counts stay separate in every group',()=>{
  const rows=[{botId:'a',botName:'Same name',provider:'p',model:'m',amountUsd:.2,inputTokens:0},{botId:'a',botName:'Same name',provider:'p',model:'m',amountUsd:null},{botId:'b',botName:'Same name',provider:'other',model:'m',billing:'subscription',amountUsd:999}]
  const report=usageReport(rows,{groupBy:'bot'})
  assert.equal(report.summary.knownApiUsd,.2);assert.equal(report.summary.unknownApiCalls,1);assert.equal(report.summary.subscriptionCalls,1)
  assert.equal(report.groups.length,2);assert.equal(report.groups.find(row=>row.key==='b').knownApiUsd,null)
  assert.equal(usageReport([{amountUsd:null}]).summary.knownApiUsd,null)
  assert.equal(usageReport([{amountUsd:0}]).summary.knownApiUsd,0)
  assert.equal(usageReport(rows,{groupBy:'model'}).groups.length,2);assert.equal(usageModel(rows[0]),'p/m')
  assert.equal(usageReport(rows,{botId:'a',source:'cli'}).rows.length,0)
})

test('CSV preserves unknown and subscription amounts as empty cells and neutralizes spreadsheet formulas, quotes and multiline text',()=>{
  assert.equal(csvCell(' =1+1'),'"\' =1+1"');assert.equal(csvCell('\t=1+1'),'"\'\t=1+1"')
  assert.equal(csvCell('say "hello"\nnext'),'"say ""hello""\nnext"')
  const csv=usageCsv(usageReport([{id:'r1',botName:'=HYPERLINK("https://example.invalid")',amountUsd:null,status:'unknown'},{id:'r2',billing:'subscription',amountUsd:999,status:'settled'},{id:'r3',amountUsd:0,status:'settled'}]))
  assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/'=HYPERLINK\(""https:/)
  assert.match(csv,/'?API","","未知"/);assert.match(csv,/"订阅","","订阅"/);assert.match(csv,/"API","0","已知"/)
  assert.doesNotMatch(csv,/"999"/)
})

test('analysis never mutates receipts and cannot wrap overflowing amounts into a plausible total',()=>{
  const rows=[{id:'a',createdAt:1,amountUsd:1e308},{id:'b',createdAt:2,amountUsd:1e308},{id:'c',createdAt:3,amountUsd:2}]
  const before=JSON.stringify(rows),report=usageReport(rows,{groupBy:'source'})
  assert.equal(JSON.stringify(rows),before);assert.deepEqual(report.rows.map(row=>row.id),['c','b','a'])
  assert.equal(report.summary.knownApiUsd,null);assert.equal(report.summary.amountOverflow,true);assert.equal(report.groups[0].knownApiUsd,null)
  assert.equal(usageReport([{createdAt:0}],{timezone:'not/a/timezone'}).timezone,'UTC')
})

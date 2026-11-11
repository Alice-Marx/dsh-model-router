export const USAGE_SOURCES = Object.freeze({bot:'Bot 对话',aux:'Bot 辅助调用','mr-api':'MR API',cli:'官方 CLI',review:'评审'})
export const USAGE_STATES = Object.freeze({admitted:'已准入',running:'执行中',reported:'已报告',settled:'已结算',unknown:'待核对'})
const quantity=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null
const dateOf=row=>Number.isSafeInteger(row.createdAt)&&row.createdAt>=0?row.createdAt:Number.isSafeInteger(row.finishedAt)&&row.finishedAt>=0?row.finishedAt:null
const validDate=value=>!value||/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value
const formatterCache=new Map()
export function usageTimezone(value){
  if(formatterCache.has(value||'UTC'))return value||'UTC'
  try{new Intl.DateTimeFormat('en',{timeZone:value||'UTC'}).format(0);return value||'UTC'}catch{return 'UTC'}
}
export function usageDay(row,timezone='UTC'){
  const at=dateOf(row)
  if(at===null||!Number.isFinite(new Date(at).getTime()))return null
  const zone=usageTimezone(timezone)
  if(!formatterCache.has(zone)){if(formatterCache.size>=32)formatterCache.delete(formatterCache.keys().next().value);formatterCache.set(zone,new Intl.DateTimeFormat('en',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}))}
  const parts=Object.fromEntries(formatterCache.get(zone).formatToParts(at).map(part=>[part.type,part.value]))
  return `${parts.year.padStart(4,'0')}-${parts.month}-${parts.day}`
}
export const usageModel=row=>typeof row.model==='object'&&row.model?`${row.model.provider??row.provider??'未知来源'}/${row.model.model??row.model.id??'未知模型'}`:row.provider?`${row.provider}/${row.model??row.modelId??'未知模型'}`:String(row.model??row.modelId??'未报告')
const emptySummary=()=>({calls:0,knownApiUsd:null,knownApiCalls:0,amountOverflow:false,unknownApiCalls:0,subscriptionCalls:0,inputTokens:0,outputTokens:0,unknownInputCalls:0,unknownOutputCalls:0})
function accumulate(total,row){
  total.calls++
  const amount=quantity(row.amountUsd??row.costUsd)
  if(row.billing==='subscription')total.subscriptionCalls++
  else if(amount===null)total.unknownApiCalls++
  else {
    total.knownApiCalls++
    if(!total.amountOverflow){const sum=(total.knownApiUsd??0)+amount;total.amountOverflow=!Number.isFinite(sum);total.knownApiUsd=total.amountOverflow?null:sum}
  }
  for(const [field,missing]of [['inputTokens','unknownInputCalls'],['outputTokens','unknownOutputCalls']]){
    const value=Number.isSafeInteger(row[field])&&row[field]>=0?row[field]:null
    if(value===null)total[missing]++
    else total[field]=total[field]===null||!Number.isSafeInteger(total[field]+value)?null:total[field]+value
  }
}

/** Analysis of public source receipts only; no budget, reservation or billing decisions. */
export function usageReport(items=[],{from='',to='',botId='',source='',status='',groupBy='none',timezone='UTC'}={}){
  const error=!validDate(from)||!validDate(to)?'请选择有效的起止日期。':from&&to&&from>to?'开始日期不能晚于结束日期。':''
  const zone=usageTimezone(timezone),rows=[],groups=new Map(),summary=emptySummary()
  let undated=0,undatedExcluded=0
  for(const row of Array.isArray(items)?items:[]){
    if(!row||typeof row!=='object'||botId&&row.botId!==botId||source&&row.source!==source||status&&row.status!==status)continue
    const day=usageDay(row,zone)
    if(!day){undated++;if(from||to)undatedExcluded++}
    if(error||(from||to)&&!day||from&&day<from||to&&day>to)continue
    rows.push(row);accumulate(summary,row)
    if(groupBy!=='none'){
      const key=groupBy==='bot'?String(row.botId??''):groupBy==='model'?usageModel(row):groupBy==='source'?String(row.source??''):day??''
      if(!groups.has(key))groups.set(key,{key,label:groupBy==='bot'?row.botName??row.botId??'未归属':groupBy==='source'?USAGE_SOURCES[row.source]??row.source??'未报告':groupBy==='day'?day??'日期未报告':key,...emptySummary()})
      accumulate(groups.get(key),row)
    }
  }
  rows.sort((a,b)=>(dateOf(b)??-1)-(dateOf(a)??-1)||(b.sequence??0)-(a.sequence??0))
  return {rows,groups:[...groups.values()].sort((a,b)=>groupBy==='day'?b.key.localeCompare(a.key):b.calls-a.calls||a.key.localeCompare(b.key)),summary,timezone:zone,undated,undatedExcluded,error,total:Array.isArray(items)?items.length:0}
}

/** Quoting alone does not prevent spreadsheet formulas in a person's Bot/model name. */
export function csvCell(value){
  let text=value===null||value===undefined?'':String(value).replaceAll('\0','')
  if(/^[\s\uFEFF]*[=+\-@]/u.test(text)||/^[\t\r\n]/.test(text))text=`'${text}`
  return `"${text.replaceAll('"','""')}"`
}
export function usageCsv(report){
  const headers=['收据编号','Bot 编号','Bot 名称','任务编号','运行编号','调用开始时间','日期时区','来源','准确模型','计费方式','金额 USD（空白=未知或订阅）','金额状态','输入 Token（空白=未知）','输出 Token（空白=未知）','状态','核对结果']
  const lines=report.rows.map(row=>{
    const amount=quantity(row.amountUsd??row.costUsd),at=dateOf(row),dated=at!==null&&Number.isFinite(new Date(at).getTime())
    return [row.id??row.receiptId,row.botId,row.botName,row.taskId,row.runId,dated?new Date(at).toISOString():'',report.timezone,USAGE_SOURCES[row.source]??row.source,usageModel(row),row.billing==='subscription'?'订阅':'API',row.billing==='subscription'?null:amount,row.billing==='subscription'?'订阅':amount===null?'未知':'已知',quantity(row.inputTokens),quantity(row.outputTokens),row.status,row.resolution?.kind??'']
  })
  return '\uFEFF'+[headers,...lines].map(cells=>cells.map(csvCell).join(',')).join('\r\n')+'\r\n'
}

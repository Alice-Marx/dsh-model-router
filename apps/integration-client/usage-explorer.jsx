import React,{useEffect,useMemo,useState} from 'react'
import {money} from './api.mjs'
import {usageReport,usageCsv,usageDay,usageModel,USAGE_SOURCES,USAGE_STATES} from './usage-report.mjs'
import {UiIcon} from './ui-icons.jsx'

const quantity=value=>value===null?'未知':value.toLocaleString('zh-CN')
export function UsageExplorer({section,busy=false,scope}){
  const [filter,setFilter]=useState({from:'',to:'',botId:'',source:'',status:'',groupBy:'none'}),[page,setPage]=useState(0),[message,setMessage]=useState('')
  useEffect(()=>{setFilter({from:'',to:'',botId:'',source:'',status:'',groupBy:'none'});setPage(0);setMessage('')},[scope])
  const items=section.items??[]
  const report=useMemo(()=>usageReport(items,{...filter,timezone:section.timezone}),[items,filter,section.timezone])
  const bots=useMemo(()=>[...new Map(items.map(row=>[row.botId??'',row.botName??row.botId??'未归属'])).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]))),[items])
  const statuses=useMemo(()=>[...new Set(items.map(row=>row.status).filter(Boolean))].sort(),[items])
  const pages=Math.max(1,Math.ceil(report.rows.length/100)),current=Math.min(page,pages-1),visible=report.rows.slice(current*100,(current+1)*100)
  const change=(key,value)=>{setFilter(old=>({...old,[key]:value}));setPage(0);setMessage('')}
  const exportCsv=()=>{
    if(busy||report.error||!report.rows.length)return
    try{
      const href=URL.createObjectURL(new Blob([usageCsv(report)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a')
      link.href=href;link.download=`dsh-usage-${filter.from||'all'}-${filter.to||'all'}.csv`;link.hidden=true;document.body.append(link)
      try{link.click()}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(href),1000)}
      setMessage(`已导出 ${report.rows.length} 条当前筛选的收据。`)
    }catch{setMessage('浏览器未能导出文件，请检查下载权限后重试。')}
  }
  return <section className="bp-usage-explorer" aria-label="费用收据明细">
    <div className="bp-usage-heading"><div><h2>收据明细</h2><p className="bp-muted">按调用开始时间筛选 · {report.timezone}。仅包含当前 Bot 的逐条调用收据；早期汇总归档与无归属费用见上方资金汇总。</p></div><button type="button" disabled={busy||Boolean(report.error)||!report.rows.length} onClick={exportCsv}><UiIcon name="download" size={15}/>导出 CSV</button></div>
    <div className="bp-usage-filters">
      <label>开始日期<input type="date" aria-label="收据开始日期" value={filter.from} onChange={event=>change('from',event.target.value)}/></label>
      <label>结束日期<input type="date" aria-label="收据结束日期" value={filter.to} onChange={event=>change('to',event.target.value)}/></label>
      <label>Bot<select aria-label="筛选收据 Bot" value={filter.botId} onChange={event=>change('botId',event.target.value)}><option value="">全部 Bot</option>{bots.filter(([id])=>id).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>来源<select aria-label="筛选收据来源" value={filter.source} onChange={event=>change('source',event.target.value)}><option value="">全部来源</option>{[...new Set(items.map(row=>row.source).filter(Boolean))].sort().map(source=><option key={source} value={source}>{USAGE_SOURCES[source]??source}</option>)}</select></label>
      <label>状态<select aria-label="筛选收据状态" value={filter.status} onChange={event=>change('status',event.target.value)}><option value="">全部状态</option>{statuses.map(status=><option key={status} value={status}>{USAGE_STATES[status]??status}</option>)}</select></label>
      <label>分组<select aria-label="收据分组" value={filter.groupBy} onChange={event=>change('groupBy',event.target.value)}>{[['none','不分组'],['bot','按 Bot'],['model','按模型'],['source','按来源'],['day','按日期']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {report.error&&<p className="bp-error" role="alert">{report.error}</p>}
    {(report.undatedExcluded>0||report.undated>0&&!filter.from&&!filter.to)&&<p className="bp-muted">{report.undatedExcluded?`${report.undatedExcluded} 条收据未报告日期，不计入所选日期范围。`:`${report.undated} 条收据未报告日期，保留在全部明细中。`}</p>}
    <div className="bp-usage-totals" aria-label="当前筛选汇总"><span><strong>{report.summary.calls}</strong> 条收据</span><span>已知 API 金额 <strong>{money(report.summary.knownApiUsd)}</strong></span><span>金额未知 <strong>{report.summary.unknownApiCalls}</strong> 条</span><span>订阅调用 <strong>{report.summary.subscriptionCalls}</strong> 次</span><span>已知 Token {quantity(report.summary.calls>report.summary.unknownInputCalls?report.summary.inputTokens:null)} / {quantity(report.summary.calls>report.summary.unknownOutputCalls?report.summary.outputTokens:null)}{report.summary.unknownInputCalls+report.summary.unknownOutputCalls>0?'（含未报告项）':''}</span></div>
    {report.groups.length>0&&<div className="bp-table-wrap bp-usage-groups"><table><thead><tr><th>分组</th><th>收据数</th><th>已知 API 金额</th><th>金额未知</th><th>订阅调用</th></tr></thead><tbody>{report.groups.map(group=><tr key={group.key}><td>{group.label}</td><td>{group.calls}</td><td>{money(group.knownApiUsd)}</td><td>{group.unknownApiCalls}</td><td>{group.subscriptionCalls}</td></tr>)}</tbody></table></div>}
    {!visible.length?<p className="bp-empty">{items.length?'没有符合条件的收据。':'尚无费用收据。'}</p>:<div className="bp-table-wrap bp-usage-receipts"><table role="table"><thead><tr><th>日期 / Bot / 任务</th><th>来源</th><th>准确模型</th><th>金额</th><th>状态</th></tr></thead><tbody role="rowgroup">{visible.map((row,index)=><tr role="row" key={row.id??row.receiptId??index}><td role="cell" data-label="日期 / Bot / 任务">{usageDay(row,report.timezone)??'日期未报告'}<small>{row.botName??row.botId??'未归属'}</small><small>{row.taskId??row.runId}</small></td><td role="cell" data-label="来源">{USAGE_SOURCES[row.source]??row.source??'未报告'}</td><td role="cell" data-label="准确模型">{usageModel(row)}</td><td role="cell" data-label="金额">{row.billing==='subscription'?'订阅':money(row.amountUsd??row.costUsd)}</td><td role="cell" data-label="状态">{USAGE_STATES[row.status]??row.status??'未知'}{row.resolution&&<span className="bp-tag">{row.resolution.kind==='waive'?'已按零费用放行':`已确认 ${money(row.resolution.costUsd)}`}</span>}</td></tr>)}</tbody></table></div>}
    <div className="bp-usage-pagination"><span>{report.rows.length} / {report.total} 条 · 第 {current+1} / {pages} 页</span><button type="button" disabled={current===0} onClick={()=>setPage(current-1)}>上一页</button><button type="button" disabled={current+1>=pages} onClick={()=>setPage(current+1)}>下一页</button></div>
    {message&&<p role="status">{message}</p>}
  </section>
}

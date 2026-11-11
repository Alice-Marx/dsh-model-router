import React, { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MarkdownText, MarkdownDelegateProvider, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { copyRichText, INDEPENDENT_MARKDOWN_LABELS, richToolArguments } from './independent-chat-rich.mjs'

/**
 * The public Host renderer owns parsing, GFM, math, safe URLs and highlighting.
 * An empty nested delegate deliberately replaces enclosing file capabilities:
 * an authored path never gains an opener or image resolver from another panel.
 */
export const IndependentRichMessage = memo(function IndependentRichMessage({ message, botName, calls = [] }) {
  const text = typeof message.content === 'string' ? message.content : ''
  const [feedback, setFeedback] = useState(null), [codeFeedback, setCodeFeedback] = useState(null)
  const body = useRef(null), scope = useRef({ live: false, revision: 0, copying: false })
  useEffect(() => {
    const current = scope.current; current.live = true; current.revision++; current.copying = false
    setFeedback(null); setCodeFeedback(null)
    return () => { current.live = false; current.revision++; current.copying = false }
  }, [message.messageId, text])
  const copy = async (source, codeTarget = null) => {
    const current = scope.current, revision = current.revision
    if (!current.live || current.copying) return
    current.copying = true
    const focused = document.activeElement
    const ok = await copyRichText(source, writeClipboard)
    if (!current.live || current.revision !== revision) return
    current.copying = false
    const value = { ok, text: ok ? codeTarget ? '代码已复制' : '消息原文已复制' : '复制失败，请展开消息原文后手动复制。' }
    if (codeTarget?.isConnected) setCodeFeedback({ ...value, target: codeTarget })
    else setFeedback(value)
    // The public helper's execCommand fallback temporarily focuses a textarea.
    // Return to this message's own control rather than disturbing the composer.
    if (focused?.isConnected && typeof focused.focus === 'function') focused.focus({ preventScroll: true })
  }
  const copyCode = event => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest('button'), block = button?.closest('.md-code-block')
    if (!block || !body.current?.contains(block)) return
    // These are public SDK 0.2.1-rc.4's observable code-card hooks. If a future
    // Host changes them, do not guess from translated button text: the always
    // present exact-message copy/raw controls still work independently.
    const banner = button.closest('[data-code-block-banner]'), source = block.querySelector('[data-code-block-content] pre')
    if (!banner || !source) return
    event.preventDefault(); event.stopPropagation()
    void copy(source.textContent ?? '', banner)
  }
  const roleLabel = message.role === 'user' ? '你' : message.role === 'assistant' ? botName || 'Bot' : message.role === 'tool' ? message.name || '工具结果' : '上下文记录'
  return <article className={`ic-message ic-message-${message.role}`} data-message-id={message.messageId}>
    <div className="ic-message-meta"><strong>{roleLabel}</strong>{message.at != null && <time>{new Date(message.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>}</div>
    {message.role === 'tool' ? <details className="ic-rich-tool-result"><summary>工具结果{message.toolCallId ? ` · ${message.toolCallId}` : ' · 未记录调用编号'}</summary><pre>{text}</pre>{message.isError === true && <p className="ic-rich-tool-error">记录为错误结果</p>}</details>
      : message.role === 'system' ? <details className="ic-rich-context"><summary>查看上下文记录</summary><pre>{text}</pre></details>
      : text ? <div ref={body} className="ic-bubble ic-rich-body" onClickCapture={copyCode}>
        <MarkdownDelegateProvider><MarkdownText text={text} labels={INDEPENDENT_MARKDOWN_LABELS} variant="body"/></MarkdownDelegateProvider>
        {codeFeedback?.target.isConnected && createPortal(<span className="ic-rich-code-feedback" role="status" data-copy-ok={codeFeedback.ok}>{codeFeedback.text}</span>, codeFeedback.target)}
      </div> : null}
    {calls.length > 0 && <details className="ic-rich-tool-calls"><summary>工具调用 · {calls.length} 项</summary><p className="ic-rich-tool-note">这里显示已记录的调用与返回；结果记录不代表任务完成或已停止。</p>
      {calls.map((call, index) => <section key={`${call.id ?? 'unrecorded'}:${index}`} data-tool-call-id={call.id}>
        <h4>{call.name || '未记录名称'}</h4><dl><dt>调用编号</dt><dd>{call.id || '未记录'}</dd><dt>参数</dt><dd><pre>{richToolArguments(call)}</pre></dd><dt>返回记录</dt><dd>{call.results?.length ? call.results.map(result => <div key={result.messageId} data-tool-result-id={result.messageId}><small>{result.isError === true ? '记录为错误结果' : '已记录返回'} · {result.messageId}</small><pre>{result.content}</pre></div>) : <span>本页尚未记录对应返回；不能据此判断执行结果。</span>}</dd></dl>
      </section>)}
    </details>}
    {message.modelSource && <small className="ic-message-source">{typeof message.modelSource === 'string' ? message.modelSource : `${message.modelSource.provider ?? ''}/${message.modelSource.model ?? ''}`}</small>}
    <div className="ic-rich-message-actions"><button type="button" aria-label="复制消息原文" onClick={() => { void copy(text) }}>复制原文</button><details className="ic-rich-raw"><summary>消息原文</summary><textarea readOnly aria-label="消息原文（可选择复制）" value={text} spellCheck={false}/></details>{feedback && <span role="status" data-copy-ok={feedback.ok}>{feedback.text}</span>}</div>
  </article>
})

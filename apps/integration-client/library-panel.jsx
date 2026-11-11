import React, { useCallback, useEffect, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024
const textFile = name => /\.(?:txt|md|markdown|csv|tsv|json|ya?ml|xml|html|log|m?js|ts|py)$/iu.test(name) || !name.includes('.')
const bytesLabel = size => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`
const fileBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('文件读取失败。'))
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
  reader.readAsDataURL(file)
})

export function LibraryPanel({ snapshot, dispatch, busy, focus }) {
  const bots = snapshot.bots ?? []
  const [botId, setBotId] = useState(bots[0]?.id ?? '')
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState([])
  const [editor, setEditor] = useState(null)
  const [newName, setNewName] = useState('')
  const [filter, setFilter] = useState('')
  const [query, setQuery] = useState(''), [searchResults, setSearchResults] = useState(null), [searchedQuery, setSearchedQuery] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [working, setWorking] = useState(false)
  const [deleteName, setDeleteName] = useState(null)
  const sequence = useRef(0)
  const editorRef = useRef(null)
  const createMenuRef = useRef(null)
  const dispatchRef = useRef(dispatch)
  dispatchRef.current = dispatch
  const call = useCallback(async (action, payload) => {
    const value = await dispatchRef.current(action, payload)
    if (value === undefined || value?.ok === false) throw new Error(value?.error?.message ?? '宿主尚未确认这次操作，请刷新后重试。')
    return value
  }, [])
  const fullPath = name => path ? `${path}/${name}` : name
  const load = useCallback(async () => {
    const generation = ++sequence.current
    if (!botId || typeof dispatchRef.current !== 'function') return
    try {
      const rows = await call('library.list', { botId, relativePath: path })
      if (generation === sequence.current) { setEntries(Array.isArray(rows) ? rows : []); setError('') }
    } catch (failure) { if (generation === sequence.current) setError(String(failure?.message ?? failure)) }
  }, [botId, path, call])
  useEffect(() => { setEditor(null); setDeleteName(null); setEntries([]); setSearchResults(null); void load(); return () => { sequence.current++ } }, [load])
  useEffect(() => { if (!botId && bots[0]) setBotId(bots[0].id) }, [botId, bots])
  useEffect(() => {
    if (focus?.botId && bots.some(bot => bot.id === focus.botId)) { setBotId(focus.botId); setPath(''); setEditor(null); setSearchResults(null) }
  }, [focus?.version, focus?.botId])
  useEffect(() => {
    if (!editor?.line || !editorRef.current) return
    const textarea = editorRef.current, lines = textarea.value.split('\n')
    const index = Math.min(lines.length - 1, Math.max(0, editor.line - 1))
    const start = lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0)
    textarea.focus(); textarea.setSelectionRange(start, start + lines[index].length)
  }, [editor?.relativePath, editor?.line])
  const perform = async work => {
    setWorking(true); setError(''); setStatus('')
    try { await work() } catch (failure) { setError(String(failure?.message ?? failure)) }
    finally { setWorking(false) }
  }
  const upload = event => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    void perform(async () => {
      let uploaded = 0
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} 超过 16 MB。`)
        await call('library.upload', { botId, relativePath: fullPath(file.name), contentBase64: await fileBase64(file) })
        uploaded++
      }
      await load(); if (uploaded) setStatus(`已上传 ${uploaded} 个文件。`)
    })
  }
  const download = name => perform(async () => {
    const value = await call('library.download', { botId, relativePath: fullPath(name) })
    const bytes = Uint8Array.from(atob(value.contentBase64), char => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: value.mediaType ?? 'application/octet-stream' }))
    const link = document.createElement('a'); link.href = url; link.download = name; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  const search = () => perform(async () => {
    const generation = sequence.current, needle = query.trim()
    const result = await call('library.search', { botId, query: needle })
    if (generation !== sequence.current) return
    if (!Array.isArray(result?.results)) throw new Error('宿主返回的搜索结果无效。')
    setSearchResults(result.results); setSearchedQuery(needle)
  })
  const openText = (relativePath, name, line = null) => perform(async () => {
    const generation = sequence.current
    const result = await call('library.read', { botId, relativePath })
    if (generation === sequence.current) setEditor({ name, relativePath, content: result.content, fresh: false, ...(line ? { line } : {}) })
  })
  const open = entry => {
    if (entry.kind === 'directory') { setPath(fullPath(entry.name)); return }
    if (!textFile(entry.name)) { void download(entry.name); return }
    void openText(fullPath(entry.name), entry.name)
  }
  const disabled = busy || working || !botId
  if (!bots.length) return <p className="bp-empty">还没有 Bot。</p>
  return <article className="bp-card bp-library"><div className="bp-card-title"><h2>资料库</h2>
    <select aria-label="资料库 Bot" value={botId} disabled={working} onChange={event => { setBotId(event.target.value); setPath(''); setStatus('') }}>
      {bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name ?? bot.id}</option>)}</select></div>
    <p className="bp-muted">按 Bot 保存文档、图片和工作资料。单文件最大 16 MB，文本可直接编辑。</p>
    <nav className="bp-actions bp-library-breadcrumb" aria-label="资料库目录"><UiIcon name="folder" size={15} /><button disabled={disabled} onClick={() => setPath('')}>根目录</button>
      {path && <><span>/ {path}</span><button disabled={disabled} onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}>上一级</button></>}
      <button disabled={disabled} onClick={() => { void load() }}>列出目录</button></nav>
    <div className="bp-library-toolbar"><label className="bp-search-field"><UiIcon name="search" size={15} /><input aria-label="筛选资料" placeholder="按文件名查找…" value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <details className="bp-create-menu" ref={createMenuRef}><summary><UiIcon name="plus" size={15} />新建</summary><div className="bp-create-popover">
        <input aria-label="新建名称" value={newName} onChange={event => setNewName(event.target.value)} placeholder="文件或文件夹名称" />
        <div className="bp-actions"><button disabled={disabled || !newName.trim()} onClick={() => { setEditor({ name: newName.trim(), content: '', fresh: true }); setNewName(''); createMenuRef.current.open = false }}>新建文本</button>
        <button disabled={disabled || !newName.trim()} onClick={() => { void perform(async () => { await call('library.mkdir', { botId, relativePath: fullPath(newName.trim()) }); setNewName(''); createMenuRef.current.open = false; await load() }) }}>新建文件夹</button></div>
      </div></details>
      <label className="bp-upload"><UiIcon name="upload" size={15} />上传文件<input aria-label="上传资料" type="file" multiple disabled={disabled} onChange={upload} /></label>
    </div>
    <div className="bp-library-search"><input aria-label="资料库文本查询" maxLength={256} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索这个 Bot 的文本内容" />
      <button disabled={disabled || !query.trim()} onClick={() => { void search() }}>搜索文本</button>
      {searchResults !== null && <button disabled={working} onClick={() => setSearchResults(null)}>清除搜索</button>}</div>
    {error && <p className="bp-error" role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {searchResults !== null && <section aria-label="资料库搜索结果"><p role="status">“{searchedQuery}” · {searchResults.length} 条结果（最多 50 条，扫描最多 500 个条目 / 8 层目录，仅限不超过 1 MiB 的文本文件）</p>
      {!searchResults.length ? <p className="bp-muted">没有匹配的文本内容。</p> : <div className="bp-table-wrap"><table>
        <thead><tr><th>文件 / 行号</th><th>匹配文本</th></tr></thead><tbody>{searchResults.map((row, index) => <tr key={`${row.path}:${row.line}:${index}`}>
          <td><button disabled={disabled} className="bp-text-button" onClick={() => { void openText(row.path, row.path.split('/').at(-1), row.line) }}>{row.path}:{row.line}</button></td>
          <td><code>{row.text}</code></td></tr>)}</tbody></table></div>}</section>}
    {!entries.length ? <div className="bp-empty-state"><span className="bp-empty-icon"><UiIcon name="folder" size={28} /></span><strong>给这位伙伴一份资料</strong><p>这个目录是空的。上传文件或新建文本开始。</p></div> : <div className="bp-table-wrap"><table>
      <thead><tr><th>名称</th><th>大小</th><th>操作</th></tr></thead><tbody>{entries.filter(entry => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(entry => <tr key={entry.name}>
        <td><button className="bp-text-button bp-file-name" disabled={disabled || entry.kind === 'other'} onClick={() => open(entry)}><UiIcon name={entry.kind === 'directory' ? 'folder' : 'file'} size={18} />{entry.name}</button></td>
        <td className="bp-file-meta">{entry.kind === 'file' ? bytesLabel(entry.size ?? 0) : '文件夹'}</td><td><div className="bp-row-actions">{entry.kind === 'file' && <>
          {textFile(entry.name) && <button disabled={disabled} onClick={() => open(entry)}>查看</button>}
          <button disabled={disabled} onClick={() => { void download(entry.name) }}>下载</button>
          <button disabled={disabled} onClick={() => setDeleteName(entry.name)}>删除</button></>}
          {deleteName === entry.name && <span>删除此文件？ <button className="bp-button-danger" disabled={disabled} onClick={() => { void perform(async () => { await call('library.remove', { botId, relativePath: fullPath(entry.name) }); setDeleteName(null); if (editor?.name === entry.name) setEditor(null); await load() }) }}>确认删除</button>
            <button onClick={() => setDeleteName(null)}>取消</button></span>}</div></td></tr>)}</tbody></table></div>}
    {editor && <section className="bp-form"><strong>{editor.relativePath ?? editor.name}{editor.line ? `:${editor.line}` : ''}</strong><textarea ref={editorRef} autoFocus rows={12} aria-label="资料内容" value={editor.content} onChange={event => setEditor({ ...editor, content: event.target.value })} />
      <div className="bp-actions"><button className="bp-button-primary" disabled={disabled} onClick={() => { void perform(async () => {
        if (editor.fresh) await call('library.upload', { botId, relativePath: fullPath(editor.name), contentBase64: await fileBase64(new File([editor.content], editor.name, { type: 'text/plain' })) })
        else await call('library.write', { botId, relativePath: editor.relativePath ?? fullPath(editor.name), content: editor.content })
        setEditor({ ...editor, fresh: false }); await load(); setStatus(`已保存 ${editor.name}`)
      }) }}>保存</button><button disabled={working} onClick={() => setEditor(null)}>关闭</button></div></section>}
  </article>
}

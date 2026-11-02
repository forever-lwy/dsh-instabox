import { useEffect, useRef, useState } from 'react'
import { configSchema, type SettingsView, type ConfigData } from '../shared.js'
import type { InstaboxFace } from './face.js'

export function InstaboxSettings({face, openPanel, onSaved}: {face: InstaboxFace; openPanel?: () => void; onSaved?: (view: SettingsView) => void}) {
  const [view, setView] = useState<SettingsView | null>(null)
  const [draft, setDraft] = useState<ConfigData | null>(null)
  const [apiKey, setApiKey] = useState(''), [clearApiKey, setClearApiKey] = useState(false)
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const controller = useRef<AbortController | null>(null), active = useRef(false), latest = useRef(face)
  latest.current = face
  useEffect(() => {
    active.current = true
    const pending = new AbortController(); controller.current = pending; setBusy(true); setError('')
    void latest.current.read(pending.signal).then(value => {
      if (!pending.signal.aborted) { setView(value); setDraft({...value.config}); setApiKey(''); setClearApiKey(false) }
    }).catch(reason => { if (!pending.signal.aborted) setError(reason instanceof Error ? reason.message : '读取设置失败。') })
      .finally(() => { if (!pending.signal.aborted) setBusy(false) })
    return () => { active.current = false; pending.abort(); controller.current?.abort() }
  }, [reload])
  const save = async () => {
    if (!view || !draft || busy) return
    const parsed = configSchema.safeParse(draft)
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join('；')); return }
    const pending = new AbortController(); controller.current = pending
    setBusy(true); setError(''); setMessage('')
    try {
      const value = await latest.current.save({config: parsed.data, expectedRevision: view.revision,
        ...(apiKey.trim() ? {apiKey: apiKey.trim()} : {}), ...(clearApiKey ? {clearApiKey: true} : {})}, pending.signal)
      if (!pending.signal.aborted && active.current) {
        setView(value); setDraft({...value.config}); setApiKey(''); setClearApiKey(false); setMessage('已保存。密钥保存在 DSH 凭据服务中。'); onSaved?.(value)
      }
    } catch (reason) { if (!pending.signal.aborted && active.current) setError(reason instanceof Error ? reason.message : '保存失败。') }
    finally { if (!pending.signal.aborted && active.current) setBusy(false) }
  }
  return <section className="dsi dsi-setting" aria-label="Instabox 设置">
    <h2>Instabox 设置</h2>
    <p className="dsi-muted" style={{marginTop: 8}}>使用创建云机的个人 API Key，可在 DSH 中查看桌面和人工接管。组织 Key 可执行命令和截图，官方不允许它生成桌面观看链接。</p>
    {openPanel && <button type="button" className="dsi-settingslaunch" onClick={openPanel}>打开云电脑</button>}
    {error && <p role="alert" className="dsi-error">{error}</p>}
    {message && <p role="status" className="dsi-good">{message}</p>}
    {busy && !draft && <p role="status" className="dsi-loading">正在读取设置…</p>}
    {!draft || !view ? <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取</button> :
      <form onSubmit={event => {event.preventDefault(); void save()}}>
        <fieldset disabled={busy} style={{border: 0, padding: 0, margin: 0}}>
          <div className="dsi-stack" style={{marginTop: 20}}>
            <label className="dsi-field"><span>API Key 凭据引用</span><input data-setting="apiKeyRef" value={draft.apiKeyRef} spellCheck={false} autoComplete="off"
              onChange={event => setDraft({...draft, apiKeyRef: event.target.value})}/><small>默认 INSTABOX_API_KEY。配置文件只保存引用，不保存密钥。</small></label>
            <label className="dsi-field"><span>API Key {view.credential.configured ? '（已配置，留空保留）' : '（尚未配置）'}</span>
              <input data-setting="apiKey" type="password" value={apiKey} autoComplete="new-password" spellCheck={false} disabled={!view.credential.writable && draft.apiKeyRef === view.config.apiKeyRef}
                onChange={event => {setApiKey(event.target.value); setClearApiKey(false)}} placeholder="ibk_…"/>
              <small>密钥仅发送到当前 DSH 后端，不会回显，也不会写入浏览器存储。</small></label>
            <label className="dsi-check"><input data-setting="clearApiKey" type="checkbox" checked={clearApiKey} disabled={!view.credential.writable && draft.apiKeyRef === view.config.apiKeyRef}
              onChange={event => {setClearApiKey(event.target.checked); if (event.target.checked) setApiKey('')}}/>清除已保存的 API Key</label>
            {!view.credential.writable && <p className="dsi-note">此凭据来源不可写，请在启动环境中修改，或使用可写的凭据引用。</p>}
            <label className="dsi-field"><span>默认机器模板</span><input data-setting="defaultTemplate" value={draft.defaultTemplate} spellCheck={false}
              onChange={event => setDraft({...draft, defaultTemplate: event.target.value})}/><small>桌面推荐 agent-browser；免费套餐可用模板以账户为准。</small></label>
            <label className="dsi-field"><span>单次 HTTP 请求超时（毫秒）</span><input data-setting="requestTimeoutMs" type="number" min={5000} max={120000} step={1000} value={draft.requestTimeoutMs}
              onChange={event => setDraft({...draft, requestTimeoutMs: Number(event.target.value)})}/><small>长操作在插件后台执行，通过短请求查询进度。</small></label>
            <label className="dsi-check"><input data-setting="modelToolsEnabled" type="checkbox" checked={draft.modelToolsEnabled}
              onChange={event => setDraft({...draft, modelToolsEnabled: event.target.checked})}/>允许模型调用 Instabox 工具</label>
            <p className="dsi-muted">接管时，该机器的模型变更操作会暂停；交还后恢复。云机运行、磁盘和流量受 Instabox 套餐及用量限制。</p>
            <div className="dsi-actions"><button type="submit" data-action="save-settings" className="dsi-primary" disabled={busy}>{busy ? '保存中…' : '保存设置'}</button>
              <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取</button>
              <a href="https://dashboard.instabox.sh/dashboard/api-keys" target="_blank" rel="noopener noreferrer">创建 API Key ↗</a></div>
          </div>
        </fieldset>
      </form>}
  </section>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InstaboxFace } from './face.js'
import { listOf, machineIdOf, waitForJob } from './face.js'

const parentOf = (path: string) => path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'
const childOf = (path: string, name: string) => `${path.replace(/\/+$/, '')}/${name}`

/** One cloud directory level from the files API. The response shape is not
 * pinned by the SDK, so directories are recognised from any of the field
 * spellings the API has used; everything else is dropped silently. This runs
 * on every render path, so it never throws on an unexpected payload. */
function directoriesOf(value: unknown, base: string): {name: string; path: string}[] {
  const out: {name: string; path: string}[] = []
  try {
    for (const entry of listOf(value, 'files', 'entries', 'items', 'data')) {
      if (!entry || typeof entry !== 'object') continue
      const raw = String(entry.name ?? entry.filename ?? entry.path ?? '').replace(/\/+$/, '')
      const name = raw.split('/').pop() ?? ''
      const type = String(entry.type ?? entry.kind ?? '')
      const directory = entry.isDirectory === true || entry.isDir === true || type === 'dir' || type === 'directory'
      if (name && directory) out.push({name, path: childOf(base, name)})
    }
  } catch { return [] }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

type Props = {
  face: InstaboxFace
  /** Adopt the Host's local mirror as a Workspace and open a Session in it.
   * Owned by the panel's registration, so this component never reaches for
   * client services itself. */
  openCloudWorkspace?: (localPath: string, signal?: AbortSignal) => Promise<void>
}

/** Pick a cloud directory and turn it into a local Workspace. The dialog only
 * chooses; the Host writes a one-file mirror and hands back a real local path,
 * which the host UI then adopts — the mirror never holds project files. */
export function WorkspacePicker({face, openCloudWorkspace}: Props) {
  const [machines, setMachines] = useState<any[]>([])
  const [machineId, setMachineId] = useState('')
  const [path, setPath] = useState('/data/home')
  const [draft, setDraft] = useState('/data/home')
  const [entries, setEntries] = useState<{name: string; path: string}[]>([])
  const [listing, setListing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const faceRef = useRef(face)
  faceRef.current = face
  // One controller per listing: a newer request aborts the older one, so a slow
  // response for a machine or path the user already left cannot overwrite the
  // entries they are looking at.
  const listingAbort = useRef<AbortController | null>(null)
  const bindAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const request: any = {action: 'machines.list', input: {}, clientId: 'workspace-picker'}
        const initial = await faceRef.current.execute(request, controller.signal)
        const done = await waitForJob(faceRef.current, initial, controller.signal)
        const list = listOf(done.result, 'machines')
        if (controller.signal.aborted) return
        setMachines(list)
        setMachineId(previous => list.some(item => machineIdOf(item) === previous) ? previous : String(machineIdOf(list[0]) || ''))
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      }
    })()
    return () => { controller.abort() }
  }, [])

  const load = useCallback(async (target: string, machine: string) => {
    if (!machine) return
    listingAbort.current?.abort()
    const controller = new AbortController()
    listingAbort.current = controller
    const current = () => listingAbort.current === controller && !controller.signal.aborted
    setListing(true); setError('')
    try {
      const request: any = {action: 'files.list', machineId: machine, input: {path: target}, clientId: 'workspace-picker'}
      const initial = await faceRef.current.execute(request, controller.signal)
      const done = await waitForJob(faceRef.current, initial, controller.signal)
      if (!current()) return
      setEntries(directoriesOf(done.result, target))
    } catch (reason) {
      // An aborted listing is a superseded one, never an error worth showing.
      if (!current()) return
      setEntries([]); setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (current()) setListing(false) }
  }, [])

  // Listing follows the committed path only. The text field is a draft, so
  // keystrokes do not submit files.list; Enter, refresh and directory buttons
  // commit it.
  useEffect(() => { if (machineId) void load(path, machineId) }, [machineId, path, load])
  const commit = (next: string) => {
    setDraft(next)
    if (next === path) void load(next, machineId)
    else setPath(next)
  }

  // Leaving the panel cancels both in-flight operations; their results would
  // otherwise land in a component that no longer exists.
  useEffect(() => () => {
    listingAbort.current?.abort()
    bindAbort.current?.abort()
  }, [])

  const bind = async () => {
    if (!machineId || busy) return
    const bindWorkspace = faceRef.current.bindWorkspace
    if (!bindWorkspace) { setError('当前版本没有可用的工作区接口。'); return }
    if (!openCloudWorkspace) { setError('当前界面没有工作区服务，无法新建会话。'); return }
    bindAbort.current?.abort()
    const controller = new AbortController()
    bindAbort.current = controller
    const current = () => bindAbort.current === controller && !controller.signal.aborted
    setBusy(true); setError('')
    try {
      const view = await bindWorkspace({machineId, remotePath: path}, controller.signal)
      if (!current()) return
      // Handing the path to the host closes this panel, so the state below this
      // line belongs to no rendered component any more.
      await openCloudWorkspace(view.localPath, controller.signal)
    } catch (reason) {
      if (!current()) return
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (current()) setBusy(false) }
  }

  return <section className="dsi-card" aria-label="选择云机工作目录">
    <h3>云机工作目录</h3>
    <p className="dsi-muted">选中的目录会成为本会话的工作区；本机只保存一条标识记录，读写仍直接调用 Instabox API。</p>
    <div className="dsi-fields">
      <label className="dsi-field"><span>机器</span>
        <select value={machineId} onChange={event => setMachineId(event.target.value)} disabled={busy}>
          <option value="">{machines.length ? '请选择机器' : '暂无机器'}</option>
          {machines.map(machine => <option key={machineIdOf(machine)} value={machineIdOf(machine)}>{String(machine?.name ?? machineIdOf(machine))}</option>)}
        </select>
      </label>
      <label className="dsi-field"><span>目录（绝对路径）</span>
        <input type="text" value={draft} spellCheck={false} disabled={busy}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(draft) } }}/>
        <small>回车读取该目录</small>
      </label>
    </div>
    <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:8}}>
      <button type="button" onClick={() => commit(parentOf(path))} disabled={busy || path === '/'}>上一级</button>
      <button type="button" onClick={() => commit(draft)} disabled={busy || listing || !machineId}>{listing ? '读取中…' : '刷新目录'}</button>
      <button type="button" className="dsi-primary" onClick={() => void bind()} disabled={busy || !machineId}>用此目录新建会话</button>
    </div>
    {listing && <p role="status" className="dsi-loading">正在读取云机目录…</p>}
    {entries.length > 0 && <ul className="dsi-list" style={{marginTop:10, maxHeight:220, overflow:'auto'}}>
      {entries.map(entry => <li key={entry.path}>
        <button type="button" onClick={() => commit(entry.path)} disabled={busy}>{entry.name}/</button>
      </li>)}
    </ul>}
    {!listing && machineId && entries.length === 0 && !error && <p className="dsi-muted">该目录下没有子目录，可直接使用此目录。</p>}
    {error && <p role="alert" className="dsi-error">{error}</p>}
  </section>
}

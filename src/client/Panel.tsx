import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ACTIONS, defaultConfig, type Action, type ActionRequest, type ControlView, type JobView, type SettingsView } from '../shared.js'
import { base64ToBytes, bytesToBase64, listOf, machineIdOf, pretty, viewerUrl, waitForJob, type InstaboxFace } from './face.js'
import { InstaboxSettings } from './Settings.js'

type Run = (action: Action, input?: Record<string, unknown>, machineId?: string, quiet?: boolean) => Promise<any>
type Field = {key: string; label: string; type?: 'text'|'number'|'textarea'|'checkbox'|'json'; value?: string|number|boolean; required?: boolean; options?: string[]; min?: number; max?: number; hint?: string}
const MIB = 1024 * 1024
const id = () => typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
const machineName = (machine: any) => String(machine?.name ?? machine?.machine?.name ?? machineIdOf(machine))
const stateName = (state: unknown) => ({running: '运行中', suspended: '已暂停', stopped: '已停止', starting: '启动中', stopping: '停止中', paused: '已暂停'}[String(state)] ?? String(state ?? '未知'))
const terminalState = (job: JobView) => ({queued:'等待中',running:'执行中',succeeded:'已完成',failed:'失败',cancelled:'已取消'}[job.status])
const parentPath = (path: string) => path.replace(/\/$/, '').replace(/\/[^/]*$/, '') || '/'
const childPath = (path: string, name: string) => `${path.replace(/\/$/, '')}/${name}`

export function InstaboxIcon() {
  return <svg className="dsi-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M8 21h8m-4-4v4M7 9l3 2-3 2m6 0h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

function ActionCard({title, description, action, fields = [], run, disabled = false, dangerous = false, onResult, button}: {
  title: string; description?: string; action: Action; fields?: Field[]; run: Run; disabled?: boolean; dangerous?: boolean; onResult?: (value: any) => void; button?: string
}) {
  const [values, setValues] = useState<Record<string, any>>(() => Object.fromEntries(fields.filter(field => field.value !== undefined).map(field => [field.key, field.value])))
  const [busy, setBusy] = useState(false), [result, setResult] = useState<unknown>(), [error, setError] = useState('')
  const mounted = useRef(true), inFlight = useRef(false)
  useEffect(() => {mounted.current = true; return () => {mounted.current = false}}, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled || inFlight.current) return
    const input: Record<string, unknown> = {}
    try {
      for (const field of fields) {
        const value = values[field.key]
        if (value === '' || value === undefined) { if (field.required) throw new Error(`请填写${field.label}。`); continue }
        input[field.key] = field.type === 'json' ? JSON.parse(value) : field.type === 'number' ? Number(value) : value
      }
      if (dangerous && !window.confirm(`确认${title}？此操作可能中断任务或永久删除数据。`)) return
      inFlight.current = true; setBusy(true); setError('')
      const value = await run(action, input)
      if (mounted.current) {setResult(value); onResult?.(value)}
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '操作失败。') }
    finally { inFlight.current = false; if (mounted.current) setBusy(false) }
  }
  return <form className="dsi-card" onSubmit={event => void submit(event)}>
    <h3>{title}</h3>{description && <p className="dsi-muted" style={{marginTop:6}}>{description}</p>}
    <fieldset disabled={disabled || busy} style={{border:0,margin:0,padding:0}}>
      <div className="dsi-fields">{fields.map(field => field.type === 'checkbox' ? <label key={field.key} className="dsi-check"><input type="checkbox" checked={!!values[field.key]} onChange={event => setValues({...values, [field.key]: event.target.checked})}/>{field.label}</label> :
        <label className="dsi-field" key={field.key}><span>{field.label}{field.required ? ' *' : ''}</span>
          {field.options ? <select value={values[field.key] ?? ''} onChange={event => setValues({...values,[field.key]:event.target.value})}>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select> :
            field.type === 'textarea' || field.type === 'json' ? <textarea required={field.required} spellCheck={false} value={values[field.key] ?? ''} onChange={event => setValues({...values,[field.key]:event.target.value})}/> :
              <input required={field.required} type={field.type === 'number' ? 'number' : 'text'} min={field.min} max={field.max} value={values[field.key] ?? ''} spellCheck={false} onChange={event => setValues({...values,[field.key]:event.target.value})}/>}
          {field.hint && <small>{field.hint}</small>}</label>)}</div>
      <div className="dsi-actions" style={{marginTop:12}}><button type="submit" className={dangerous ? 'dsi-danger' : ''}>{busy ? '执行中…' : button ?? title}</button></div>
    </fieldset>
    {error && <p role="alert" className="dsi-error">{error}</p>}{result !== undefined && <pre>{pretty(result)}</pre>}
  </form>
}

function Desktop({run, machineId, ownerId, control, setControl}: {run: Run; machineId: string; ownerId: string; control: ControlView | null; setControl: (value: ControlView | null) => void}) {
  const [url, setUrl] = useState(''), [viewerMode, setViewerMode] = useState<'watch'|'control'|null>(null), [image, setImage] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [x,setX] = useState('0'), [y,setY] = useState('0'), [targetX,setTargetX] = useState('100'), [targetY,setTargetY] = useState('100')
  const [button,setButton] = useState('left'), [text,setText] = useState(''), [keys,setKeys] = useState('ctrl+l'), [website,setWebsite] = useState('https://example.com')
  const [scrollDirection,setScrollDirection] = useState('down'), [amount,setAmount] = useState(3), [width,setWidth] = useState(1280), [height,setHeight] = useState(800)
  const [clickScreenshot,setClickScreenshot] = useState(false)
  const viewer = useRef<HTMLDivElement>(null), imageRef = useRef<HTMLImageElement>(null), live = useRef(true)
  const pendingCleanup = control?.pendingCleanup === true
  const mine = control?.mode === 'human' && control.ownerId === ownerId && !pendingCleanup
  const other = control?.mode === 'human' && !mine && !pendingCleanup
  useEffect(() => {live.current = true; return () => {live.current = false}}, [])
  useEffect(() => {
    if (pendingCleanup) {setUrl('');setViewerMode(null)}
    else if (mine && control?.url) {try {setUrl(viewerUrl(control.url)); setViewerMode('control')} catch (reason) {setError(String(reason));setUrl('');setViewerMode(null)}}
    else if (viewerMode === 'control') {setUrl('');setViewerMode(null)}
  }, [mine, pendingCleanup, control?.url, viewerMode])
  const perform = async (action: Action, input: Record<string, unknown> = {}, handler?: (value: any) => void) => {
    if (busy) return
    setBusy(true); setError('')
    try {const value = await run(action, input); if (live.current) handler?.(value)}
    catch(reason) {if(live.current)setError(reason instanceof Error ? reason.message : '桌面操作失败。')}
    finally {if(live.current)setBusy(false)}
  }
  const watch = () => void perform('desktop.view', {viewOnly:true,ttlSeconds:600}, value => {setUrl(viewerUrl(value.url));setViewerMode('watch')})
  const take = () => void perform('control.take', {ownerId}, value => {setControl(value); setUrl(viewerUrl(value.url));setViewerMode('control')})
  const release = () => {setUrl('');setViewerMode(null); void perform('control.release',{ownerId}, value => setControl(value))}
  const screenshot = () => void perform('desktop.screenshot', {}, value => {
    if (value.mimeType !== 'image/png' || typeof value.base64 !== 'string') throw new Error('截图格式无效。')
    setImage(`data:image/png;base64,${value.base64}`)
  })
  const inputDisabled = !mine || busy
  return <div className="dsi-stack">
    <div className="dsi-card">
      <div className="dsi-actions"><h2>云桌面</h2><span className={`dsi-pill ${mine || other || pendingCleanup ? 'human' : ''}`}>{pendingCleanup ? '上次接管待清理' : mine ? '你正在接管' : other ? '其他窗口正在接管' : control?.mode === 'agent' ? '模型可操作' : '控制状态待确认'}</span><span className="dsi-operation">{machineId}</span></div>
      <div className="dsi-actions"><button type="button" disabled={busy || other || pendingCleanup} onClick={watch}>查看桌面</button>
        {pendingCleanup ? <button type="button" data-action="cleanup-control" className="dsi-primary" disabled={busy} onClick={release}>清理并交还</button> : !mine ? <button type="button" data-action="take-control" className="dsi-primary" disabled={busy || other} onClick={take}>接管键鼠</button> : <button type="button" data-action="release-control" className="dsi-primary" disabled={busy} onClick={release}>交还给模型</button>}
        <button type="button" disabled={busy} onClick={screenshot}>截图</button>
        <button type="button" disabled={busy || other} onClick={() => {
          if (!window.confirm('撤销这台机器的全部桌面链接并断开所有观看者？')) return
          setUrl('');setViewerMode(null)
          if (mine || pendingCleanup) release()
          else void perform('desktop.revoke',{},()=>{void run('control.status',{},machineId,true).then(setControl).catch(()=>{})})
        }}>撤销全部桌面链接</button></div>
      {mine && <p className="dsi-note">接管期间，插件阻止模型对这台机器发出新的变更操作。已在云机运行的后台进程会继续。离开面板或交还时将撤销交互链接。</p>}
      {pendingCleanup && <p className="dsi-note" role="status">上次接管的桌面链接尚未确认撤销，模型仍被锁定。请先清理并交还；若密钥失效，可在“设置”更新 API Key 后重试。清理成功前不会开放模型变更操作。</p>}
      {!mine && !pendingCleanup && <p className="dsi-muted" style={{marginTop:10}}>观看链接只读。点击“接管键鼠”后可在桌面中操作；链接等同访问凭证，请勿转发给他人。</p>}
      {error && <p role="alert" className="dsi-error">{error}</p>}
    </div>
    {url && !pendingCleanup && !(viewerMode === 'control' && !mine) ? <div className="dsi-view" ref={viewer}>
      <div className="dsi-viewbar"><span>{viewerMode === 'control' ? '人工接管 · 可交互' : '实时桌面 · 只读'}</span><div className="dsi-actions">
        <a href={url} target="_blank" rel="noopener noreferrer">新窗口 ↗</a>
        <button type="button" onClick={() => { const pending = document.fullscreenElement ? document.exitFullscreen?.() : viewer.current?.requestFullscreen?.(); if (pending) void pending.catch(reason => setError(reason instanceof Error ? reason.message : '无法全屏')); else setError('当前浏览器未提供全屏功能。') }}>全屏</button>
        {mine && <button type="button" onClick={release} disabled={busy}>交还</button>}
        <button type="button" onClick={() => setUrl('')}>隐藏画面</button></div></div>
      <iframe title={viewerMode === 'control' ? 'Instabox 人工接管桌面' : 'Instabox 只读桌面'} src={url} allow="clipboard-read; clipboard-write; fullscreen" allowFullScreen referrerPolicy="no-referrer"/>
    </div> : <div className="dsi-view dsi-empty" style={{color:'#ddd'}}><InstaboxIcon/><p>{pendingCleanup ? '桌面接管待清理，交互画面已关闭。' : '打开桌面观看或接管；机器须处于运行状态。'}</p><small>本版组织 Key 支持截图和模型工具；人工键鼠接管与实时桌面需使用创建机器的个人 Key。</small></div>}
    {image && <div className="dsi-card dsi-shot"><div className="dsi-actions"><h3>最新截图</h3>
      <label className="dsi-check"><input type="checkbox" checked={clickScreenshot} disabled={!mine} onChange={event => setClickScreenshot(event.target.checked)}/>点击截图发送鼠标点击</label>
      <button type="button" onClick={() => {const link=document.createElement('a');link.href=image;link.download=`instabox-${machineId}.png`;link.click()}}>保存 PNG</button></div>
      <img className="dsi-preview" ref={imageRef} src={image} alt="Instabox 云桌面截图" onClick={event => {
        const node=imageRef.current;if(!node || !mine)return;const box=node.getBoundingClientRect();
        const px=Math.floor((event.clientX-box.left)*node.naturalWidth/box.width),py=Math.floor((event.clientY-box.top)*node.naturalHeight/box.height)
        setX(String(px));setY(String(py));if(clickScreenshot&&!busy)void perform('desktop.click',{x:px,y:py,button})
      }}/></div>}
    <div className="dsi-grid">
      <div className="dsi-card"><h3>键鼠与输入</h3><p className="dsi-muted" style={{marginTop:6}}>先接管，避免与模型同时操作。坐标以完整屏幕左上角为原点。</p>
        <fieldset disabled={inputDisabled} style={{border:0,padding:0,margin:0}}>
          <div className="dsi-fields"><label className="dsi-field">X<input className="dsi-coordinate" type="number" min={0} value={x} onChange={event=>setX(event.target.value)}/></label>
            <label className="dsi-field">Y<input className="dsi-coordinate" type="number" min={0} value={y} onChange={event=>setY(event.target.value)}/></label>
            <label className="dsi-field">鼠标键<select value={button} onChange={event=>setButton(event.target.value)}><option value="left">左键</option><option value="right">右键</option><option value="middle">中键</option></select></label></div>
          <div className="dsi-actions" style={{marginTop:10}}><button type="button" onClick={()=>void perform('desktop.click',{x:Number(x),y:Number(y),button})}>单击</button><button type="button" onClick={()=>void perform('desktop.click',{x:Number(x),y:Number(y),button,double:true})}>双击</button><button type="button" onClick={()=>void perform('desktop.move',{x:Number(x),y:Number(y)})}>移动指针</button><button type="button" onClick={()=>void perform('desktop.cursor',{},v=>{setX(String(v.x));setY(String(v.y))})}>读取坐标</button></div>
          <div className="dsi-fields"><label className="dsi-field">拖拽目标 X<input type="number" min={0} value={targetX} onChange={event=>setTargetX(event.target.value)}/></label><label className="dsi-field">拖拽目标 Y<input type="number" min={0} value={targetY} onChange={event=>setTargetY(event.target.value)}/></label></div>
          <div className="dsi-actions" style={{marginTop:10}}><button type="button" onClick={()=>void perform('desktop.drag',{from:[Number(x),Number(y)],to:[Number(targetX),Number(targetY)]})}>拖拽到目标</button></div>
          <div className="dsi-fields"><label className="dsi-field">滚动方向<select value={scrollDirection} onChange={event=>setScrollDirection(event.target.value)}>{[['up','上'],['down','下'],['left','左'],['right','右']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="dsi-field">格数<input type="number" min={1} max={100} value={amount} onChange={event=>setAmount(Number(event.target.value))}/></label></div>
          <div className="dsi-actions" style={{marginTop:10}}><button type="button" onClick={()=>void perform('desktop.scroll',{direction:scrollDirection,amount})}>滚动</button></div>
          <label className="dsi-field" style={{marginTop:14}}>输入到当前焦点<textarea value={text} onChange={event=>setText(event.target.value)} placeholder="支持中文、多行文本"/></label>
          <div className="dsi-actions" style={{marginTop:10}}><button type="button" onClick={()=>void perform('desktop.type',{text})}>输入文本</button></div>
          <label className="dsi-field" style={{marginTop:14}}>按键或组合键<input value={keys} onChange={event=>setKeys(event.target.value)} placeholder="Enter 或 ctrl+l"/></label>
          <div className="dsi-actions" style={{marginTop:10}}><button type="button" onClick={()=>void perform('desktop.press',{keys:keys.includes('+')?keys.split('+').map(key=>key.trim()):keys})}>发送按键</button></div>
          <label className="dsi-field" style={{marginTop:14}}>打开网页<input type="url" value={website} onChange={event=>setWebsite(event.target.value)}/></label>
          <div className="dsi-actions" style={{marginTop:10}}><button type="button" onClick={()=>void perform('desktop.open',{url:website})}>在云浏览器打开</button></div>
        </fieldset>
      </div>
      <div className="dsi-card"><h3>桌面服务</h3><div className="dsi-fields"><label className="dsi-field">宽度<input type="number" min={800} max={2560} value={width} onChange={event=>setWidth(Number(event.target.value))}/></label><label className="dsi-field">高度<input type="number" min={600} max={1600} value={height} onChange={event=>setHeight(Number(event.target.value))}/></label></div>
        <div className="dsi-actions"><button type="button" disabled={busy||other||pendingCleanup} onClick={()=>void perform('desktop.start',{width,height})}>启动桌面服务</button><button type="button" disabled={busy} onClick={()=>void perform('desktop.status',{},v=>setError(`桌面状态：${pretty(v)}`))}>查询状态</button></div>
        <p className="dsi-muted" style={{marginTop:14}}>启动会保留已运行的桌面。部分模板首次使用需要安装桌面；免费套餐推荐 agent-browser。截图工具可返回图片给支持视觉输入的模型。</p>
      </div>
    </div>
  </div>
}

function Terminal({run}: {run:Run}) {
  const [jobs,setJobs]=useState<any[]>([]),[output,setOutput]=useState(''),[error,setError]=useState('')
  const refresh=async()=>{try{const value=await run('jobs.list');setJobs(listOf(value,'jobs'))}catch(reason){setError(String(reason))}}
  return <div className="dsi-stack"><ActionCard title="执行云端命令" description="命令运行在选中的 Instabox 云机，不是 DSH 所在服务器。长任务勾选后台执行，然后查询日志。" action="commands.run" run={run}
    fields={[{key:'cmd',label:'命令',type:'textarea',required:true},{key:'cwd',label:'工作目录',value:'/data/home'},{key:'timeoutSeconds',label:'前台超时（秒）',type:'number',value:60,min:1,max:600},{key:'background',label:'后台执行',type:'checkbox',value:false},{key:'envs',label:'环境变量 JSON',type:'json',hint:'例如 {"NODE_ENV":"test"}'},{key:'stdin',label:'标准输入',type:'textarea'}]}/>
    <div className="dsi-card"><div className="dsi-actions"><h3>后台任务</h3><button type="button" onClick={()=>void refresh()}>刷新任务</button></div>
      {error&&<p className="dsi-error" role="alert">{error}</p>}
      {jobs.length===0?<p className="dsi-muted" style={{marginTop:10}}>刷新以读取云机中的后台任务。</p>:<div className="dsi-scroll"><table className="dsi-table"><thead><tr><th>任务</th><th>状态</th><th>操作</th></tr></thead><tbody>{jobs.map((job,index)=>{const jobId=String(job.jobId??job.id??index);return <tr key={jobId}><td>{jobId}</td><td>{job.state??job.status??(job.exitCode===undefined?'运行中':`退出 ${job.exitCode}`)}</td><td><div className="dsi-actions"><button type="button" onClick={()=>void run('jobs.get',{jobId,tail:200}).then(v=>setOutput(pretty(v))).catch(reason=>setError(String(reason)))}>状态与日志</button><button type="button" className="dsi-danger" onClick={()=>{if(window.confirm('终止这个后台任务？'))void run('jobs.kill',{jobId}).then(()=>refresh()).catch(reason=>setError(String(reason)))}}>终止</button></div></td></tr>})}</tbody></table></div>}
      {output&&<pre>{output}</pre>}</div>
    <ActionCard title="按任务 ID 查询日志" action="jobs.get" run={run} fields={[{key:'jobId',label:'任务 ID',required:true},{key:'tail',label:'末尾行数',type:'number',value:200,min:1,max:2000}]}/></div>
}

function Files({run}: {run:Run}) {
  const [path,setPath]=useState('/data/home'),[entries,setEntries]=useState<any[]>([]),[selected,setSelected]=useState(''),[content,setContent]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const perform=async(task:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setMessage('');try{await task()}catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:String(reason))}finally{if(mounted.current)setBusy(false)}}
  const browse=async(target=path)=>{const value=await run('files.list',{path:target});if(mounted.current){setPath(target);setEntries(listOf(value,'entries','files'))}}
  const read=async(target:string)=>{const value=await run('files.read',{path:target,format:'text'});if(mounted.current){setSelected(target);setContent(String(value.content??''))}}
  const download=async(target:string)=>{const value=await run('files.read',{path:target,format:'base64'});const bytes=base64ToBytes(value.content);const blob=new Blob([bytes.buffer as ArrayBuffer],{type:'application/octet-stream'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=target.split('/').at(-1)||'download';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  const upload=async(file:File)=>{if(file.size>10*MIB)throw new Error('单个文件最大 10 MiB。');const target=childPath(path,file.name);if(entries.some(item=>item.name===file.name)&&!window.confirm(`覆盖 ${target}？`))return;const bytes=new Uint8Array(await file.arrayBuffer());await run('files.write',{path:target,format:'base64',content:bytesToBase64(bytes)});await browse();if(mounted.current)setMessage(`已上传 ${file.name}`)}
  return <div className="dsi-stack"><div className="dsi-card"><h3>云机文件</h3><div className="dsi-fields"><label className="dsi-field">目录<input value={path} onChange={event=>setPath(event.target.value)} spellCheck={false}/></label></div>
    <div className="dsi-actions"><button type="button" disabled={busy} onClick={()=>void perform(()=>browse())}>打开目录</button><button type="button" disabled={busy} onClick={()=>void perform(()=>browse(parentPath(path)))}>上一级</button>
      <label className="dsi-upload" aria-disabled={busy}>上传文件<input aria-label="上传文件" type="file" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void perform(()=>upload(file))}}/></label><small>单次上传、下载最多 10 MiB</small></div>
    {error&&<p role="alert" className="dsi-error">{error}</p>}{message&&<p role="status" className="dsi-good">{message}</p>}
    <div className="dsi-stack" style={{marginTop:12}}>{entries.map((entry,index)=>{const target=String(entry.path??childPath(path,entry.name)),directory=entry.type==='dir'||entry.type==='directory';return <div className="dsi-file" key={`${target}-${index}`}><button type="button" disabled={busy} onClick={()=>void perform(()=>directory?browse(target):read(target))}>{directory?'▸':'·'} {entry.name??target}</button>{!directory&&<button type="button" disabled={busy} onClick={()=>void perform(()=>download(target))}>下载</button>}<button type="button" disabled={busy} className="dsi-danger" onClick={()=>{if(window.confirm(`永久删除 ${target}${directory?' 及其全部内容':''}？`))void perform(async()=>{await run('files.remove',{path:target,confirm:target});await browse()})}}>删除</button></div>})}</div>
  </div><div className="dsi-card"><h3>文本编辑器</h3><label className="dsi-field" style={{marginTop:12}}>文件路径<input value={selected} onChange={event=>setSelected(event.target.value)} spellCheck={false} placeholder="/data/home/notes.txt"/></label>
    <label className="dsi-field" style={{marginTop:10}}>内容<textarea className="dsi-json" value={content} onChange={event=>setContent(event.target.value)} spellCheck={false}/></label>
    <div className="dsi-actions"><button type="button" disabled={busy||!selected} onClick={()=>void perform(()=>read(selected))}>读取文本</button><button type="button" className="dsi-primary" disabled={busy||!selected} onClick={()=>{if(window.confirm(`保存并覆盖 ${selected}？`))void perform(async()=>{await run('files.write',{path:selected,format:'text',content});setMessage('文件已保存。')})}}>保存文件</button><button type="button" disabled={busy||!selected} onClick={()=>void perform(()=>download(selected))}>下载文件</button></div></div></div>
}

function Snapshots({run,refreshMachines,machineId}: {run:Run;refreshMachines:()=>Promise<void>;machineId:string}) {
  const [snapshots,setSnapshots]=useState<any[]>([]),[error,setError]=useState('')
  const refresh=async()=>{try{setSnapshots(listOf(await run('snapshots.list'), 'snapshots','images'))}catch(reason){setError(String(reason))}}
  return <div className="dsi-stack"><div className="dsi-card"><div className="dsi-actions"><h3>账户快照</h3><button type="button" onClick={()=>void refresh()}>刷新快照</button></div>{error&&<p className="dsi-error" role="alert">{error}</p>}
    <div className="dsi-scroll"><table className="dsi-table"><thead><tr><th>名称 / ID</th><th>状态</th><th>操作</th></tr></thead><tbody>{snapshots.map((snapshot,index)=>{const snapshotId=String(snapshot.id??snapshot.snapshotId??index);return <tr key={snapshotId}><td>{snapshot.name}<small style={{display:'block'}}>{snapshotId}</small></td><td>{snapshot.status??snapshot.state??'—'}</td><td><div className="dsi-actions"><button type="button" onClick={()=>void run('snapshots.get',{snapshotId}).catch(reason=>setError(String(reason)))}>详情</button><button type="button" onClick={()=>{if(window.confirm('从此快照创建一台新机器？可能产生费用。'))void run('machines.create',{snapshotId}).then(()=>refreshMachines()).catch(reason=>setError(String(reason)))}}>创建机器</button><button type="button" className="dsi-danger" onClick={()=>{if(window.confirm('永久删除此快照？'))void run('snapshots.delete',{snapshotId,confirm:snapshotId}).then(()=>refresh()).catch(reason=>setError(String(reason)))}}>删除</button></div></td></tr>})}</tbody></table></div></div>
    <ActionCard title="保存当前机器快照" action="snapshots.create" run={run} disabled={!machineId} fields={[{key:'name',label:'快照名称',required:true},{key:'description',label:'描述'},{key:'rootOnly',label:'仅保存系统盘（不含 /data）',type:'checkbox',value:false}]} onResult={()=>void refresh()}/></div>
}

function Network({run}: {run:Run}) {
  const [ports,setPorts]=useState<any[]>([]),[error,setError]=useState('')
  const refresh=async()=>{try{const value=await run('ports.list');setPorts(listOf(value,'ports','publicPorts'))}catch(reason){setError(String(reason))}}
  return <div className="dsi-stack"><div className="dsi-card"><div className="dsi-actions"><h3>已发布端口</h3><button type="button" onClick={()=>void refresh()}>刷新端口</button></div>{error&&<p className="dsi-error" role="alert">{error}</p>}
    {ports.length===0?<p className="dsi-muted" style={{marginTop:10}}>刷新以读取已发布的 HTTPS 服务入口。</p>:<div className="dsi-scroll"><table className="dsi-table"><thead><tr><th>端口</th><th>入口</th><th>操作</th></tr></thead><tbody>{ports.map((port,index)=>{const address=port.url??port.privateUrl??port.publicUrl;let href='';try{const u=new URL(address);if(u.protocol==='https:')href=u.href}catch{}return <tr key={port.port??index}><td>{port.port} {port.name}</td><td>{href?<a href={href} target="_blank" rel="noopener noreferrer">打开服务 ↗</a>:pretty(port)}</td><td><button type="button" className="dsi-danger" onClick={()=>{if(window.confirm('取消发布此端口？'))void run('ports.unpublish',{port:Number(port.port)}).then(()=>refresh()).catch(reason=>setError(String(reason)))}}>取消发布</button></td></tr>})}</tbody></table></div>}</div>
    <ActionCard title="发布云机端口" description="私有入口使用持有即访问的令牌链接；公开入口允许任何人访问。" action="ports.publish" run={run} onResult={()=>void refresh()}
      fields={[{key:'port',label:'端口',type:'number',value:3000,min:1,max:65535,required:true},{key:'name',label:'名称'},{key:'access',label:'访问范围',options:['private','public'],value:'private'},{key:'rotateToken',label:'轮换私有令牌',type:'checkbox',value:false}]}/>
    <ActionCard title="生成 SSH 登录凭证" description="只提交 SSH 公钥；私钥留在你的电脑。返回的短时证书和主机信息用于本机 ssh 登录。" action="ssh.credentials" run={run}
      fields={[{key:'publicKey',label:'SSH 公钥',type:'textarea',required:true},{key:'ttlSeconds',label:'有效期（秒）',type:'number',value:3600,min:1,max:86400}]}/></div>
}

function Advanced({run,machineId}: {run:Run;machineId:string}) {
  const allowed=ACTIONS.filter(action=>!action.startsWith('control.') && !['desktop.takeover','desktop.handback','desktop.revoke','desktop.view'].includes(action))
  const [action,setAction]=useState<Action>('machines.get'),[input,setInput]=useState('{}'),[result,setResult]=useState<unknown>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const examples:Partial<Record<Action,unknown>>={'machines.get':{},'machines.update':{persistentDiskGiB:50},'machines.fork':{name:'my-copy'},'machines.logs':{tail:200},'machines.delete':{confirm:machineId},'operations.get':{operationId:'op_…'},'desktop.drag':{from:[100,100],to:[200,200]},'desktop.press':{keys:['ctrl','l']},'snapshots.delete':{snapshotId:'sn_…',confirm:'sn_…'}}
  return <div className="dsi-card"><h3>完整操作接口</h3><p className="dsi-muted" style={{marginTop:8}}>用于机器规格、日志、异步 operation、快照详情等高级操作。输入格式参见插件说明；输入按后端接口严格校验。桌面接管由“桌面”页的控制按钮管理。</p>
    <form onSubmit={event=>{event.preventDefault();if(busy)return;void(async()=>{try{const value=JSON.parse(input);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('输入必须是 JSON 对象。');if(/delete|remove|stop|kill|unpublish/.test(action)&&!window.confirm(`确认执行 ${action}？`))return;setBusy(true);setError('');setResult(await run(action,value))}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}})()}}>
      <div className="dsi-fields"><label className="dsi-field">操作<select data-field="advanced-action" value={action} onChange={event=>{const value=event.target.value as Action;setAction(value);setInput(JSON.stringify(examples[value]??{},null,2))}}>{allowed.map(value=><option key={value} value={value}>{value}</option>)}</select></label></div>
      <label className="dsi-field" style={{marginTop:12}}>输入 JSON<textarea data-field="advanced-input" className="dsi-json" value={input} onChange={event=>setInput(event.target.value)} spellCheck={false}/></label>
      <div className="dsi-actions" style={{marginTop:12}}><button type="submit" disabled={busy}>{busy?'执行中…':'执行操作'}</button><a href="https://instabox.sh/docs/api" target="_blank" rel="noopener noreferrer">官方 API 文档 ↗</a></div>
    </form>{error&&<p role="alert" className="dsi-error">{error}</p>}{result!==undefined&&<pre>{pretty(result)}</pre>}</div>
}

export function InstaboxPanel({face,closePanel}: {face:InstaboxFace;closePanel?:()=>void}) {
  const [settings,setSettings]=useState<SettingsView|null>(null),[machines,setMachines]=useState<any[]>([]),[machineId,setMachineId]=useState('')
  const [tab,setTab]=useState('desktop'),[create,setCreate]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const [control,setControl]=useState<ControlView|null>(null),[history,setHistory]=useState<JobView[]>([]),[resource,setResource]=useState<unknown>()
  const ownerId=useRef(id()).current, lifetime=useRef<AbortController|null>(null),faceRef=useRef(face),machineRef=useRef(machineId),controlRef=useRef(control)
  faceRef.current=face;machineRef.current=machineId;controlRef.current=control
  const updateJob=useCallback((job:JobView)=>{if(!lifetime.current?.signal.aborted)setHistory(previous=>[job,...previous.filter(item=>item.jobId!==job.jobId)].slice(0,24))},[])
  const run=useCallback<Run>(async(action,input={},target,quiet=false)=>{
    const signal=lifetime.current?.signal
    if(!signal || signal.aborted)throw new Error('面板已关闭。')
    const request:ActionRequest={action,input,...((target??machineRef.current)?{machineId:target??machineRef.current}:{}),clientId:ownerId}
    const initial=await faceRef.current.execute(request,signal)
    const done=await waitForJob(faceRef.current,initial,signal,quiet?undefined:updateJob)
    return done.result
  },[ownerId,updateJob])
  const refresh=useCallback(async()=>{
    const value=await run('machines.list',{},'',true)
    const list=listOf(value,'machines')
    if(!lifetime.current?.signal.aborted){setMachines(list);setMachineId(previous=>list.some(item=>machineIdOf(item)===previous)?previous:machineIdOf(list[0]));setError('')}
  },[run])
  useEffect(()=>{
    const controller=new AbortController();lifetime.current=controller
    void faceRef.current.read(controller.signal).then(async value=>{
      if(controller.signal.aborted)return;setSettings(value)
      if(value.credential.configured)await refresh();else setTab('settings')
    }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:String(reason))})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>{controller.abort()}
  },[refresh])
  useEffect(()=>{
    if(!machineId)return
    let active=true
    const status=()=>void run('control.status',{},machineId,true).then(value=>{if(active)setControl(value)}).catch(()=>{})
    status()
    const timer=setInterval(()=>{
      const lease=controlRef.current
      if(lease?.mode==='human'&&lease.ownerId===ownerId&&!lease.pendingCleanup){
        void run('control.renew',{ownerId},machineId,true).then(value=>{if(active)setControl(previous=>({...value,url:previous?.url}))}).catch(reason=>{
          if(!active)return
          setError(`接管续期失败，已隐藏交互桌面并核对控制状态：${reason instanceof Error?reason.message:String(reason)}`)
          setControl(previous=>previous?{...previous,url:undefined}:previous)
          void run('control.status',{},machineId,true).then(value=>{if(active)setControl({...value,url:undefined})}).catch(()=>{})
        })
      }else status()
    },10000)
    return()=>{
      active=false;clearInterval(timer)
      // This independent request must outlive the React component and its
      // aborted polling signal. The Host validates ownerId before revocation.
      void faceRef.current.execute({action:'control.release',machineId,input:{ownerId},clientId:ownerId}).catch(()=>{})
      setControl(null)
    }
  },[machineId,ownerId,run])
  const selected=machines.find(item=>machineIdOf(item)===machineId)
  const mutate=async(action:Action,input:Record<string,unknown>={})=>{try{await run(action,input);await refresh()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}}
  const requireMachine=!machineId && !['settings','resources','snapshots','advanced'].includes(tab)
  return <main className="dsi" aria-label="Instabox 云电脑">
    <header className="dsi-head"><div><div className="dsi-brand"><InstaboxIcon/><h1>Instabox 云电脑</h1></div><p>独立 Linux 云机 · 桌面 · 人工接管</p></div><div className="dsi-actions"><button type="button" disabled={loading||!settings?.credential.configured} onClick={()=>void refresh().catch(reason=>setError(String(reason)))}>刷新机器</button><button type="button" data-action="new-machine" disabled={!settings?.credential.configured} className="dsi-primary" onClick={()=>setCreate(value=>!value)}>新建机器</button>{closePanel&&<button type="button" onClick={closePanel}>返回会话</button>}</div></header>
    {error&&<p role="alert" className="dsi-error">{error}</p>}
    {loading&&<p role="status" className="dsi-loading">正在读取配置与机器…</p>}
    {create&&<div style={{marginBottom:14}}><ActionCard title="创建独立云机" description="会占用 Instabox 配额；付费套餐可能产生用量费用。默认不注入个人 Vault 或组织 Secrets。" action="machines.create" run={run} fields={[
      {key:'name',label:'名称',hint:'小写字母、数字和短横线'},{key:'templateId',label:'模板',value:settings?.config.defaultTemplate??defaultConfig().defaultTemplate},{key:'snapshotId',label:'或从快照 ID 创建',hint:'填写快照时请清空模板'},
      {key:'vcpus',label:'vCPU（可选）',type:'number',min:1,max:32},{key:'memMiB',label:'内存 MiB（可选）',type:'number',min:1024,max:65536},{key:'metadata',label:'标签 JSON',type:'json'}]} onResult={()=>{setCreate(false);void refresh()}}/></div>}
    <div className="dsi-machinebar"><span>当前机器</span><select aria-label="当前机器" value={machineId} onChange={event=>setMachineId(event.target.value)}><option value="">{machines.length?'请选择机器':'暂无机器'}</option>{machines.map(machine=><option key={machineIdOf(machine)} value={machineIdOf(machine)}>{machineName(machine)} · {stateName(machine.state??machine.machine?.state)}</option>)}</select>
      {selected&&<><span className="dsi-pill">{stateName(selected.state??selected.machine?.state)}</span><div className="dsi-actions"><button type="button" onClick={()=>void mutate('machines.start')}>启动</button><button type="button" onClick={()=>void mutate('machines.resume')}>恢复</button><button type="button" onClick={()=>{if(window.confirm('暂停机器并保留内存状态？'))void mutate('machines.suspend')}}>暂停</button><button type="button" onClick={()=>{if(window.confirm('关闭机器？正在运行的进程会结束。'))void mutate('machines.stop')}}>关机</button><button type="button" className="dsi-danger" onClick={()=>{if(window.confirm(`永久删除 ${machineName(selected)} 及其全部磁盘数据？`))void mutate('machines.delete',{confirm:machineId})}}>删除</button></div></>}
    </div>
    <nav className="dsi-tabs" aria-label="云机功能" role="tablist">{[['desktop','桌面'],['terminal','终端与任务'],['files','文件'],['snapshots','快照'],['network','端口与 SSH'],['resources','资源与用量'],['advanced','高级操作'],['settings','设置']].map(([key,label])=><button type="button" key={key} role="tab" aria-selected={tab===key} data-tab={key} onClick={()=>setTab(key)}>{label}</button>)}</nav>
    {tab==='settings'?<InstaboxSettings face={face} onSaved={value=>{setSettings(value);if(value.credential.configured)void refresh().catch(reason=>setError(String(reason)))}}/>:
      requireMachine?<div className="dsi-empty"><InstaboxIcon/><p>{settings?.credential.configured?'创建或选择一台云机后开始操作。':'先在设置中保存 Instabox API Key。'}</p><button type="button" onClick={()=>setTab('settings')}>打开设置</button></div>:
      <div key={`${machineId}:${tab}`} role="tabpanel" aria-label={tab}>
        {tab==='desktop'&&<Desktop run={run} machineId={machineId} ownerId={ownerId} control={control} setControl={setControl}/>}
        {tab==='terminal'&&<Terminal run={run}/>}
        {tab==='files'&&<Files run={run}/>}
        {tab==='snapshots'&&<Snapshots run={run} refreshMachines={refresh} machineId={machineId}/>}
        {tab==='network'&&<Network run={run}/>}
        {tab==='resources'&&<div className="dsi-stack"><div className="dsi-card"><h3>账户与机器资源</h3><div className="dsi-actions">{[['account.me','账户'],['account.usage','账户用量'],['templates.list','可用模板'],['machines.get','机器详情'],['machines.disk','磁盘空间'],['metrics.get','CPU / 内存'],['usage.get','机器用量'],['machines.logs','机器日志']].map(([action,label])=><button type="button" key={action} disabled={!machineId&&!action.startsWith('account.')&&action!=='templates.list'} onClick={()=>void run(action as Action).then(setResource).catch(reason=>setError(String(reason)))}>{label}</button>)}</div>{resource!==undefined&&<pre>{pretty(resource)}</pre>}</div>
          <ActionCard title="调整机器规格与磁盘" description="受套餐限制。缩小磁盘或调整 CPU / 内存通常需要先关机。" action="machines.update" run={run} disabled={!machineId} fields={[{key:'vcpus',label:'vCPU',type:'number',min:1,max:32},{key:'memMiB',label:'内存 MiB',type:'number',min:1024,max:65536},{key:'persistentDiskGiB',label:'持久盘 GiB',type:'number',min:1,max:1024},{key:'autoSuspendAfterSeconds',label:'空闲暂停（秒）',type:'number',min:0,max:1800},{key:'metadata',label:'替换标签 JSON',type:'json'}]} onResult={()=>void refresh()}/>
          <ActionCard title="复制当前机器" action="machines.fork" run={run} disabled={!machineId} fields={[{key:'name',label:'新机器名称'},{key:'metadata',label:'标签 JSON',type:'json'}]} onResult={()=>void refresh()}/></div>}
        {tab==='advanced'&&<Advanced run={run} machineId={machineId}/>}
      </div>}
    {history.length>0&&<details className="dsi-card" style={{marginTop:20}}><summary>最近操作 · {history.filter(job=>['queued','running'].includes(job.status)).length} 个执行中</summary><div className="dsi-jobs" style={{marginTop:12}}>{history.map(job=><details className="dsi-job" key={job.jobId}><summary>{terminalState(job)} · {job.action} <small>{new Date(job.createdAt).toLocaleTimeString()}</small></summary>{job.error?<p role="alert" className="dsi-error">{job.error}</p>:<pre>{pretty(job.result??{jobId:job.jobId,status:job.status})}</pre>}</details>)}</div></details>}
  </main>
}

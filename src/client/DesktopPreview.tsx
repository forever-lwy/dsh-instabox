import {useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {PreviewController,type PreviewMachine} from './preview-controller.js'

function MachinePreview({controller,item,presentation}:{controller:PreviewController;item:PreviewMachine;presentation:'card'|'sidebar'}){
  const [zoom,setZoom]=useState(false)
  const stage=useRef<HTMLDivElement>(null)
  const inactive=item.retiring||item.phase==='inactive'||['stopped','suspended','paused','deleted'].includes(item.machineState??'')
  const foreign=item.control?.mode==='human'&&item.mode!=='control'&&!item.cleanupNeeded
  const controlling=item.mode==='control'&&!!item.url&&!item.cleanupNeeded
  const title=item.name||item.machineId
  const invoke=(task:Promise<void>)=>void task.catch(()=>{/* The controller owns the visible error state. */})
  useEffect(()=>{if(!item.expanded)setZoom(false)},[item.expanded])
  useEffect(()=>{
    if(!zoom)return
    const node=stage.current
    let topLayer=false
    if(node&&typeof node.showPopover==='function'){
      node.setAttribute('popover','manual')
      try{node.showPopover();topLayer=true}catch{node.removeAttribute('popover')}
    }
    const previous=document.activeElement as HTMLElement|null
    const first=stage.current?.querySelector<HTMLButtonElement>('button');first?.focus()
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setZoom(false)}
      if(event.key!=='Tab')return
      const elements=[...(stage.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],iframe')??[])]
      if(!elements.length)return
      const current=elements.indexOf(document.activeElement as HTMLElement)
      if(event.shiftKey&&current<=0){event.preventDefault();elements.at(-1)?.focus()}
      else if(!event.shiftKey&&(current===elements.length-1||current===-1)){event.preventDefault();elements[0]?.focus()}
    }
    document.addEventListener('keydown',keydown)
    return()=>{
      document.removeEventListener('keydown',keydown)
      if(topLayer){try{node?.hidePopover()}catch{}}
      node?.removeAttribute('popover')
      if(previous?.isConnected)previous.focus()
    }
  },[zoom])
  return <section className={`dsi-preview-card ${presentation==='sidebar'?'dsi-preview-sidebar':''}`} data-preview-machine={item.machineId}>
    <div className="dsi-preview-heading"><div className="dsi-preview-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M8 21h8m-4-4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg><strong>{title}</strong><span className={`dsi-preview-status ${item.phase==='busy'?'busy':''}`}>{item.pending?'处理中…':item.cleanupNeeded?'接管待清理':controlling?'人工接管':foreign?'其他面板接管':inactive?'机器未运行':item.phase==='busy'?'模型使用中':'云机就绪'}</span></div>
      {!item.expanded&&<div className="dsi-preview-actions">{item.cleanupNeeded?<button type="button" data-preview-action="cleanup" disabled={item.pending} onClick={()=>invoke(controller.handback(item.machineId))}>清理并交还</button>:<><button type="button" data-preview-action="watch" disabled={item.pending||inactive} onClick={()=>invoke(controller.watch(item.machineId))}>观看桌面</button><button type="button" data-preview-action="take" className="dsi-preview-primary" disabled={item.pending||inactive||foreign} onClick={()=>invoke(controller.take(item.machineId))}>接管</button></>}</div>}
    </div>
    {item.error&&<p className="dsi-preview-error" role="alert">{item.error}</p>}
    {item.backgroundRunning&&<small className="dsi-preview-hint">云端后台任务仍在运行。</small>}
    {inactive&&!item.expanded&&<p className="dsi-preview-hint">机器已停止或暂停，可先在“Instabox 云电脑”中恢复，再打开桌面。</p>}
    {item.expanded&&<div ref={stage} className={`dsi-preview-stage ${zoom?'dsi-preview-zoom':''}`} role={zoom?'dialog':'region'} aria-modal={zoom?true:undefined} aria-label={`${title} 云桌面`}>
      <div className="dsi-preview-toolbar"><span>{item.cleanupNeeded?'接管状态待清理':controlling?'人工接管 · 键鼠由你控制':'实时桌面 · 只读观看'}</span><div className="dsi-preview-actions">
        {item.url&&<a href={item.url} target="_blank" rel="noopener noreferrer">新窗口 ↗</a>}
        {item.url&&<button type="button" data-preview-action="zoom" onClick={()=>setZoom(value=>!value)}>{zoom?'缩小':'放大'}</button>}
        {item.cleanupNeeded?<button type="button" data-preview-action="cleanup" disabled={item.pending} onClick={()=>invoke(controller.handback(item.machineId))}>清理并交还</button>:
          controlling?<button type="button" data-preview-action="handback" disabled={item.pending} onClick={()=>invoke(controller.handback(item.machineId))}>交还并收起</button>:
            <><button type="button" data-preview-action="take" className="dsi-preview-primary" disabled={item.pending||inactive||foreign} onClick={()=>invoke(controller.take(item.machineId))}>接管</button><button type="button" data-preview-action="collapse" disabled={item.pending} onClick={()=>invoke(controller.collapse(item.machineId))}>收起</button></>}
      </div></div>
      {item.url&&!item.cleanupNeeded?<iframe key={`${item.mode}:${item.url}`} data-preview-viewer="true" title={`${title}${controlling?'人工接管':'只读'}桌面`} src={item.url} allow="clipboard-read; clipboard-write; fullscreen" allowFullScreen referrerPolicy="no-referrer"/>:
        <div className="dsi-preview-placeholder" role="status">{item.pending?'正在准备云桌面…':item.cleanupNeeded?'交互画面已隐藏。确认清理成功后才会交还模型。':'桌面暂未打开，可重试观看或检查个人 API Key。'}
          {!item.pending&&!item.cleanupNeeded&&<button type="button" disabled={inactive} onClick={()=>invoke(controller.watch(item.machineId))}>重新观看</button>}
        </div>}
      {controlling&&<p className="dsi-preview-hint">模型对这台机器的新变更操作已暂停。交还并收起后，模型可继续操作；云机中的后台进程会继续运行。</p>}
    </div>}
  </section>
}

/** This component is a pure subscriber. Message replay, moving between slots,
 * and React unmount do not create viewers, renew, or release a machine lease. */
export function DesktopPreview({controller,presentation='card',machineId}:{controller:PreviewController;presentation?:'card'|'sidebar';machineId?:string}){
  const snapshot=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot)
  const items=machineId?snapshot.items.filter(item=>item.machineId===machineId):snapshot.items
  if(!items.length)return presentation==='sidebar'?<div className="dsi-preview-empty">此对话还没有使用 Instabox 云机。</div>:null
  return <div className={`dsi-preview-list dsi-preview-${presentation}`} data-preview-session={snapshot.sessionId??''}>{items.map(item=><MachinePreview key={`${snapshot.sessionId}:${item.machineId}`} controller={controller} item={item} presentation={presentation}/>)}</div>
}

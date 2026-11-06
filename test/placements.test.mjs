import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {JSDOM} from 'jsdom'
import {readFile} from 'node:fs/promises'
import {runInNewContext} from 'node:vm'
import {defaultConfig} from '../lib/shared.js'
import {createPreviewTailDefinition,installPreviewPlacements,PREVIEW_NODE_KIND,PREVIEW_TAB_KIND,PREVIEW_TAB_ID} from '../lib/client/placements.js'

let dom,React,createRoot
const originals=new Map()
before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://dsh.test/'})
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,Node:dom.window.Node,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})
  }
  React=await import('react');({createRoot}=await import('react-dom/client'))
})
after(()=>{dom.window.close();for(const[key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}})
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))}
const settings=(placement='inline',revision=1)=>({config:{...defaultConfig(),desktopPlacement:placement},revision,credential:{configured:true,writable:true}})
const activity=(sessionId,revision=1,machineId='m_one',phase='busy')=>({sessionId,revision,machines:[{machineId,name:'cloud',phase,lastAction:'commands.run',updatedAt:Date.now(),pendingJobs:phase==='busy'?1:0,backgroundRunning:false,machineState:'running'}]})
function observable(initial){
  let value=initial
  const listeners=new Set()
  return{getSnapshot:()=>value,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},set:next=>{value=next;for(const listener of listeners)listener()}}
}
function fixture(t,{placement='inline',getActivity,initialSession='session-a'}={}){
  const mounted=observable(initialSession),registrations=[],definitions=[],types=[],calls=[],events=new Map(),effects=[],opens=[],focuses=[],closeHandlers=new Map()
  let currentSettings=settings(placement),expanded=false,sequence=0
  const tabs=[]
  const sidebar={
    mounted,tabsIn:()=>tabs,isExpanded:()=>expanded,toggleExpanded:()=>{expanded=!expanded},
    registerCloseHandler:(kind,handler)=>{closeHandlers.set(kind,handler);return()=>closeHandlers.delete(kind)},
    focus:id=>{focuses.push(id)},
    openTab:kind=>{opens.push(kind);tabs.push({id:'tab-'+tabs.length,kind});expanded=true},
  }
  const face={
    read:async()=>currentSettings,save:async request=>(currentSettings={...settings(request.config.desktopPlacement,request.expectedRevision+1),config:request.config}),
    getActivity:getActivity??(async({sessionId})=>activity(sessionId)),
    execute:async request=>{
      calls.push(structuredClone(request))
      const machineId=request.machineId
      let result={}
      if(request.action==='control.status'||request.action==='control.release')result={machineId,mode:'agent'}
      if(request.action==='control.take'||request.action==='control.renew')result={machineId,mode:'human',ownerId:request.input.ownerId,url:'https://dashboard.instabox.sh/desktop/'+machineId+'#token=interactive',expiresAt:Date.now()+120000}
      if(request.action==='desktop.view')result={url:'https://dashboard.instabox.sh/desktop/'+machineId+'#token=readonly',expiresAt:Date.now()+600000}
      return{jobId:'j-'+(++sequence),action:request.action,machineId,status:'succeeded',createdAt:Date.now(),updatedAt:Date.now(),result}
    },
    getJob:async()=>{throw Error('Unexpected pending job')},
  }
  const ctx={
    sidebarRight:sidebar,sidebarRightTabs:{register:definition=>{types.push(definition);return()=>{}}},
    uiConversation:{events:{register:definition=>{definitions.push(definition);return()=>{}}}},
    slots:{inject:(_key,callback)=>callback(),register:(options,component)=>{registrations.push({options,component});return()=>{}}},
    inject:(_keys,callback)=>callback(ctx),
    effect:callback=>{const dispose=callback();if(typeof dispose==='function')effects.push(dispose);return dispose},
    on:(event,callback)=>{events.set(event,callback);return()=>events.delete(event)},
  }
  const handle=installPreviewPlacements(ctx,face)
  let disposed=false
  const dispose=async()=>{if(disposed)return;disposed=true;await React.act(async()=>{for(const effect of effects.reverse())await effect();await flush()})}
  t.after(dispose)
  return{...handle,mounted,sidebar,registrations,definitions,types,calls,opens,focuses,events,face,dispose,closeHandlers,
    hide:()=>{expanded=false},changeSettings:view=>{currentSettings=view;handle.updateSettings(view)}}
}
async function render(t,component,props){
  const node=document.createElement('div');document.body.appendChild(node);const root=createRoot(node)
  const draw=next=>React.act(async()=>{root.render(React.createElement(component,next??props));await flush()})
  await draw()
  let unmounted=false
  const unmount=async()=>{if(unmounted)return;unmounted=true;await React.act(async()=>{root.unmount();await flush()});node.remove()}
  t.after(unmount)
  return{node,draw,unmount}
}

test('one native custom Chat node remains after all durable rows and preserves official fallback',()=>{
  const definition=createPreviewTailDefinition()
  const context={key:'preview-key',id:'desktop-preview',current:new Map(),state:{},matches:[]}
  const first=definition.buildViewNode(context)
  assert.equal(first.kind,PREVIEW_NODE_KIND)
  assert.equal(first.target,'chat')
  assert.deepEqual(first.location,{kind:'session'})
  assert.equal(first.groupTree,'turn')
  assert.equal(first.anchorSeq,Number.MAX_SAFE_INTEGER)
  context.current.set('chat',first)
  for(const type of ['user/message','assistant/live-chunk','tool/call','turn/end']){
    assert.deepEqual(definition.match({type}),{id:'desktop-preview',role:'start'})
    assert.equal(definition.update(context,{event:{type}}),context.state)
    assert.equal(definition.buildViewNode(context),first)
  }
  assert.equal(definition.match({type:'extension/unknown'}),null)
  const ordered=[{key:'assistant',anchorSeq:22},{key:'user',anchorSeq:10},first,{key:'later-answer',anchorSeq:1000}].sort((a,b)=>a.anchorSeq-b.anchorSeq)
  assert.deepEqual(ordered.map(node=>node.key),['user','assistant','later-answer','preview-key'])
})

// Evaluate the exact installed rc.5 browser artifacts, through their public
// loader factory. No upstream checkout, copied assembler, or source rewriting.
async function nativeModule(name,providers){
  let value
  const source=await readFile(new URL(import.meta.resolve(name+'/client')),'utf8')
  runInNewContext(source,{
    window:{__ModuleLoader__:{load:({factory})=>{
      const require=id=>{
        if(!(id in providers))throw Error('Unprovided native factory dependency: '+id)
        return providers[id]
      }
      // 0.2.2 bundles resolve static assets through require.asset(path).
      require.asset=path=>'/'+path
      value=factory(require)
    }}},
    console,queueMicrotask,setTimeout,clearTimeout,structuredClone,AbortController,AbortSignal,URL,crypto:globalThis.crypto,
  },{filename:name+'/lib/client.js'})
  return value
}

test('real rc.5 assembler and Chat process groups keep exactly one preview after completed turns and live streams',async t=>{
  const cordis=await import('@deepseek-ai/cordis'),zod=await import('zod'),jsx=await import('react/jsx-runtime'),reactDom=await import('react-dom')
  const store=await import('@deepseek-ai/dsh-client-store')
  const unusedUi=new Proxy({},{get:()=>()=>null})
  const providers={'@deepseek-ai/cordis':cordis,'zod':zod,'react':React,'react/jsx-runtime':jsx,'react-dom':reactDom,
    '@deepseek-ai/dsh-client-store':store,'@deepseek-ai/dsh-client-ui-primitives':unusedUi,'@deepseek-ai/dsh-client-ui-slots':{},'@tanstack/react-virtual':{}}
  const conversation=await nativeModule('@deepseek-ai/dsh-client-ui-conversation',providers)
  const chat=await nativeModule('@deepseek-ai/dsh-client-ui-chat',providers)
  const ctx=new cordis.Context()
  t.after(()=>ctx.fiber.dispose())
  const service=new conversation.UiConversation(ctx,{binding:()=>undefined})
  // apply() first contributes the actual Chat definitions, view factory, and
  // process-group registry. Stop before unrelated UI settings/rendering setup.
  const afterNativeRegistrations=new Error('native Chat definitions registered')
  assert.throws(()=>chat.apply({effect:fn=>ctx.effect(fn),uiConversation:service,uiSession:{provide:()=>{throw afterNativeRegistrations}}}),error=>error===afterNativeRegistrations)
  assert.ok(service.events instanceof conversation.ConversationEventRegistry)
  assert.equal(service.groups.forTarget('chat').kind,'process-groups')
  service.events.register(createPreviewTailDefinition())
  const assembler=new conversation.ConversationNodeAssembler(service.events,service.views,service.groups)
  const durable=(seq,type,data)=>({type:'event',event:{type,seq,time:seq*1000,surfaceOp:'append',data}})
  const history=[
    durable(1,'turn/start',{turn:1}),
    durable(2,'step/start',{turn:1,step:1}),
    durable(3,'user/message',{id:'u1',source:{kind:'user'},content:[{type:'text',text:'hello'}]}),
    durable(4,'assistant/message',{turn:1,step:1,message:{id:'a1',source:{provider:'test',model:'test'},content:[{type:'reasoning',text:'working through it'},{type:'text',text:'first answer'}]},stream:[]}),
    durable(5,'step/end',{turn:1,step:1,reason:{kind:'completed'}}),
    durable(6,'turn/end',{turn:1,reason:{kind:'completed'}}),
  ]
  assembler.replaceWindow(history,false);assembler.activateTarget('chat')
  const assertTail=()=>{
    const snapshot=assembler.get('chat')
    const nodes=snapshot.order.map(key=>snapshot.nodes.get(key)).filter(Boolean)
    const preview=nodes.filter(node=>node.kind===PREVIEW_NODE_KIND)
    assert.equal(preview.length,1)
    assert.equal(nodes.at(-1).key,preview[0].key)
    const groups=assembler.grouped('chat')
    assert.equal(groups.entries.at(-1).kind,'node')
    assert.equal(groups.entries.at(-1).key,preview[0].key)
    for(const entry of groups.entries)if(entry.kind==='group')assert.ok(!groups.groupSource(entry.key).getSnapshot().members.some(member=>member.key===preview[0].key),'preview must remain outside collapsible process/turn groups')
    return{key:preview[0].key,nodes,groups}
  }
  const first=assertTail()
  assert.ok(first.nodes.some(node=>node.kind==='user'))
  assert.ok(first.nodes.some(node=>node.kind==='assistant-step'))
  assert.ok(first.groups.entries.some(entry=>entry.kind==='group'),'actual Chat grouping was exercised')
  for(const entry of [
    durable(7,'turn/start',{turn:2}),
    durable(8,'step/start',{turn:2,step:1}),
    {type:'transient',event:{type:'assistant/live-chunk',seq:8.5,time:8500,data:{attemptId:'live-attempt',turn:2,step:1,chunk:{type:'text-delta',text:'streaming answer'}}}},
    durable(9,'extension/unknown',{value:'must retain fallback'}),
  ]){
    assembler.append(entry);assembler.flush()
    assert.equal(assertTail().key,first.key,'live append keeps a single stable preview context')
  }
  assert.equal(service.events.fallbackEntry().kind,'unknown-surface')
  assert.equal(createPreviewTailDefinition().match({type:'system/message'}),null)
  assert.ok(service.events.fallbackEntry().match({type:'system/message',surfaceOp:'append',seq:10}),'unclaimed surface events retain the official fallback')
})

test('placements add a native chat kind and keepMounted tab without replacing host surfaces',async t=>{
  const ui=fixture(t)
  await flush()
  assert.equal(ui.definitions.length,1)
  assert.deepEqual(ui.registrations.map(item=>[item.options.name,item.options.key]),[
    ['conversation.chat.node',PREVIEW_NODE_KIND],['sidebar.right.pane.tab',PREVIEW_TAB_ID],
  ])
  assert.equal(ui.types[0].kind,PREVIEW_TAB_KIND)
  assert.equal(ui.types[0].keepMounted,true)
  assert.equal(ui.registrations.some(item=>['rightbar','conversation.chat.flow','conversation.view'].includes(item.options.name)),false)
})

test('late activity from a departed chat cannot reveal its machines in the arriving chat',async t=>{
  let resolveOld
  const ui=fixture(t,{getActivity:({sessionId})=>sessionId==='session-a'?new Promise(resolve=>{resolveOld=resolve}):Promise.resolve(activity(sessionId,1,'m_two'))})
  await flush()
  assert.ok(resolveOld)
  ui.mounted.set('session-b')
  assert.equal(ui.controller.getSnapshot().sessionId,'session-b')
  await flush()
  resolveOld(activity('session-a',100,'m_secret'))
  await flush()
  assert.equal(ui.controller.getSnapshot().sessionId,'session-b')
  assert.deepEqual(ui.controller.getSnapshot().items.map(item=>item.machineId),['m_two'])
})

test('inline row is session-scoped and unmounting its presentation does not release control',async t=>{
  const ui=fixture(t)
  await flush()
  const component=ui.registrations.find(item=>item.options.key===PREVIEW_NODE_KIND).component
  const props={sessionId:'session-a',useSession:selector=>selector({pendingSubmissions:[]})}
  const view=await render(t,component,props)
  assert.ok(view.node.querySelector('[data-instabox-placement=inline]'))
  await React.act(async()=>{await ui.controller.take('m_one')})
  const before=ui.calls.filter(call=>call.action==='control.release').length
  await view.unmount()
  assert.equal(ui.calls.filter(call=>call.action==='control.release').length,before)
  assert.equal(ui.controller.getSnapshot().items[0].mode,'control')
})

test('sidebar opens once per busy period; user collapse and repeated polls do not steal focus',async t=>{
  const ui=fixture(t,{placement:'sidebar'})
  await flush()
  assert.deepEqual(ui.opens,[PREVIEW_TAB_KIND])
  ui.hide()
  ui.controller.updateActivity(activity('session-a',2))
  await flush()
  assert.equal(ui.opens.length,1)
  assert.equal(ui.focuses.length,0)
  ui.controller.updateActivity(activity('session-a',3,'m_one','idle'))
  ui.controller.updateActivity(activity('session-a',4,'m_one','busy'))
  await flush()
  assert.equal(ui.opens.length,1,'existing native tab is reused')
  assert.equal(ui.focuses.length,1,'a subsequent busy period may reveal the existing tab')
})

test('placement setting switches instantly and an old hidden sidebar cannot hand back the inline viewer',async t=>{
  const ui=fixture(t,{placement:'sidebar'})
  await flush()
  const inline=ui.registrations.find(item=>item.options.key===PREVIEW_NODE_KIND).component
  const sidebar=ui.registrations.find(item=>item.options.key===PREVIEW_TAB_ID).component
  const row=await render(t,inline,{sessionId:'session-a',useSession:selector=>selector({pendingSubmissions:[]})})
  assert.ok(row.node.querySelector('[data-instabox-placement=toolbar]'))
  await React.act(async()=>{await ui.controller.take('m_one')})
  const before=ui.calls.filter(call=>call.action==='control.release').length
  await React.act(async()=>{ui.changeSettings(settings('inline',2));await flush()})
  assert.ok(row.node.querySelector('[data-instabox-placement=inline]'))
  await render(t,sidebar,{sessionId:'session-a',useTabInfo:()=>({tab:{visible:false}})})
  assert.equal(ui.calls.filter(call=>call.action==='control.release').length,before)
  assert.equal(ui.controller.getSnapshot().items[0].mode,'control')
})

test('hiding the active sidebar presentation hands back its interactive viewer',async t=>{
  const ui=fixture(t,{placement:'sidebar'})
  await flush()
  await ui.controller.take('m_one')
  const component=ui.registrations.find(item=>item.options.key===PREVIEW_TAB_ID).component
  await render(t,component,{sessionId:'session-a',useTabInfo:()=>({tab:{visible:false}})})
  await flush()
  assert.ok(ui.calls.some(call=>call.action==='control.release'))
  assert.equal(ui.controller.getSnapshot().items[0].expanded,false)
})

test('failed handback while a sidebar is hidden keeps cleanup visible without retrying on every render',async t=>{
  const ui=fixture(t,{placement:'sidebar'})
  await flush();await ui.controller.take('m_one')
  const execute=ui.face.execute
  let releases=0
  ui.face.execute=async request=>{
    if(request.action==='control.release'){releases++;throw Error('revocation temporarily unavailable')}
    if(request.action==='control.status')throw Error('control status temporarily unavailable')
    return execute(request)
  }
  const Body=ui.registrations.find(item=>item.options.name==='sidebar.right.pane.tab').component
  const props=visible=>({sessionId:'session-a',useTabInfo:()=>({tab:{visible}})})
  const surface=await render(t,Body,props(true))
  await surface.draw(props(false))
  assert.equal(releases,1)
  assert.equal(ui.controller.getSnapshot().items[0].cleanupNeeded,true)
  assert.equal(ui.controller.getSnapshot().items[0].url,undefined)
  await React.act(async()=>{ui.controller.updateActivity(activity('session-a',2));await flush()})
  assert.equal(releases,1,'activity and cleanup error emissions cannot cause a hidden render/retry loop')
  await surface.draw(props(true));await surface.draw(props(false))
  assert.equal(releases,2,'a new deliberate hide can retry cleanup')
})

test('native X-close enqueues handback before removal, while closing an old sidebar in inline mode preserves control',async t=>{
  const ui=fixture(t,{placement:'sidebar'})
  await flush();await ui.controller.take('m_one')
  const close=ui.closeHandlers.get(PREVIEW_TAB_KIND)
  assert.equal(typeof close,'function')
  close('session-b',{id:'foreign',kind:PREVIEW_TAB_KIND})
  await flush()
  assert.equal(ui.calls.filter(call=>call.action==='control.release').length,0)
  close('session-a',{id:'ours',kind:PREVIEW_TAB_KIND})
  assert.equal(ui.controller.getSnapshot().items[0].url,undefined,'native close synchronously hides the interactive URL')
  await flush()
  assert.equal(ui.calls.filter(call=>call.action==='control.release').length,1)
  await ui.controller.take('m_one')
  ui.changeSettings(settings('inline',2))
  close('session-a',{id:'old-sidebar',kind:PREVIEW_TAB_KIND})
  await flush()
  assert.equal(ui.calls.filter(call=>call.action==='control.release').length,1)
  assert.equal(ui.controller.getSnapshot().items[0].mode,'control')
})

test('connection reset accepts a restarted Host activity revision and discards stale viewers',async t=>{
  let fresh=false
  const ui=fixture(t,{getActivity:async({sessionId})=>activity(sessionId,fresh?0:50,fresh?'m_new':'m_old')})
  await flush()
  assert.deepEqual(ui.controller.getSnapshot().items.map(item=>item.machineId),['m_old'])
  fresh=true
  ui.events.get('connection/reset')()
  assert.equal(ui.controller.getSnapshot().sessionId,null)
  await flush()
  assert.equal(ui.controller.getSnapshot().sessionId,'session-a')
  assert.deepEqual(ui.controller.getSnapshot().items.map(item=>item.machineId),['m_new'])
})

import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {JSDOM} from 'jsdom'
import {PreviewController} from '../lib/client/preview-controller.js'

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const drain=async()=>{for(let i=0;i<60;i++)await Promise.resolve()}
function fakeClock(){
  let now=0,next=0
  const tasks=new Map()
  const create=(handler,ms,repeat)=>{const id=++next;tasks.set(id,{handler,ms,at:now+ms,repeat});return id}
  return {timers:{setTimeout:(fn,ms)=>create(fn,ms,false),clearTimeout:id=>tasks.delete(id),setInterval:(fn,ms)=>create(fn,ms,true),clearInterval:id=>tasks.delete(id)},
    tick(ms){const end=now+ms;while(true){const pair=[...tasks].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pair)break;const[id,job]=pair;now=job.at;if(job.repeat)job.at+=job.ms;else tasks.delete(id);job.handler()}now=end},get size(){return tasks.size}}
}
function harness(options={}){
  let nextJob=0,nextOwner=0,watchTokens=0
  const calls=[],leases=new Map(),clock=fakeClock()
  const result=(action,value,status='succeeded')=>({jobId:`job-${++nextJob}`,action,status,createdAt:Date.now(),updatedAt:Date.now(),result:value})
  const server={calls,leases,clock,failRelease:false,failRenew:false,pendingCleanup:false,
    async base(request){
      const{action,machineId,input={}}=request
      if(action==='control.status'){
        const lease=leases.get(machineId)
        return lease?{machineId,mode:'human',ownerId:lease.ownerId,url:lease.url,...(lease.pendingCleanup?{pendingCleanup:true}:{})}:{machineId,mode:'agent'}
      }
      if(action==='desktop.view'){
        assert.equal(input.viewOnly,true)
        return {url:`https://api.instabox.sh/vnc/${machineId}#token=watch-${++watchTokens}`,expiresAt:Date.now()+600000}
      }
      if(action==='desktop.status')return{installed:true,running:true,width:1280,height:800}
      if(action==='desktop.start')return{installed:true,running:true,width:1280,height:800}
      if(action==='control.take'){
        const old=leases.get(machineId)
        if(old&&old.ownerId!==input.ownerId)throw new Error('接管属于其他面板')
        const lease={ownerId:input.ownerId,url:`https://api.instabox.sh/vnc/${machineId}#token=control-${nextJob}`}
        leases.set(machineId,lease)
        return {machineId,mode:'human',...lease,expiresAt:Date.now()+120000}
      }
      if(action==='control.renew'){
        if(server.failRenew)throw new Error('连接已断开')
        const lease=leases.get(machineId);assert.ok(lease);assert.equal(lease.ownerId,input.ownerId)
        return {machineId,mode:'human',...lease,expiresAt:Date.now()+120000}
      }
      if(action==='control.release'){
        if(server.failRelease)throw new Error('暂时无法确认撤销')
        const lease=leases.get(machineId)
        if(lease&&lease.ownerId!==input.ownerId&&!lease.pendingCleanup)throw new Error('不能释放其他面板接管')
        leases.delete(machineId);return{machineId,mode:'agent'}
      }
      throw new Error(`Unexpected ${action}`)
    }}
  const face={
    read:async()=>{throw new Error('unused')},save:async()=>{throw new Error('unused')},
    execute:async(request,signal)=>{
      calls.push({request,signal})
      const value=options.execute?await options.execute(request,signal,server):await server.base(request)
      return value?.jobId?value:result(request.action,value)
    },getJob:async request=>options.getJob?options.getJob(request,server):Promise.reject(new Error('Unexpected poll')),
  }
  const controller=new PreviewController(face,{timers:clock.timers,createId:()=>`preview-owner-${++nextOwner}`,pollMs:1,...options.controller})
  return{...server,server,face,controller,calls,leases,clock,result}
}
const activity=(sessionId='s_one',phase='idle',revision=1,machineId='m_one',extra={})=>({sessionId,revision,machines:[{machineId,name:machineId==='m_one'?'测试云机':'另一台云机',phase,lastAction:'desktop.click',updatedAt:revision,pendingJobs:phase==='busy'?1:0,backgroundRunning:false,...extra}]})
const count=(h,action)=>h.calls.filter(call=>call.request.action===action).length
const item=h=>h.controller.getSnapshot().items[0]

test('automatic readonly opens once, idle uses grace, manual reopening stays open across polling',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.setSession('s_one')
  h.controller.updateActivity(activity('s_one','busy'));await drain()
  assert.equal(item(h).mode,'watch');assert.equal(item(h).manual,false);assert.equal(count(h,'desktop.view'),1)
  h.controller.updateActivity(activity('s_one','busy',2));await drain();assert.equal(count(h,'desktop.view'),1)
  h.controller.updateActivity(activity('s_one','idle',3));h.clock.tick(4999);await drain();assert.equal(item(h).expanded,true)
  h.clock.tick(1);await drain();assert.equal(item(h).expanded,false);assert.equal(h.controller.getSnapshot().items.length,1)
  await h.controller.watch('m_one');assert.equal(item(h).manual,true)
  h.controller.updateActivity(activity('s_one','idle',4));h.clock.tick(10000);await drain();assert.equal(item(h).expanded,true)
  h.controller.updateActivity(activity('s_one','busy',5));h.controller.updateActivity(activity('s_one','idle',6));h.clock.tick(10000);await drain()
  assert.equal(item(h).expanded,true);assert.equal(count(h,'control.take'),0)
})

test('manual collapse during a busy cycle is not undone by every activity poll',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.setSession('s_one')
  h.controller.updateActivity(activity('s_one','busy'));await drain();await h.controller.collapse('m_one')
  h.controller.updateActivity(activity('s_one','busy',2));await drain();assert.equal(item(h).expanded,false);assert.equal(count(h,'desktop.view'),1)
  h.controller.updateActivity(activity('s_one','idle',3));h.controller.updateActivity(activity('s_one','busy',4));await drain()
  assert.equal(item(h).expanded,true);assert.equal(count(h,'desktop.view'),2)
})

test('a shell-only machine starts its desktop service before opening a readonly viewer',async t=>{
  let desktopRunning=false
  const h=harness({execute:async(request,_signal,server)=>{
    if(request.action==='desktop.status')return{installed:false,running:desktopRunning}
    if(request.action==='desktop.start'){desktopRunning=true;return{installed:true,running:true}}
    return server.base(request)
  }})
  t.after(()=>h.controller.dispose());await h.controller.setSession('s_one');h.controller.updateActivity(activity('s_one','busy'));await drain()
  const sequence=h.calls.map(call=>call.request.action)
  assert.ok(sequence.indexOf('desktop.status')<sequence.indexOf('desktop.start'))
  assert.ok(sequence.indexOf('desktop.start')<sequence.indexOf('desktop.view'))
  assert.equal(count(h,'desktop.start'),1);assert.equal(item(h).mode,'watch');assert.ok(item(h).url)
  assert.ok(!sequence.includes('machines.start'));assert.ok(!sequence.includes('machines.resume'))
})

test('one stable owner renews manual control and idle completion never interrupts it',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.setSession('s_one');h.controller.updateActivity(activity())
  await h.controller.take('m_one');const owner=h.leases.get('m_one').ownerId
  h.controller.updateActivity(activity('s_one','busy',2));h.controller.updateActivity(activity('s_one','idle',3));h.clock.tick(10000);await drain()
  assert.equal(item(h).mode,'control');assert.equal(item(h).expanded,true);assert.equal(count(h,'control.renew'),1)
  assert.equal(h.calls.find(call=>call.request.action==='control.renew').request.input.ownerId,owner)
  assert.equal(count(h,'control.release'),0)
  await h.controller.handback('m_one');assert.equal(item(h).expanded,false);assert.equal(h.leases.size,0)
  assert.equal(h.calls.find(call=>call.request.action==='control.release').request.input.ownerId,owner)
})

test('switching sessions immediately hides the previous view and revokes a late pending take',async t=>{
  const pending=deferred()
  const h=harness({execute:async(request,_signal,server)=>{const value=await server.base(request);if(request.action==='control.take')await pending.promise;return value}})
  t.after(()=>h.controller.dispose());await h.controller.setSession('s_one');h.controller.updateActivity(activity())
  const taking=h.controller.take('m_one');await drain();assert.equal(h.leases.size,1)
  const switching=h.controller.setSession('s_two');assert.equal(h.controller.getSnapshot().sessionId,'s_two');assert.deepEqual(h.controller.getSnapshot().items,[])
  h.controller.updateActivity(activity('s_two','busy',1,'m_two'));await drain();assert.equal(item(h).machineId,'m_two')
  pending.resolve();await taking;await switching;await drain()
  assert.ok(!h.leases.has('m_one'));assert.equal(item(h).machineId,'m_two');assert.ok(!item(h).url.includes('control'))
  h.controller.updateActivity(activity('s_one','busy',999));assert.equal(h.controller.getSnapshot().sessionId,'s_two');assert.equal(item(h).machineId,'m_two')
})

test('a failed collapse hides interactive URL but keeps a visible conservative cleanup state',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.setSession('s_one');h.controller.updateActivity(activity());await h.controller.take('m_one')
  h.server.failRelease=true
  const collapsing=h.controller.collapse('m_one');assert.equal(item(h).url,undefined)
  await assert.rejects(collapsing,/无法确认撤销/)
  assert.equal(item(h).expanded,true);assert.equal(item(h).mode,'control');assert.equal(item(h).cleanupNeeded,true);assert.equal(h.leases.size,1)
  h.server.failRelease=false;await h.controller.handback('m_one');assert.equal(item(h).expanded,false);assert.equal(item(h).mode,'closed');assert.equal(h.leases.size,0)
})

test('a renewal failure never retains an iframe URL or reports the unknown lock as handed back',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.setSession('s_one');h.controller.updateActivity(activity());await h.controller.take('m_one')
  h.server.failRenew=true;h.clock.tick(10000);await drain()
  assert.equal(item(h).mode,'control');assert.equal(item(h).expanded,true);assert.equal(item(h).url,undefined);assert.equal(item(h).cleanupNeeded,true)
  assert.match(item(h).error,/续期失败/);assert.equal(h.leases.size,1)
  h.server.failRenew=false;h.clock.tick(10000);await drain();assert.equal(item(h).url,undefined)
})

test('disposing while a take is pending sends cleanup with an independent non-aborted request',async()=>{
  const pending=deferred()
  const h=harness({execute:async(request,_signal,server)=>{const value=await server.base(request);if(request.action==='control.take')await pending.promise;return value}})
  await h.controller.setSession('s_one');h.controller.updateActivity(activity())
  const taking=h.controller.take('m_one');const rejected=assert.rejects(taking);await drain()
  const disposing=h.controller.dispose();assert.equal(h.controller.getSnapshot().sessionId,null)
  pending.resolve();await rejected;await disposing
  assert.equal(h.leases.size,0);assert.equal(h.clock.size,0)
  const release=h.calls.find(call=>call.request.action==='control.release');assert.ok(release);assert.equal(release.signal.aborted,false)
})

test('activity epoch reset accepts a restarted Host revision and removes safely released old bindings',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.setSession('s_one');h.controller.updateActivity(activity('s_one','idle',100));await h.controller.watch('m_one')
  await h.controller.resetActivityEpoch();assert.equal(h.controller.getSnapshot().sessionId,null)
  await h.controller.setSession('s_one');h.controller.updateActivity(activity('s_one','idle',0,'m_two'))
  assert.deepEqual(h.controller.getSnapshot().items.map(value=>value.machineId),['m_two'])
})

test('inactive bindings keep a button but never auto-resume; other owner links are never rendered or released',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.setSession('s_one');h.controller.updateActivity(activity('s_one','inactive'))
  await assert.rejects(h.controller.watch('m_one'),/停止或暂停/);assert.equal(h.calls.length,0)
  h.controller.updateActivity(activity('s_one','idle',2));h.leases.set('m_one',{ownerId:'other-panel',url:'https://api.instabox.sh/vnc/m_one#token=foreign-control'})
  await h.controller.watch('m_one');assert.equal(item(h).mode,'watch');assert.ok(item(h).url.includes('watch-'));assert.equal(item(h).control.url,undefined)
  await assert.rejects(h.controller.take('m_one'),/其他面板/);assert.equal(item(h).cleanupNeeded,false)
  await h.controller.collapse('m_one');assert.equal(count(h,'control.release'),0);assert.equal(h.leases.get('m_one').ownerId,'other-panel')
})

test('restored pending cleanup never embeds its stale URL and can be released by the current owner',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.setSession('s_one');h.controller.updateActivity(activity())
  h.leases.set('m_one',{ownerId:'previous-browser',url:'https://api.instabox.sh/vnc/m_one#token=stale',pendingCleanup:true})
  await h.controller.watch('m_one');assert.equal(item(h).cleanupNeeded,true);assert.equal(item(h).url,undefined);assert.equal(count(h,'desktop.view'),0)
  await h.controller.handback('m_one');assert.equal(item(h).expanded,false);assert.equal(h.leases.size,0)
})

test('evicted bindings disappear after safe release and do not repeat a failed cleanup on every poll',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.setSession('s_one');h.controller.updateActivity(activity());await h.controller.take('m_one')
  h.server.failRelease=true
  h.controller.updateActivity(activity('s_one','idle',2,'m_two'));await drain()
  const retired=h.controller.getSnapshot().items.find(value=>value.machineId==='m_one')
  assert.equal(retired.retiring,true);assert.equal(retired.url,undefined);assert.equal(retired.cleanupNeeded,true);assert.equal(count(h,'control.release'),1)
  h.controller.updateActivity(activity('s_one','idle',2,'m_two'));h.controller.updateActivity(activity('s_one','idle',3,'m_two'));await drain()
  assert.equal(count(h,'control.release'),1)
  h.server.failRelease=false;await h.controller.handback('m_one')
  assert.deepEqual(h.controller.getSnapshot().items.map(value=>value.machineId),['m_two']);assert.equal(h.leases.size,0)
})

test('evicting a pending take cleans up its late lease before removing the binding',async t=>{
  const pending=deferred()
  const h=harness({execute:async(request,_signal,server)=>{const value=await server.base(request);if(request.action==='control.take')await pending.promise;return value}})
  t.after(()=>h.controller.dispose());await h.controller.setSession('s_one');h.controller.updateActivity(activity())
  const taking=h.controller.take('m_one');await drain()
  h.controller.updateActivity(activity('s_one','idle',2,'m_two'));assert.equal(h.controller.getSnapshot().items.find(value=>value.machineId==='m_one').url,undefined)
  pending.resolve();await taking;await drain()
  assert.ok(!h.leases.has('m_one'));assert.deepEqual(h.controller.getSnapshot().items.map(value=>value.machineId),['m_two'])
})

let dom,React,createRoot,DesktopPreview
const originals=new Map()
before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://dsh.test/'})
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,Node:dom.window.Node,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})
  }
  React=await import('react');({createRoot}=await import('react-dom/client'));({DesktopPreview}=await import('../lib/client/DesktopPreview.js'))
})
after(()=>{dom.window.close();for(const[key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}})

test('message remounts never own leases; zoom reuses one iframe and hash-only token changes replace it',async t=>{
  const h=harness();await h.controller.setSession('s_one');h.controller.updateActivity(activity());await h.controller.watch('m_one')
  const node=document.createElement('div');document.body.appendChild(node);let root=createRoot(node)
  const act=async callback=>React.act(async()=>{callback?.();await drain()})
  t.after(async()=>{await act(()=>root.unmount());node.remove();await h.controller.dispose()})
  await act(()=>root.render(React.createElement(DesktopPreview,{controller:h.controller,presentation:'card'})))
  const first=node.querySelector('iframe');assert.ok(first);assert.ok(first.src.includes('#token=watch-'))
  let topLayerOpened=0,topLayerClosed=0
  const stage=node.querySelector('.dsi-preview-stage');stage.showPopover=()=>{topLayerOpened++};stage.hidePopover=()=>{topLayerClosed++}
  const reads=count(h,'desktop.view')
  for(let i=0;i<3;i++)await act(()=>root.render(React.createElement(DesktopPreview,{controller:h.controller,presentation:i%2?'sidebar':'card'})))
  assert.equal(node.querySelector('iframe'),first);assert.equal(count(h,'desktop.view'),reads)
  await act(()=>node.querySelector('[data-preview-action=zoom]').click());assert.equal(node.querySelector('iframe'),first);assert.ok(node.querySelector('[role=dialog]'))
  assert.equal(topLayerOpened,1);assert.equal(stage.getAttribute('popover'),'manual')
  await act(()=>node.querySelector('[data-preview-action=zoom]').click());assert.equal(node.querySelector('iframe'),first)
  assert.equal(topLayerClosed,1);assert.equal(stage.hasAttribute('popover'),false)
  await act(()=>node.querySelector('[data-preview-action=take]').click())
  const controlled=node.querySelector('iframe');assert.notEqual(controlled,first);assert.ok(controlled.src.includes('#token=control-'));assert.equal(node.querySelectorAll('iframe').length,1)
  assert.equal(new URL(first.src).pathname,new URL(controlled.src).pathname)
  const takes=count(h,'control.take'),releases=count(h,'control.release')
  await act(()=>root.unmount());root=createRoot(node);await act(()=>root.render(React.createElement(DesktopPreview,{controller:h.controller})))
  assert.equal(count(h,'control.take'),takes);assert.equal(count(h,'control.release'),releases);assert.equal(node.querySelectorAll('iframe').length,1)
  await act(()=>node.querySelector('[data-preview-action=handback]').click());assert.equal(node.querySelector('iframe'),null);assert.ok(node.querySelector('[data-preview-action=watch]'))
  assert.equal(h.leases.size,0)
})

test('preview component displays readable status and background task continuation without source identifiers',async t=>{
  const h=harness();await h.controller.setSession('s_one');h.controller.updateActivity(activity('s_one','idle',1,'m_one',{lastAction:'commands.run',backgroundRunning:true}))
  const node=document.createElement('div');document.body.appendChild(node);const root=createRoot(node)
  t.after(async()=>{await React.act(async()=>root.unmount());node.remove();await h.controller.dispose()})
  await React.act(async()=>root.render(React.createElement(DesktopPreview,{controller:h.controller})))
  assert.match(node.textContent,/云端后台任务仍在运行/);assert.ok(!node.textContent.includes('commands.run'));assert.equal(node.querySelector('iframe'),null);assert.equal(h.calls.length,0)
})

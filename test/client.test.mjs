import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {JSDOM} from 'jsdom'
import {defaultConfig} from '../lib/shared.js'
import {viewerUrl,bytesToBase64,base64ToBytes,waitForJob} from '../lib/client/face.js'

let dom,React,createRoot,Simulate,Panel,Settings
const originals=new Map()
before(async()=>{
  dom=new JSDOM('<!doctype html><html><head></head><body></body></html>',{url:'https://dsh.test/'})
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,Node:dom.window.Node,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})
  }
  dom.window.confirm=()=>true
  React=await import('react');({createRoot}=await import('react-dom/client'));({Simulate}=await import('react-dom/test-utils'))
  ;({InstaboxPanel:Panel}=await import('../lib/client/Panel.js'));({InstaboxSettings:Settings}=await import('../lib/client/Settings.js'))
})
after(()=>{dom.window.close();for(const[key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}})
const settings=()=>({config:defaultConfig(),revision:3,credential:{configured:true,writable:true}})
const job=(action,result,status='succeeded')=>({jobId:`job-${Math.random()}`,action,status,createdAt:Date.now(),updatedAt:Date.now(),result})
async function mount(t,component=Panel,overrides={}){
  const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container),calls=[],saves=[]
  const face={read:async()=>settings(),save:async request=>{saves.push(request);return{...settings(),config:request.config,revision:4}},
    execute:async request=>{calls.push(request);let value={};if(request.action==='machines.list')value={machines:[{id:'m_one',name:'first',state:'running'},{id:'m_two',name:'second',state:'stopped'}]};
      if(request.action==='control.status'||request.action==='control.release')value={machineId:request.machineId,mode:'agent'};
      if(request.action==='control.take'||request.action==='control.renew')value={machineId:request.machineId,mode:'human',ownerId:request.input.ownerId,expiresAt:Date.now()+120000,url:`https://dashboard.instabox.sh/desktop/${request.machineId}#token=interactive`};
      if(request.action==='desktop.view')value={url:`https://dashboard.instabox.sh/desktop/${request.machineId}#token=readonly`,expiresAt:Date.now()+600000};
      if(request.action==='desktop.screenshot')value={mimeType:'image/png',base64:'iVBORw0KGgo='};return job(request.action,value)},getJob:async()=>{throw new Error('Unexpected poll')},...overrides}
  const flush=action=>React.act(async()=>{action?.()})
  await flush(()=>root.render(React.createElement(component,{face})))
  let unmounted=false
  const unmount=async()=>{if(!unmounted){unmounted=true;await flush(()=>root.unmount());container.remove()}}
  t.after(unmount)
  return{container,face,calls,saves,flush,unmount,
    async click(selector){const node=container.querySelector(selector);assert.ok(node,selector);await flush(()=>node.click())},
    async change(selector,value){const node=container.querySelector(selector);assert.ok(node,selector);await flush(()=>Simulate.change(node,{target:{value,checked:value}}))}}
}

test('credentials remain write-only and settings save keeps revision then clears password',async t=>{
  const ui=await mount(t,Settings)
  const field=ui.container.querySelector('[data-setting=apiKey]');assert.equal(field.type,'password');assert.equal(field.value,'')
  await ui.change('[data-setting=apiKey]','ibk_private_test')
  assert.equal(ui.saves.length,0)
  await ui.click('[data-action=save-settings]')
  assert.equal(ui.saves.length,1);assert.equal(ui.saves[0].expectedRevision,3);assert.equal(ui.saves[0].apiKey,'ibk_private_test')
  assert.equal(field.value,'');assert.ok(!ui.container.textContent.includes('ibk_private_test'));assert.equal(window.localStorage.length,0)
})

test('manual takeover returns interactive iframe and machine switch releases the same owner lease',async t=>{
  const ui=await mount(t)
  assert.equal(ui.container.querySelector('[aria-label="当前机器"]').value,'m_one')
  await ui.click('[data-action=take-control]')
  const take=ui.calls.find(call=>call.action==='control.take');assert.ok(take.input.ownerId)
  assert.equal(ui.container.querySelector('iframe').title,'Instabox 人工接管桌面')
  assert.match(ui.container.textContent,/你正在接管/)
  await ui.change('[aria-label="当前机器"]','m_two')
  assert.ok(ui.calls.some(call=>call.action==='control.release'&&call.machineId==='m_one'&&call.input.ownerId===take.input.ownerId))
  assert.equal(ui.container.querySelector('iframe'),null)
  await ui.unmount()
  assert.ok(ui.calls.some(call=>call.action==='control.release'&&call.machineId==='m_two'))
})

test('view-only desktop never acquires control and handback removes interactive iframe',async t=>{
  const ui=await mount(t)
  const view=[...ui.container.querySelectorAll('button')].find(node=>node.textContent==='查看桌面')
  await ui.flush(()=>view.click())
  assert.equal(ui.container.querySelector('iframe').title,'Instabox 只读桌面')
  assert.deepEqual(ui.calls.find(call=>call.action==='desktop.view').input,{viewOnly:true,ttlSeconds:600})
  assert.ok(!ui.calls.some(call=>call.action==='control.take'))
  await ui.click('[data-action=take-control]');await ui.click('[data-action=release-control]')
  assert.equal(ui.container.querySelector('iframe'),null)
  assert.ok(ui.calls.some(call=>call.action==='control.release'))
})

test('hash-only viewer token changes remount the iframe instead of retaining read-only document state',async t=>{
  const ui=await mount(t)
  const view=[...ui.container.querySelectorAll('button')].find(node=>node.textContent==='查看桌面')
  await ui.flush(()=>view.click())
  const readonlyFrame=ui.container.querySelector('iframe')
  const readonlyUrl=new URL(readonlyFrame.src)
  assert.equal(readonlyUrl.hash,'#token=readonly')
  await ui.click('[data-action=take-control]')
  const interactiveFrame=ui.container.querySelector('iframe')
  const interactiveUrl=new URL(interactiveFrame.src)
  assert.equal(interactiveUrl.pathname,readonlyUrl.pathname)
  assert.equal(interactiveUrl.search,readonlyUrl.search)
  assert.equal(interactiveUrl.hash,'#token=interactive')
  assert.notEqual(interactiveFrame,readonlyFrame,'official viewer reads the hash only on initial mount; a fresh document is required')
  assert.equal(readonlyFrame.isConnected,false)
  assert.equal(interactiveFrame.title,'Instabox 人工接管桌面')
  const frameWindow=interactiveFrame.contentWindow
  await ui.click('[data-action=release-control]')
  assert.equal(interactiveFrame.isConnected,false)
  assert.equal(ui.container.querySelector('iframe'),null)
  assert.ok(frameWindow)
})

test('failed renewal hides the interactive desktop while preserving the Host human lock',async t=>{
  t.mock.timers.enable({apis:['setInterval']})
  let ownerId,locked=false
  const ui=await mount(t,Panel,{execute:async request=>{
    if(request.action==='machines.list')return job(request.action,{machines:[{id:'m_one',name:'first',state:'running'}]})
    if(request.action==='control.take'){ownerId=request.input.ownerId;locked=true;return job(request.action,{machineId:'m_one',mode:'human',ownerId,url:'https://dashboard.instabox.sh/view?token=interactive'})}
    if(request.action==='control.renew')throw new Error('revoke not confirmed')
    if(request.action==='control.status')return job(request.action,{machineId:'m_one',mode:locked?'human':'agent',...(locked?{ownerId}: {})})
    return job(request.action,{machineId:'m_one',mode:'agent'})
  }})
  await ui.click('[data-action=take-control]');assert.ok(ui.container.querySelector('iframe'))
  await ui.flush(()=>t.mock.timers.tick(10000))
  assert.equal(ui.container.querySelector('iframe'),null)
  assert.match(ui.container.textContent,/你正在接管/)
  assert.match(ui.container.querySelector('[role=alert]').textContent,/续期失败/)
  assert.ok(!ui.container.textContent.includes('模型可操作'))
  await ui.unmount()
})

test('restored takeover cleanup stays locked on failure, permits updating the key, then hands back explicitly',async t=>{
  const calls=[];let pending=true,attempts=0
  const ui=await mount(t,Panel,{execute:async request=>{
    calls.push(request)
    if(request.action==='machines.list')return job(request.action,{machines:[{id:'m_one',name:'first',state:'running'}]})
    if(request.action==='control.status')return job(request.action,pending?{machineId:'m_one',mode:'human',ownerId:'previous-instance',pendingCleanup:true,url:'https://dashboard.instabox.sh/view?token=stale'}:{machineId:'m_one',mode:'agent'})
    if(request.action==='control.release'){
      attempts++
      if(attempts===1)throw new Error('旧密钥失效，撤销失败。')
      pending=false;return job(request.action,{machineId:'m_one',mode:'agent'})
    }
    return job(request.action,{})
  }})
  assert.match(ui.container.textContent,/上次接管待清理/)
  assert.match(ui.container.textContent,/组织 Key 支持截图和模型工具/)
  assert.equal(ui.container.querySelector('iframe'),null)
  assert.equal(ui.container.querySelector('[data-action=take-control]'),null)
  await ui.click('[data-action=cleanup-control]')
  assert.match(ui.container.querySelector('[role=alert]').textContent,/密钥失效/)
  assert.match(ui.container.textContent,/上次接管待清理/)
  assert.ok(!ui.container.textContent.includes('模型可操作'))
  await ui.click('[data-tab=settings]');await ui.change('[data-setting=apiKey]','ibk_replacement');await ui.click('[data-action=save-settings]')
  assert.equal(ui.saves[0].apiKey,'ibk_replacement')
  await ui.click('[data-tab=desktop]');await ui.click('[data-action=cleanup-control]')
  const release=calls.find(call=>call.action==='control.release')
  assert.ok(release.input.ownerId);assert.notEqual(release.input.ownerId,'previous-instance')
  assert.match(ui.container.textContent,/模型可操作/);assert.ok(!ui.container.textContent.includes('上次接管待清理'))
})

test('an active takeover owned by another window cannot be cleaned up or taken over here',async t=>{
  const ui=await mount(t,Panel,{execute:async request=>{
    if(request.action==='machines.list')return job(request.action,{machines:[{id:'m_one',name:'first',state:'running'}]})
    if(request.action==='control.status')return job(request.action,{machineId:'m_one',mode:'human',ownerId:'another-window'})
    return job(request.action,{})
  }})
  assert.match(ui.container.textContent,/其他窗口正在接管/)
  assert.equal(ui.container.querySelector('[data-action=cleanup-control]'),null)
  assert.equal(ui.container.querySelector('[data-action=take-control]').disabled,true)
  assert.equal(ui.container.querySelector('iframe'),null)
})

test('background command form sends explicit cloud command and background setting',async t=>{
  const ui=await mount(t);await ui.click('[data-tab=terminal]')
  const form=ui.container.querySelector('form');const textarea=form.querySelector('textarea');const checkbox=form.querySelector('input[type=checkbox]')
  await ui.flush(()=>Simulate.change(textarea,{target:{value:'npm run build'}}));await ui.flush(()=>Simulate.change(checkbox,{target:{checked:true}}))
  await ui.flush(()=>Simulate.submit(form))
  const call=ui.calls.find(call=>call.action==='commands.run');assert.equal(call.machineId,'m_one');assert.equal(call.input.cmd,'npm run build');assert.equal(call.input.background,true)
})

test('advanced input rejects invalid JSON before creating a cloud job',async t=>{
  const ui=await mount(t);await ui.click('[data-tab=advanced]')
  await ui.change('[data-field=advanced-input]','[1,2]')
  const count=ui.calls.length;await ui.flush(()=>Simulate.submit(ui.container.querySelector('form')))
  assert.equal(ui.calls.length,count);assert.match(ui.container.querySelector('[role=alert]').textContent,/JSON 对象/)
})

test('the integrated resources panel reads current machine values and submits only the edited disk field',async t=>{
  const requests=[]
  let disk=20
  const ui=await mount(t,Panel,{execute:async request=>{
    requests.push(request)
    let value={}
    if(request.action==='machines.list')value={machines:[{id:'m_one',name:'first',state:'running'}]}
    if(request.action==='control.status'||request.action==='control.release')value={machineId:request.machineId,mode:'agent'}
    if(request.action==='machines.get')value={id:request.machineId,name:'first',state:'running',spec:{vcpus:4,memMiB:8192,persistentDiskGiB:disk},autoSuspendAfterSeconds:1800}
    if(request.action==='machines.update'){disk=request.input.persistentDiskGiB;value={ok:true}}
    if(request.action==='account.usage')value={machines:1,snapshots:2,storedBytes:5*1024**3,limits:{maxMachines:1,maxSnapshots:5,maxStoredGiB:200}}
    if(request.action==='metrics.get')value={metrics:[{cpuUsedPct:12,memUsed:2*1024**3,memTotal:8*1024**3}]}
    return job(request.action,value)
  }})
  await ui.click('[data-tab=resources]')
  assert.equal(ui.container.querySelector('[data-spec=vcpus]').value,'4')
  assert.equal(ui.container.querySelector('[data-spec=memMiB]').value,'8192')
  assert.equal(ui.container.querySelector('[data-spec=persistentDiskGiB]').value,'20')
  assert.match(ui.container.querySelector('[data-resource=metrics]').textContent,/12%/)
  assert.match(ui.container.querySelector('[data-resource=quota]').textContent,/机器配额/)
  assert.ok(requests.some(request=>request.action==='account.usage'&&request.machineId===undefined))
  await ui.change('[data-spec=persistentDiskGiB]','60')
  await ui.click('[data-action=save-specification]')
  const update=requests.find(request=>request.action==='machines.update')
  assert.equal(update.machineId,'m_one')
  assert.deepEqual(update.input,{persistentDiskGiB:60})
  assert.equal(ui.container.querySelector('[data-spec=persistentDiskGiB]').value,'60')
})

test('viewer validates scheme and official host; binary transfers preserve every byte',()=>{
  assert.equal(viewerUrl('https://dashboard.instabox.sh/view?t=x'),'https://dashboard.instabox.sh/view?t=x')
  for(const invalid of['javascript:alert(1)','http://dashboard.instabox.sh/view','https://instabox.sh.evil.example/view','https://evil.example/view','https://user:password@instabox.sh/view'])assert.throws(()=>viewerUrl(invalid))
  const bytes=Uint8Array.from({length:16000},(_,i)=>i%256);assert.deepEqual(base64ToBytes(bytesToBase64(bytes)),bytes)
})

test('long-running operations use short polls, report failure and stop polling on abort',async()=>{
  let polls=0;const updates=[],signal=new AbortController()
  const done=await waitForJob({getJob:async()=>{polls++;return job('machines.create',{id:'m_ready'})}},job('machines.create',undefined,'running'),signal.signal,value=>updates.push(value),1)
  assert.equal(polls,1);assert.equal(done.result.id,'m_ready');assert.equal(updates.length,2)
  await assert.rejects(waitForJob({getJob:async()=>({...job('machines.create',undefined,'failed'),error:'quota exceeded'})},job('machines.create',undefined,'running'),signal.signal,undefined,1),/quota exceeded/)
  const cancelled=new AbortController();const waiting=waitForJob({getJob:async()=>{throw new Error('must not poll')}},job('machines.create',undefined,'running'),cancelled.signal,undefined,1000);cancelled.abort();await assert.rejects(waiting)
})

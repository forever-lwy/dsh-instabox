import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {JSDOM} from 'jsdom'
import {changedSpec,specDraft,bytes,duration,percentage,machineSpec} from '../lib/client/resources-data.js'

let dom,React,createRoot,Simulate,Resources
const originals=new Map(),GiB=1024**3
before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://dsh.test/'})
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,Node:dom.window.Node,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})
  }
  React=await import('react');({createRoot}=await import('react-dom/client'));({Simulate}=await import('react-dom/test-utils'));({Resources}=await import('../lib/client/Resources.js'))
})
after(()=>{dom.window.close();for(const[key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}})
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const first=()=>({id:'m_one',name:'first',state:'running',spec:{vcpus:4,memMiB:8192,persistentDiskGiB:20},template:{id:'agent-browser'},autoSuspendAfterSeconds:1800,createdAt:'2026-11-02T00:00:00Z'})
const second=()=>({...first(),id:'m_two',name:'second',spec:{vcpus:8,memMiB:16384,persistentDiskGiB:50},autoSuspendAfterSeconds:900})
async function mount(t,options={}){
  const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container),calls=[]
  const machines={m_one:first(),m_two:second()};let updates=0
  const base=async(action,input={},target)=>{
    switch(action){
      case'machines.get':return structuredClone(machines[target]??{})
      case'account.me':return {userId:'u_1',login:'owner',name:'测试用户',email:'owner@example.test',allowedSpecs:[{vcpus:4,memMiB:8192,persistentDiskGiB:20}]}
      case'account.usage':return {machines:1,snapshots:2,storedBytes:5*GiB,logicalBytes:20*GiB,computedAt:'2026-11-02T00:00:00Z',limits:{maxMachines:5,maxSnapshots:10,maxStoredGiB:200}}
      case'metrics.get':return {metrics:[{timestamp:'2026-11-02T01:00:00Z',cpuUsedPct:25,cpuCount:4,memUsed:2*GiB,memTotal:8*GiB,diskTotal:20*GiB,netInBytesPerSec:1024,netOutBytesPerSec:2048}]}
      case'machines.disk':return {measuredAt:'2026-11-02T01:00:00Z',filesystems:[{mount:'/data',sizeBytes:20*GiB,usedBytes:5*GiB,availableBytes:15*GiB,usedPct:25,inodesUsedPct:2,level:'ok'}]}
      case'usage.get':return {from:'2026-11-01T00:00:00Z',to:'2026-11-02T01:00:00Z',runningSeconds:5400,vcpuSeconds:21600,memGiBSeconds:43200,diskGiBSeconds:108000}
      case'templates.list':return {templates:[{id:'agent-browser',version:'2026-11-01',description:'完整桌面浏览器',creatable:true,defaultSpec:{vcpus:4,memMiB:8192,persistentDiskGiB:20}}]}
      case'machines.logs':return {machineId:target,state:'running',console:'Boot complete\nReady for work',cursor:10,operations:[{id:'op_1',type:'create',state:'succeeded',createdAt:'2026-11-02T00:00:00Z'}]}
      case'machines.update':machines[target]={...machines[target],spec:{...machines[target].spec,...Object.fromEntries(Object.entries(input).filter(([key])=>key!=='autoSuspendAfterSeconds'))},...(input.autoSuspendAfterSeconds===undefined?{}:{autoSuspendAfterSeconds:input.autoSuspendAfterSeconds})};return structuredClone(machines[target])
      default:throw new Error(`Unexpected ${action}`)
    }
  }
  const run=async(action,input={},target,quiet)=>{calls.push({action,input,target,quiet});return options.run?options.run(action,input,target,quiet,base):base(action,input,target)}
  const props={run,machineId:options.machineId??'m_one',onUpdated:async()=>{updates++;await options.onUpdated?.()}}
  const flush=action=>React.act(async()=>{action?.()})
  await flush(()=>root.render(React.createElement(Resources,props)))
  let unmounted=false
  const unmount=async()=>{if(!unmounted){unmounted=true;await flush(()=>root.unmount());container.remove()}}
  t.after(unmount)
  return {container,calls,props,machines,flush,unmount,get updates(){return updates},
    async click(selector){const node=container.querySelector(selector);assert.ok(node,selector);await flush(()=>node.click())},
    async change(selector,value){const node=container.querySelector(selector);assert.ok(node,selector);await flush(()=>Simulate.change(node,{target:{value}}))},
    async rerender(machineId){props.machineId=machineId;await flush(()=>root.render(React.createElement(Resources,{...props})))}}
}

test('resources load automatically as readable cards with real units and prefilled current specification',async t=>{
  const ui=await mount(t)
  for(const action of ['machines.get','account.me','account.usage','metrics.get','machines.disk','usage.get','templates.list','machines.logs'])assert.ok(ui.calls.some(call=>call.action===action),action)
  assert.equal(ui.container.querySelector('[data-spec=vcpus]').value,'4')
  assert.equal(ui.container.querySelector('[data-spec=memMiB]').value,'8192')
  assert.equal(ui.container.querySelector('[data-spec=persistentDiskGiB]').value,'20')
  assert.equal(ui.container.querySelector('[data-spec=autoSuspendAfterSeconds]').value,'1800')
  assert.match(ui.container.querySelector('[data-resource=machine]').textContent,/8 GiB/)
  assert.match(ui.container.querySelector('[data-resource=metrics]').textContent,/25%/)
  assert.equal(ui.container.querySelector('[data-resource=metrics] progress[aria-label="内存"]').value,25)
  assert.match(ui.container.querySelector('[data-resource=disk]').textContent,/15 GiB/)
  assert.match(ui.container.querySelector('[data-resource=usage]').textContent,/1 小时 30 分/)
  assert.match(ui.container.querySelector('[data-resource=usage]').textContent,/6 vCPU·小时/)
  assert.match(ui.container.querySelector('[data-resource=quota]').textContent,/服务尚未返回账单金额/)
  assert.match(ui.container.querySelector('[data-resource=templates]').textContent,/完整桌面浏览器/)
  assert.match(ui.container.querySelector('[data-resource=logs] [aria-label="机器控制台日志"]').textContent,/Boot complete/)
  for(const details of ui.container.querySelectorAll('details.dsi-resource-raw'))assert.equal(details.open,false)
})

test('changing only disk submits only disk and rereads the current specification after save',async t=>{
  const ui=await mount(t)
  assert.equal(ui.container.querySelector('[data-action=save-specification]').disabled,true)
  await ui.change('[data-spec=persistentDiskGiB]','50');await ui.click('[data-action=save-specification]')
  const writes=ui.calls.filter(call=>call.action==='machines.update')
  assert.equal(writes.length,1);assert.deepEqual(writes[0].input,{persistentDiskGiB:50});assert.equal(writes[0].target,'m_one')
  assert.equal(ui.container.querySelector('[data-spec=persistentDiskGiB]').value,'50');assert.equal(ui.updates,1)
  assert.equal(ui.calls.filter(call=>call.action==='machines.get').length,2)
  assert.equal(ui.container.querySelector('[data-action=save-specification]').disabled,true)
})

test('an accepted update followed by a read failure does not claim the current specification was refreshed',async t=>{
  let reads=0
  const ui=await mount(t,{run:async(action,input,target,quiet,base)=>{
    if(action==='machines.get'&&++reads>1)throw new Error('最新规格暂时无法读取')
    return base(action,input,target)
  }})
  await ui.change('[data-spec=persistentDiskGiB]','50');await ui.click('[data-action=save-specification]')
  const status=ui.container.querySelector('[data-resource=specification] [role=status]')
  assert.match(status.textContent,/修改已提交，但读取最新规格失败/)
  assert.ok(!status.textContent.includes('已重新读取服务器当前规格'))
  assert.equal(ui.calls.filter(call=>call.action==='machines.update').length,1)
  assert.match(ui.container.querySelector('[data-resource=machine] [role=alert]').textContent,/最新规格暂时无法读取/)
})

test('CPU and memory are independently submitted only when actually edited, invalid inputs never dispatch',async t=>{
  const ui=await mount(t)
  await ui.change('[data-spec=memMiB]','16384');await ui.click('[data-action=save-specification]')
  assert.deepEqual(ui.calls.find(call=>call.action==='machines.update').input,{memMiB:16384})
  await ui.change('[data-spec=vcpus]','');await ui.flush(()=>Simulate.submit(ui.container.querySelector('[data-resource=specification] form')))
  assert.equal(ui.calls.filter(call=>call.action==='machines.update').length,1)
  assert.match(ui.container.querySelector('[data-resource=specification] [role=alert]').textContent,/不能为空/)
})

test('a failed metrics endpoint does not hide other data or the editable specification',async t=>{
  const ui=await mount(t,{run:async(action,input,target,quiet,base)=>{if(action==='metrics.get')throw new Error('指标暂时不可用');return base(action,input,target)}})
  assert.match(ui.container.querySelector('[data-resource=metrics] [role=alert]').textContent,/指标暂时不可用/)
  assert.equal(ui.container.querySelector('[data-resource=machine] [role=alert]'),null)
  assert.match(ui.container.querySelector('[data-resource=disk]').textContent,/空间正常/)
  assert.equal(ui.container.querySelector('[data-spec=vcpus]').value,'4')
})

test('a late response from the previous machine never fills the selected machine form',async t=>{
  const old=deferred()
  const ui=await mount(t,{run:async(action,input,target,quiet,base)=>action==='machines.get'&&target==='m_one'?old.promise:base(action,input,target)})
  assert.equal(ui.container.querySelector('[data-spec=vcpus]').value,'')
  await ui.rerender('m_two')
  assert.equal(ui.container.querySelector('[data-spec=vcpus]').value,'8')
  assert.equal(ui.container.querySelector('[data-spec=persistentDiskGiB]').value,'50')
  await ui.flush(()=>old.resolve(first()))
  assert.equal(ui.container.querySelector('[data-spec=vcpus]').value,'8')
  assert.match(ui.container.querySelector('[data-resource=machine]').textContent,/second/)
  assert.ok(!ui.container.querySelector('[data-resource=machine]').textContent.includes('first'))
})

test('an update finishing after machine selection changes cannot replace the new machine form',async t=>{
  const pending=deferred()
  const ui=await mount(t,{run:async(action,input,target,quiet,base)=>action==='machines.update'?pending.promise:base(action,input,target)})
  await ui.change('[data-spec=persistentDiskGiB]','30');await ui.click('[data-action=save-specification]')
  assert.equal([...ui.container.querySelectorAll('button')].find(button=>button.textContent==='刷新全部').disabled,true)
  assert.equal(ui.container.querySelector('[data-resource=machine] button').disabled,true)
  await ui.rerender('m_two')
  await ui.flush(()=>pending.resolve({...first(),spec:{...first().spec,persistentDiskGiB:30}}))
  assert.equal(ui.container.querySelector('[data-spec=persistentDiskGiB]').value,'50')
  assert.equal(ui.container.querySelector('[data-spec=vcpus]').value,'8')
  assert.equal(ui.updates,0)
})

test('missing fields are unknown, while zero CPU, zero balances and disabled idle suspension are retained',async t=>{
  const ui=await mount(t,{run:async(action,input,target,quiet,base)=>{
    if(action==='machines.get')return {id:'m_one',name:'partial',state:'stopped',autoSuspendAfterSeconds:null}
    if(action==='metrics.get')return {metrics:[{timestamp:'2026-11-02T00:00:00Z',cpuUsedPct:0,memUsed:0,memTotal:8*GiB}]}
    if(action==='account.usage')return {...await base(action,input,target),cost:{costUSD:0,runtimeUSD:0,storageUSD:0,egressUSD:0,allowanceUSD:20,creditRemainingUSD:20,remainingUSD:0,overageUSD:0,creditsUSD:0,ratedUntil:'2026-11-02T00:00:00Z'}}
    return base(action,input,target)
  }})
  assert.equal(ui.container.querySelector('[data-spec=vcpus]').value,'')
  assert.equal(ui.container.querySelector('[data-spec=memMiB]').value,'')
  assert.equal(ui.container.querySelector('[data-spec=autoSuspendAfterSeconds]').value,'0')
  assert.match(ui.container.querySelector('[data-resource=machine]').textContent,/关闭（保持运行）/)
  assert.match(ui.container.querySelector('[data-resource=metrics]').textContent,/0%/)
  const stats=[...ui.container.querySelectorAll('[data-resource=quota] .dsi-resource-stat')]
  assert.match(stats.find(node=>node.textContent.includes('本月已计量费用')).textContent,/0 USD/)
  assert.match(stats.find(node=>node.textContent.includes('包含额度剩余')).textContent,/20 USD/)
  assert.ok(!ui.container.querySelector('[data-resource=quota]').textContent.includes('服务尚未返回账单金额'))
})

test('account and templates stay usable before any machine is selected',async t=>{
  const ui=await mount(t,{machineId:''})
  assert.ok(ui.calls.some(call=>call.action==='account.me'))
  assert.ok(ui.calls.some(call=>call.action==='account.usage'))
  assert.ok(ui.calls.some(call=>call.action==='templates.list'))
  assert.ok(!ui.calls.some(call=>['machines.get','metrics.get','machines.disk','usage.get','machines.logs'].includes(call.action)))
  assert.equal(ui.container.querySelector('[data-resource=specification] fieldset').disabled,true)
})

test('specification comparisons preserve unknown values and never manufacture unchanged fields',()=>{
  const current=specDraft(first());assert.deepEqual(changedSpec({...current,persistentDiskGiB:'50'},current),{persistentDiskGiB:50})
  assert.deepEqual(changedSpec({...current,vcpus:'04'},current),{})
  assert.deepEqual(machineSpec({id:'m_partial',autoSuspendAfterSeconds:null}),{vcpus:undefined,memMiB:undefined,persistentDiskGiB:undefined,autoSuspendAfterSeconds:0})
  assert.equal(bytes(8*GiB),'8 GiB');assert.equal(bytes(undefined),'未提供');assert.equal(duration(5400),'1 小时 30 分');assert.equal(percentage(0,8),0)
})

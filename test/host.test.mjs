import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { InstaboxRuntime, safeError } from '../lib/runtime.js'
import { InstaboxService } from '../lib/service.js'
import { ConfigStore } from '../lib/store.js'
import { ControlLeaseStore } from '../lib/control-store.js'
import { defaultConfig } from '../lib/shared.js'
import { registerTools } from '../lib/tools.js'

const signal = () => new AbortController().signal
const id = 'm_test-machine'
const ownerId = 'panel-one-123'
const request = (action, input = {}, machineId = id) => ({action, machineId, input})
const done = (runtime, action, actor = 'human', input = {}, machineId = id) => runtime.submit(request(action, input, machineId), actor, signal(), 8000)
const apiFixture = () => {
  const calls = []
  let revokeFails = false
  const api = {async execute(request, abort) {
    abort?.throwIfAborted()
    calls.push(structuredClone(request))
    if (request.action === 'desktop.view') return {url: 'https://instabox.sh/view/test-token', expiresAt: '2026-11-02T13:00:00Z'}
    if (request.action === 'desktop.revoke' && revokeFails) throw new Error('secret ibk_do-not-show')
    return {ok: true}
  }}
  return {api, calls, failRevocation: value => {revokeFails = value}}
}

test('takeover aborts active model input, blocks queued/future mutation, leaves reads available, and verifies owner on handback', async t => {
  const fixture = apiFixture()
  let execStarted, sawAbort = false
  const started = new Promise(resolve => {execStarted = resolve})
  const original = fixture.api.execute
  fixture.api.execute = async (request, abort) => {
    if (request.action !== 'commands.run') return original(request, abort)
    execStarted()
    await new Promise((resolve, reject) => abort.addEventListener('abort', () => {sawAbort = true; reject(abort.reason)}, {once:true}))
  }
  const runtime = new InstaboxRuntime(async () => fixture.api)
  t.after(() => runtime.dispose())
  const active = await runtime.submit(request('commands.run', {cmd:'sleep 10'}), 'agent', signal())
  await started
  const queued = await runtime.submit(request('files.write', {path:'/data/home/a',content:'x'}), 'agent', signal())
  const takeover = await done(runtime, 'control.take', 'human', {ownerId})
  assert.equal(takeover.status, 'succeeded')
  assert.equal(takeover.result.mode, 'human')
  assert.equal(sawAbort, true)
  assert.equal(runtime.getJob(active.jobId).status, 'cancelled')
  assert.equal(runtime.getJob(queued.jobId).status, 'cancelled')
  await assert.rejects(done(runtime, 'desktop.click', 'agent', {x:1,y:2}), /用户正在接管/)
  await assert.rejects(done(runtime, 'machines.suspend', 'agent'), /用户正在接管/)
  await assert.rejects(done(runtime, 'desktop.handback', 'agent'), /仅能由用户/)
  await assert.rejects(done(runtime, 'desktop.view', 'agent', {viewOnly:false}), /仅能由用户/)
  assert.equal((await done(runtime, 'desktop.screenshot', 'agent')).status, 'succeeded')
  const wrongOwner = await done(runtime, 'control.release', 'human', {ownerId:'another-panel-123'})
  assert.equal(wrongOwner.status, 'failed')
  assert.equal(fixture.calls.filter(call => call.action === 'desktop.revoke').length, 0)
  assert.equal((await done(runtime, 'control.release', 'human', {ownerId})).result.mode, 'agent')
  assert.equal((await done(runtime, 'desktop.click', 'agent', {x:1,y:2})).status, 'succeeded')
  assert.deepEqual(fixture.calls.slice(0, 3).map(call=>call.action), ['desktop.start','desktop.takeover','desktop.view'])
})

test('Host replaces the opaque watch token with a newly minted interactive hash token and preserves it across renewal', async t=>{
  const calls=[]
  const pathname=`https://dashboard.instabox.sh/desktop/${id}`
  const runtime=new InstaboxRuntime(async()=>({async execute(request){
    calls.push(structuredClone(request))
    if(request.action==='desktop.view') return {url:`${pathname}#${request.input.viewOnly?'synthetic-watch-token':'synthetic-interactive-token'}`,expiresAt:'2026-11-02T13:00:00Z'}
    return {controller:'human',yours:true}
  }}))
  t.after(()=>runtime.dispose())
  // The official viewer reads its hash token on initial mount. These opaque
  // synthetic values deliberately use the same path and differ only in hash;
  // this checks Host mode/token propagation, not browser or VNC mouse input.
  const watch=await done(runtime,'desktop.view','human',{viewOnly:true,ttlSeconds:600})
  const take=await done(runtime,'control.take','human',{ownerId})
  assert.equal(watch.status,'succeeded')
  assert.equal(take.status,'succeeded')
  assert.equal(new URL(watch.result.url).pathname,new URL(take.result.url).pathname)
  assert.notEqual(new URL(watch.result.url).hash,new URL(take.result.url).hash)
  assert.equal(new URL(take.result.url).hash,'#synthetic-interactive-token')
  assert.deepEqual(calls.filter(call=>call.action==='desktop.view').map(call=>call.input),[
    {viewOnly:true,ttlSeconds:600},{viewOnly:false,ttlSeconds:600},
  ])
  const renewed=await done(runtime,'control.renew','human',{ownerId})
  assert.equal(renewed.result.url,take.result.url)
  assert.equal(calls.filter(call=>call.action==='desktop.view').length,2)
  assert.equal(calls.at(-1).action,'desktop.status')
})

test('invalid owner and machine aliases fail before jobs are accepted, avoiding canonical-ID takeover bypass', async t => {
  const fixture = apiFixture()
  const runtime = new InstaboxRuntime(async () => fixture.api)
  t.after(() => runtime.dispose())
  await assert.rejects(done(runtime, 'control.take', 'human', {}), /租约标识/)
  await assert.rejects(done(runtime, 'control.take', 'human', {ownerId}, 'my-friendly-name'), /操作参数无效/)
  assert.equal(runtime.listJobs().length, 0)
  await done(runtime, 'control.take', 'human', {ownerId})
  const count = runtime.listJobs().length
  await assert.rejects(done(runtime, 'control.take', 'human', {ownerId:'other-panel-123'}), /另一个面板/)
  assert.equal(runtime.listJobs().length, count)
})

test('expired leases revoke viewer capability; failed revocation keeps agent blocked and can be retried', async t => {
  const fixture = apiFixture()
  let now = 0
  const runtime = new InstaboxRuntime(async () => fixture.api, () => now)
  t.after(() => runtime.dispose())
  await done(runtime, 'control.take', 'human', {ownerId})
  fixture.failRevocation(true)
  now = 120001
  await runtime.expireLeases()
  assert.equal(runtime.control(id).mode, 'human')
  await assert.rejects(done(runtime, 'desktop.type', 'agent', {text:'bad'}), /用户正在接管/)
  fixture.failRevocation(false)
  now += 16000
  await runtime.expireLeases()
  assert.equal(runtime.control(id).mode, 'agent')
})

test('missing credentials cannot leave an initializing takeover lock; closing polling does not cancel accepted jobs', async t => {
  const missing = new InstaboxRuntime(async () => {throw new Error('ibk_secret')})
  t.after(() => missing.dispose())
  const failed = await done(missing, 'control.take', 'human', {ownerId})
  assert.equal(failed.status, 'failed')
  assert.equal(missing.control(id).mode, 'agent')
  assert.equal(failed.error.includes('ibk_secret'), false)
  let complete
  const runtime = new InstaboxRuntime(async () => ({execute: async () => new Promise(resolve => {complete = resolve})}))
  t.after(() => runtime.dispose())
  const caller = new AbortController()
  const view = await runtime.submit(request('machines.start'), 'human', caller.signal)
  await new Promise(resolve => setImmediate(resolve))
  caller.abort()
  assert.equal(runtime.getJob(view.jobId).status, 'running')
  complete({ok:true})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.getJob(view.jobId).status, 'succeeded')
})

test('releasing during takeover initialization cancels creation before a new interactive viewer can escape cleanup', async t => {
  const fixture=apiFixture()
  const original=fixture.api.execute
  let began
  const started=new Promise(resolve=>{began=resolve})
  fixture.api.execute=async(request,abort)=>{
    if(request.action!=='desktop.start') return original(request,abort)
    began()
    return new Promise((resolve,reject)=>abort.addEventListener('abort',()=>reject(abort.reason),{once:true}))
  }
  const runtime=new InstaboxRuntime(async()=>fixture.api)
  t.after(()=>runtime.dispose())
  const view=await runtime.submit(request('control.take',{ownerId}),'human',signal())
  await started
  await runtime.releaseAll()
  assert.equal(runtime.control(id).mode,'agent')
  assert.equal(runtime.getJob(view.jobId).status,'cancelled')
  assert.equal(fixture.calls.some(call=>call.action==='desktop.view'),false)
  assert.equal(fixture.calls.filter(call=>call.action==='desktop.revoke').length,1)
})

test('dispose aborts cooperative in-flight work and revokes only owned interactive desktops', async () => {
  const fixture = apiFixture()
  const original = fixture.api.execute
  let activeSignal
  fixture.api.execute = async (request, abort) => {
    if (request.action !== 'machines.logs') return original(request, abort)
    activeSignal = abort
    await new Promise((resolve,reject) => abort.addEventListener('abort',()=>reject(abort.reason),{once:true}))
  }
  const runtime = new InstaboxRuntime(async () => fixture.api)
  await done(runtime, 'control.take', 'human', {ownerId})
  await runtime.submit(request('machines.logs'), 'human')
  await new Promise(resolve=>setImmediate(resolve))
  await runtime.dispose()
  assert.equal(activeSignal.aborted, true)
  assert.equal(fixture.calls.filter(call=>call.action==='desktop.revoke').length, 1)
  await assert.rejects(done(runtime, 'machines.list'), /正在关闭/)
})

test('finished plugin job retention removes oldest results, retains newest polling handle', async t => {
  const runtime = new InstaboxRuntime(async () => ({execute:async()=>({ok:true})}))
  t.after(() => runtime.dispose())
  const first = await done(runtime,'machines.get')
  let last
  for (let n=0;n<130;n++) last=await done(runtime,'machines.get')
  assert.equal(runtime.listJobs().length,128)
  assert.throws(()=>runtime.getJob(first.jobId), /过期/)
  assert.equal(runtime.getJob(last.jobId).status,'succeeded')
})

test('failed viewer revocation survives a runtime reload as durable human control until a later successful revoke', async t=>{
  const dir=await mkdtemp(join(tmpdir(),'instabox-control-journal-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const path=join(dir,'control-leases.json')
  const fixture=apiFixture()
  const first=new InstaboxRuntime(async()=>fixture.api,Date.now,{journal:new ControlLeaseStore(path)})
  await done(first,'control.take','human',{ownerId})
  const durable=JSON.parse(await readFile(path,'utf8'))
  assert.equal(durable.leases[0].machineId,id)
  assert.equal(durable.leases[0].ownerId,ownerId)
  assert.equal(JSON.stringify(durable).includes('https:'),false)
  assert.equal(JSON.stringify(durable).includes('ibk_'),false)
  assert.equal((await stat(path)).mode&0o777,0o600)
  fixture.failRevocation(true)
  await first.dispose()
  assert.equal(JSON.parse(await readFile(path,'utf8')).leases.length,1)
  const second=new InstaboxRuntime(async()=>fixture.api,Date.now,{journal:new ControlLeaseStore(path)})
  t.after(()=>second.dispose())
  await second.ready
  assert.equal(second.control(id).mode,'human')
  assert.equal(second.control(id).pendingCleanup,true)
  await assert.rejects(done(second,'desktop.click','agent',{x:1,y:1}),/用户正在接管/)
  // The original browser is gone. A new panel may explicitly retry a recovered
  // tombstone, without acquiring the old owner's interactive viewer URL.
  const denied=await done(second,'control.release','human',{ownerId:'new-panel-owner-123'})
  assert.equal(denied.status,'failed')
  fixture.failRevocation(false)
  const released=await done(second,'control.release','human',{ownerId:'new-panel-owner-123'})
  assert.equal(released.status,'succeeded')
  assert.equal(second.control(id).mode,'agent')
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')).leases,[])
  assert.equal((await done(second,'desktop.click','agent',{x:1,y:1})).status,'succeeded')
})

test('a missing recovery key can be replaced through settings while the persisted lock remains fail closed',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'instabox-recovery-key-'))
  const ctx=new Context()
  t.after(async()=>{await ctx.fiber.dispose();await rm(dir,{recursive:true,force:true})})
  const journal=new ControlLeaseStore(join(dir,'control-leases.json'))
  await journal.save([{machineId:id,ownerId,since:0,expiresAt:1}])
  const credentials=new Map()
  ctx.provide('credentials',{
    describe:async ref=>({configured:credentials.has(ref),writable:true}),resolve:async ref=>credentials.has(ref)?{value:credentials.get(ref),source:'file'}:undefined,
    set:async(ref,value)=>credentials.set(ref,value),unset:async ref=>credentials.delete(ref),
  })
  const fixture=apiFixture()
  const store=new ConfigStore(join(dir,'settings.json'));await store.load()
  const service=new InstaboxService(ctx,store,{apiFactory:async()=>{
    if(!credentials.has('INSTABOX_API_KEY')) throw new Error('missing key')
    return fixture.api
  }})
  await service.runtime.ready
  assert.equal(service.runtime.control(id).pendingCleanup,true)
  const saved=await service.saveSettings({config:defaultConfig(),expectedRevision:0,apiKey:'ibk_restored_personal_key_123'},signal())
  assert.equal(saved.credential.configured,true)
  assert.equal(service.runtime.control(id).mode,'agent')
  assert.equal((await journal.load()).length,0)
  assert.equal(JSON.stringify(await readFile(journal.path,'utf8')).includes('ibk_'),false)
})

test('interactive desktop creation never starts if its durable lock cannot be recorded',async t=>{
  const fixture=apiFixture()
  const journal={load:async()=>[],save:async()=>{throw new Error('disk full')}}
  const runtime=new InstaboxRuntime(async()=>fixture.api,Date.now,{journal})
  t.after(()=>runtime.dispose())
  const result=await done(runtime,'control.take','human',{ownerId})
  assert.equal(result.status,'failed')
  assert.equal(fixture.calls.length,0)
  assert.equal(runtime.control(id).mode,'human')
  assert.equal(runtime.control(id).pendingCleanup,true)
})

test('dispose joins an already running expiry revoke and drains its journal commit before returning',async()=>{
  const fixture=apiFixture()
  let now=0
  const journalRecords=[]
  let allowRevoke,startedRevoke
  const revokeBegan=new Promise(resolve=>{startedRevoke=resolve})
  const revokeGate=new Promise(resolve=>{allowRevoke=resolve})
  let allowJournal,startedJournal
  const journalBegan=new Promise(resolve=>{startedJournal=resolve})
  const journalGate=new Promise(resolve=>{allowJournal=resolve})
  let delayCleanup=false
  const journal={load:async()=>[],save:async records=>{
    if(delayCleanup && records.length===0){startedJournal();await journalGate}
    journalRecords.splice(0,journalRecords.length,...structuredClone(records))
  }}
  const original=fixture.api.execute
  fixture.api.execute=async(request,abort)=>{
    if(delayCleanup && request.action==='desktop.revoke') {startedRevoke();await revokeGate}
    return original(request,abort)
  }
  const runtime=new InstaboxRuntime(async()=>fixture.api,()=>now,{journal})
  await done(runtime,'control.take','human',{ownerId})
  delayCleanup=true
  now=120001
  const expiry=runtime.expireLeases()
  await revokeBegan
  let disposed=false
  const disposal=runtime.dispose().then(()=>{disposed=true})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(disposed,false,'must await the in-flight timer revoke')
  allowRevoke()
  await journalBegan
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(disposed,false,'must also await the pending durable commit')
  assert.equal(journalRecords.length,1)
  allowJournal()
  await Promise.all([expiry,disposal])
  assert.equal(disposed,true)
  assert.equal(journalRecords.length,0)
  assert.equal(fixture.calls.filter(call=>call.action==='desktop.revoke').length,1)
  assert.equal(fixture.calls.filter(call=>call.action==='desktop.handback').length,1)
})

test('real Cordis service keeps credential values out of settings/disk, enforces revision, and routes model create with templateId', async t => {
  const dir=await mkdtemp(join(tmpdir(),'instabox-host-'))
  const ctx=new Context()
  const credentials=new Map()
  const calls=[]
  new TypertRegistry(ctx)
  ctx.provide('credentials',{
    describe:async ref=>({configured:credentials.has(ref),writable:true}),
    resolve:async ref=>credentials.has(ref)?{value:credentials.get(ref),source:'file'}:undefined,
    set:async(ref,value)=>credentials.set(ref,value),unset:async ref=>credentials.delete(ref),
  })
  const store=new ConfigStore(join(dir,'settings.json'));await store.load()
  const service=new InstaboxService(ctx,store,{apiFactory:async()=>({execute:async request=>{calls.push(request);return {ok:true}}})})
  t.after(async()=>{await ctx.fiber.dispose();await rm(dir,{recursive:true,force:true})})
  assert.equal(ctx.instabox.current().defaultTemplate,'agent-browser')
  assert.deepEqual(remoteMethods(service).map(row=>row.method).sort(),['execute','getJob','getSettings','saveSettings'])
  const initial=await service.getSettings({},signal())
  const secret='ibk_synthetic_test_123456'
  const saved=await service.saveSettings({config:initial.config,expectedRevision:0,apiKey:secret},signal())
  assert.equal(saved.revision,1)
  assert.equal(saved.credential.configured,true)
  assert.equal(JSON.stringify(saved).includes(secret),false)
  assert.equal((await readFile(store.path,'utf8')).includes(secret),false)
  assert.equal((await stat(store.path)).mode&0o777,0o600)
  await assert.rejects(service.saveSettings({config:initial.config,expectedRevision:0,apiKey:'ibk_replacement_test123'},signal()), /其他窗口修改/)
  assert.equal(credentials.get('INSTABOX_API_KEY'),secret)
  await service.executeAgent({action:'machines.create'},signal())
  assert.deepEqual(calls.at(-1).input,{templateId:'agent-browser'})
  await service.executeAgent({action:'machines.create',input:{snapshotId:'sn_copy'}},signal())
  assert.deepEqual(calls.at(-1).input,{snapshotId:'sn_copy'})
  await service.saveSettings({config:{...defaultConfig(),modelToolsEnabled:false},expectedRevision:1},signal())
  await assert.rejects(service.executeAgent({action:'machines.list'},signal()), /模型工具已/)
})

test('model screenshot produces durable image with original screen coordinates; help describes actual validated fields', async t => {
  const ctx=new Context()
  const tools=new Map()
  const image={attachmentId:'test-image',mediaType:'image/png',bytes:1,width:1000,height:625,name:'screen.png'}
  const images=[]
  ctx.provide('tools',{register:definition=>{tools.set(definition.name,definition);return()=>tools.delete(definition.name)}})
  ctx.provide('attachments',{saveImage:async input=>{images.push(input);return image}})
  const service={current:()=>defaultConfig(),executeAgent:async()=>({jobId:'test-job',action:'desktop.screenshot',machineId:id,status:'succeeded',createdAt:0,updatedAt:0,result:{mimeType:'image/png',base64:'AA==',width:2560,height:1600}})}
  registerTools(ctx,service)
  t.after(()=>ctx.fiber.dispose())
  const definition=tools.get('instabox_desktop')
  const value=await definition.execute({action:'desktop.screenshot',machineId:id},{signal:signal()})
  const content=definition.output.render({},value)
  assert.equal(content[1].type,'image')
  assert.equal(content[1].attachment,image)
  assert.equal(value.result.screenWidth,2560)
  assert.equal(value.result.screenHeight,1600)
  assert.equal(JSON.stringify(value).includes('base64'),false)
  assert.equal(images.length,1)
  const help=await tools.get('instabox_help').execute({action:'machines.create'},{signal:signal()})
  assert.ok(help.inputSchema.properties.templateId)
  assert.ok(help.inputSchema.properties.snapshotId)
  assert.equal(help.inputSchema.properties.template,undefined)
  const portHelp=await tools.get('instabox_help').execute({action:'ports.publish'},{signal:signal()})
  assert.deepEqual(portHelp.inputSchema.properties.access.enum,['private','public'])
})

test('nested screenshot is injected into its agent only after the enclosing tool succeeds', async t=>{
  const ctx=new Context()
  const definitions=new Map()
  ctx.provide('tools',{register:definition=>definitions.set(definition.name,definition)})
  registerTools(ctx,{current:()=>defaultConfig()})
  t.after(()=>ctx.fiber.dispose())
  const image={attachmentId:'nested-image',mediaType:'image/png',bytes:1,width:1,height:1}
  const injected=[]
  const agent={inject:message=>injected.push(message)}
  const rootToken=Symbol('root')
  const job={jobId:'image-job',result:{image}}
  const successful={isError:false,content:[{type:'image',attachment:image}],meta:{instabox:job}}
  ctx.emit('tools/result',{name:'instabox_desktop',token:Symbol('child'),parent:rootToken,agent,signal:signal()},successful)
  assert.equal(injected.length,0)
  ctx.emit('tools/result',{name:'run_code',token:rootToken,agent,signal:signal()},{isError:false,content:[]})
  assert.equal(injected.length,1)
  assert.equal(injected[0].content[0].attachment.attachmentId,'nested-image')
  const failedRoot=Symbol('failed-root')
  ctx.emit('tools/result',{name:'instabox_desktop',token:Symbol('child2'),parent:failedRoot,agent,signal:signal()},successful)
  ctx.emit('tools/result',{name:'run_code',token:failedRoot,agent,signal:signal()},{isError:true,content:[]})
  assert.equal(injected.length,1)
})

test('error surfaces redact raw provider bodies and keys but preserve safe corrective details and operation ID',()=>{
  assert.equal(safeError(new Error('raw password ibk_something <html>')), 'Instabox 操作失败。请检查连接、账号权限及云端状态。')
  const wrong={code:'invalid_input',operationId:'op_safe123'}
  assert.match(safeError(wrong),/字段名称/)
  assert.match(safeError(wrong),/op_safe123/)
  assert.match(safeError({code:'not_utf8'}),/format:base64/)
  assert.match(safeError({code:'confirmation_required'}),/confirm/)
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Context} from '@deepseek-ai/cordis'
import {ActivityTracker} from '../lib/activity.js'
import {InstaboxService} from '../lib/service.js'
import {ConfigStore} from '../lib/store.js'
import {registerTools} from '../lib/tools.js'
import {defaultConfig} from '../lib/shared.js'

const id='m_activity-one'
const request=(action,machineId=id,input={})=>({action,...(machineId?{machineId}:{}),input})
const job=(action,result,status='succeeded',machineId=id)=>({jobId:'plugin-job',action,machineId,status,createdAt:1,updatedAt:2,result})
const signal=()=>new AbortController().signal
const first=(tracker,session='session-a')=>tracker.snapshot(session).machines[0]

test('activity belongs to its exact session and snapshots contain only selected machine metadata',()=>{
  const tracker=new ActivityTracker()
  const token=tracker.begin('session-a',request('desktop.screenshot'))
  tracker.finish(token,job('desktop.screenshot',{mimeType:'image/png',base64:'sensitive-image',url:'https://private/view#token=secret',apiKey:'ibk_secret',content:'file-secret'}))
  assert.equal(first(tracker).machineId,id)
  assert.equal(first(tracker).phase,'idle')
  assert.deepEqual(tracker.snapshot('session-b'),{sessionId:'session-b',revision:0,machines:[]})
  const bytes=JSON.stringify(tracker.snapshot('session-a'))
  for(const secret of ['sensitive-image','https:','ibk_','file-secret','base64','content'])assert.equal(bytes.includes(secret),false)
  const detached=tracker.snapshot('session-a');detached.machines[0].machineId='m_tampered'
  assert.equal(first(tracker).machineId,id)
})

test('list/account/help-shaped operations do not create a global or session desktop entry',()=>{
  const tracker=new ActivityTracker()
  for(const action of ['machines.list','files.list','account.me','account.usage','templates.list','snapshots.list','snapshots.get','snapshots.delete','operations.get']){
    assert.equal(tracker.begin('session-a',request(action)),undefined)
  }
  assert.deepEqual(tracker.snapshot('session-a').machines,[])
  assert.equal(tracker.begin(undefined,request('desktop.click')),undefined)
  assert.equal(tracker.begin('session-a',request('desktop.click','friendly-alias')),undefined)
})

test('a cloud desktop stays busy between mouse calls during its actual agent turn and idles only after the turn ends',()=>{
  const tracker=new ActivityTracker()
  tracker.beginTurn('session-a')
  const click=tracker.begin('session-a',request('desktop.click'))
  assert.equal(first(tracker).pendingJobs,1)
  tracker.finish(click,job('desktop.click',{ok:true}))
  assert.equal(first(tracker).pendingJobs,0)
  assert.equal(first(tracker).phase,'busy')
  const type=tracker.begin('session-a',request('desktop.type'))
  tracker.finish(type,job('desktop.type',{ok:true}))
  assert.equal(first(tracker).phase,'busy')
  tracker.setRunning('session-a',false)
  assert.equal(first(tracker).phase,'idle')
  // A later turn does not reopen the prior turn's machine until it is used.
  tracker.beginTurn('session-a')
  assert.equal(first(tracker).phase,'idle')
  const next=tracker.begin('session-a',request('desktop.screenshot','m_second'))
  tracker.finish(next,job('desktop.screenshot',{ok:true},'succeeded','m_second'))
  assert.equal(tracker.snapshot('session-a').machines.find(m=>m.machineId===id).phase,'idle')
  assert.equal(tracker.snapshot('session-a').machines.find(m=>m.machineId==='m_second').phase,'busy')
})

test('overlapping plugin jobs remain busy after agent idle until every accepted job settles',()=>{
  const tracker=new ActivityTracker()
  const a=tracker.begin('session-a',request('commands.run'),true)
  const b=tracker.begin('session-a',request('files.read'),true)
  assert.equal(first(tracker).pendingJobs,2)
  tracker.setRunning('session-a',false)
  tracker.finish(a,job('commands.run',{stdout:'secret'}))
  assert.equal(first(tracker).phase,'busy')
  assert.equal(first(tracker).pendingJobs,1)
  tracker.finish(b,job('files.read',{content:'secret'}))
  assert.equal(first(tracker).phase,'idle')
  tracker.finish(b,job('files.read',{content:'secret'}))
  assert.equal(first(tracker).pendingJobs,0)
})

test('creation attaches its asynchronously discovered machine ID and safe name to the originating session',()=>{
  const tracker=new ActivityTracker()
  const token=tracker.begin('session-a',{action:'machines.create',input:{name:'new-cloud',secret:'never-retain'}},true)
  assert.ok(token)
  assert.deepEqual(tracker.snapshot('session-a').machines,[])
  tracker.finish(token,job('machines.create',{operation:{id:'op_create',machineId:'m_created',state:'succeeded'},machine:{id:'m_created',name:'new-cloud',state:'running',key:'ibk_secret',files:{secret:'x'}}},'succeeded',undefined))
  assert.equal(first(tracker).machineId,'m_created')
  assert.equal(first(tracker).name,'new-cloud')
  assert.equal(first(tracker).phase,'busy')
  tracker.setRunning('session-a',false)
  assert.equal(first(tracker).phase,'idle')
  assert.deepEqual(tracker.snapshot('session-b').machines,[])
})

test('background VM programs are separate from tool/turn busy and are cleared only after observed exit or machine stop',()=>{
  const tracker=new ActivityTracker()
  const run=tracker.begin('session-a',request('commands.run',id,{background:true,cmd:'sensitive'}))
  tracker.finish(run,job('commands.run',{jobId:'remote-job-1',status:'running',pid:123}))
  assert.equal(first(tracker).phase,'idle')
  assert.equal(first(tracker).backgroundRunning,true)
  const kill=tracker.begin('session-a',request('jobs.kill',id,{jobId:'remote-job-1'}))
  tracker.finish(kill,job('jobs.kill',{jobId:'remote-job-1',killed:true,status:'running'}))
  assert.equal(first(tracker).backgroundRunning,true,'SIGTERM acceptance is not observed process exit')
  const poll=tracker.begin('session-a',request('jobs.get',id,{jobId:'remote-job-1'}))
  tracker.finish(poll,job('jobs.get',{jobId:'remote-job-1',status:'exited',exitCode:143}))
  assert.equal(first(tracker).backgroundRunning,false)
  const again=tracker.begin('session-a',request('commands.run',id,{background:true}))
  tracker.finish(again,job('commands.run',{jobId:'remote-job-2',status:'running'}))
  tracker.observe(request('machines.stop'),job('machines.stop',{operation:{state:'succeeded'}}))
  assert.equal(first(tracker).phase,'inactive')
  assert.equal(first(tracker).machineState,'stopped')
  assert.equal(first(tracker).backgroundRunning,false)
})

test('panel state observations update only machines already used by a session, and stopping wins over an ongoing turn',()=>{
  const tracker=new ActivityTracker()
  const token=tracker.begin('session-a',request('desktop.screenshot'),true)
  tracker.finish(token,job('desktop.screenshot',{ok:true}))
  tracker.observe(request('machines.list',undefined),job('machines.list',{machines:[{id,name:'chosen-vm',state:'stopped',url:'https://private'},{id:'m_foreign',name:'foreign',state:'running'}]}))
  assert.equal(first(tracker).phase,'inactive')
  assert.equal(first(tracker).name,'chosen-vm')
  assert.equal(tracker.snapshot('session-a').machines.length,1)
  assert.deepEqual(tracker.snapshot('session-b').machines,[])
  tracker.observe(request('machines.get'),job('machines.get',{id,name:'chosen-vm',state:'running'}))
  assert.equal(first(tracker).phase,'busy')
  tracker.observe(request('machines.delete'),job('machines.delete',{operation:{state:'succeeded'}}))
  assert.equal(first(tracker).phase,'inactive')
  assert.equal(first(tracker).machineState,'deleted')
})

test('recent-machine/session bounds retain the newest session metadata and never fall back to another session',()=>{
  let now=0
  const tracker=new ActivityTracker(()=>++now,2,1)
  for(const machine of ['m_first','m_second','m_third']){
    const token=tracker.begin('session-a',request('desktop.status',machine))
    tracker.finish(token,job('desktop.status',{ok:true},'succeeded',machine))
  }
  assert.deepEqual(tracker.snapshot('session-a').machines.map(m=>m.machineId),['m_third','m_second'])
  const other=tracker.begin('session-b',request('desktop.status','m_other'))
  tracker.finish(other,job('desktop.status',{ok:true},'succeeded','m_other'))
  assert.deepEqual(tracker.snapshot('session-a').machines,[])
  assert.equal(first(tracker,'session-b').machineId,'m_other')
  tracker.dispose()
  assert.deepEqual(tracker.snapshot('session-b').machines,[])
})

test('real Host associates a pending runtime job with its original session even after a different conversation is polled',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'instabox-activity-'))
  const ctx=new Context()
  const store=new ConfigStore(join(directory,'settings.json'));await store.load()
  let complete,started
  const began=new Promise(resolve=>{started=resolve})
  const service=new InstaboxService(ctx,store,{apiFactory:async()=>({execute:async request=>{
    if(request.action==='commands.run'){started();return new Promise(resolve=>{complete=resolve})}
    return {operation:{state:'succeeded'}}
  }})})
  t.after(async()=>{await ctx.fiber.dispose();await rm(directory,{recursive:true,force:true})})
  // Skip only the convenience wait. The real runtime still owns submission,
  // queueing, completion and cancellation exactly as in production.
  const submit=service.runtime.submit.bind(service.runtime)
  service.runtime.submit=(request,actor,signal)=>submit(request,actor,signal,0)
  const pending=await service.executeAgent(request('commands.run'),signal(),'session-a',true)
  await began
  ctx.emit('session/event',{id:'session-a'},{type:'turn/end'})
  assert.equal((await service.getActivity({sessionId:'session-a'},signal())).machines[0].phase,'busy')
  assert.deepEqual((await service.getActivity({sessionId:'session-b'},signal())).machines,[])
  complete({stdout:'do-not-project',stderr:'',exitCode:0})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(service.runtime.getJob(pending.jobId).status,'succeeded')
  const done=await service.getActivity({sessionId:'session-a'},signal())
  assert.equal(done.machines[0].phase,'idle')
  assert.equal(done.machines[0].pendingJobs,0)
  assert.equal(JSON.stringify(done).includes('do-not-project'),false)
  const stopped=await service.execute(request('machines.stop'),signal())
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(service.runtime.getJob(stopped.jobId).status,'succeeded')
  assert.equal((await service.getActivity({sessionId:'session-a'},signal())).machines[0].phase,'inactive')
})

test('model tools derive session identity from exec.agent, not arguments or a global current session',async t=>{
  const ctx=new Context(),definitions=new Map(),calls=[]
  ctx.provide('tools',{register:definition=>definitions.set(definition.name,definition)})
  registerTools(ctx,{current:()=>defaultConfig(),executeAgent:async(...args)=>{calls.push(args);return job('desktop.click',{ok:true})}})
  t.after(()=>ctx.fiber.dispose())
  const tool=definitions.get('instabox')
  await tool.execute(request('desktop.click',id,{x:1,y:2}),{signal:signal(),agent:{session:{id:'session-a'},status:'running'}})
  await tool.execute(request('desktop.click',id,{x:1,y:2}),{signal:signal(),agent:{session:{id:'session-b'},status:'idle'}})
  assert.equal(calls[0][2],'session-a');assert.equal(calls[0][3],true)
  assert.equal(calls[1][2],'session-b');assert.equal(calls[1][3],false)
})

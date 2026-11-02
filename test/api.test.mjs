import test from 'node:test'
import assert from 'node:assert/strict'
import { InstaboxApi } from '../lib/api.js'

const machineId='m_testmachine'
const machine={id:machineId,name:'test',state:'running',desiredState:'running',spec:{vcpus:4,memMiB:8192,persistentDiskGiB:20},
  template:{id:'agent-browser',version:'test',digest:'sha256:test'},runtime:{ready:true},revision:1,operationId:null,
  createdAt:'2026-11-02T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z'}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})
function fixture(respond) {
  const requests=[]
  const api=new InstaboxApi({apiKey:'ibk_fake_test_key',requestTimeoutMs:5000,fetch:async(input,init={})=>{
    const url=new URL(input instanceof Request ? input.url : String(input))
    const request={url,method:init.method??'GET',headers:new Headers(init.headers),body:typeof init.body==='string' ? JSON.parse(init.body) : init.body,signal:init.signal}
    requests.push(request)
    return respond(request,requests)
  }})
  return {api,requests}
}
test('create uses idempotency and isolation, then waits until the operation truly succeeds',async()=>{
  const {api,requests}=fixture(r=>{
    if(r.url.pathname==='/v1/machines')return json({id:'op_test',machineId,type:'create',state:'queued'})
    if(r.url.pathname==='/v1/operations/op_test')return json({id:'op_test',machineId,type:'create',state:'succeeded'})
    return json(machine)
  })
  const result=await api.execute({action:'machines.create',input:{name:'dev',templateId:'agent-browser@2026-11-02.1'}})
  assert.equal(result.operation.state,'succeeded')
  assert.equal(result.machine.id,machineId)
  assert.equal(requests.length,3)
  assert.equal(requests[1].url.searchParams.get('wait'),'25s')
  assert.equal(requests[0].url.origin,'https://api.instabox.sh')
  assert.equal(requests[0].url.pathname,'/v1/machines')
  assert.ok(requests[0].headers.get('Idempotency-Key'))
  assert.deepEqual(requests[0].body,{name:'dev',templateId:'agent-browser@2026-11-02.1',vault:false,secrets:[],envSecrets:[]})
  assert.equal(requests[0].headers.get('X-API-Key'),'ibk_fake_test_key')
})
test('invalid action fields, machine aliases, conflicting create sources and incomplete sizes never mutate',async()=>{
  const {api,requests}=fixture(()=>{throw Error('unexpected fetch')})
  for(const request of [
    {action:'machines.create',input:{template:'agent-browser'}},
    {action:'machines.create',input:{templateId:'agent-browser',snapshotId:'sn_demo'}},
    {action:'machines.create',input:{vcpus:4}},
    {action:'desktop.click',machineId,input:{x:-1,y:5}},
    {action:'machines.get',machineId:'name-alias'},
    {action:'commands.run',machineId,input:{cmd:'é'.repeat(40000)}},
  ])await assert.rejects(api.execute(request),e=>e.code==='invalid_input')
  assert.equal(requests.length,0)
})
test('foreground commands are never replayed and preserve nonzero exit results',async()=>{
  const {api,requests}=fixture(()=>json({stdout:'',stderr:'compile failed',exitCode:2,timedOut:false,truncated:false}))
  const result=await api.execute({action:'commands.run',machineId,input:{cmd:'npm test',cwd:'/data/home/app',envs:{NODE_ENV:'test'},timeoutSeconds:120}})
  assert.equal(result.exitCode,2)
  assert.equal(requests.length,1)
  assert.equal(requests[0].headers.has('Idempotency-Key'),false)
  assert.equal(requests[0].body.timeoutSeconds,120)
  assert.deepEqual(requests[0].body.envs,{NODE_ENV:'test'})
})
test('network failure and 503 on commands do not trigger implicit retries',async()=>{
  for(const failure of [()=>{throw Error('network error')},()=>json({error:{code:'host_unavailable',message:'offline',retryable:true}},503)]){
    const {api,requests}=fixture(failure)
    await assert.rejects(api.execute({action:'commands.run',machineId,input:{cmd:'charge-once'}}))
    assert.equal(requests.length,1)
  }
})
test('SDK desktop text input passes unicode and shell metacharacters on stdin without waking machine',async()=>{
  const typed="你好 '$HOME'; $(touch bad)\nline"
  const {api,requests}=fixture(r=>r.url.pathname.endsWith('/exec')
    ? json({stdout:'',stderr:'',exitCode:0,timedOut:false,truncated:false}) : json({...machine,state:'suspended'}))
  const result=await api.execute({action:'desktop.type',machineId,input:{text:typed,delayMs:0}})
  assert.deepEqual(result,{ok:true})
  assert.equal(requests[0].method,'GET')
  assert.equal(requests.some(r=>/\/(resume|wake|start)$/.test(r.url.pathname)),false)
  const command=requests.find(r=>r.url.pathname.endsWith('/exec'))
  assert.equal(command.body.stdin,typed)
  assert.match(command.body.cmd,/type --delay 0 --file -/)
  assert.equal(command.body.cmd.includes(typed),false)
})
test('desktop status/takeover/handback send official actions and viewer defaults to read only',async()=>{
  const {api,requests}=fixture(r=>json(r.url.pathname.endsWith('/stream')?{url:'https://api.instabox.sh/desktop/x?token=fake',expiresAt:'2026-11-02T01:00:00Z'}:{controller:'human',yours:true}))
  for(const action of ['desktop.status','desktop.takeover','desktop.handback'])await api.execute({action,machineId})
  await api.execute({action:'desktop.view',machineId})
  assert.deepEqual(requests.map(r=>r.body),[{action:'status'},{action:'takeover'},{action:'handback'},{viewOnly:true,ttlSeconds:600}])
})
test('workspace key desktop viewer rejection explains personal-key requirement and hides keys',async()=>{
  const {api}=fixture(()=>json({error:{code:'permission_denied',message:'denied ibk_fake_test_key'}},403))
  await assert.rejects(api.execute({action:'desktop.view',machineId}),e=>{
    assert.equal(e.code,'permission_denied')
    assert.match(e.message,/个人 API Key/)
    assert.equal(e.message.includes('ibk_fake_test_key'),false)
    return true
  })
})
test('file reads preserve binary bytes and reject invalid UTF-8 rather than corrupting data',async()=>{
  const bytes=Uint8Array.from([0,255,254,10,65])
  const {api}=fixture(r=>r.url.pathname.endsWith('/files/content')?new Response(bytes,{headers:{'Content-Length':String(bytes.length)}}):json(machine))
  const result=await api.execute({action:'files.read',machineId,input:{path:'/data/home/file.bin',format:'base64'}})
  assert.deepEqual(result,{path:'/data/home/file.bin',format:'base64',content:Buffer.from(bytes).toString('base64')})
  await assert.rejects(api.execute({action:'files.read',machineId,input:{path:'/data/home/file.bin'}}),e=>e.code==='not_utf8')
})
test('oversized file declarations and invalid base64 reject unbounded reads and writes',async()=>{
  const {api,requests}=fixture(r=>r.url.pathname.endsWith('/files/content')?new Response(new Uint8Array(),{headers:{'Content-Length':String(11*1024*1024)}}):json(machine))
  await assert.rejects(api.execute({action:'files.read',machineId,input:{path:'/data/home/large'}}),e=>e.code==='file_too_large')
  const before=requests.length
  await assert.rejects(api.execute({action:'files.write',machineId,input:{path:'/data/home/x',format:'base64',content:'not base64!'}}),e=>e.code==='invalid_input')
  assert.equal(requests.length,before)
})
test('delete confirmations and normalized root protection run before destructive commands',async()=>{
  const {api,requests}=fixture(()=>json(machine))
  await assert.rejects(api.execute({action:'machines.delete',machineId,input:{confirm:'wrong'}}),e=>e.code==='confirmation_required')
  await assert.rejects(api.execute({action:'snapshots.delete',input:{snapshotId:'sn_test',confirm:'sn_wrong'}}),e=>e.code==='confirmation_required')
  await assert.rejects(api.execute({action:'files.remove',machineId,input:{path:'/data/home/x',confirm:'/data/home/y'}}),e=>e.code==='confirmation_required')
  await assert.rejects(api.execute({action:'files.remove',machineId,input:{path:'/data/home/../home/',confirm:'/data/home/../home/'}}),e=>e.code==='invalid_input')
  assert.equal(requests.some(r=>r.method==='DELETE'||r.url.pathname.endsWith('/exec')),false)
})
test('private port is the default and explicit public access remains supported',async()=>{
  const {api,requests}=fixture(()=>json({url:'https://3000-box.instabox.tech'}))
  await api.execute({action:'ports.publish',machineId,input:{port:3000}})
  await api.execute({action:'ports.publish',machineId,input:{port:3000,access:'public'}})
  assert.equal(requests[0].body.access,'private')
  assert.equal(requests[1].body.access,'public')
  await assert.rejects(api.execute({action:'ports.publish',machineId,input:{port:5901}}),e=>e.code==='invalid_input')
})
test('job polling reads persistent SDK job records without Host memory state',async()=>{
  const {api,requests}=fixture(()=>json({stdout:JSON.stringify({jobId:'abc123',status:'exited',exitCode:0,stdout:'done'}),stderr:'',exitCode:0}))
  assert.equal((await api.execute({action:'jobs.get',machineId,input:{jobId:'abc123',tail:100}})).stdout,'done')
  assert.match(requests[0].body.cmd,/\.instabox/)
  assert.match(requests[0].body.cmd,/killpg/)
  assert.equal(requests[0].body.noHistory,true)
  await assert.rejects(api.execute({action:'jobs.get',machineId,input:{jobId:'../../secrets'}}),e=>e.code==='invalid_input')
})
test('aborted requests never start and active REST requests receive cancellation',async()=>{
  const aborted=new AbortController();aborted.abort(new Error('cancelled'))
  const {api,requests}=fixture(()=>json({}))
  await assert.rejects(api.execute({action:'account.me'},aborted.signal),/cancelled/)
  assert.equal(requests.length,0)
  const controller=new AbortController()
  const pending=new InstaboxApi({apiKey:'ibk_test',requestTimeoutMs:5000,fetch:(_input,init)=>new Promise((_resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})
  })}).execute({action:'account.me'},controller.signal)
  controller.abort(new Error('active cancelled'))
  await assert.rejects(pending,/active cancelled/)
})
test('screenshot returns PNG dimensions alongside original bytes',async()=>{
  const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(1280,16);png.writeUInt32BE(800,20)
  const {api}=fixture(r=>{
    if(r.url.pathname.endsWith('/exec'))return json({stdout:'',stderr:'',exitCode:0,timedOut:false,truncated:false})
    if(r.url.pathname.endsWith('/files/content'))return new Response(png,{headers:{'Content-Length':String(png.length)}})
    return json(machine)
  })
  const result=await api.execute({action:'desktop.screenshot',machineId})
  assert.equal(result.width,1280);assert.equal(result.height,800)
  assert.equal(result.mimeType,'image/png')
  assert.deepEqual(Buffer.from(result.base64,'base64'),png)
})

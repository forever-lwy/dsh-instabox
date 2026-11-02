import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react'
import type {Action} from '../shared.js'
import {pretty} from './face.js'
import {array,bytes,changedSpec,duration,emptyDraft,finite,gibibytes,GiB,machineData,machineSpec,mebibytes,number,percentage,record,specDraft,stateLabel,timestamp,usd,type Data,type SpecDraft,type SpecKey} from './resources-data.js'

export type ResourceRun = (action:Action,input?:Record<string,unknown>,machineId?:string,quiet?:boolean)=>Promise<any>
type Key = 'machine'|'account'|'quota'|'metrics'|'disk'|'usage'|'templates'|'logs'
type Entry = {value?:unknown;loading:boolean;error?:string}
type Entries = Record<Key,Entry>
const actions:Record<Key,Action>={machine:'machines.get',account:'account.me',quota:'account.usage',metrics:'metrics.get',disk:'machines.disk',usage:'usage.get',templates:'templates.list',logs:'machines.logs'}
const machineKeys=new Set<Key>(['machine','metrics','disk','usage','logs'])
const emptyEntries=():Entries=>Object.fromEntries(Object.keys(actions).map(key=>[key,{loading:false}])) as Entries
const title:Record<Key,string>={machine:'当前机器',account:'账户与可用规格',quota:'账户配额与账单',metrics:'CPU 与内存',disk:'磁盘空间',usage:'本机累计用量',templates:'可用模板',logs:'机器日志与操作'}

function Rows({items}:{items:[string,ReactNode][]}){
  return <dl className="dsi-resource-rows">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value ?? '未提供'}</dd></div>)}</dl>
}
function Stat({label,value,hint}:{label:string;value:ReactNode;hint?:string}){
  return <div className="dsi-resource-stat"><span>{label}</span><strong>{value}</strong>{hint&&<small>{hint}</small>}</div>
}
function Meter({label,used,total,unit='',format=number}:{label:string;used:unknown;total:unknown;unit?:string;format?:(value:unknown)=>string}){
  const maximum=finite(total),current=finite(used),ratio=percentage(current,maximum)
  return <div className="dsi-resource-meter"><div><span>{label}</span><span>{current===undefined?'未提供':format(current)}{maximum===undefined?' / 上限未提供':maximum<0?' / 不限':` / ${format(maximum)}`}{unit?` ${unit}`:''}</span></div>
    {ratio!==undefined&&<progress aria-label={label} value={ratio} max={100}/>}</div>
}
function Raw({value}:{value:unknown}){return value===undefined?null:<details className="dsi-resource-raw"><summary>查看原始响应</summary><pre>{pretty(value)}</pre></details>}
function Card({name,entry,retry,children,disabled=false}:{name:Key;entry:Entry;retry:()=>void;children:ReactNode;disabled?:boolean}){
  return <section className="dsi-card dsi-resource-card" data-resource={name} aria-busy={entry.loading}>
    <div className="dsi-resource-heading"><h3>{title[name]}</h3><button type="button" disabled={entry.loading||disabled} onClick={retry}>刷新</button></div>
    {entry.loading&&entry.value===undefined&&<p className="dsi-muted" role="status">读取中…</p>}
    {entry.error&&<p className="dsi-error" role="alert">{entry.error}</p>}
    {children}<Raw value={entry.value}/>
  </section>
}

/** API reads are independent: a missing metrics scope does not hide the disk,
 * quota, or the editable specification. Generation guards discard late reads
 * and saves from the machine the user has already left. */
export function Resources({run,machineId,onUpdated}:{run:ResourceRun;machineId:string;onUpdated:()=>Promise<void>}){
  const [entries,setEntries]=useState<Entries>(emptyEntries),[entriesMachine,setEntriesMachine]=useState(machineId),[epoch,setEpoch]=useState(0)
  const [original,setOriginal]=useState<SpecDraft>(emptyDraft),[draft,setDraft]=useState<SpecDraft>(emptyDraft),[specMachine,setSpecMachine]=useState(machineId)
  const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[message,setMessage]=useState('')
  const generation=useRef(0),mounted=useRef(false),current=useRef(machineId),latest=useRef({run,onUpdated}),saveInFlight=useRef(false)
  latest.current={run,onUpdated};current.current=machineId
  const read=useCallback(async(key:Key,target:string,version:number)=>{
    if(machineKeys.has(key)&&!target)return false
    const valid=()=>mounted.current&&generation.current===version&&current.current===target
    if(valid())setEntries(previous=>({...previous,[key]:{...previous[key],loading:true,error:undefined}}))
    try{
      const value=await latest.current.run(actions[key],key==='logs'?{tail:200}:{},machineKeys.has(key)?target:'',true)
      if(!valid())return false
      setEntries(previous=>({...previous,[key]:{value,loading:false}}))
      if(key==='machine'){
        const values=specDraft(value)
        setOriginal(values);setDraft(values);setSpecMachine(target)
      }
      return true
    }catch(error){if(valid())setEntries(previous=>({...previous,[key]:{...previous[key],loading:false,error:error instanceof Error?error.message:'读取失败，请重试。'}}));return false}
  },[])
  useEffect(()=>{
    mounted.current=true;const version=++generation.current
    setEntries(emptyEntries());setEntriesMachine(machineId);setOriginal(emptyDraft());setDraft(emptyDraft());setSpecMachine(machineId);setSaving(false);saveInFlight.current=false;setSaveError('');setMessage('')
    for(const key of Object.keys(actions) as Key[])void read(key,machineId,version)
    return()=>{mounted.current=false;generation.current++}
  },[machineId,epoch,read])
  const data=entriesMachine===machineId?entries:emptyEntries()
  const machine=machineData(data.machine.value),spec=machineSpec(data.machine.value),account=record(data.account.value),quota=record(data.quota.value),limits=record(quota.limits),cost=record(quota.cost)
  const samples=array(data.metrics.value,'metrics'),latestSample=record(samples.at(-1)),disk=record(data.disk.value??record(data.metrics.value).disk),filesystems=array(disk,'filesystems'),usage=record(data.usage.value)
  const templates=array(data.templates.value,'templates'),logs=record(data.logs.value),operations=array(logs,'operations'),allowed=array(account,'allowedSpecs')
  const draftValues=specMachine===machineId?draft:emptyDraft(),originalValues=specMachine===machineId?original:emptyDraft()
  const dirty=Object.keys(draftValues).some(key=>draftValues[key as SpecKey]!==originalValues[key as SpecKey])
  const refresh=(key:Key)=>void read(key,machineId,generation.current)
  const save=async()=>{
    if(saveInFlight.current||!machineId||!data.machine.value)return
    let input:Record<string,unknown>
    try{input=changedSpec(draftValues,originalValues)}catch(error){setSaveError(error instanceof Error?error.message:'规格输入无效。');return}
    if(!Object.keys(input).length){setMessage('当前没有需要保存的修改。');return}
    const version=generation.current,target=machineId
    const valid=()=>mounted.current&&generation.current===version&&current.current===target
    saveInFlight.current=true;setSaving(true);setSaveError('');setMessage('')
    try{
      await latest.current.run('machines.update',input,target)
      if(!valid())return
      const refreshed=await read('machine',target,version)
      if(!valid())return
      setMessage(refreshed?'修改已提交，已重新读取服务器当前规格。':'修改已提交，但读取最新规格失败，请刷新“当前机器”卡片核对。')
      try{await latest.current.onUpdated()}catch{if(valid())setMessage('修改已提交；刷新未完成，请手动刷新机器列表和当前规格。')}
    }catch(error){if(valid())setSaveError(error instanceof Error?error.message:'保存失败。')}
    finally{if(valid()){saveInFlight.current=false;setSaving(false)}}
  }
  const specField=(key:SpecKey,label:string,min:number,max:number,hint?:string)=><label className="dsi-field" key={key}><span>{label}</span>
    <input data-spec={key} type="number" min={min} max={max} step={1} value={draftValues[key]} placeholder="服务未提供当前值" onChange={event=>{setDraft(previous=>({...previous,[key]:event.target.value}));setMessage('');setSaveError('')}}/>
    {hint&&<small>{hint}</small>}</label>
  return <div className="dsi-stack dsi-resources">
    <div className="dsi-resource-heading"><div><h2>资源与用量</h2><p className="dsi-muted">自动读取当前机器和账户数据；金额仅展示平台已返回的计量结果。</p></div><button type="button" disabled={saving} onClick={()=>setEpoch(value=>value+1)}>刷新全部</button></div>
    <div className="dsi-grid">
      <Card name="machine" entry={data.machine} disabled={!machineId||saving} retry={()=>refresh('machine')}>
        {!machineId?<p className="dsi-muted">先选择一台机器查看详情。</p>:data.machine.value!==undefined&&<>
          <div className="dsi-resource-stats"><Stat label="vCPU" value={spec.vcpus===undefined?'未提供':`${number(spec.vcpus,0)} 核`}/><Stat label="内存" value={mebibytes(spec.memMiB)}/><Stat label="持久盘 /data" value={gibibytes(spec.persistentDiskGiB)}/></div>
          <Rows items={[["机器名称",machine.name],["机器 ID",machine.id??machineId],["状态",stateLabel(machine.state)],["模板",record(machine.template).id??machine.templateId],["空闲暂停",spec.autoSuspendAfterSeconds===undefined?'未提供':spec.autoSuspendAfterSeconds===0?'关闭（保持运行）':duration(spec.autoSuspendAfterSeconds)],["创建时间",timestamp(machine.createdAt)]]}/>
          {machine.metadata&&Object.keys(record(machine.metadata)).length>0&&<p className="dsi-muted">标签：{Object.entries(record(machine.metadata)).map(([key,value])=>`${key}: ${String(value)}`).join(' · ')}</p>}
          {record(machine.lastError).message&&<p className="dsi-error">{String(record(machine.lastError).message)}</p>}
        </>}
      </Card>
      <Card name="metrics" entry={data.metrics} disabled={!machineId} retry={()=>refresh('metrics')}>
        {!machineId?<p className="dsi-muted">选择机器后查看实时指标。</p>:data.metrics.value!==undefined&&(samples.length===0?<p className="dsi-muted">平台尚未返回采样。新机器通常约 30 秒后有首个样本；暂停的机器可能没有近期数据。</p>:<>
          <div className="dsi-resource-stats"><Stat label="CPU 使用率" value={finite(latestSample.cpuUsedPct)===undefined?'未提供':`${number(latestSample.cpuUsedPct)}%`} hint={finite(latestSample.cpuCount)===undefined?undefined:`${number(latestSample.cpuCount,0)} vCPU`}/><Stat label="内存占用" value={bytes(latestSample.memUsed)} hint={`总量 ${bytes(latestSample.memTotal)}`}/></div>
          <Meter label="CPU" used={latestSample.cpuUsedPct} total={100} unit="%"/>
          <Meter label="内存" used={latestSample.memUsed} total={latestSample.memTotal} format={bytes}/>
          {['netInBytesPerSec','netOutBytesPerSec','diskReadBytesPerSec','diskWriteBytesPerSec'].some(key=>finite(latestSample[key])!==undefined)&&<Rows items={[["网络接收",finite(latestSample.netInBytesPerSec)===undefined?'未提供':`${bytes(latestSample.netInBytesPerSec)}/秒`],["网络发送",finite(latestSample.netOutBytesPerSec)===undefined?'未提供':`${bytes(latestSample.netOutBytesPerSec)}/秒`],["磁盘读取",finite(latestSample.diskReadBytesPerSec)===undefined?'未提供':`${bytes(latestSample.diskReadBytesPerSec)}/秒`],["磁盘写入",finite(latestSample.diskWriteBytesPerSec)===undefined?'未提供':`${bytes(latestSample.diskWriteBytesPerSec)}/秒`]]}/>}<p className="dsi-muted">采样时间：{timestamp(latestSample.timestamp)} · 共 {samples.length} 个样本</p>
        </>)}
      </Card>
      <Card name="disk" entry={data.disk} disabled={!machineId} retry={()=>refresh('disk')}>
        {!machineId?<p className="dsi-muted">选择机器后查看磁盘空间。</p>:filesystems.length>0?<>
          {filesystems.map((filesystem,index)=><div className="dsi-resource-filesystem" key={filesystem.mount??index}>
            <div className="dsi-resource-heading"><strong>{filesystem.mount??'磁盘'}</strong><span className={`dsi-pill ${['high','critical','full'].includes(filesystem.level)?'human':''}`}>{({ok:'空间正常',high:'空间偏高',critical:'空间紧张',full:'已满'} as Record<string,string>)[filesystem.level]??'已测量'}</span></div>
            <Meter label={`${filesystem.mount??'磁盘'} 已用`} used={filesystem.usedBytes} total={filesystem.sizeBytes} format={bytes}/>
            <Rows items={[["可用空间",bytes(filesystem.availableBytes)],["空间占用",finite(filesystem.usedPct)===undefined?'未提供':`${number(filesystem.usedPct)}%`],["inode 使用率",finite(filesystem.inodesUsedPct)===undefined?'未提供':`${number(filesystem.inodesUsedPct)}%`]]}/>
          </div>)}
          <p className="dsi-muted">测量时间：{timestamp(disk.measuredAt)}</p>
          {disk.warning&&<p className="dsi-note">{typeof disk.warning==='string'?disk.warning:String(record(disk.warning).message??'请检查磁盘空间。')}</p>}
        </>:data.disk.value!==undefined&&<p className="dsi-muted">平台尚未返回文件系统容量；可稍后刷新。</p>}
      </Card>
      <Card name="usage" entry={data.usage} disabled={!machineId} retry={()=>refresh('usage')}>
        {!machineId?<p className="dsi-muted">选择机器后查看累计用量。</p>:data.usage.value!==undefined&&<>
          <div className="dsi-resource-stats"><Stat label="累计运行" value={duration(usage.runningSeconds)}/><Stat label="CPU 用量" value={finite(usage.vcpuSeconds)===undefined?'未提供':`${number(usage.vcpuSeconds/3600,2)} vCPU·小时`}/></div>
          <Rows items={[["内存用量",finite(usage.memGiBSeconds)===undefined?'未提供':`${number(usage.memGiBSeconds/3600,2)} GiB·小时`],["磁盘用量",finite(usage.diskGiBSeconds)===undefined?'未提供':`${number(usage.diskGiBSeconds/3600,2)} GiB·小时`],["开始时间",timestamp(usage.from)],["截至时间",timestamp(usage.to)]]}/>
          <p className="dsi-muted">默认统计本月（UTC）至今。资源用量不是账单金额。</p>
        </>}
      </Card>
    </div>
    <section className="dsi-card" data-resource="specification"><h3>调整机器规格与磁盘</h3><p className="dsi-muted">下方是服务器返回的当前值。仅提交实际修改的字段；修改 CPU 或内存通常需要先关机，套餐限制以平台反馈为准。</p>
      {!machineId&&<p className="dsi-note">先选择一台机器。</p>}{data.machine.error&&<p className="dsi-error">当前规格读取失败，请先刷新“当前机器”卡片。</p>}
      <form onSubmit={event=>{event.preventDefault();void save()}}><fieldset disabled={!machineId||!data.machine.value||data.machine.loading||saving} style={{border:0,padding:0,margin:0}}>
        <div className="dsi-fields">{specField('vcpus','vCPU（核）',1,32)}{specField('memMiB','内存（MiB）',1024,65536,spec.memMiB===undefined?undefined:`当前 ${mebibytes(spec.memMiB)}`)}{specField('persistentDiskGiB','持久盘 /data（GiB）',1,1024)}{specField('autoSuspendAfterSeconds','空闲暂停（秒）',0,1800,'0 为关闭；免费套餐通常固定 1800 秒。')}</div>
        {allowed.length>0&&<p className="dsi-muted" style={{marginTop:10}}>账户可选规格：{allowed.map(item=>`${number(item.vcpus,0)} 核 / ${mebibytes(item.memMiB)}`).join('；')}</p>}
        <div className="dsi-actions" style={{marginTop:14}}><button type="submit" data-action="save-specification" className="dsi-primary" disabled={!dirty||saving}>{saving?'保存中…':'保存修改'}</button><button type="button" disabled={!dirty||saving} onClick={()=>{setDraft({...originalValues});setSaveError('');setMessage('')}}>还原当前值</button></div>
      </fieldset></form>{saveError&&<p className="dsi-error" role="alert">{saveError}</p>}{message&&<p className={data.machine.error?'dsi-note':'dsi-good'} role="status">{message}</p>}
    </section>
    <div className="dsi-grid">
      <Card name="quota" entry={data.quota} retry={()=>refresh('quota')}>
        {data.quota.value!==undefined&&<>
          <Meter label="机器配额" used={quota.machines} total={limits.maxMachines} unit="台"/><Meter label="快照配额" used={quota.snapshots??quota.images} total={limits.maxSnapshots??limits.maxImages} unit="个"/>
          {quota.computedAt===null?<p className="dsi-muted">存储占用等待平台首次统计。</p>:<Meter label="存储占用" used={quota.storedBytes} total={finite(limits.maxStoredGiB)===undefined?undefined:limits.maxStoredGiB<0?-1:limits.maxStoredGiB*GiB} format={bytes}/>}<p className="dsi-muted">存储统计时间：{timestamp(quota.computedAt)}</p>
          {finite(cost.costUSD)===undefined?<p className="dsi-muted">服务尚未返回账单金额。账单以 Instabox 控制台为准。</p>:<>
            <div className="dsi-resource-stats"><Stat label="本月已计量费用" value={usd(cost.costUSD)}/><Stat label="包含额度剩余" value={usd(cost.creditRemainingUSD)}/></div>
            <Rows items={[["计算费用",usd(cost.runtimeUSD)],["存储费用",usd(cost.storageUSD)],["出站流量费用",usd(cost.egressUSD)],["本月包含额度",usd(cost.allowanceUSD)],["超出包含额度",usd(cost.overageUSD)],["额外点数余额",usd(cost.creditsUSD)],["计量截至",timestamp(cost.ratedUntil)]]}/>
            <p className="dsi-muted">已计量费用按平台账单周期统计，不包含未来预测。停机支出限额余量不作为账户余额展示。</p>
          </>}
        </>}
      </Card>
      <Card name="account" entry={data.account} retry={()=>refresh('account')}>
        {data.account.value!==undefined&&<><Rows items={[["名称",account.name??account.login],["登录名",account.login],["邮箱",account.email],["用户 ID",account.userId],["凭据范围",account.orgId?'组织空间':'个人空间'],["组织",record(account.org).name??account.orgId??'—']]}/>
          {allowed.length>0&&<p className="dsi-muted">可用计算规格：{allowed.map(item=>`${number(item.vcpus,0)} vCPU / ${mebibytes(item.memMiB)}`).join('；')}</p>}
          {finite(account.fixedAutoSuspendSeconds)!==undefined&&<p className="dsi-muted">账户固定空闲暂停：{duration(account.fixedAutoSuspendSeconds)}</p>}
        </>}
      </Card>
    </div>
    <Card name="templates" entry={data.templates} retry={()=>refresh('templates')}>
      {data.templates.value!==undefined&&(templates.length===0?<p className="dsi-muted">平台未返回可用模板。</p>:<div className="dsi-scroll"><table className="dsi-table"><thead><tr><th>模板</th><th>说明</th><th>默认规格</th><th>可创建</th></tr></thead><tbody>{templates.map((template,index)=><tr key={`${template.id}-${template.version??index}`}><td>{template.id}<small style={{display:'block'}}>{template.version??''}{template.default?' · 默认':''}</small></td><td>{template.description??'—'}</td><td>{number(record(template.defaultSpec).vcpus,0)} 核 / {mebibytes(record(template.defaultSpec).memMiB)} / {gibibytes(record(template.defaultSpec).persistentDiskGiB)}</td><td>{template.creatable===false||template.hidden===true?'不可创建':template.creatable===true?'可创建':'以套餐与实际创建结果为准'}</td></tr>)}</tbody></table></div>)}
    </Card>
    <Card name="logs" entry={data.logs} disabled={!machineId} retry={()=>refresh('logs')}>
      {!machineId?<p className="dsi-muted">选择机器后查看控制台日志与操作记录。</p>:data.logs.value!==undefined&&<>
        <div className="dsi-resource-heading"><strong>控制台输出</strong><span className="dsi-pill">{stateLabel(logs.state)}</span></div>
        {logs.consoleUnavailable&&<p className="dsi-note">{typeof logs.consoleUnavailable==='string'?logs.consoleUnavailable:'平台暂时无法提供控制台输出。'}</p>}
        {logs.consoleTruncated&&<p className="dsi-muted">仅显示最近输出，较早内容已截断。</p>}{logs.consoleReset&&<p className="dsi-muted">控制台记录已在机器重启后重置。</p>}
        {typeof logs.console==='string'&&logs.console?<pre aria-label="机器控制台日志">{logs.console}</pre>:<p className="dsi-muted">暂无控制台输出。</p>}
        {operations.length>0&&<div className="dsi-scroll"><table className="dsi-table"><thead><tr><th>操作</th><th>状态</th><th>时间</th><th>说明</th></tr></thead><tbody>{operations.map((operation,index)=><tr key={operation.id??index}><td>{({create:'创建',start:'启动',stop:'关机',suspend:'暂停',resume:'恢复',delete:'删除',fork:'复制'} as Record<string,string>)[operation.type]??operation.type??operation.id}</td><td>{stateLabel(operation.state)}</td><td>{timestamp(operation.createdAt??operation.startedAt)}</td><td>{record(operation.error).message??'—'}</td></tr>)}</tbody></table></div>}
      </>}
    </Card>
  </div>
}

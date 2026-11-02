import { randomUUID } from 'node:crypto'
import type { Action, ActionRequest, ActivityMachine, ActivityView, JobView } from './shared.js'

interface MachineRecord {view: ActivityMachine; pending: Set<string>; background: Set<string>; inactive: boolean}
interface SessionRecord {revision: number; touchedAt: number; running: boolean; turnMachines: Set<string>; machines: Map<string, MachineRecord>}
interface TaskRecord {sessionId: string; action: Action; machineId?: string; background: boolean; remoteJobId?: string}
const machineId = (value: unknown): string | undefined => typeof value === 'string' && /^m_[A-Za-z0-9_-]{1,158}$/.test(value) ? value : undefined
const remoteJobId = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(value) ? value : undefined
const MACHINE_STATES = new Set(['running','starting','stopping','stopped','suspended','paused','deleted','failed','archived','creating','resuming','suspending'])
const INACTIVE_STATES = new Set(['stopped','suspended','paused','deleted','failed','archived'])
const valueObject = (value: unknown): Record<string, any> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined
const safeName = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_. -]{0,159}$/.test(value) ? value : undefined
const hasState = (value: unknown): value is string => typeof value === 'string' && MACHINE_STATES.has(value)

/** Keeps only the machine metadata needed to render a session's cloud-computer
 * entry. Arguments, tool results, URLs, credentials and file bytes never enter
 * a retained record. No unknown session inherits a global "last machine". */
export class ActivityTracker {
  private sessions = new Map<string, SessionRecord>()
  private tasks = new Map<string, TaskRecord>()
  private disposed = false
  constructor(private readonly now = Date.now, private readonly maxMachines = 4, private readonly maxSessions = 128) {}
  begin(sessionId: string | undefined, request: ActionRequest, running?: boolean): string | undefined {
    if (this.disposed || !this.validSession(sessionId) || !this.trackable(request)) return undefined
    const session = this.ensure(sessionId)
    if (running === true) session.running = true
    const token = randomUUID()
    // Global create/operation/snapshot APIs do not address request.machineId;
    // never let an unused optional field invent a desktop association.
    const id = request.action === 'machines.create' ? undefined : machineId(request.machineId)
    const task: TaskRecord = {sessionId, action: request.action, ...(id ? {machineId:id} : {}),
      background: request.action === 'commands.run' && request.input?.background === true,
      ...(remoteJobId(request.input?.jobId) ? {remoteJobId: remoteJobId(request.input?.jobId)} : {})}
    this.tasks.set(token, task)
    if (id) {
      const machine = this.touch(session, id, request.action)
      machine.pending.add(token)
      if (session.running) session.turnMachines.add(id)
      this.refresh(session, machine)
    }
    this.prune()
    return token
  }
  finish(token: string | undefined, job?: JobView): void {
    if (!token || this.disposed) return
    const task = this.tasks.get(token)
    if (!task) return
    this.tasks.delete(token)
    const session = this.sessions.get(task.sessionId)
    if (!session) return
    const original = task.machineId ? session.machines.get(task.machineId) : undefined
    if (original) {
      original.pending.delete(token)
      original.view.lastAction = task.action; original.view.updatedAt = this.now()
      this.refresh(session, original)
    }
    if (!job || job.status !== 'succeeded') { this.trimMachines(session); return }
    const result = valueObject(job.result)
    const candidate = valueObject(result?.machine) ?? (machineId(result?.id) ? result : undefined)
    const target = ['machines.create','machines.fork'].includes(task.action)
      ? machineId(candidate?.id ?? candidate?.sandboxId ?? valueObject(result?.operation)?.machineId) ?? task.machineId : task.machineId
    if (target) {
      const machine = this.touch(session, target, task.action)
      if (session.running) session.turnMachines.add(target)
      this.describe(machine, candidate)
      if (task.action === 'machines.stop') this.setState(machine, 'stopped')
      else if (task.action === 'machines.suspend') this.setState(machine, 'suspended')
      else if (task.action === 'machines.delete') this.setState(machine, 'deleted')
      else if (['machines.start','machines.resume','machines.create','machines.fork'].includes(task.action) && !hasState(candidate?.state)) this.setState(machine, 'running')
      // A detached process continues on the cloud VM after its submitting tool
      // becomes idle. Keep that fact separate from a DSH turn or plugin job.
      if (task.background && remoteJobId(result?.jobId) && result?.status === 'running') machine.background.add(result!.jobId)
      if (task.action === 'jobs.get' && task.remoteJobId && ['exited','lost','failed','cancelled','completed'].includes(String(result?.status))) machine.background.delete(task.remoteJobId)
      if (task.action === 'jobs.kill' && task.remoteJobId && ['exited','lost','failed','cancelled','completed'].includes(String(result?.status))) machine.background.delete(task.remoteJobId)
      this.refresh(session, machine)
    }
    this.trimMachines(session)
  }
  /** Observe state changes made in the dedicated panel without creating an
   * activity entry for sessions that never used the machine. */
  observe(request: ActionRequest, job: JobView): void {
    if (this.disposed || job.status !== 'succeeded') return
    const result = valueObject(job.result)
    if (request.action === 'machines.list') {
      const values = Array.isArray(job.result) ? job.result : Array.isArray(result?.machines) ? result.machines : []
      for (const value of values) this.observeMachine(valueObject(value))
      return
    }
    if (request.action === 'jobs.list' && request.machineId) {
      const values = Array.isArray(job.result) ? job.result : Array.isArray(result?.jobs) ? result.jobs : []
      for (const session of this.sessions.values()) {
        const machine = session.machines.get(request.machineId)
        if (!machine) continue
        for (const job of values) if (remoteJobId(job?.jobId) && ['exited','lost','failed','cancelled','completed'].includes(String(job?.status))) machine.background.delete(job.jobId)
        this.refresh(session, machine)
      }
    }
    if (['jobs.get','jobs.kill'].includes(request.action) && request.machineId && remoteJobId(result?.jobId)
      && ['exited','lost','failed','cancelled','completed'].includes(String(result?.status))) {
      for(const session of this.sessions.values()){
        const machine=session.machines.get(request.machineId)
        if(machine){machine.background.delete(result!.jobId);this.refresh(session,machine)}
      }
    }
    const candidate = valueObject(result?.machine) ?? (machineId(result?.id) ? result : undefined)
    if (candidate) this.observeMachine(candidate)
    const state = request.action === 'machines.stop' ? 'stopped' : request.action === 'machines.suspend' ? 'suspended'
      : request.action === 'machines.delete' ? 'deleted' : undefined
    if (state && request.machineId) for (const session of this.sessions.values()) {
      const machine = session.machines.get(request.machineId)
      if (!machine) continue
      this.setState(machine, state)
      machine.view.updatedAt = this.now()
      this.refresh(session, machine)
    }
  }
  beginTurn(sessionId: string): void {
    if (!this.validSession(sessionId) || this.disposed) return
    const session = this.ensure(sessionId)
    session.running = true; session.turnMachines.clear()
    for (const machine of session.machines.values()) this.refresh(session, machine)
  }
  setRunning(sessionId: string, running: boolean): void {
    if (!this.validSession(sessionId) || this.disposed) return
    const session = this.ensure(sessionId)
    session.running = running
    if (!running) session.turnMachines.clear()
    for (const machine of session.machines.values()) this.refresh(session, machine)
  }
  snapshot(sessionId: string): ActivityView {
    this.prune()
    const session = this.sessions.get(sessionId)
    if (!session) return {sessionId,revision:0,machines:[]}
    const machines = [...session.machines.values()].map(machine => machine.view).sort((a,b) => b.updatedAt-a.updatedAt).slice(0,this.maxMachines)
    return {sessionId,revision:session.revision,machines:structuredClone(machines)}
  }
  dispose(): void { this.disposed=true; this.sessions.clear(); this.tasks.clear() }
  private trackable(request: ActionRequest): boolean {
    if (request.action.startsWith('account.') || request.action.startsWith('templates.') || request.action.endsWith('.list') || request.action.startsWith('control.')) return false
    if(request.action==='operations.get' || (request.action.startsWith('snapshots.') && request.action!=='snapshots.create'))return false
    return !!machineId(request.machineId) || request.action === 'machines.create'
  }
  private validSession(value: string | undefined): value is string { return typeof value === 'string' && value.length>0 && value.length<=256 && !/[\u0000-\u001f\u007f]/.test(value) }
  private ensure(sessionId: string): SessionRecord {
    let session = this.sessions.get(sessionId)
    if (!session) {session={revision:0,touchedAt:this.now(),running:false,turnMachines:new Set(),machines:new Map()};this.sessions.set(sessionId,session)}
    session.touchedAt=this.now()
    return session
  }
  private touch(session: SessionRecord, id: string, action: Action): MachineRecord {
    let machine=session.machines.get(id)
    if(!machine){machine={view:{machineId:id,phase:'idle',lastAction:action,updatedAt:this.now(),pendingJobs:0,backgroundRunning:false},pending:new Set(),background:new Set(),inactive:false};session.machines.set(id,machine)}
    machine.view.lastAction=action;machine.view.updatedAt=this.now()
    session.revision++;session.touchedAt=this.now()
    return machine
  }
  private refresh(session: SessionRecord, machine: MachineRecord): void {
    const phase = machine.inactive ? 'inactive' : machine.pending.size>0 || (session.running && session.turnMachines.has(machine.view.machineId)) ? 'busy' : 'idle'
    const backgroundRunning=machine.background.size>0
    if(machine.view.phase!==phase || machine.view.pendingJobs!==machine.pending.size || machine.view.backgroundRunning!==backgroundRunning) session.revision++
    machine.view.phase=phase;machine.view.pendingJobs=machine.pending.size;machine.view.backgroundRunning=backgroundRunning
  }
  private setState(machine: MachineRecord,state:string): void {
    machine.view.machineState=state;machine.inactive=INACTIVE_STATES.has(state)
    if(machine.inactive){machine.background.clear()}
  }
  private describe(machine: MachineRecord,value?:Record<string,any>):void {
    if(!value)return
    const name=safeName(value.name)
    if(name)machine.view.name=name
    if(hasState(value.state))this.setState(machine,value.state)
  }
  private observeMachine(value?:Record<string,any>):void {
    const id=machineId(value?.id??value?.sandboxId)
    if(!id)return
    for(const session of this.sessions.values()){
      const machine=session.machines.get(id)
      if(!machine)continue
      const before=JSON.stringify(machine.view)
      this.describe(machine,value);this.refresh(session,machine)
      if(JSON.stringify(machine.view)!==before)session.revision++
    }
  }
  private trimMachines(session:SessionRecord):void {
    if(session.machines.size<=this.maxMachines)return
    const evict=[...session.machines.values()].filter(machine=>machine.pending.size===0 && !(session.running&&session.turnMachines.has(machine.view.machineId))).sort((a,b)=>a.view.updatedAt-b.view.updatedAt)
    for(const machine of evict){if(session.machines.size<=this.maxMachines)break;session.machines.delete(machine.view.machineId);session.turnMachines.delete(machine.view.machineId);session.revision++}
  }
  private prune():void {
    const pendingSessions=new Set([...this.tasks.values()].map(task=>task.sessionId))
    const removable=[...this.sessions].filter(([id,session])=>!pendingSessions.has(id) && !session.running && ![...session.machines.values()].some(machine=>machine.pending.size>0)).sort((a,b)=>a[1].touchedAt-b[1].touchedAt)
    for(const[id,session]of removable)if(this.sessions.size>this.maxSessions || this.now()-session.touchedAt>86400000)this.sessions.delete(id)
  }
}

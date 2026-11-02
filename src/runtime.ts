import { randomUUID } from 'node:crypto'
import { actionSchema, type ActionRequest, type ControlView, type JobView } from './shared.js'
import type { ControlJournal, ControlRecord } from './control-store.js'

export type Actor = 'human' | 'agent'
export interface ApiPort { execute(request: ActionRequest, signal?: AbortSignal): Promise<unknown> }
interface Job { view: JobView; actor: Actor; controller: AbortController; settled: Promise<void> }
interface Lease { ownerId: string; since: number; expiresAt: number; url?: string; api?: ApiPort; releasing?: boolean; releasePromise?: Promise<void>; startingJob?: Job; unverified?: boolean }
const READ_ACTIONS = new Set([
  'account.me', 'account.usage', 'templates.list', 'machines.list', 'machines.get', 'machines.logs', 'machines.disk',
  'operations.get', 'jobs.list', 'jobs.get', 'files.list', 'files.read', 'desktop.status', 'desktop.screenshot',
  'desktop.cursor', 'snapshots.list', 'snapshots.get', 'ports.list', 'metrics.get', 'usage.get', 'control.status',
])
const HUMAN_ONLY = new Set(['control.take', 'control.release', 'control.renew', 'desktop.takeover', 'desktop.handback', 'desktop.view', 'desktop.revoke'])
const SAFE_MESSAGES: Record<string, string> = {
  missing_api_key: '请先在 Instabox 设置中保存 API Key。',
  missing_scope: 'API Key 权限不足，请按操作补充机器或快照权限。',
  permission_denied: 'Instabox 拒绝此操作；桌面观看/接管链接需要机器创建者的个人 API Key。',
  invalid_key: 'API Key 无效，请重新填写。', expired_key: 'API Key 已过期，请更换密钥。', revoked_key: 'API Key 已撤销，请更换密钥。',
  not_found: '未找到指定机器、任务或快照，请刷新列表。',
  quota_exceeded: '已达到 Instabox 账号配额或并发限制，请查询用量后重试。',
  machine_cooldown: '机器处于最长运行时间后的冷却期，请稍后再恢复。',
  operation_conflict: '该机器有尚未完成的操作，请查询机器状态后重试。',
  spec_not_allowed: '当前套餐不允许此规格或设置。', template_not_allowed: '当前套餐不允许此模板。',
  invalid_input: '操作参数无效，请检查字段名称、路径和数值范围。',
  file_too_large: '文件超过 Instabox 的 10 MiB 单文件上限。',
  not_utf8: '文件不是有效 UTF-8 文本，请改用 format:base64 下载。',
  confirmation_required: '删除操作需要 input.confirm 与目标机器 ID、快照 ID 或文件路径完全相同。',
}
export class RuntimeError extends Error {
  constructor(message: string, readonly code = 'instabox_error') { super(message); this.name = 'InstaboxRuntimeError' }
}
function safeErrorBody(error: unknown): string {
  if (error instanceof RuntimeError) return error.message
  const code = error && typeof error === 'object' ? String((error as any).code ?? '') : ''
  if (code === 'invalid_input' && error instanceof Error && /^输入参数无效：[A-Za-z0-9_.、]+$/.test(error.message)) return error.message
  if (SAFE_MESSAGES[code]) return `${SAFE_MESSAGES[code]} (${code})`
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return '操作已取消或等待超时；请先查询云端状态，避免重复提交。'
  if (code === 'bad_request' || code === 'INVALID_ARGUMENT') return '操作参数无效，请检查必填项、路径和数值范围。'
  return `Instabox 操作失败${/^[a-z][a-z0-9_]{0,63}$/.test(code) ? ` (${code})` : ''}。请检查连接、账号权限及云端状态。`
}
export function safeError(error: unknown): string {
  const operationId = error && typeof error === 'object' ? (error as any).operationId : undefined
  const suffix = typeof operationId === 'string' && /^op_[A-Za-z0-9_-]{1,150}$/.test(operationId) ? ` 操作编号：${operationId}；请查询该操作，不要重复提交。` : ''
  return safeErrorBody(error) + suffix
}
export function isReadAction(action: string): boolean { return READ_ACTIONS.has(action) }

/** Jobs own accepted requests after the short RPC/tool call returns. The runtime
 * retains their results for polling, bounds retention, and aborts them on dispose. */
export class InstaboxRuntime {
  readonly ready: Promise<void>
  private jobs = new Map<string, Job>()
  private leases = new Map<string, Lease>()
  private lanes = new Map<string, Promise<void>>()
  private disposed = false
  private journalWrites: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setInterval>
  constructor(private readonly apiFactory: () => Promise<ApiPort>, private readonly now = Date.now, private readonly options: {journal?: ControlJournal} = {}) {
    this.ready = this.initialize()
    // A failed journal read remains a fail-closed rejected ready promise for
    // callers, while avoiding an unhandled rejection before the first RPC.
    void this.ready.catch(() => {})
    this.timer = setInterval(() => { void this.expireLeases() }, 5000)
    this.timer.unref?.()
  }
  control(machineId: string): ControlView {
    const lease = this.leases.get(machineId)
    return lease ? {machineId, mode: 'human', ownerId: lease.ownerId, since: lease.since, expiresAt: lease.expiresAt, ...(lease.url ? {url: lease.url} : {}), ...(lease.unverified ? {pendingCleanup: true} : {})}
      : {machineId, mode: 'agent'}
  }
  listJobs(): JobView[] { return [...this.jobs.values()].map(job => structuredClone(job.view)) }
  cancelAgentJobs(): void {
    for (const job of this.jobs.values()) if (job.actor === 'agent' && ['queued', 'running'].includes(job.view.status)) {
      job.controller.abort(new DOMException('模型工具已关闭。', 'AbortError'))
    }
  }
  getJob(jobId: string): JobView {
    const job = this.jobs.get(jobId)
    if (!job) throw new RuntimeError('任务记录已过期或不存在，请查询机器当前状态。', 'job_not_found')
    return structuredClone(job.view)
  }
  async submit(raw: ActionRequest, actor: Actor, signal?: AbortSignal, waitMs = 0): Promise<JobView> {
    await this.ready
    signal?.throwIfAborted()
    if (this.disposed) throw new RuntimeError('Instabox 插件正在关闭，请稍后重试。')
    const parsed = actionSchema.safeParse(raw)
    if (!parsed.success) throw new RuntimeError('操作参数无效，请检查 action、machineId 和 input。', 'bad_request')
    const request = structuredClone(parsed.data)
    if (actor === 'agent' && HUMAN_ONLY.has(request.action)) throw new RuntimeError('该操作仅能由用户在 Instabox 面板中执行。', 'human_only')
    if ([...this.jobs.values()].filter(job => job.view.status === 'running' || job.view.status === 'queued').length >= 32) {
      throw new RuntimeError('已有过多插件任务在运行，请等待完成或取消任务。', 'jobs_full')
    }
    if (actor === 'agent') this.assertAgentAccess(request)
    if (request.action === 'control.take' || request.action === 'desktop.takeover') this.claim(request)
    const time = this.now()
    const view: JobView = {jobId: randomUUID(), action: request.action, ...(request.machineId ? {machineId: request.machineId} : {}), status: 'queued', createdAt: time, updatedAt: time}
    const job: Job = {view, actor, controller: new AbortController(), settled: Promise.resolve()}
    this.jobs.set(view.jobId, job)
    if (request.action === 'control.take' || request.action === 'desktop.takeover') this.leases.get(request.machineId!)!.startingJob = job
    const perform = async () => {
      if (job.controller.signal.aborted || this.disposed) { view.status = 'cancelled'; view.updatedAt = this.now(); return }
      view.status = 'running'; view.updatedAt = this.now()
      try {
        if (actor === 'agent') this.assertAgentAccess(request)
        const result = await this.run(request, actor, job.controller.signal)
        job.controller.signal.throwIfAborted()
        // The API is an untrusted data boundary. No prototypes/bytes/undefined
        // escape into Typert or the durable tool schema.
        view.result = JSON.parse(JSON.stringify(result ?? null))
        view.status = 'succeeded'
      } catch (error) {
        view.status = job.controller.signal.aborted ? 'cancelled' : 'failed'
        view.error = safeError(error)
        if (request.machineId && (request.action === 'control.take' || request.action === 'desktop.takeover')) {
          const lease = this.leases.get(request.machineId)
          if (lease && !lease.api && !lease.unverified && lease.ownerId === request.input?.ownerId) {
            try { await this.forget(request.machineId, lease) }
            catch { lease.unverified = true; view.error = '无法清理持久接管记录，模型操作保持暂停；请检查持久目录。' }
          }
        }
      } finally { view.updatedAt = this.now(); this.trimJobs() }
    }
    // A take request claims the lane immediately, before an old queued agent
    // command can start; cancel active agent input before waiting for its lane.
    if (request.action === 'control.take' || request.action === 'desktop.takeover') {
      for (const existing of this.jobs.values()) {
        if (existing !== job && existing.actor === 'agent' && existing.view.machineId === request.machineId
          && !isReadAction(existing.view.action) && ['queued', 'running'].includes(existing.view.status)) {
          existing.controller.abort(new DOMException('用户已接管桌面。', 'AbortError'))
        }
      }
    }
    const exclusive = request.machineId && !isReadAction(request.action) && request.action !== 'control.renew'
    if (exclusive) {
      const key = request.machineId!
      const preceding = this.lanes.get(key) ?? Promise.resolve()
      job.settled = preceding.then(perform, perform)
      this.lanes.set(key, job.settled)
      void job.settled.finally(() => { if (this.lanes.get(key) === job.settled) this.lanes.delete(key) })
    } else { job.settled = Promise.resolve().then(perform) }
    if (waitMs > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([job.settled, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.min(waitMs, 8000)) })]) }
      finally { if (timer) clearTimeout(timer) }
    }
    return this.getJob(view.jobId)
  }
  cancel(jobId: string): JobView {
    const job = this.jobs.get(jobId)
    if (!job) throw new RuntimeError('任务记录不存在。', 'job_not_found')
    if (job.view.status === 'queued' || job.view.status === 'running') job.controller.abort(new DOMException('用户取消任务。', 'AbortError'))
    return this.getJob(jobId)
  }
  private assertAgentAccess(request: ActionRequest): void {
    if (request.machineId && this.leases.has(request.machineId) && !isReadAction(request.action)) {
      throw new RuntimeError('用户正在接管此机器，已阻止模型的执行、写入和桌面输入。等待用户在面板交还控制权。', 'human_control')
    }
  }
  private owner(request: ActionRequest): string {
    const value = request.input?.ownerId
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,160}$/.test(value)) throw new RuntimeError('接管操作缺少有效的面板租约标识。', 'bad_request')
    return value
  }
  private machine(request: ActionRequest): string {
    if (!request.machineId) throw new RuntimeError('此操作需要 machineId。', 'bad_request')
    return request.machineId
  }
  private claim(request: ActionRequest): void {
    const id = this.machine(request), ownerId = this.owner(request)
    const previous = this.leases.get(id)
    if (previous?.unverified) throw new RuntimeError('上次接管的连接尚未清理，请先重试交还控制权。', 'revoke_failed')
    if (previous && previous.ownerId !== ownerId) throw new RuntimeError('另一个面板正在接管此机器，请先在那个面板交还控制权。', 'control_owned')
    if (previous?.releasing) throw new RuntimeError('该机器正在交还控制权，请稍后重新接管。', 'control_owned')
    if (previous?.startingJob && ['queued', 'running'].includes(previous.startingJob.view.status)) throw new RuntimeError('正在准备桌面接管，请等待当前任务完成。', 'control_owned')
    if (!previous) this.leases.set(id, {ownerId, since: this.now(), expiresAt: this.now() + 120000})
  }
  private async run(request: ActionRequest, actor: Actor, signal: AbortSignal): Promise<unknown> {
    const {action} = request
    if (action === 'control.status') return this.control(this.machine(request))
    const api = await this.apiFactory()
    signal.throwIfAborted()
    if (action === 'control.take' || action === 'desktop.takeover') {
      const id = this.machine(request), ownerId = this.owner(request)
      const lease = this.leases.get(id)
      if (!lease || lease.ownerId !== ownerId) throw new RuntimeError('接管租约已改变，请重新接管。', 'control_owned')
      try {
        // This durable tombstone must be committed before even starting the
        // interactive desktop. A crash at any later await then fails closed.
        await this.persist()
        signal.throwIfAborted()
        lease.api = api
        await api.execute({action: 'desktop.start', machineId: id, input: {}}, signal)
        signal.throwIfAborted()
        await api.execute({action: 'desktop.takeover', machineId: id, input: {}}, signal)
        signal.throwIfAborted()
        const stream = await api.execute({action: 'desktop.view', machineId: id, input: {viewOnly: false, ttlSeconds: 600}}, signal) as {url: string}
        signal.throwIfAborted()
        lease.url = stream.url
        lease.expiresAt = this.now() + 120000
        return this.control(id)
      } catch (error) {
        await this.release(id, lease, true, true)
        throw error
      } finally { lease.startingJob = undefined }
    }
    if (action === 'control.renew') {
      const id = this.machine(request), lease = this.leases.get(id)
      if (!lease || lease.ownerId !== this.owner(request)) throw new RuntimeError('接管租约已结束或属于其他面板。', 'control_owned')
      if (lease.releasing) throw new RuntimeError('接管租约正在交还，请稍后重新接管。', 'control_owned')
      await api.execute({action: 'desktop.status', machineId: id, input: {}}, signal)
      if (this.leases.get(id) !== lease) throw new RuntimeError('接管租约已结束。', 'control_owned')
      lease.expiresAt = this.now() + 120000
      return this.control(id)
    }
    if (action === 'control.release' || action === 'desktop.handback') {
      const id = this.machine(request), lease = this.leases.get(id)
      if (!lease) return this.control(id)
      if (lease.ownerId !== this.owner(request) && !lease.unverified) throw new RuntimeError('接管租约属于另一个面板，当前面板不能释放。', 'control_owned')
      await this.release(id, lease)
      return this.control(id)
    }
    if (action === 'desktop.view') {
      if (request.input?.viewOnly === false) throw new RuntimeError('请通过“接管”按钮打开可操作桌面，确保模型暂停输入。', 'bad_request')
    }
    if (actor === 'agent') this.assertAgentAccess(request)
    return api.execute(request, signal)
  }
  private release(id: string, lease: Lease, quiet = false, fromInitializer = false): Promise<void> {
    if (this.leases.get(id) !== lease) return Promise.resolve()
    // A release already waiting for this initializer owns cleanup. Let the
    // initializer settle instead of creating a cycle that waits for itself.
    if (fromInitializer && lease.releasePromise) return Promise.resolve()
    let task = lease.releasePromise
    if (!task) {
      task = this.releaseExclusive(id, lease, fromInitializer)
      lease.releasePromise = task
      const clear = () => { if (lease.releasePromise === task) lease.releasePromise = undefined }
      // Both branches handle the subscription, so this cleanup hook cannot
      // leave a rejected finally() promise unobserved.
      void task.then(clear, clear)
    }
    return quiet ? task.catch(() => {}) : task
  }
  private async releaseExclusive(id: string, lease: Lease, fromInitializer = false): Promise<void> {
    if (this.leases.get(id) !== lease) return
    if (lease.startingJob && !fromInitializer) {
      const start = lease.startingJob
      start.controller.abort(new DOMException('桌面接管初始化已取消。', 'AbortError'))
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([start.settled, new Promise<void>(resolve => { timer = setTimeout(resolve, 8000) })]) }
      finally { if (timer) clearTimeout(timer) }
      if (this.leases.get(id) !== lease) return
      if (lease.startingJob) {
        lease.expiresAt = this.now() + 15000
        throw new RuntimeError('桌面接管仍在停止，模型保持暂停；请稍后重试交还。', 'revoke_failed')
      }
    }
    if (!lease.api && !lease.unverified) { await this.forget(id, lease); return }
    lease.releasing = true
    const abort = AbortSignal.timeout(8000)
    // Official revocation invalidates ALL viewer links for this machine. Keep
    // model input locked if revocation fails: a stale interactive viewer may
    // still be connected even after its URL expired.
    try {
      if (!lease.api) lease.api = await this.apiFactory()
      await lease.api.execute({action: 'desktop.revoke', machineId: id, input: {}}, abort)
      await lease.api.execute({action: 'desktop.handback', machineId: id, input: {}}, abort)
      await this.forget(id, lease)
    } catch (error) {
      lease.url = undefined
      lease.unverified = true
      lease.expiresAt = this.now() + 15000
      throw new RuntimeError('交还失败，模型仍保持暂停；请重试交还或在 Instabox 控制台撤销桌面连接。', 'revoke_failed')
    } finally { lease.releasing = false }
  }
  private async expireLeases(): Promise<void> {
    if (this.disposed) return
    for (const [id, lease] of this.leases) if (lease.expiresAt <= this.now()) await this.release(id, lease, true)
  }
  async releaseAll(): Promise<void> {
    await this.ready
    await Promise.all([...this.leases].map(([id, lease]) => this.release(id, lease)))
  }
  /** Recovery may need a newly saved key; keep tombstones while the old key is
   * invalid, then try the current credential on the next explicit retry. */
  async retryCleanup(): Promise<void> {
    await this.ready
    for (const lease of this.leases.values()) if (lease.unverified) lease.api = undefined
    await Promise.allSettled([...this.leases].filter(([, lease]) => lease.unverified).map(([id, lease]) => this.release(id, lease, true)))
  }
  private async initialize(): Promise<void> {
    if (!this.options.journal) return
    const records = await this.options.journal.load()
    for (const record of records) this.leases.set(record.machineId, {ownerId: record.ownerId, since: record.since, expiresAt: this.now(), unverified: true})
    await Promise.allSettled([...this.leases].map(([id, lease]) => this.release(id, lease, true)))
  }
  private records(exclude?: {id: string; lease: Lease}): ControlRecord[] {
    return [...this.leases].filter(([id, lease]) => !(exclude && id === exclude.id && lease === exclude.lease)).map(([machineId, lease]) => ({machineId, ownerId: lease.ownerId, since: lease.since, expiresAt: lease.expiresAt}))
  }
  private journalWrite(exclude?: {id: string; lease: Lease}): Promise<void> {
    const journal = this.options.journal
    if (!journal) return Promise.resolve()
    const task = this.journalWrites.then(() => journal.save(this.records(exclude)))
    this.journalWrites = task.catch(() => {})
    return task
  }
  private persist(): Promise<void> { return this.journalWrite() }
  private async forget(id: string, lease: Lease): Promise<void> {
    if (this.leases.get(id) !== lease) return
    await this.journalWrite({id, lease})
    if (this.leases.get(id) === lease) this.leases.delete(id)
  }
  private trimJobs(): void {
    const finished = [...this.jobs.values()].filter(job => !['queued', 'running'].includes(job.view.status))
    let retainedBytes = finished.reduce((sum, job) => sum + JSON.stringify(job.view).length * 2, 0)
    for (const job of finished) {
      if (this.jobs.size > 128 || retainedBytes > 64 * 1024 * 1024 || this.now() - job.view.updatedAt > 3600000) {
        retainedBytes -= JSON.stringify(job.view).length * 2
        this.jobs.delete(job.view.jobId)
      }
    }
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.timer)
    await this.ready.catch(() => {})
    for (const job of this.jobs.values()) job.controller.abort(new DOMException('插件关闭。', 'AbortError'))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([Promise.allSettled([...this.jobs.values()].map(job => job.settled)), new Promise<void>(resolve => { timer = setTimeout(resolve, 8000) })])
    } finally { if (timer) clearTimeout(timer) }
    await Promise.allSettled([...this.leases].map(([id, lease]) => this.release(id, lease)))
    // A timer may already own a revoke or disk commit. Disposal joins its same
    // release promise, then drains the journal lane before a new generation
    // can recover or issue another viewer.
    await this.journalWrites
    // Failed revocations remain in the durable journal and are recovered as
    // unknown human control by the next plugin generation.
    this.jobs.clear(); this.leases.clear(); this.lanes.clear()
  }
}

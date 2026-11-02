import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { InstaboxApi } from './api.js'
import { actionSchema, getJobSchema, saveSettingsSchema, type ActionRequest, type ConfigData, type JobView, type SaveSettingsRequest, type SettingsView } from './shared.js'
import { ConfigConflict, ConfigStore } from './store.js'
import { ControlLeaseStore } from './control-store.js'
import { dirname, join } from 'node:path'
import { InstaboxRuntime, RuntimeError, safeError, type ApiPort } from './runtime.js'

declare module '@deepseek-ai/cordis' { interface Context { instabox: InstaboxService } }
export interface ServiceOptions { apiFactory?: () => Promise<ApiPort> }
export class InstaboxService extends TypertRemoteService {
  readonly runtime: InstaboxRuntime
  private saves: Promise<unknown> = Promise.resolve()
  constructor(ctx: Context, readonly store: ConfigStore, options: ServiceOptions = {}) {
    super(ctx, 'instabox')
    this.runtime = new InstaboxRuntime(options.apiFactory ?? (() => this.createApi()), Date.now, {journal: new ControlLeaseStore(join(dirname(store.path), 'control-leases.json'))})
    ctx.effect(() => () => this.runtime.dispose(), 'instabox: jobs and desktop leases')
  }
  current(): ConfigData { return this.store.current() }
  private async createApi(): Promise<ApiPort> {
    const config = this.current()
    const key = await this.ctx.credentials.resolve(credentialRef(config.apiKeyRef))
    if (!key?.value) throw new RuntimeError('请先在 Instabox 设置中保存 API Key。', 'missing_api_key')
    return new InstaboxApi({apiKey: key.value, requestTimeoutMs: config.requestTimeoutMs})
  }
  @Remote
  async getSettings(request: Record<string, never>, signal: AbortSignal): Promise<SettingsView> {
    await this.runtime.ready
    signal.throwIfAborted()
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length) throw new RemoteError('gateway/bad-request', '读取参数无效。', {})
    const config = this.current()
    const info = await this.ctx.credentials.describe(credentialRef(config.apiKeyRef))
    signal.throwIfAborted()
    return {config, revision: this.store.revision(), credential: {configured: info.configured, writable: info.writable}}
  }
  @Remote
  async saveSettings(request: SaveSettingsRequest, signal: AbortSignal): Promise<SettingsView> {
    const parsed = saveSettingsSchema.safeParse(request)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', 'Instabox 配置无效，请检查凭据引用和数值范围。', {})
    const task = this.saves.then(() => this.saveExclusive(parsed.data, signal))
    this.saves = task.catch(() => {})
    return task
  }
  private async saveExclusive(request: SaveSettingsRequest, signal: AbortSignal): Promise<SettingsView> {
    signal.throwIfAborted()
    if (request.apiKey && request.clearApiKey) throw new RemoteError('gateway/bad-request', '不能同时填写和清除 API Key。', {})
    if (request.apiKey && (!/^ibk_[A-Za-z0-9_-]{8,4096}$/.test(request.apiKey))) throw new RemoteError('gateway/bad-request', '请填写有效的 ibk_ 开头 API Key。', {})
    await this.store.load()
    if (request.expectedRevision !== this.store.revision()) throw new RemoteError('gateway/bad-request', '配置已在其他窗口修改，请重新加载后保存。', {})
    const ref = credentialRef(request.config.apiKeyRef)
    const changesKey = request.apiKey !== undefined || request.clearApiKey === true || this.current().apiKeyRef !== request.config.apiKeyRef
    if (request.apiKey !== undefined || request.clearApiKey) {
      const info = await this.ctx.credentials.describe(ref)
      if (!info.writable) throw new RemoteError('gateway/bad-request', '该凭据来源不可写，请使用可写的凭据引用。', {})
    }
    // End owned viewers with the old key before rotating it; otherwise their
    // capability URLs might survive without a credential able to revoke them.
    if (changesKey) {
      try { await this.runtime.releaseAll() }
      catch { /* Keep durable locks, but allow replacing an expired key so it can revoke old viewers. */ }
    }
    signal.throwIfAborted()
    try {
      if (request.apiKey !== undefined) await this.ctx.credentials.set(ref, request.apiKey)
      else if (request.clearApiKey) await this.ctx.credentials.unset(ref)
      await this.store.save(request.config, request.expectedRevision)
      if (!request.config.modelToolsEnabled) this.runtime.cancelAgentJobs()
      if (changesKey) await this.runtime.retryCleanup()
    } catch (error) {
      if (error instanceof ConfigConflict) throw new RemoteError('gateway/bad-request', error.message, {})
      throw new RemoteError('gateway/internal', '保存未完成，请重新加载核对设置及凭据后重试。', {})
    }
    return this.getSettings({}, new AbortController().signal)
  }
  @Remote
  async execute(request: ActionRequest, signal: AbortSignal): Promise<JobView> {
    try { return await this.runtime.submit(request, 'human', signal, 0) }
    catch (error) { throw new RemoteError('gateway/bad-request', safeError(error), {}) }
  }
  @Remote
  async getJob(request: {jobId: string}, signal: AbortSignal): Promise<JobView> {
    signal.throwIfAborted()
    const parsed = getJobSchema.safeParse(request)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', '任务编号无效。', {})
    try { return this.runtime.getJob(parsed.data.jobId) }
    catch (error) { throw new RemoteError('gateway/bad-request', safeError(error), {}) }
  }
  async executeAgent(request: ActionRequest, signal: AbortSignal): Promise<JobView> {
    signal.throwIfAborted()
    if (!this.current().modelToolsEnabled) throw new RuntimeError('Instabox 模型工具已在设置中关闭。', 'model_tools_disabled')
    const parsed = actionSchema.parse(request)
    if (parsed.action === 'machines.create' && !parsed.input?.templateId && !parsed.input?.snapshotId) {
      parsed.input = {...parsed.input, templateId: this.current().defaultTemplate}
    }
    return this.runtime.submit(parsed, 'agent', signal, 8000)
  }
}

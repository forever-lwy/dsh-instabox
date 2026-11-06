var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { SessionId } from '@deepseek-ai/dsh-session';
import { InstaboxApi } from './api.js';
import { actionSchema, activityRequestSchema, getJobSchema, saveSettingsSchema } from './shared.js';
import { ConfigConflict } from './store.js';
import { ControlLeaseStore } from './control-store.js';
import { dirname, join } from 'node:path';
import { InstaboxRuntime, RuntimeError, safeError } from './runtime.js';
import { ActivityTracker } from './activity.js';
let InstaboxService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _getSettings_decorators;
    let _saveSettings_decorators;
    let _execute_decorators;
    let _getJob_decorators;
    let _getActivity_decorators;
    return class InstaboxService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _getSettings_decorators = [Remote];
            _saveSettings_decorators = [Remote];
            _execute_decorators = [Remote];
            _getJob_decorators = [Remote];
            _getActivity_decorators = [Remote({ resources: { session: (request) => SessionId(request.sessionId) } })];
            __esDecorate(this, null, _getSettings_decorators, { kind: "method", name: "getSettings", static: false, private: false, access: { has: obj => "getSettings" in obj, get: obj => obj.getSettings }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _saveSettings_decorators, { kind: "method", name: "saveSettings", static: false, private: false, access: { has: obj => "saveSettings" in obj, get: obj => obj.saveSettings }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _execute_decorators, { kind: "method", name: "execute", static: false, private: false, access: { has: obj => "execute" in obj, get: obj => obj.execute }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getJob_decorators, { kind: "method", name: "getJob", static: false, private: false, access: { has: obj => "getJob" in obj, get: obj => obj.getJob }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getActivity_decorators, { kind: "method", name: "getActivity", static: false, private: false, access: { has: obj => "getActivity" in obj, get: obj => obj.getActivity }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        store = __runInitializers(this, _instanceExtraInitializers);
        runtime;
        activity = new ActivityTracker();
        activityJobs = new Map();
        activityDisposed = false;
        saves = Promise.resolve();
        constructor(ctx, store, options = {}) {
            super(ctx, 'instabox');
            this.store = store;
            this.runtime = new InstaboxRuntime(options.apiFactory ?? (() => this.createApi()), Date.now, { journal: new ControlLeaseStore(join(dirname(store.path), 'control-leases.json')) });
            ctx.effect(() => () => this.runtime.dispose(), 'instabox: jobs and desktop leases');
            const timer = setInterval(() => this.sweepActivityJobs(), 250);
            timer.unref?.();
            ctx.effect(() => () => { this.activityDisposed = true; clearInterval(timer); this.activityJobs.clear(); this.activity.dispose(); }, 'instabox: session activity');
            ctx.on('agent/status', ({ agent, status }) => this.activity.setRunning(String(agent.session.id), status === 'running'));
            ctx.on('agent/disposed', ({ agent }) => this.activity.setRunning(String(agent.session.id), false));
            ctx.on('session/event', (session, event) => {
                if (event.type === 'turn/start')
                    this.activity.beginTurn(String(session.id));
                else if (event.type === 'turn/end')
                    this.activity.setRunning(String(session.id), false);
            });
        }
        current() { return this.store.current(); }
        async createApi() {
            const config = this.current();
            const key = await this.ctx.credentials.resolve(credentialRef(config.apiKeyRef));
            if (!key?.value)
                throw new RuntimeError('请先在 Instabox 设置中保存 API Key。', 'missing_api_key');
            return new InstaboxApi({ apiKey: key.value, requestTimeoutMs: config.requestTimeoutMs });
        }
        async getSettings(request, signal) {
            await this.runtime.ready;
            signal.throwIfAborted();
            if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length)
                throw new RemoteError('gateway/bad-request', '读取参数无效。', {});
            const config = this.current();
            const info = await this.ctx.credentials.describe(credentialRef(config.apiKeyRef));
            signal.throwIfAborted();
            return { config, revision: this.store.revision(), credential: { configured: info.configured, writable: info.writable } };
        }
        async saveSettings(request, signal) {
            const parsed = saveSettingsSchema.safeParse(request);
            if (!parsed.success)
                throw new RemoteError('gateway/bad-request', 'Instabox 配置无效，请检查凭据引用和数值范围。', {});
            const task = this.saves.then(() => this.saveExclusive(parsed.data, signal));
            this.saves = task.catch(() => { });
            return task;
        }
        async saveExclusive(request, signal) {
            signal.throwIfAborted();
            if (request.apiKey && request.clearApiKey)
                throw new RemoteError('gateway/bad-request', '不能同时填写和清除 API Key。', {});
            if (request.apiKey && (!/^ibk_[A-Za-z0-9_-]{8,4096}$/.test(request.apiKey)))
                throw new RemoteError('gateway/bad-request', '请填写有效的 ibk_ 开头 API Key。', {});
            await this.store.load();
            if (request.expectedRevision !== this.store.revision())
                throw new RemoteError('gateway/bad-request', '配置已在其他窗口修改，请重新加载后保存。', {});
            const ref = credentialRef(request.config.apiKeyRef);
            const changesKey = request.apiKey !== undefined || request.clearApiKey === true || this.current().apiKeyRef !== request.config.apiKeyRef;
            if (request.apiKey !== undefined || request.clearApiKey) {
                const info = await this.ctx.credentials.describe(ref);
                if (!info.writable)
                    throw new RemoteError('gateway/bad-request', '该凭据来源不可写，请使用可写的凭据引用。', {});
            }
            // End owned viewers with the old key before rotating it; otherwise their
            // capability URLs might survive without a credential able to revoke them.
            if (changesKey) {
                try {
                    await this.runtime.releaseAll();
                }
                catch { /* Keep durable locks, but allow replacing an expired key so it can revoke old viewers. */ }
            }
            signal.throwIfAborted();
            try {
                if (request.apiKey !== undefined)
                    await this.ctx.credentials.set(ref, request.apiKey);
                else if (request.clearApiKey)
                    await this.ctx.credentials.unset(ref);
                await this.store.save(request.config, request.expectedRevision);
                if (!request.config.modelToolsEnabled)
                    this.runtime.cancelAgentJobs();
                if (changesKey)
                    await this.runtime.retryCleanup();
            }
            catch (error) {
                if (error instanceof ConfigConflict)
                    throw new RemoteError('gateway/bad-request', error.message, {});
                throw new RemoteError('gateway/internal', '保存未完成，请重新加载核对设置及凭据后重试。', {});
            }
            return this.getSettings({}, new AbortController().signal);
        }
        async execute(request, signal) {
            try {
                const job = await this.runtime.submit(request, 'human', signal, 0);
                this.watchActivityJob(request, job);
                return job;
            }
            catch (error) {
                throw new RemoteError('gateway/bad-request', safeError(error), {});
            }
        }
        async getJob(request, signal) {
            signal.throwIfAborted();
            const parsed = getJobSchema.safeParse(request);
            if (!parsed.success)
                throw new RemoteError('gateway/bad-request', '任务编号无效。', {});
            try {
                return this.runtime.getJob(parsed.data.jobId);
            }
            catch (error) {
                throw new RemoteError('gateway/bad-request', safeError(error), {});
            }
        }
        async getActivity(request, signal) {
            signal.throwIfAborted();
            const parsed = activityRequestSchema.safeParse(request);
            if (!parsed.success)
                throw new RemoteError('gateway/bad-request', '会话标识无效。', {});
            this.sweepActivityJobs();
            return this.activity.snapshot(parsed.data.sessionId);
        }
        async executeAgent(request, signal, sessionId, running) {
            signal.throwIfAborted();
            if (!this.current().modelToolsEnabled)
                throw new RuntimeError('Instabox 模型工具已在设置中关闭。', 'model_tools_disabled');
            const parsed = actionSchema.parse(request);
            if (parsed.action === 'machines.create' && !parsed.input?.templateId && !parsed.input?.snapshotId) {
                parsed.input = { ...parsed.input, templateId: this.current().defaultTemplate };
            }
            const token = this.activity.begin(sessionId, parsed, running);
            try {
                const job = await this.runtime.submit(parsed, 'agent', signal, 8000);
                this.watchActivityJob(parsed, job, token);
                return job;
            }
            catch (error) {
                this.activity.finish(token);
                throw error;
            }
        }
        watchActivityJob(request, job, token) {
            if (this.activityDisposed)
                return;
            const stateObservation = ['machines.list', 'machines.get', 'machines.create', 'machines.fork', 'machines.update', 'machines.start', 'machines.resume', 'machines.suspend', 'machines.stop', 'machines.delete', 'jobs.list', 'jobs.get', 'jobs.kill'].includes(request.action);
            if (!token && !stateObservation)
                return;
            // Retain only the action and machine identity. In particular, a long file
            // transfer must not make this observer keep a second copy of file bytes,
            // shell commands, URLs or credentials from request.input.
            const metadata = { action: request.action, ...(request.machineId ? { machineId: request.machineId } : {}) };
            if (['queued', 'running'].includes(job.status))
                this.activityJobs.set(job.jobId, { request: metadata, ...(token ? { token } : {}) });
            else {
                this.activity.finish(token, job);
                this.activity.observe(metadata, job);
            }
        }
        sweepActivityJobs() {
            if (this.activityDisposed)
                return;
            for (const [jobId, entry] of this.activityJobs) {
                try {
                    const job = this.runtime.getJob(jobId);
                    if (['queued', 'running'].includes(job.status))
                        continue;
                    this.activityJobs.delete(jobId);
                    this.activity.finish(entry.token, job);
                    this.activity.observe(entry.request, job);
                }
                catch {
                    this.activityJobs.delete(jobId);
                    this.activity.finish(entry.token);
                }
            }
        }
    };
})();
export { InstaboxService };

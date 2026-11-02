import { viewerUrl, waitForJob } from './face.js';
const timers = {
    setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
    clearTimeout: handle => globalThis.clearTimeout(handle),
    setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
    clearInterval: handle => globalThis.clearInterval(handle),
};
const createId = () => globalThis.crypto?.randomUUID?.() ?? `instabox-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const message = (error) => error instanceof Error ? error.message : '云桌面操作失败。';
const inactive = (entry) => entry.activity.phase === 'inactive' || ['stopped', 'suspended', 'paused', 'deleted'].includes(entry.activity.machineState ?? '');
/** One owner at browser-plugin scope, independent of React/message lifetimes.
 * Calls are serialized per physical machine, including across two sessions.
 * A queued release therefore also cleans up a take that completes after the
 * user switched chats. Only the controller owns lease and heartbeat effects. */
export class PreviewController {
    face;
    options;
    records = new Map();
    machineQueues = new Map();
    activityRevisions = new Map();
    listeners = new Set();
    lifetime = new AbortController();
    clock;
    interval;
    currentSession = null;
    disposed = false;
    disposeTask;
    version = 0;
    snapshot = { sessionId: null, items: [], revision: 0 };
    constructor(face, options = {}) {
        this.face = face;
        this.options = options;
        this.clock = options.timers ?? timers;
        this.interval = this.clock.setInterval(() => this.heartbeat(), options.heartbeatMs ?? 10000);
        this.interval?.unref?.();
    }
    subscribe = (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    getSnapshot = () => this.snapshot;
    key(sessionId, machineId) { return JSON.stringify([sessionId, machineId]); }
    emit() {
        const items = this.currentSession === null ? [] : [...this.records.values()].filter(entry => entry.sessionId === this.currentSession)
            .sort((a, b) => b.activity.updatedAt - a.activity.updatedAt).map(entry => ({
            ...entry.activity, expanded: entry.expanded, mode: entry.mode, ...(entry.url ? { url: entry.url } : {}),
            pending: entry.pending > 0, ...(entry.error ? { error: entry.error } : {}), ...(entry.control ? { control: { ...entry.control } } : {}),
            manual: entry.manual, cleanupNeeded: entry.unverified || entry.control?.pendingCleanup === true || entry.needsRelease && !entry.url, retiring: entry.retiring,
        }));
        this.snapshot = { sessionId: this.currentSession, items, revision: ++this.version };
        for (const listener of this.listeners)
            listener();
    }
    clearGrace(entry) { if (entry.grace !== undefined) {
        this.clock.clearTimeout(entry.grace);
        entry.grace = undefined;
    } }
    active(entry, intent = entry.intent) { return !this.disposed && !entry.retiring && entry.sessionId === this.currentSession && entry.intent === intent; }
    entry(machineId) {
        if (this.disposed)
            throw new Error('云桌面预览已关闭。');
        if (!this.currentSession)
            throw new Error('请先选择一个对话。');
        const entry = this.records.get(this.key(this.currentSession, machineId));
        if (!entry)
            throw new Error('当前对话尚未绑定这台云机。');
        return entry;
    }
    queue(entry, operation) {
        entry.pending++;
        this.emit();
        const previous = this.machineQueues.get(entry.activity.machineId) ?? Promise.resolve();
        const task = previous.catch(() => { }).then(operation);
        const tracked = task.catch(error => { entry.error = message(error); throw error; }).finally(() => { entry.pending--; this.emit(); });
        const settled = tracked.catch(() => { });
        this.machineQueues.set(entry.activity.machineId, settled);
        void settled.then(() => { if (this.machineQueues.get(entry.activity.machineId) === settled)
            this.machineQueues.delete(entry.activity.machineId); });
        return tracked;
    }
    async request(entry, action, input = {}, cleanup = false) {
        // Cleanup outlives the aborted browser owner. The Host also keeps a durable
        // tombstone if a release fails or this page disappears during the request.
        const signal = cleanup ? AbortSignal.timeout(120000) : this.lifetime.signal;
        const initial = await this.face.execute({ action, machineId: entry.activity.machineId, input, clientId: entry.ownerId }, signal);
        const job = await waitForJob(this.face, initial, signal, undefined, this.options.pollMs ?? 1000);
        return job.result;
    }
    applyControl(entry, value) {
        // Control status is metadata. Render only a URL this entry explicitly
        // obtained for its own viewer, never another panel's interactive link.
        entry.control = { ...value, url: undefined };
        if (value.mode === 'agent') {
            entry.needsRelease = false;
            entry.unverified = false;
            if (entry.mode === 'control') {
                entry.url = undefined;
                entry.mode = 'closed';
            }
        }
        else if (value.ownerId === entry.ownerId || value.pendingCleanup) {
            entry.needsRelease = true;
            entry.unverified = value.pendingCleanup === true;
            if (value.pendingCleanup) {
                entry.url = undefined;
                entry.mode = 'control';
            }
        }
        else {
            entry.needsRelease = false;
            entry.unverified = false;
            if (entry.mode === 'control') {
                entry.url = undefined;
                entry.mode = 'closed';
            }
        }
    }
    async inspect(entry, cleanup = false) {
        const value = await this.request(entry, 'control.status', {}, cleanup);
        this.applyControl(entry, value);
        return value;
    }
    async releaseOwned(entry, cleanup = false) {
        if (!entry.needsRelease && !entry.unverified)
            return;
        entry.url = undefined;
        try {
            const value = await this.request(entry, 'control.release', { ownerId: entry.ownerId }, cleanup);
            this.applyControl(entry, value);
            if (value.mode !== 'agent')
                throw new Error('桌面接管尚未确认交还，请重试。');
            entry.error = undefined;
        }
        catch (error) {
            entry.needsRelease = true;
            entry.unverified = true;
            entry.mode = 'control';
            entry.url = undefined;
            try {
                await this.inspect(entry, cleanup);
            }
            catch { /* Keep the conservative lock when status cannot be read. */ }
            if (!entry.needsRelease && !entry.unverified) {
                entry.error = undefined;
                return;
            }
            entry.needsRelease = true;
            entry.unverified = true;
            throw error;
        }
    }
    async setSession(sessionId) {
        if (this.disposed || sessionId === this.currentSession)
            return;
        const previous = this.currentSession;
        this.currentSession = sessionId;
        const cleanups = [];
        for (const entry of this.records.values()) {
            if (entry.sessionId === previous) {
                entry.intent++;
                this.clearGrace(entry);
                entry.url = undefined;
                entry.expanded = false;
                entry.manual = false;
                if (entry.needsRelease || entry.unverified)
                    cleanups.push(this.queue(entry, async () => { await this.releaseOwned(entry); entry.mode = 'closed'; }));
                else
                    entry.mode = 'closed';
            }
            if (entry.sessionId === sessionId)
                entry.activation = true;
        }
        this.emit();
        await Promise.allSettled(cleanups);
    }
    async resetActivityEpoch() {
        await this.setSession(null);
        this.activityRevisions.clear();
        for (const [key, entry] of this.records) {
            if (!entry.needsRelease && !entry.unverified)
                this.records.delete(key);
            else {
                entry.activation = true;
                entry.retiring = true;
            }
        }
        this.emit();
    }
    updateActivity(view) {
        if (this.disposed || view.sessionId !== this.currentSession)
            return;
        const previousRevision = this.activityRevisions.get(view.sessionId) ?? -1;
        if (view.revision < previousRevision)
            return;
        this.activityRevisions.set(view.sessionId, view.revision);
        const opens = [], closes = [];
        for (const activity of view.machines) {
            const key = this.key(view.sessionId, activity.machineId);
            let entry = this.records.get(key);
            const previousBusy = entry?.activity.phase === 'busy', activation = entry?.activation ?? true;
            if (!entry) {
                entry = { sessionId: view.sessionId, activity: { ...activity }, ownerId: (this.options.createId ?? createId)(), expanded: false, mode: 'closed', manual: false, needsRelease: false, unverified: false, pending: 0, intent: 0, activation: false, retiring: false };
                this.records.set(key, entry);
            }
            else {
                entry.activity = { ...activity };
                entry.activation = false;
                entry.retiring = false;
            }
            if (activity.phase === 'busy') {
                this.clearGrace(entry);
                if ((!previousBusy || activation) && !entry.expanded && !entry.needsRelease && !entry.manual)
                    opens.push(entry);
            }
            else if (activity.phase === 'inactive') {
                this.clearGrace(entry);
                // Taking control is never interrupted merely because agent jobs ended.
                // An offline machine cannot be auto-opened; retain the re-open button.
                if (entry.mode !== 'control' && !entry.needsRelease && entry.expanded)
                    closes.push(entry);
            }
            else if (previousBusy && entry.expanded && !entry.manual && !entry.needsRelease && entry.mode !== 'control') {
                this.clearGrace(entry);
                const intent = entry.intent;
                entry.grace = this.clock.setTimeout(() => {
                    entry.grace = undefined;
                    if (this.active(entry, intent) && entry.activity.phase !== 'busy' && !entry.manual && !entry.needsRelease)
                        void this.collapseEntry(entry, false).catch(() => { });
                }, this.options.idleGraceMs ?? 5000);
            }
        }
        const present = new Set(view.machines.map(activity => activity.machineId));
        for (const [key, entry] of this.records) {
            if (entry.sessionId !== view.sessionId || present.has(entry.activity.machineId) || entry.retiring)
                continue;
            entry.retiring = true;
            entry.intent++;
            this.clearGrace(entry);
            entry.url = undefined;
            entry.manual = false;
            if (entry.needsRelease || entry.unverified) {
                entry.expanded = true;
                void this.queue(entry, async () => { await this.releaseOwned(entry); if (entry.retiring)
                    this.records.delete(key); }).catch(() => { });
            }
            else
                this.records.delete(key);
        }
        this.emit();
        for (const entry of closes)
            void this.collapseEntry(entry, false).catch(() => { });
        for (const entry of opens)
            void this.openWatch(entry, false).catch(() => { });
    }
    async openWatch(entry, manual) {
        if (inactive(entry) || entry.retiring) {
            entry.error = '机器已停止或暂停。请先在云电脑面板恢复机器，再打开桌面。';
            this.emit();
            throw new Error(entry.error);
        }
        this.clearGrace(entry);
        if (manual)
            entry.manual = true;
        if (entry.expanded && entry.mode === 'watch' && entry.url && !entry.needsRelease) {
            this.emit();
            return;
        }
        const intent = ++entry.intent;
        entry.expanded = true;
        entry.error = undefined;
        entry.url = undefined;
        if (!entry.needsRelease)
            entry.mode = 'watch';
        await this.queue(entry, async () => {
            if (!this.active(entry, intent))
                return;
            await this.releaseOwned(entry);
            if (!this.active(entry, intent))
                return;
            const control = await this.inspect(entry);
            if (!this.active(entry, intent))
                return;
            if (control.pendingCleanup) {
                entry.mode = 'control';
                entry.url = undefined;
                entry.error = '上次接管待清理。请先清理并交还。';
                return;
            }
            if (control.mode === 'human' && control.ownerId === entry.ownerId) {
                await this.releaseOwned(entry);
                if (!this.active(entry, intent))
                    return;
            }
            const desktop = await this.request(entry, 'desktop.status');
            if (!this.active(entry, intent))
                return;
            if (desktop?.running !== true) {
                await this.request(entry, 'desktop.start');
                if (!this.active(entry, intent))
                    return;
            }
            const value = await this.request(entry, 'desktop.view', { viewOnly: true, ttlSeconds: 600 });
            if (!this.active(entry, intent))
                return;
            entry.url = viewerUrl(value?.url);
            entry.mode = 'watch';
        });
    }
    async watch(machineId) { return this.openWatch(this.entry(machineId), true); }
    async take(machineId) {
        const entry = this.entry(machineId);
        if (inactive(entry) || entry.retiring) {
            entry.error = '机器已停止、暂停或不再绑定此对话。请先在云电脑面板检查机器，再接管。';
            this.emit();
            throw new Error(entry.error);
        }
        this.clearGrace(entry);
        entry.manual = true;
        if (entry.mode === 'control' && entry.url && !entry.unverified && entry.control?.ownerId === entry.ownerId) {
            entry.expanded = true;
            this.emit();
            return;
        }
        const cleanupBeforeClaim = entry.needsRelease || entry.unverified;
        const intent = ++entry.intent;
        entry.expanded = true;
        entry.url = undefined;
        entry.error = undefined;
        // Mark the possibly submitted claim before enqueueing; a context switch
        // must release it even when the response has not reached this browser.
        entry.needsRelease = true;
        await this.queue(entry, async () => {
            if (!this.active(entry, intent))
                return;
            try {
                if (cleanupBeforeClaim) {
                    await this.releaseOwned(entry);
                    if (!this.active(entry, intent))
                        return;
                    entry.needsRelease = true;
                }
                const value = await this.request(entry, 'control.take', { ownerId: entry.ownerId });
                this.applyControl(entry, value);
                if (value.mode !== 'human' || value.ownerId !== entry.ownerId || value.pendingCleanup)
                    throw new Error('未获得这台机器的人工接管，请核对控制状态。');
                entry.mode = 'control';
                if (!this.active(entry, intent))
                    return;
                entry.url = viewerUrl(value.url);
                entry.unverified = false;
            }
            catch (error) {
                entry.url = undefined;
                if (!this.disposed) {
                    try {
                        await this.inspect(entry);
                    }
                    catch {
                        entry.needsRelease = true;
                        entry.unverified = true;
                        entry.mode = 'control';
                    }
                }
                throw error;
            }
        });
    }
    collapseEntry(entry, manual) {
        this.clearGrace(entry);
        entry.intent++;
        if (manual)
            entry.manual = false;
        entry.url = undefined;
        if (!entry.needsRelease && !entry.unverified) {
            entry.expanded = false;
            entry.mode = 'closed';
            entry.error = undefined;
            if (entry.retiring)
                this.records.delete(this.key(entry.sessionId, entry.activity.machineId));
            this.emit();
            return Promise.resolve();
        }
        // Keep a visible cleanup surface until revocation succeeds; a hidden
        // control URL must never be mistaken for a successfully handed-back VM.
        entry.expanded = entry.sessionId === this.currentSession;
        return this.queue(entry, async () => { await this.releaseOwned(entry); entry.expanded = false; entry.mode = 'closed'; entry.manual = false; if (entry.retiring)
            this.records.delete(this.key(entry.sessionId, entry.activity.machineId)); });
    }
    async collapse(machineId) { return this.collapseEntry(this.entry(machineId), true); }
    async handback(machineId) { return this.collapse(machineId); }
    heartbeat() {
        if (this.disposed)
            return;
        for (const entry of this.records.values()) {
            if (entry.retiring || entry.sessionId !== this.currentSession || !entry.expanded || entry.mode !== 'control' || !entry.needsRelease || entry.unverified || entry.pending > 0)
                continue;
            void this.queue(entry, async () => {
                if (entry.sessionId !== this.currentSession || !entry.needsRelease || entry.unverified)
                    return;
                try {
                    const value = await this.request(entry, 'control.renew', { ownerId: entry.ownerId });
                    const previousUrl = entry.url;
                    this.applyControl(entry, value);
                    if (value.mode === 'agent') {
                        entry.expanded = false;
                        entry.manual = false;
                        entry.url = undefined;
                        return;
                    }
                    if (value.pendingCleanup) {
                        entry.url = undefined;
                        entry.error = '上次接管待清理。请先清理并交还。';
                        return;
                    }
                    if (value.ownerId !== entry.ownerId)
                        throw new Error('接管已转移至其他面板。');
                    entry.url = value.url ? viewerUrl(value.url) : previousUrl;
                }
                catch (error) {
                    entry.url = undefined;
                    entry.unverified = true;
                    entry.error = `接管续期失败，已隐藏交互画面：${message(error)}`;
                    try {
                        const value = await this.inspect(entry);
                        if (value.mode === 'agent' || value.ownerId !== entry.ownerId && !value.pendingCleanup) {
                            entry.expanded = false;
                            entry.manual = false;
                            entry.unverified = false;
                        }
                        else
                            entry.unverified = true;
                    }
                    catch { /* Retain cleanup ownership on unknown status. */ }
                }
            }).catch(() => { });
        }
    }
    dispose() {
        if (this.disposeTask)
            return this.disposeTask;
        this.disposed = true;
        this.currentSession = null;
        this.clock.clearInterval(this.interval);
        this.lifetime.abort();
        const cleanups = [];
        for (const entry of this.records.values()) {
            this.clearGrace(entry);
            entry.intent++;
            entry.url = undefined;
            entry.expanded = false;
            if (entry.needsRelease || entry.unverified)
                cleanups.push(this.queue(entry, async () => { await this.releaseOwned(entry, true); entry.mode = 'closed'; }));
        }
        this.emit();
        this.listeners.clear();
        this.disposeTask = Promise.allSettled(cleanups).then(() => { });
        return this.disposeTask;
    }
}

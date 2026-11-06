import { randomUUID } from 'node:crypto';
import { posix as cloudPath } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Sandbox } from '@insforge/instabox-sdk';
import { z } from 'zod';
const API_URL = 'https://api.instabox.sh';
const MiB = 1024 * 1024;
const MAX_FILE_BYTES = 10 * MiB;
const identifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const machineIdentifier = z.string().min(3).max(160).regex(/^m_[A-Za-z0-9_-]+$/);
const templateIdentifier = z.string().min(1).max(160).regex(/^[a-z0-9][a-z0-9-]*(?:@[A-Za-z0-9_.-]+)?$/);
const name = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const path = z.string().min(1).max(4096).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Invalid path');
const text = z.string().max(MAX_FILE_BYTES);
const metadata = z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), z.string().max(4096)).refine(value => Object.keys(value).length <= 32);
const empty = z.object({}).strict();
const coord = z.number().int().min(0).max(16384);
const port = z.number().int().min(1024).max(65535).refine(value => value !== 5901 && value !== 6768, 'Reserved platform port');
const datetime = z.string().datetime({ offset: true });
const object = (shape) => z.object(shape).strict();
/** This schema belongs on the Host; importing it in a browser would bundle the SDK. */
export const ACTION_INPUT_SCHEMAS = {
    'account.me': empty, 'account.usage': empty, 'templates.list': empty,
    'machines.list': object({ limit: z.number().int().min(1).max(100).optional(), cursor: z.string().max(2048).optional(), metadata: metadata.optional() }),
    'machines.get': empty,
    'machines.create': object({ name: name.optional(), templateId: templateIdentifier.optional(), snapshotId: identifier.optional(),
        vcpus: z.number().int().min(1).max(32).optional(), memMiB: z.number().int().min(1024).max(65536).optional(),
        metadata: metadata.optional(), autoSuspendAfterSeconds: z.number().int().min(0).max(1800).optional() }),
    'machines.update': object({ vcpus: z.number().int().min(1).max(32).optional(), memMiB: z.number().int().min(1024).max(65536).optional(),
        persistentDiskGiB: z.number().int().min(1).max(1024).optional(), metadata: metadata.optional(),
        autoSuspendAfterSeconds: z.number().int().min(0).max(1800).optional() }),
    'machines.start': empty, 'machines.suspend': empty, 'machines.resume': empty,
    'machines.stop': object({ timeoutSeconds: z.number().int().min(0).max(600).optional() }),
    'machines.delete': object({ confirm: identifier }),
    'machines.fork': object({ name: name.optional(), vcpus: z.number().int().min(1).max(32).optional(),
        memMiB: z.number().int().min(1024).max(65536).optional(), metadata: metadata.optional() }),
    'machines.logs': object({ tail: z.number().int().min(1).max(5000).optional(), after: z.number().int().nonnegative().optional() }),
    'machines.disk': empty,
    'operations.get': object({ operationId: identifier, waitSeconds: z.number().int().min(0).max(25).optional() }),
    'commands.run': object({ cmd: z.string().min(1).max(65536).refine(value => !value.includes('\0') && Buffer.byteLength(value) <= 65536),
        cwd: path.optional(), envs: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(MiB)).optional(),
        timeoutSeconds: z.number().int().min(1).max(600).optional(), background: z.boolean().optional(),
        stdin: z.string().refine(value => Buffer.byteLength(value) <= MiB).optional() }),
    'jobs.list': empty, 'jobs.get': object({ jobId: identifier, tail: z.number().int().min(1).max(5000).optional() }),
    'jobs.kill': object({ jobId: identifier }),
    'files.list': object({ path }),
    'files.read': object({ path, format: z.enum(['text', 'base64']).optional() }),
    'files.write': object({ path, format: z.enum(['text', 'base64']).optional(), content: z.string().max(Math.ceil(MAX_FILE_BYTES / 3) * 4) }),
    'files.remove': object({ path, confirm: path }),
    'desktop.start': object({ width: z.number().int().min(800).max(2560).optional(), height: z.number().int().min(600).max(1600).optional() }),
    'desktop.status': empty, 'desktop.takeover': empty, 'desktop.handback': empty, 'desktop.screenshot': empty,
    'desktop.click': object({ x: coord, y: coord, button: z.enum(['left', 'right', 'middle']).optional(), double: z.boolean().optional() }),
    'desktop.move': object({ x: coord, y: coord }), 'desktop.drag': object({ from: z.tuple([coord, coord]), to: z.tuple([coord, coord]) }),
    'desktop.scroll': object({ direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().int().min(1).max(100).optional() }),
    'desktop.type': object({ text: text.max(MiB).refine(value => Buffer.byteLength(value) <= MiB), delayMs: z.number().int().min(0).max(1000).optional() }),
    'desktop.press': object({ keys: z.union([z.string().min(1).max(100), z.array(z.string().min(1).max(100)).min(1).max(16)]) }),
    'desktop.open': object({ url: z.string().url().max(8192).refine(value => ['https:', 'http:'].includes(new URL(value).protocol)) }),
    'desktop.cursor': empty,
    'desktop.view': object({ viewOnly: z.boolean().optional(), ttlSeconds: z.number().int().min(60).max(86400).optional() }),
    'desktop.revoke': empty,
    'snapshots.list': empty, 'snapshots.get': object({ snapshotId: identifier }),
    'snapshots.create': object({ name, description: z.string().max(4096).optional(), rootOnly: z.boolean().optional() }),
    'snapshots.delete': object({ snapshotId: identifier, confirm: identifier }),
    'ports.list': empty,
    'ports.publish': object({ port, name: z.string().min(1).max(100).optional(), access: z.enum(['private', 'public']).optional(), rotateToken: z.boolean().optional() }),
    'ports.unpublish': object({ port }),
    'ssh.credentials': object({ publicKey: z.string().min(20).max(16384).refine(value => /^(ssh-|ecdsa-)/.test(value) && !/[\r\n\0]/.test(value)),
        ttlSeconds: z.number().int().min(1).max(86400).optional() }),
    'metrics.get': object({ since: datetime.optional() }), 'usage.get': object({ from: datetime.optional(), to: datetime.optional() }),
};
export class InstaboxApiError extends Error {
    code;
    status;
    retryable;
    operationId;
    constructor(message, code = 'instabox_error', status = 0, retryable = false, operationId) {
        super(message);
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        this.operationId = operationId;
        this.name = 'InstaboxApiError';
    }
}
function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
function validate(schema, input) {
    const parsed = schema.safeParse(input);
    if (!parsed.success)
        throw new InstaboxApiError(`输入参数无效：${parsed.error.issues.map(issue => issue.path.join('.') || 'input').join('、')}`, 'invalid_input');
    return parsed.data;
}
/** Reads SDK/CLI jobs from their on-disk format, so polling survives a Host reload.
 * No API key, command text or environment is written to this script. */
const JOB_SCRIPT = String.raw `import os,sys,json,signal
from pathlib import Path
root=Path.home()/'.instabox'/'jobs'
action,job,tail=sys.argv[1],sys.argv[2],int(sys.argv[3])
boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def read(p,default=''):
 try:return p.read_text().strip()
 except (OSError,UnicodeError):return default
def info(p,log=False):
 pidtext=read(p/'pid');pid=int(pidtext) if pidtext.isdigit() else 0
 exittext=read(p/'exit');exitcode=int(exittext) if exittext.lstrip('-').isdigit() else None
 live=False
 if pid and read(p/'boot')==boot:
  try:
   args=(Path('/proc')/str(pid)/'cmdline').read_bytes().replace(b'\x00',b' ')
   live=str(p).encode() in args
   os.kill(pid,0)
  except OSError:live=False
 value={'jobId':p.name,'pid':pid,'status':'exited' if exitcode is not None else 'running' if live else 'lost','exitCode':exitcode,'startedAt':read(p/'started')}
 if log:
  try:
   with open(p/'out','rb') as f:
    f.seek(0,2);size=f.tell();f.seek(max(0,size-1048576));data=f.read(1048576)
   value['stdout']=b'\n'.join(data.splitlines()[-tail:]).decode('utf-8','replace');value['truncated']=size>1048576
  except OSError:value['stdout']='';value['truncated']=False
 return value
if action=='list':
 values=[]
 if root.exists():
  for p in sorted(root.iterdir(),key=lambda p:p.name):
   if p.is_dir() and not p.is_symlink() and (p/'pid').exists():values.append(info(p))
 print(json.dumps({'jobs':values}))
else:
 p=root/job
 if not p.is_dir() or p.is_symlink():raise SystemExit('No such background job')
 value=info(p,True)
 if action=='kill':
  value['killed']=False
  if value['status']=='running':
   try:os.killpg(value['pid'],signal.SIGTERM);value['killed']=True
   except ProcessLookupError:pass
 print(json.dumps(value))
`;
export class InstaboxApi {
    options;
    fetchImpl;
    constructor(options) {
        this.options = options;
        if (!options.apiKey.trim() || /[\r\n\0]/.test(options.apiKey))
            throw new InstaboxApiError('请先在插件设置中配置有效的 Instabox API Key。', 'missing_api_key');
        if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs < 1000 || options.requestTimeoutMs > 120000)
            throw new InstaboxApiError('请求超时设置无效。', 'invalid_input');
        this.fetchImpl = options.fetch ?? globalThis.fetch;
    }
    safeMessage(value) {
        const message = value instanceof Error ? value.message : typeof value === 'string' ? value : 'Instabox 请求失败。';
        return message.replaceAll(this.options.apiKey, '[REDACTED]').replace(/\bibk_[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 4096);
    }
    async request(method, route, args = {}, signal) {
        signal?.throwIfAborted();
        const url = new URL(route, API_URL);
        if (url.origin !== API_URL)
            throw new InstaboxApiError('仅允许访问 Instabox 官方 API。', 'invalid_origin');
        for (const [key, value] of Object.entries(args.query ?? {})) {
            if (value === undefined)
                continue;
            if (Array.isArray(value))
                for (const item of value)
                    url.searchParams.append(key, String(item));
            else
                url.searchParams.set(key, String(value));
        }
        const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(args.timeoutMs ?? this.options.requestTimeoutMs)]);
        const headers = { 'X-API-Key': this.options.apiKey, Accept: 'application/json', ...args.headers };
        if (args.idempotent)
            headers['Idempotency-Key'] = randomUUID();
        if (args.body !== undefined)
            headers['Content-Type'] = 'application/json';
        let response;
        try {
            response = await this.fetchImpl(url, { method, headers, body: args.body === undefined ? undefined : JSON.stringify(args.body), signal: requestSignal, redirect: 'error' });
        }
        catch (error) {
            if (requestSignal.aborted)
                throw requestSignal.reason;
            throw new InstaboxApiError(this.safeMessage(error), 'network_error', 0, true);
        }
        if (response.status === 204)
            return { ok: true };
        const raw = await response.text();
        let data;
        try {
            data = raw ? JSON.parse(raw) : {};
        }
        catch {
            throw new InstaboxApiError(`Instabox 返回了无效响应（HTTP ${response.status}）。`, 'invalid_response', response.status);
        }
        if (!response.ok) {
            const error = data?.error ?? {};
            let message = this.safeMessage(error.message || `Instabox 请求失败（HTTP ${response.status}）。`);
            if (response.status === 403 && route.endsWith('/desktop/stream'))
                message += ' 桌面链接必须使用创建该机器的个人 API Key；workspace Key 不支持桌面链接。';
            throw new InstaboxApiError(message, typeof error.code === 'string' ? error.code : 'http_error', response.status, error.retryable === true, typeof error.operationId === 'string' ? error.operationId : undefined);
        }
        return data;
    }
    async sandbox(machineId, signal) {
        return Sandbox.connect(machineId, { apiKey: this.options.apiKey, apiUrl: API_URL, resume: false,
            requestTimeoutMs: this.options.requestTimeoutMs, operationTimeoutMs: this.options.operationTimeoutMs ?? 600000,
            fetch: async (input, init) => {
                signal?.throwIfAborted();
                const url = new URL(input instanceof Request ? input.url : String(input));
                if (url.origin !== API_URL)
                    throw new InstaboxApiError('仅允许访问 Instabox 官方 API。', 'invalid_origin');
                return this.fetchImpl(input, { ...init, redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])]) });
            } });
    }
    async finishOperation(operation, signal) {
        if (!operation || typeof operation.id !== 'string' || !operation.id.startsWith('op_'))
            throw new InstaboxApiError('Instabox 未返回有效的操作标识；请先查询机器状态，避免重复提交。', 'invalid_response');
        const operationId = operation.id;
        const deadline = Date.now() + (this.options.operationTimeoutMs ?? 600000);
        let current = operation;
        try {
            while (current.state !== 'succeeded') {
                signal?.throwIfAborted();
                if (current.state === 'failed')
                    throw new InstaboxApiError(this.safeMessage(current.error?.message || '云机操作失败。'), current.error?.code || 'operation_failed', 0, current.error?.retryable === true, operationId);
                if (!['queued', 'running'].includes(current.state))
                    throw new InstaboxApiError('云机操作返回了未知状态。', 'invalid_response', 0, false, operationId);
                if (Date.now() >= deadline)
                    throw new InstaboxApiError('等待云机操作超时；该操作可能仍在执行，请用 operations.get 查询 ' + operationId + '，不要重复提交。', 'operation_timeout', 0, true, operationId);
                current = await this.request('GET', '/v1/operations/' + encodeURIComponent(operationId), { query: { wait: '25s' } }, signal);
                if (['queued', 'running'].includes(current.state))
                    await delay(250, undefined, { signal });
            }
            if (current.type === 'delete')
                return { operation: current };
            const id = current.machineId ?? operation.machineId;
            const machine = typeof id === 'string' ? await this.request('GET', '/v1/machines/' + encodeURIComponent(id), {}, signal) : undefined;
            return { operation: current, ...(machine ? { machine } : {}) };
        }
        catch (error) {
            if (error instanceof InstaboxApiError && error.operationId)
                throw error;
            throw new InstaboxApiError('云机操作已提交，但等待被中断；请先查询 ' + operationId + '。' + this.safeMessage(error), signal?.aborted ? 'aborted' : 'operation_interrupted', error?.status ?? 0, true, operationId);
        }
    }
    async finishSnapshot(snapshot, signal) {
        const deadline = Date.now() + (this.options.operationTimeoutMs ?? 600000);
        let current = snapshot;
        while (current?.status === 'pending') {
            signal?.throwIfAborted();
            if (Date.now() >= deadline)
                throw new InstaboxApiError('快照仍在保存，请查询快照 ' + String(snapshot?.id) + '，避免重复创建。', 'operation_timeout', 0, true);
            await delay(500, undefined, { signal });
            current = await this.request('GET', '/v1/snapshots/' + encodeURIComponent(snapshot.id), {}, signal);
        }
        if (current?.status === 'failed')
            throw new InstaboxApiError(this.safeMessage(current.error?.message || '快照保存失败。'), 'snapshot_failed');
        if (current?.status !== 'ready')
            throw new InstaboxApiError('快照返回了未知状态。', 'invalid_response');
        return current;
    }
    async execute(request, signal) {
        signal?.throwIfAborted();
        const schema = ACTION_INPUT_SCHEMAS[request.action];
        if (!schema)
            throw new InstaboxApiError('不支持的 Instabox 操作。', 'unsupported_action');
        const input = validate(schema, request.input ?? {});
        let machineId = '';
        if (/^(machines\.(?!list|create)|commands\.|jobs\.|files\.|desktop\.|snapshots\.create|ports\.|ssh\.|metrics\.|usage\.)/.test(request.action))
            machineId = validate(machineIdentifier, request.machineId);
        const base = `/v1/machines/${encodeURIComponent(machineId)}`;
        try {
            switch (request.action) {
                case 'account.me': return await this.request('GET', '/v1/me', {}, signal);
                case 'account.usage': return await this.request('GET', '/v1/usage', {}, signal);
                case 'templates.list': return await this.request('GET', '/v1/templates', {}, signal);
                case 'machines.list': return await this.request('GET', '/v1/machines', { query: { ...input, metadata: input.metadata ? Object.entries(input.metadata).map(([key, value]) => `${key}:${value}`) : undefined } }, signal);
                case 'machines.get': return await this.request('GET', base, {}, signal);
                case 'machines.create': {
                    if (input.templateId && input.snapshotId)
                        throw new InstaboxApiError('templateId 和 snapshotId 只能选择一个。', 'invalid_input');
                    if ((input.vcpus === undefined) !== (input.memMiB === undefined))
                        throw new InstaboxApiError('创建机器时必须同时填写 vcpus 和 memMiB。', 'invalid_input');
                    return await this.finishOperation(await this.request('POST', '/v1/machines', { body: { ...input, vault: false, secrets: [], envSecrets: [] }, idempotent: true }, signal), signal);
                }
                case 'machines.update': return await this.request('PATCH', base, { body: input, idempotent: true }, signal);
                case 'machines.fork': return await this.finishOperation(await this.request('POST', `${base}/fork`, { body: input, idempotent: true }, signal), signal);
                case 'machines.start':
                case 'machines.stop':
                case 'machines.suspend':
                case 'machines.resume':
                    return await this.finishOperation(await this.request('POST', `${base}/${request.action.split('.')[1]}`, { body: input, idempotent: true }, signal), signal);
                case 'machines.delete': {
                    // Match either the addressed ID/name, or the server's exact canonical name.
                    if (input.confirm !== machineId) {
                        const machine = await this.request('GET', base, {}, signal);
                        if (input.confirm !== machine.id && input.confirm !== machine.name)
                            throw new InstaboxApiError('删除确认必须填写该机器的准确 ID 或名称。', 'confirmation_required');
                    }
                    return await this.finishOperation(await this.request('DELETE', base, { headers: { 'X-Confirm-Delete': input.confirm }, idempotent: true }, signal), signal);
                }
                case 'machines.logs': return await this.request('GET', `${base}/logs`, { query: input }, signal);
                case 'machines.disk': return await this.request('GET', `${base}/disk`, {}, signal);
                case 'operations.get': return await this.request('GET', `/v1/operations/${encodeURIComponent(input.operationId)}`, { query: input.waitSeconds ? { wait: `${input.waitSeconds}s` } : undefined }, signal);
                case 'commands.run': {
                    if (input.background) {
                        if (input.stdin !== undefined)
                            throw new InstaboxApiError('后台命令暂不支持 stdin；请先写入文件。', 'invalid_input');
                        const sandbox = await this.sandbox(machineId, signal);
                        const handle = await sandbox.commands.run(input.cmd, { background: true, cwd: input.cwd, envs: input.envs, timeoutMs: 30000, signal });
                        return { jobId: handle.jobId, pid: handle.pid, status: 'running' };
                    }
                    const { background: _background, ...body } = input;
                    const timeoutSeconds = input.timeoutSeconds ?? 60;
                    return await this.request('POST', `${base}/exec`, { body: { ...body, timeoutSeconds }, timeoutMs: (timeoutSeconds + 30) * 1000 }, signal);
                }
                case 'jobs.list':
                case 'jobs.get':
                case 'jobs.kill': {
                    const action = request.action.split('.')[1];
                    const cmd = `python3 -c ${shellQuote(JOB_SCRIPT)} ${shellQuote(action)} ${shellQuote(input.jobId ?? '')} ${shellQuote(String(input.tail ?? 200))}`;
                    const value = await this.request('POST', `${base}/exec`, { body: { cmd, timeoutSeconds: 30, noHistory: true } }, signal);
                    if (value.exitCode !== 0)
                        throw new InstaboxApiError(`后台任务操作失败：${this.safeMessage(value.stderr || '未找到任务')}`, 'job_error');
                    try {
                        return JSON.parse(value.stdout);
                    }
                    catch {
                        throw new InstaboxApiError('后台任务响应格式无效。', 'invalid_response');
                    }
                }
                case 'files.list': return await this.request('GET', `${base}/files`, { query: input }, signal);
                case 'files.read': {
                    const sandbox = await this.sandbox(machineId, signal);
                    const bytes = await sandbox.files.read(input.path, { format: 'bytes' });
                    if (bytes.length > MAX_FILE_BYTES)
                        throw new InstaboxApiError('文件超过 10 MiB 上限。', 'file_too_large');
                    const format = input.format ?? 'text';
                    let content;
                    try {
                        content = format === 'base64' ? Buffer.from(bytes).toString('base64') : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                    }
                    catch {
                        throw new InstaboxApiError('该文件不是有效 UTF-8 文本，请使用 base64 格式下载。', 'not_utf8');
                    }
                    return { path: input.path, format, content };
                }
                case 'files.write': {
                    if (input.format === 'base64' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content))
                        throw new InstaboxApiError('base64 文件内容无效。', 'invalid_input');
                    const bytes = Buffer.from(input.content, input.format === 'base64' ? 'base64' : 'utf8');
                    if (bytes.length > MAX_FILE_BYTES)
                        throw new InstaboxApiError('文件超过 10 MiB 上限。', 'file_too_large');
                    const sandbox = await this.sandbox(machineId, signal);
                    return { ...await sandbox.files.write(input.path, bytes), bytes: bytes.length };
                }
                case 'files.remove': {
                    if (input.confirm !== input.path)
                        throw new InstaboxApiError('删除确认必须与文件路径完全一致。', 'confirmation_required');
                    const target = cloudPath.resolve('/data/home', input.path);
                    if (['/', '/data', '/data/home'].includes(target) || input.path === '~')
                        throw new InstaboxApiError('不能删除整个云机工作目录，请选择具体文件或子目录。', 'invalid_input');
                    const sandbox = await this.sandbox(machineId, signal);
                    await sandbox.files.remove(input.path);
                    return { ok: true, path: input.path };
                }
                case 'desktop.status':
                case 'desktop.takeover':
                case 'desktop.handback':
                    return await this.request('POST', `${base}/desktop`, { body: { action: request.action.split('.')[1] } }, signal);
                case 'desktop.view': return await this.request('POST', `${base}/desktop/stream`, { body: { viewOnly: input.viewOnly ?? true, ttlSeconds: input.ttlSeconds ?? 600 } }, signal);
                case 'desktop.revoke': return await this.request('DELETE', `${base}/desktop/stream`, {}, signal);
                case 'desktop.start':
                case 'desktop.screenshot':
                case 'desktop.click':
                case 'desktop.move':
                case 'desktop.drag':
                case 'desktop.scroll':
                case 'desktop.type':
                case 'desktop.press':
                case 'desktop.open':
                case 'desktop.cursor': {
                    const sandbox = await this.sandbox(machineId, signal);
                    const desktop = sandbox.desktop;
                    switch (request.action) {
                        case 'desktop.start': return await desktop.start(input);
                        case 'desktop.screenshot': {
                            const bytes = await desktop.screenshot();
                            const png = Buffer.from(bytes);
                            const dimensions = png.length >= 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                                ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } : {};
                            return { mimeType: 'image/png', base64: png.toString('base64'), ...dimensions };
                        }
                        case 'desktop.click':
                            await desktop.click(input.x, input.y, { button: input.button, double: input.double });
                            break;
                        case 'desktop.move':
                            await desktop.move(input.x, input.y);
                            break;
                        case 'desktop.drag':
                            await desktop.drag(input.from, input.to);
                            break;
                        case 'desktop.scroll':
                            await desktop.scroll(input);
                            break;
                        case 'desktop.type':
                            await desktop.type(input.text, { delayMs: input.delayMs });
                            break;
                        case 'desktop.press':
                            await desktop.press(input.keys);
                            break;
                        case 'desktop.open':
                            await desktop.open(input.url);
                            break;
                        case 'desktop.cursor': return await desktop.cursorPosition();
                    }
                    return { ok: true };
                }
                case 'snapshots.list': return await this.request('GET', '/v1/snapshots', {}, signal);
                case 'snapshots.get': return await this.request('GET', `/v1/snapshots/${encodeURIComponent(input.snapshotId)}`, {}, signal);
                case 'snapshots.create': return await this.finishSnapshot(await this.request('POST', `${base}/snapshots`, { body: input, idempotent: true }, signal), signal);
                case 'snapshots.delete': {
                    if (input.confirm !== input.snapshotId)
                        throw new InstaboxApiError('请填写要删除快照的准确 ID。', 'confirmation_required');
                    return await this.request('DELETE', `/v1/snapshots/${encodeURIComponent(input.snapshotId)}`, { headers: { 'X-Confirm-Delete': input.confirm }, idempotent: true }, signal);
                }
                case 'ports.list': return await this.request('GET', `${base}/ports`, {}, signal);
                case 'ports.publish': return await this.request('POST', `${base}/ports`, { body: { ...input, access: input.access ?? 'private' } }, signal);
                case 'ports.unpublish': return await this.request('DELETE', `${base}/ports/${input.port}`, {}, signal);
                case 'ssh.credentials': return await this.request('POST', `${base}/connections`, { body: input, idempotent: true }, signal);
                case 'metrics.get': return await this.request('GET', `${base}/metrics`, { query: input }, signal);
                case 'usage.get': return await this.request('GET', `${base}/usage`, { query: input }, signal);
                default: throw new InstaboxApiError('不支持的 Instabox 操作。', 'unsupported_action');
            }
        }
        catch (error) {
            if (error instanceof InstaboxApiError)
                throw error;
            if (signal?.aborted)
                throw signal.reason;
            throw new InstaboxApiError(this.safeMessage(error), typeof error?.code === 'string' ? error.code : 'instabox_error', typeof error?.status === 'number' ? error.status : 0, error?.retryable === true, typeof error?.operationId === 'string' ? error.operationId : undefined);
        }
    }
}

import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { ACTIONS } from './shared.js';
import { ACTION_INPUT_SCHEMAS } from './api.js';
import { RuntimeError, safeError } from './runtime.js';
/**
 * Action families the model may use, with the guidance that used to live in
 * eight resident tool descriptions. It now reaches the model only through
 * `help` (progressive disclosure); the service enforces every rule anyway.
 */
const HUMAN_ONLY = new Set(['desktop.takeover', 'desktop.handback', 'desktop.view', 'desktop.revoke']);
export const FAMILIES = [
    { prefix: /^(machines|account|templates|operations|metrics|usage)\./, rules: 'Machines and account. machineId must be the canonical m_ ID from machines.list; names/aliases are refused so they cannot bypass a human takeover lock. machines.create accepts input.templateId (default agent-browser) OR snapshotId, name, vcpus, memMiB, metadata, autoSuspendAfterSeconds; creation receives no personal Vault or org Secrets. Mutation timeouts may leave cloud work in progress: poll the returned plugin jobId with task.get. Deletion requires input.confirm exactly equal to machineId.' },
    { prefix: /^(commands|jobs)\./, rules: 'Runs on the REMOTE machine, never the DSH host. commands.run input: {cmd, cwd?, envs?, timeoutSeconds?, background?}. For long work use background:true; it returns the remote jobId. jobs.list/get/kill inspect or terminate remote detached jobs; input.jobId is that remote job, distinct from a plugin task jobId. Human desktop takeover blocks model commands and job termination.' },
    { prefix: /^files\./, rules: 'input.path is a remote Linux path, relative to remote HOME if not absolute. files.read input.format text|base64; files.write input.content and format text|base64. Binary reads become durable DSH file attachments. Per-file limit is 10 MiB. files.remove requires input.confirm exactly equal to input.path; recursive deletion cannot be undone.' },
    { prefix: /^desktop\./, rules: 'Screenshot returns an image attachment usable with image-capable models; coordinates are native screen pixels (screenWidth/screenHeight). click/move use input.x,y; click adds button:left|right|middle and double:boolean. drag uses input.from:[x,y],to:[x,y]; scroll direction up|down|left|right,amount; type text; press keys:string or string[]; open url:http(s). Model keyboard/mouse actions are blocked during human takeover; takeover/handback/viewer controls are only in the user panel.' },
    { prefix: /^snapshots\./, rules: 'create needs machineId and input.name, description?, rootOnly?. get/delete use input.snapshotId; delete requires input.confirm exactly equal to snapshotId. To restore, create a new machine with machines.create input.snapshotId.' },
    { prefix: /^(ports|ssh)\./, rules: 'ports.list/publish/unpublish; publishing needs input.port (1024..65535; reserved ports refused), access:private|public (default private), name?, rotateToken?. Private publishes a token-protected HTTPS URL; public deliberately exposes it. ssh.credentials needs input.publicKey, ttlSeconds?; never generate or send a private SSH key.' },
];
export const MODEL_ACTIONS = ACTIONS.filter(action => !HUMAN_ONLY.has(action) && FAMILIES.some(f => f.prefix.test(action)));
const TASK_ACTIONS = ['task.get', 'task.list', 'task.control'];
const TASK_RULES = 'Plugin tasks: task.get needs jobId (from a previous call); task.list lists recent plugin tasks (different from remote jobs.list); task.control with machineId reports whether a user is controlling that machine. Never repeat a mutation merely because its plugin task is still running; while a human has control, wait for hand-back.';
export const INSTABOX_DESCRIPTION = [
    'Operate InstaBox REMOTE cloud Linux machines (never this DSH host; local files are not synced): machines, remote commands/jobs, files, desktop screenshots and input, snapshots, ports and SSH.',
    'Before an action\'s first use call {"action":"help","input":{"action":"<name>"}} for its exact input schema and rules; {"action":"help"} lists all actions.',
    'machineId is the canonical m_ ID from machines.list. Long operations return a plugin jobId: poll task.get instead of resubmitting.',
    'Destructive deletes need input.confirm equal to the target. While the user controls a machine in the InstaBox panel, model writes are blocked: wait for hand-back and never bypass it with other tools. Never request or print API keys.',
].join(' ');
function rulesFor(action) {
    if (TASK_ACTIONS.includes(action))
        return TASK_RULES;
    return FAMILIES.find(f => f.prefix.test(action))?.rules ?? '';
}
/** Unknown action: answer with the valid names of the same family. */
function unknownAction(action) {
    const family = String(action).split('.')[0];
    const near = [...MODEL_ACTIONS, ...TASK_ACTIONS].filter(name => name.startsWith(`${family}.`));
    return new RuntimeError(`未知操作 ${action}。${near.length ? `可用：${near.join(', ')}。` : '调用 {"action":"help"} 查看全部操作。'}`, 'bad_request');
}
export function registerTools(ctx, service) {
    const pending = new Map();
    ctx.effect(() => () => pending.clear(), 'instabox: nested image receipts');
    const imageCache = new Map();
    const fileCache = new Map();
    ctx.effect(() => () => { imageCache.clear(); fileCache.clear(); });
    const prepare = async (job, signal) => {
        signal.throwIfAborted();
        if (job.status !== 'succeeded')
            return job;
        const raw = job.result;
        if (job.action === 'desktop.screenshot' && raw?.mimeType === 'image/png' && typeof raw.base64 === 'string') {
            let attachment = imageCache.get(job.jobId);
            if (!attachment) {
                attachment = await ctx.attachments.saveImage({ data: Buffer.from(raw.base64, 'base64'), mediaType: 'image/png', name: `instabox-${job.machineId ?? 'desktop'}.png` });
                imageCache.set(job.jobId, attachment);
                if (imageCache.size > 128)
                    imageCache.delete(imageCache.keys().next().value);
            }
            return { ...job, result: { image: attachment, screenWidth: raw.width ?? attachment.width, screenHeight: raw.height ?? attachment.height, coordinateSystem: 'Use original screen pixels (screenWidth/screenHeight) for click/move/drag. The attached image may have been downscaled by DSH; scale coordinates accordingly.' } };
        }
        if (job.action === 'files.read' && raw?.format === 'base64' && typeof raw.content === 'string') {
            let attachment = fileCache.get(job.jobId);
            if (!attachment) {
                attachment = await ctx.attachments.saveFile({ data: Buffer.from(raw.content, 'base64'), name: String(raw.path ?? 'download').split('/').at(-1) || 'download' });
                fileCache.set(job.jobId, attachment);
                if (fileCache.size > 128)
                    fileCache.delete(fileCache.keys().next().value);
            }
            return { ...job, result: { file: attachment } };
        }
        if (job.action.startsWith('control.') || ['desktop.takeover', 'desktop.handback', 'desktop.view'].includes(job.action)) {
            const { url: _url, ownerId: _owner, ...safe } = raw ?? {};
            return { ...job, result: safe };
        }
        return job;
    };
    const output = {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
            const result = value.result;
            const content = [{ type: 'text', text: JSON.stringify(value) }];
            if (result?.image)
                content.push({ type: 'image', attachment: result.image });
            if (result?.file)
                content.push({ type: 'file', attachment: result.file });
            return content;
        },
        presentationMeta: (_args, value) => ({ instabox: value }),
    };
    const help = (input) => {
        const action = typeof input?.action === 'string' ? input.action : '';
        if (!action)
            return { actions: [...TASK_ACTIONS, ...MODEL_ACTIONS], usage: 'Call help with input.action for one action\'s schema and rules.' };
        if (HUMAN_ONLY.has(action) || action.startsWith('control.'))
            throw new RuntimeError('此操作仅由用户面板管理。');
        if (TASK_ACTIONS.includes(action))
            return { action, rules: TASK_RULES };
        const schema = ACTION_INPUT_SCHEMAS[action];
        if (!schema || !MODEL_ACTIONS.includes(action))
            throw unknownAction(action);
        // Zod attaches non-enumerable ~standard function metadata to the schema
        // object. DSH's lossless-JSON output boundary correctly rejects that
        // object; publish only the actual JSON Schema document.
        return { action, rules: rulesFor(action), inputSchema: JSON.parse(JSON.stringify(z.toJSONSchema(schema))) };
    };
    const task = async (action, args, signal) => {
        if (action === 'task.list')
            return { tasks: service.runtime.listJobs().map(({ result: _result, ...job }) => job) };
        if (action === 'task.control') {
            if (!args.machineId)
                throw new RuntimeError('请提供 machineId。', 'bad_request');
            const { url: _url, ownerId: _owner, ...view } = service.runtime.control(args.machineId);
            return { control: view };
        }
        if (!args.jobId)
            throw new RuntimeError('请提供 jobId。', 'bad_request');
        return prepare(service.runtime.getJob(args.jobId), signal);
    };
    const definition = defineTool({
        name: 'instabox',
        description: INSTABOX_DESCRIPTION,
        parameters: {
            action: { type: 'string', required: true, description: 'help, task.get|list|control, or a remote action such as machines.list, commands.run, files.read, desktop.screenshot.' },
            machineId: { type: 'string', description: 'Canonical m_ machine ID for machine-scoped actions.' },
            input: { type: 'object', additionalProperties: true, description: 'Action-specific fields (see help).' },
            jobId: { type: 'string', description: 'task.get: plugin task id.' },
        },
        output,
        async execute(args, exec) {
            exec.signal.throwIfAborted();
            if (!service.current().modelToolsEnabled)
                throw new RuntimeError('Instabox 模型工具已关闭。');
            const action = String(args.action ?? '');
            if (action === 'help')
                return help(args.input);
            if (TASK_ACTIONS.includes(action))
                return task(action, args, exec.signal);
            if (!MODEL_ACTIONS.includes(action))
                throw unknownAction(action);
            try {
                const request = { action, ...(args.machineId ? { machineId: args.machineId } : {}), ...(args.input ? { input: args.input } : {}) };
                const job = await service.executeAgent(request, exec.signal, exec.agent?.session.id, exec.agent?.status === 'running');
                return await prepare(job, exec.signal);
            }
            catch (error) {
                throw new RuntimeError(safeError(error));
            }
        },
    });
    // Register only while model tools are enabled: a disabled InstaBox costs no
    // context at all. Toggling changes the tool list from the next request on.
    let unregister = null;
    const syncRegistration = () => {
        const enabled = service.current().modelToolsEnabled;
        if (enabled && unregister === null) {
            const disposer = ctx.tools.register(definition);
            unregister = typeof disposer === 'function' ? disposer : () => { };
        }
        else if (!enabled && unregister !== null) {
            const off = unregister;
            unregister = null;
            off();
        }
    };
    syncRegistration();
    if (typeof service.onSaved === 'function')
        ctx.effect(() => service.onSaved(syncRegistration), 'instabox: model tool registration');
    // PTC sub-call content is not put in model history by rc.5. Publish a durable
    // screenshot only after both nested dispatch and enclosing call succeeded.
    ctx.on('tools/result', (exec, result) => {
        const collected = pending.get(exec.token);
        pending.delete(exec.token);
        if (collected && !result.isError && !exec.signal.aborted && exec.agent === collected.agent) {
            for (const receipt of collected.images)
                collected.agent.inject(createUserMessage({ source: { kind: 'instabox-screen', jobId: receipt.jobId }, content: [{ type: 'image', attachment: receipt.attachment }] }));
        }
        if (!exec.parent || !exec.agent || result.isError || exec.signal.aborted || exec.name !== 'instabox')
            return;
        const receipt = result.meta?.instabox;
        const attachment = receipt?.result?.image;
        if (!attachment || !result.content.some(block => block.type === 'image' && block.attachment.attachmentId === attachment.attachmentId))
            return;
        const group = pending.get(exec.parent) ?? { agent: exec.agent, images: [] };
        if (group.agent !== exec.agent)
            return;
        group.images.push({ jobId: receipt.jobId, attachment });
        pending.set(exec.parent, group);
    });
    ctx.on('agent/disposed', ({ agent }) => { for (const [key, group] of pending)
        if (group.agent === agent)
            pending.delete(key); });
}

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef, FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { ACTIONS, type ActionRequest, type JobView } from './shared.js'
import { ACTION_INPUT_SCHEMAS } from './api.js'
import { RuntimeError, safeError } from './runtime.js'
import type { InstaboxService } from './service.js'

declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { 'instabox-screen': {kind: 'instabox-screen'; jobId: string} } }
const GROUPS = [
  {name: 'instabox_machine', actions: ACTIONS.filter(a => /^(machines|account|templates|operations|metrics|usage)\./.test(a)), description: 'Manage remote InstaBox Linux machines: list/create/get/update/start/stop/suspend/resume/fork/delete, logs/disk, templates, account usage, operation status and metrics. machineId must be the canonical m_ ID from machines.list; names/aliases are refused so they cannot bypass a human takeover lock. machines.create accepts input.templateId (default agent-browser) OR snapshotId, name, vcpus, memMiB, metadata, autoSuspendAfterSeconds. Creation explicitly receives no personal Vault or org Secrets. Mutation timeouts may leave cloud work in progress: poll the returned plugin jobId. Deletion requires input.confirm exactly equal to machineId. Call instabox_help for the exact input schema.'},
  {name: 'instabox_command', actions: ACTIONS.filter(a => /^(commands|jobs)\./.test(a)), description: 'Execute code on an InstaBox REMOTE machine, never on the DSH host. commands.run input: {cmd, cwd?, envs?, timeoutSeconds?, background?}. For long work use background:true; this returns the remote jobId. jobs.list/get/kill inspect or terminate remote detached jobs; input.jobId identifies that remote job, distinct from a plugin task jobId. Human desktop takeover blocks model commands and job termination.'},
  {name: 'instabox_file', actions: ACTIONS.filter(a => /^files\./.test(a)), description: 'List/read/write/remove remote InstaBox files. input.path is a remote Linux path, relative to remote HOME if not absolute. files.read input.format text|base64; files.write input.content and format text|base64. Binary reads become durable DSH file attachments. Per-file limit is 10 MiB. files.remove requires input.confirm exactly equal to input.path; recursive deletion cannot be undone.'},
  {name: 'instabox_desktop', actions: ACTIONS.filter(a => /^desktop\./.test(a) && !['desktop.takeover', 'desktop.handback', 'desktop.view', 'desktop.revoke'].includes(a)), description: 'See and drive an InstaBox desktop: start/status/screenshot/click/move/drag/scroll/type/press/open/cursor. Screenshot returns an image attachment usable with image-capable models. Coordinates are native screen pixels. click/move use input.x,y; click adds button:left|right|middle and double:boolean. drag uses input.from:[x,y],to:[x,y]; scroll direction up|down|left|right,amount; type text; press keys:string or string[]; open url:http(s). Model keyboard/mouse actions are blocked during human takeover. Human takeover/handback/viewer controls are only in the user panel.'},
  {name: 'instabox_snapshot', actions: ACTIONS.filter(a => /^snapshots\./.test(a)), description: 'List/get/create/delete InstaBox snapshots. create needs machineId and input.name,description?,rootOnly?. get/delete use input.snapshotId. Delete requires input.confirm exactly equal to snapshotId. To restore create a new machine from that snapshot using instabox_machine machines.create input.snapshotId. Call instabox_help for the exact schema.'},
  {name: 'instabox_network', actions: ACTIONS.filter(a => /^(ports|ssh)\./.test(a)), description: 'Manage remote machine ports and issue SSH credentials. ports.list/publish/unpublish; publishing needs input.port (1024..65535; reserved ports refused), access:private|public (default private), name?,rotateToken?. Private publishes a token-protected HTTPS URL; public deliberately exposes it. ssh.credentials needs input.publicKey,ttlSeconds?; do not generate or send a private SSH key. All operations are scoped to the canonical remote m_ machine ID. Call instabox_help for exact fields.'},
] as const

export function registerTools(ctx: Context, service: InstaboxService): void {
  const pending = new Map<ToolExecutionToken, {agent: Agent; images: {jobId: string; attachment: ImageAttachmentRef}[]}>()
  ctx.effect(() => () => pending.clear(), 'instabox: nested image receipts')
  const imageCache = new Map<string, ImageAttachmentRef>()
  const fileCache = new Map<string, FileAttachmentRef>()
  ctx.effect(() => () => { imageCache.clear(); fileCache.clear() })
  const prepare = async (job: JobView, signal: AbortSignal): Promise<any> => {
    signal.throwIfAborted()
    if (job.status !== 'succeeded') return job
    const raw = job.result as any
    if (job.action === 'desktop.screenshot' && raw?.mimeType === 'image/png' && typeof raw.base64 === 'string') {
      let attachment = imageCache.get(job.jobId)
      if (!attachment) {
        attachment = await ctx.attachments.saveImage({data: Buffer.from(raw.base64, 'base64'), mediaType: 'image/png', name: `instabox-${job.machineId ?? 'desktop'}.png`})
        imageCache.set(job.jobId, attachment)
        if (imageCache.size > 128) imageCache.delete(imageCache.keys().next().value!)
      }
      return {...job, result: {image: attachment, screenWidth: raw.width ?? attachment.width, screenHeight: raw.height ?? attachment.height, coordinateSystem: 'Use original screen pixels (screenWidth/screenHeight) for click/move/drag. The attached image may have been downscaled by DSH; scale coordinates accordingly.'}}
    }
    if (job.action === 'files.read' && raw?.format === 'base64' && typeof raw.content === 'string') {
      let attachment = fileCache.get(job.jobId)
      if (!attachment) {
        attachment = await ctx.attachments.saveFile({data: Buffer.from(raw.content, 'base64'), name: String(raw.path ?? 'download').split('/').at(-1) || 'download'})
        fileCache.set(job.jobId, attachment)
        if (fileCache.size > 128) fileCache.delete(fileCache.keys().next().value!)
      }
      return {...job, result: {file: attachment}}
    }
    if (job.action.startsWith('control.') || ['desktop.takeover', 'desktop.handback', 'desktop.view'].includes(job.action)) {
      const {url: _url, ownerId: _owner, ...safe} = raw ?? {}
      return {...job, result: safe}
    }
    return job
  }
  const output = {
    schema: {type: 'object' as const, additionalProperties: true as const},
    render: (_args: any, value: any): ContentBlock[] => {
      const result = value.result
      const content: ContentBlock[] = [{type: 'text', text: JSON.stringify(value)}]
      if (result?.image) content.push({type: 'image', attachment: result.image as ImageAttachmentRef})
      if (result?.file) content.push({type: 'file', attachment: result.file as FileAttachmentRef})
      return content
    },
    presentationMeta: (_args: any, value: any) => ({instabox: value}),
  }
  ctx.tools.register(defineTool({
    name: 'instabox_help', description: 'Get the exact validated input JSON Schema for an InstaBox action before constructing its input object. These are remote operations; machineId is separate from input and always a canonical m_ ID. Human-only viewer/takeover controls are not exposed to models.',
    parameters: {action: {type: 'string', enum: Object.keys(ACTION_INPUT_SCHEMAS).filter(action => !['desktop.takeover', 'desktop.handback', 'desktop.view', 'desktop.revoke'].includes(action)), required: true}},
    output,
    async execute({action}, exec): Promise<any> {
      exec.signal.throwIfAborted()
      if (!service.current().modelToolsEnabled) throw new RuntimeError('Instabox 模型工具已关闭。')
      const schema = ACTION_INPUT_SCHEMAS[action]
      if (!schema || ['desktop.takeover', 'desktop.handback', 'desktop.view', 'desktop.revoke'].includes(action)) throw new RuntimeError('此操作仅由用户面板管理。')
      // Zod attaches non-enumerable ~standard function metadata to the schema
      // object. DSH's lossless-JSON output boundary correctly rejects that
      // object; publish only the actual JSON Schema document.
      return {action, inputSchema: JSON.parse(JSON.stringify(z.toJSONSchema(schema)))}
    },
  }))
  for (const group of GROUPS) ctx.tools.register(defineTool({
    name: group.name, description: group.description,
    parameters: {
      action: {type: 'string', enum: group.actions, required: true, description: 'Exact supported remote action name.'},
      machineId: {type: 'string', description: 'Remote machine ID; required for machine-scoped actions.'},
      input: {type: 'object', additionalProperties: true, description: 'Action-specific fields. See the tool description; unknown fields are refused.'},
    }, output,
    async execute(args, exec) {
      try {
        const request = args as ActionRequest
        const job = await service.executeAgent(request, exec.signal, exec.agent?.session.id, exec.agent?.status === 'running')
        return await prepare(job, exec.signal)
      } catch (error) { throw new RuntimeError(safeError(error)) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'instabox_task',
    description: 'Poll an accepted plugin task returned by another InstaBox tool. action:get needs jobId. action:list lists recent plugin tasks; this is different from remote command jobs.list. action:control returns whether a user is controlling machineId. Never repeat a mutation merely because its plugin task is still running. While human takeover is active, wait for the user to hand back control.',
    parameters: {action: {type: 'string', enum: ['get', 'list', 'control'], required: true}, jobId: {type: 'string'}, machineId: {type: 'string'}}, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      if (!service.current().modelToolsEnabled) throw new RuntimeError('Instabox 模型工具已关闭。')
      if (args.action === 'list') return {tasks: service.runtime.listJobs().map(({result: _result, ...job}) => job)}
      if (args.action === 'control') {
        if (!args.machineId) throw new RuntimeError('请提供 machineId。', 'bad_request')
        const {url: _url, ownerId: _owner, ...view} = service.runtime.control(args.machineId)
        return {control: view}
      }
      if (!args.jobId) throw new RuntimeError('请提供 jobId。', 'bad_request')
      return prepare(service.runtime.getJob(args.jobId), exec.signal)
    },
  }))
  // PTC sub-call content is not put in model history by rc.5. Publish a durable
  // screenshot only after both nested dispatch and enclosing call succeeded.
  ctx.on('tools/result', (exec, result) => {
    const collected = pending.get(exec.token)
    pending.delete(exec.token)
    if (collected && !result.isError && !exec.signal.aborted && exec.agent === collected.agent) {
      for (const receipt of collected.images) collected.agent.inject(createUserMessage({source: {kind: 'instabox-screen', jobId: receipt.jobId}, content: [{type: 'image', attachment: receipt.attachment}]}))
    }
    if (!exec.parent || !exec.agent || result.isError || exec.signal.aborted || !['instabox_desktop', 'instabox_task'].includes(exec.name)) return
    const receipt = (result.meta as any)?.instabox
    const attachment = receipt?.result?.image
    if (!attachment || !result.content.some(block => block.type === 'image' && block.attachment.attachmentId === attachment.attachmentId)) return
    const group = pending.get(exec.parent) ?? {agent: exec.agent, images: []}
    if (group.agent !== exec.agent) return
    group.images.push({jobId: receipt.jobId, attachment})
    pending.set(exec.parent, group)
  })
  ctx.on('agent/disposed', ({agent}) => { for (const [key, group] of pending) if (group.agent === agent) pending.delete(key) })
}

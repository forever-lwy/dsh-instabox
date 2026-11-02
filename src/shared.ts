import { z } from 'zod'

export const ACTIONS = [
  'account.me', 'account.usage', 'templates.list',
  'machines.list', 'machines.get', 'machines.create', 'machines.update',
  'machines.start', 'machines.stop', 'machines.suspend', 'machines.resume', 'machines.delete',
  'machines.fork', 'machines.logs', 'machines.disk',
  'operations.get', 'commands.run', 'jobs.list', 'jobs.get', 'jobs.kill',
  'files.list', 'files.read', 'files.write', 'files.remove',
  'desktop.start', 'desktop.status', 'desktop.screenshot', 'desktop.click', 'desktop.move',
  'desktop.drag', 'desktop.scroll', 'desktop.type', 'desktop.press', 'desktop.open',
  'desktop.cursor', 'desktop.view', 'desktop.revoke', 'desktop.takeover', 'desktop.handback',
  'snapshots.list', 'snapshots.get', 'snapshots.create', 'snapshots.delete',
  'ports.list', 'ports.publish', 'ports.unpublish', 'ssh.credentials', 'metrics.get', 'usage.get',
  'control.take', 'control.release', 'control.status', 'control.renew',
] as const
export type Action = typeof ACTIONS[number]
export const actionSchema = z.object({
  action: z.enum(ACTIONS), machineId: z.string().trim().regex(/^m_[A-Za-z0-9_-]+$/, '请填写列表中的机器 ID（m_…）').max(160).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  clientId: z.string().min(1).max(160).optional(),
}).strict()
export type ActionRequest = z.infer<typeof actionSchema>
export const configSchema = z.object({
  apiKeyRef: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/).default('INSTABOX_API_KEY'),
  defaultTemplate: z.string().trim().min(1).max(160).default('agent-browser'),
  requestTimeoutMs: z.number().int().min(5000).max(120000).default(45000),
  modelToolsEnabled: z.boolean().default(true),
  desktopPlacement: z.enum(['inline', 'sidebar']).default('inline'),
}).strict()
export type ConfigData = z.infer<typeof configSchema>
export const defaultConfig = (): ConfigData => configSchema.parse({})
export const settingsViewSchema = z.object({
  config: configSchema, revision: z.number().int().nonnegative(),
  credential: z.object({configured: z.boolean(), writable: z.boolean()}),
})
export type SettingsView = z.infer<typeof settingsViewSchema>
export const saveSettingsSchema = z.object({
  config: configSchema, expectedRevision: z.number().int().nonnegative(),
  apiKey: z.string().trim().min(1).max(16384).optional(), clearApiKey: z.boolean().optional(),
}).strict()
export type SaveSettingsRequest = z.infer<typeof saveSettingsSchema>
export const jobViewSchema = z.object({
  jobId: z.string(), action: z.enum(ACTIONS), machineId: z.string().optional(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  createdAt: z.number(), updatedAt: z.number(), result: z.unknown().optional(), error: z.string().optional(),
})
export type JobView = z.infer<typeof jobViewSchema>
export const getJobSchema = z.object({jobId: z.string().min(1).max(160)}).strict()
export const controlViewSchema = z.object({
  machineId: z.string(), mode: z.enum(['agent', 'human']), ownerId: z.string().optional(), since: z.number().optional(), expiresAt: z.number().optional(), url: z.string().optional(), pendingCleanup: z.boolean().optional(),
})
export type ControlView = z.infer<typeof controlViewSchema>
export const activityRequestSchema = z.object({sessionId: z.string().min(1).max(256)}).strict()
export const activityMachineSchema = z.object({
  machineId: z.string().regex(/^m_[A-Za-z0-9_-]+$/).max(160), name: z.string().optional(),
  phase: z.enum(['busy', 'idle', 'inactive']), lastAction: z.enum(ACTIONS),
  updatedAt: z.number(), pendingJobs: z.number().int().nonnegative(),
  backgroundRunning: z.boolean(), machineState: z.string().optional(),
})
export type ActivityMachine = z.infer<typeof activityMachineSchema>
export const activityViewSchema = z.object({sessionId: z.string(), revision: z.number().int().nonnegative(), machines: z.array(activityMachineSchema)})
export type ActivityView = z.infer<typeof activityViewSchema>
export interface ScreenshotResult {mimeType: 'image/png'; base64: string; width?: number; height?: number}
export interface FileReadResult {path: string; format: 'text' | 'base64'; content: string}

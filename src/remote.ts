import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import { actionSchema, settingsViewSchema, saveSettingsSchema, jobViewSchema, getJobSchema } from './shared.js'
import type { ActionRequest, SettingsView, SaveSettingsRequest, JobView } from './shared.js'
const codec = (schema: z.ZodType, typeSymbol: string) => ({mode: 'strict' as const, typeSymbol, create: () => schema})
const method = (input: z.ZodType, output: z.ZodType) => ({
  service: 'instabox', invocation: {kind: 'direct' as const},
  parameters: [{name: 'request', source: 'json' as const, codec: codec(input, 'InstaboxRequest'), strictCodec: codec(input, 'InstaboxRequest')}],
  result: codec(output, 'InstaboxResult'), cancellation: {parameter: 'signal' as const},
})
export const remoteInfo = createTypertRemoteInfo({package: 'dsh-instabox', methods: {
  'instabox/getSettings': method(z.object({}).strict(), settingsViewSchema),
  'instabox/saveSettings': method(saveSettingsSchema, settingsViewSchema),
  'instabox/execute': method(actionSchema, jobViewSchema),
  'instabox/getJob': method(getJobSchema, jobViewSchema),
}}, z)
async function invoke<T>(remote: any, key: string, request: unknown, signal?: AbortSignal): Promise<T> {
  const result = await (remoteInfo.methods as any)[key].invoke(remote, {request}, signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
export const getSettings = (remote: any, signal?: AbortSignal) => invoke<SettingsView>(remote, 'instabox/getSettings', {}, signal)
export const saveSettings = (remote: any, request: SaveSettingsRequest, signal?: AbortSignal) => invoke<SettingsView>(remote, 'instabox/saveSettings', request, signal)
export const execute = (remote: any, request: ActionRequest, signal?: AbortSignal) => invoke<JobView>(remote, 'instabox/execute', request, signal)
export const getJob = (remote: any, request: {jobId: string}, signal?: AbortSignal) => invoke<JobView>(remote, 'instabox/getJob', request, signal)

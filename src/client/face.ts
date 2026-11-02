import type { ActionRequest, JobView, SaveSettingsRequest, SettingsView } from '../shared.js'

export interface InstaboxFace {
  read(signal?: AbortSignal): Promise<SettingsView>
  save(request: SaveSettingsRequest, signal?: AbortSignal): Promise<SettingsView>
  execute(request: ActionRequest, signal?: AbortSignal): Promise<JobView>
  getJob(request: {jobId: string}, signal?: AbortSignal): Promise<JobView>
}
export const settled = (job: JobView) => !['queued', 'running'].includes(job.status)

/** Each HTTP request is short; waiting for a cloud operation never occupies a
 * single Gateway request. Aborting the UI stops polling, not a submitted job. */
export async function waitForJob(face: InstaboxFace, initial: JobView, signal: AbortSignal,
  update?: (job: JobView) => void, delayMs = 1000): Promise<JobView> {
  let job = initial
  update?.(job)
  while (!settled(job)) {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve() }
      const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('已取消')) }
      const timer = setTimeout(done, delayMs)
      signal.addEventListener('abort', abort, {once: true})
      if (signal.aborted) abort()
    })
    job = await face.getJob({jobId: job.jobId}, signal)
    update?.(job)
  }
  signal.throwIfAborted()
  if (job.status !== 'succeeded') throw new Error(job.error || (job.status === 'cancelled' ? '任务已取消。' : '云端操作失败。'))
  return job
}

export function listOf(value: unknown, ...keys: string[]): any[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as any[]
  return []
}
export const pretty = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
export const machineIdOf = (machine: any): string => String(machine?.id ?? machine?.sandboxId ?? machine?.machine?.id ?? '')
export function viewerUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('桌面服务没有返回有效链接。')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'instabox.sh' || url.hostname.endsWith('.instabox.sh'))) {
    throw new Error('已拒绝非官方 InstaBox HTTPS 桌面链接。')
  }
  return url.href
}
export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
  return btoa(chunks.join(''))
}
export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value), bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

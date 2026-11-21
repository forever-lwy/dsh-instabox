import { basename, dirname, join, sep } from 'node:path'
import { readMirrorRecord, type MirrorRecord } from './workspace.js'

/** The mirror root every cloud Workspace lives under; a Session whose cwd
 * resolves inside it is bound to one cloud directory. */
export function workspaceRoot(dshHome: string): string {
  // join drops a trailing separator, so a DSH_HOME of `C:\Users\me\.dsh\`
  // still matches the realpath cwd the host records.
  return join(dshHome, 'storages', 'instabox', 'workspaces')
}

/** True when `cwd` names a directory inside the cloud mirror root. Comparison
 * is case-insensitive on Windows, where the recorded cwd may differ in case. */
export function insideWorkspaceRoot(root: string, cwd: string): boolean {
  if (!cwd) return false
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
  const base = normalize(root).replace(/[\\/]+$/, '')
  const target = normalize(cwd).replace(/[\\/]+$/, '')
  return target === base || target.startsWith(base + sep) || target.startsWith(base + '/')
}

/** Resolve the cloud binding of a Session from its working directory alone.
 * Mirrors are written with the cloud path in their meta file, so the directory
 * is the only state this needs; a directory without a usable meta file simply
 * yields nothing and the Session behaves like any other local Session. */
export async function bindingForCwd(root: string, cwd: string | undefined): Promise<MirrorRecord | undefined> {
  if (!cwd || !insideWorkspaceRoot(root, cwd)) return undefined
  // Try the cwd itself first, then each ancestor up to the mirror root, so a
  // Session started in a subdirectory of the mirror still resolves.
  let current = cwd.replace(/[\\/]+$/, '')
  const base = root.replace(/[\\/]+$/, '')
  for (;;) {
    const record = await readMirrorRecord(current)
    if (record) return record
    if (!insideWorkspaceRoot(base, dirname(current)) || current === base) return undefined
    current = dirname(current)
    if (basename(current) === '') return undefined
  }
}

/** Model-facing context for a Session bound to a cloud directory. The local
 * cwd is only an identifier, so this states the real location and the tool that
 * reaches it; without it the model reads an empty local mirror. */
export function cloudContextText(record: MirrorRecord): string {
  return [
    `This Session's working directory is a placeholder for a directory on an Instabox cloud machine: ${record.remotePath}`,
    `machine ID: ${record.machineId}.`,
    'The local directory contains only a small metadata file and holds none of the project files.',
    'Use the `instabox` tool for every cloud file and command operation, for example '
      + `{"action":"files.list","machineId":"${record.machineId}","input":{"path":"${record.remotePath}"}} `
      + `or {"action":"commands.run","machineId":"${record.machineId}","input":{"cmd":"ls","cwd":"${record.remotePath}"}}.`,
    'Local tools read this empty mirror, so a missing file here does not mean it is missing on the cloud machine.',
  ].join(' ')
}

import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { posix as cloudPath, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { workspaceBindSchema, type WorkspaceBindRequest, type WorkspaceView } from './shared.js'

/** Every mirror carries this file; it is the only record of which cloud
 * directory a DSH Workspace stands for. The directory itself stays empty. */
export const MIRROR_META_FILE = 'instabox.mirror.json'

export class WorkspaceError extends Error {
  constructor(message: string, readonly code = 'invalid_input') { super(message); this.name = 'InstaboxWorkspaceError' }
}

/** A filesystem-safe segment for one remote path component. Cloud names may
 * contain characters Windows rejects, so anything outside a small allowlist
 * becomes `_`; the exact cloud path lives in the meta file, never in the name. */
function segment(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 64)
  return cleaned || 'dir'
}

/** The local directory that stands for one cloud directory: one per machine
 * and leaf name. The `instabox-` prefix keeps a cloud Workspace readable
 * beside local folders in the sidebar.
 *
 * A directory found here is reused only when its meta file records the SAME
 * cloud path; two different cloud paths that happen to share a leaf name
 * (`/data/home/a` and `/mnt/x/a`) are told apart in `bindMirror`, which adds a
 * numeric suffix when the existing mirror belongs to another path. */
export function mirrorRootFor(root: string, machineId: string, remotePath: string): string {
  const target = cloudPath.resolve('/', String(remotePath).trim()).replace(/\/+$/, '') || '/'
  const parts = target.split('/').filter(Boolean)
  const last = parts.length ? parts[parts.length - 1] : 'root'
  return join(root, String(machineId).replace(/[^A-Za-z0-9_-]+/g, '_'), segment(`instabox-${last}`))
}

export interface MirrorRecord {kind: 'instabox'; machineId: string; remotePath: string; createdAt: string}

/** The binding a mirror records, or undefined when the path is not an Instabox
 * mirror. Reading is best-effort: a missing or unreadable meta file means the
 * directory carries no cloud identity, never that the Session is broken. */
export async function readMirrorRecord(localPath: string): Promise<MirrorRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(join(localPath, MIRROR_META_FILE), 'utf8'))
    if (value?.kind !== 'instabox' || typeof value.machineId !== 'string' || typeof value.remotePath !== 'string') return undefined
    return {kind: 'instabox', machineId: value.machineId, remotePath: value.remotePath, createdAt: String(value.createdAt ?? '')}
  } catch { return undefined }
}

/** Create (or reuse) the local mirror that represents one cloud directory and
 * write its identifier file. Returns the absolute local path the host adopts
 * as a Workspace; nothing is downloaded, so the directory holds no files.
 *
 * The same cloud directory always maps to the same local name. When that name
 * is already taken by a mirror of a DIFFERENT cloud path — two directories
 * that share a leaf name — the next free numeric suffix is used instead, so
 * neither mirror is mistaken for the other and no existing Workspace is
 * disturbed. */
export async function bindMirror(root: string, request: WorkspaceBindRequest): Promise<WorkspaceView> {
  const parsed = workspaceBindSchema.safeParse(request)
  if (!parsed.success) throw new WorkspaceError(parsed.error.issues.map(issue => issue.path.join('.') || 'input').join('、'))
  const {machineId} = parsed.data
  const remotePath = cloudPath.resolve('/', parsed.data.remotePath).replace(/\/+$/, '') || '/'
  if (!/^m_[A-Za-z0-9_-]+$/.test(machineId)) throw new WorkspaceError('机器 ID 无效。')
  const base = mirrorRootFor(root, machineId, remotePath)
  const claimed = await claimMirror(base, remotePath)
  if (!claimed.created) return {machineId, remotePath, localPath: claimed.localPath, created: false}
  const record: MirrorRecord = {kind: 'instabox', machineId, remotePath, createdAt: new Date().toISOString()}
  const metaPath = join(claimed.localPath, MIRROR_META_FILE)
  const temp = join(claimed.localPath, `.${MIRROR_META_FILE}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, JSON.stringify(record, null, 2) + '\n', {mode: 0o600, flag: 'wx'})
    await rename(temp, metaPath)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
  return {machineId, remotePath, localPath: claimed.localPath, created: true}
}

/** Occupy one local mirror directory without letting a concurrent bind of a
 * different cloud path reuse it. `mkdir` without `recursive` fails if the
 * directory already exists, so exactly one caller owns a new directory; the
 * other reads its meta file and either reuses a matching path or takes the
 * next suffix. A directory that exists but has no meta yet is left alone. */
async function claimMirror(base: string, remotePath: string): Promise<{localPath: string; created: boolean}> {
  await mkdir(dirname(base), {recursive: true, mode: 0o700})
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`
    try {
      await mkdir(candidate, {recursive: false, mode: 0o700})
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error
      const record = await readMirrorRecord(candidate)
      if (record?.remotePath === remotePath) return {localPath: candidate, created: false}
      continue
    }
    return {localPath: candidate, created: true}
  }
  throw new WorkspaceError('同名云机目录过多，请先删除本机不再使用的工作区。', 'mirror_name_exhausted')
}

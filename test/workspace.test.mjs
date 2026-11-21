import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceBindSchema } from '../lib/shared.js'
import { bindingForCwd, workspaceRoot } from '../lib/session-context.js'
import { bindMirror, readMirrorRecord } from '../lib/workspace.js'

test('concurrent binds of different cloud paths that share a leaf do not share one mirror', async () => {
  const root = await mkdtemp(join(tmpdir(), 'instabox-mirror-race-'))
  try {
    const [a, b] = await Promise.all([
      bindMirror(root, { machineId: 'm_confirmtest', remotePath: '/data/home/app' }),
      bindMirror(root, { machineId: 'm_confirmtest', remotePath: '/mnt/other/app' }),
    ])
    assert.notEqual(a.localPath, b.localPath)
    assert.equal((await readMirrorRecord(a.localPath)).remotePath, '/data/home/app')
    assert.equal((await readMirrorRecord(b.localPath)).remotePath, '/mnt/other/app')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('binding a cloud directory keeps a trailing space in the path', () => {
  const parsed = workspaceBindSchema.parse({ machineId: 'm_confirmtest', remotePath: '/data/home/app ' })
  assert.equal(parsed.remotePath, '/data/home/app ')
})

test('a trailing separator on DSH_HOME still resolves the realpath cwd', async () => {
  const home = await mkdtemp(join(tmpdir(), 'instabox-home-'))
  const root = workspaceRoot(`${home}\\`)
  const mirror = join(root, 'm_confirmtest', 'instabox-app')
  await mkdir(mirror, { recursive: true })
  await writeFile(join(mirror, 'instabox.mirror.json'), JSON.stringify({
    kind: 'instabox', machineId: 'm_confirmtest', remotePath: '/data/home/app', createdAt: 'now',
  }))
  const record = await bindingForCwd(root, await realpath(mirror))
  assert.equal(record && record.remotePath, '/data/home/app')
  await rm(home, { recursive: true, force: true })
})

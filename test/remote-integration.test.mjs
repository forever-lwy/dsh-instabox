import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { apply as installRemote } from '@deepseek-ai/dsh-api-gateway/client'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { z } from 'zod'
import { ConfigStore } from '../lib/store.js'
import { InstaboxService } from '../lib/service.js'
import { remoteInfo, getSettings, saveSettings, execute, getJob, getActivity } from '../lib/remote.js'

test('real rc.5 HTTP gateway carries settings and asynchronous jobs without returning credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'instabox-remote-'))
  const host = new Context(), client = new Context()
  t.after(async () => { await client.fiber.dispose(); await host.fiber.dispose(); await rm(directory, {recursive: true, force: true}) })
  new TypertRegistry(host)
  new TypertRegistry(client)
  new HostConnectionService(host, [], {})
  host.provide('remoteAccess', {decide: () => { throw new Error('owner should bypass policy') }})
  new TypertGatewayService(host, {})
  const peer = host.connection.createPeer({principal: {kind: 'owner'}, interactions: 'none'})
  const credentials = new Map()
  host.provide('credentials', {
    describe: async ref => ({configured: credentials.has(ref), writable: true}),
    resolve: async ref => credentials.has(ref) ? {value: credentials.get(ref)} : undefined,
    set: async (ref, value) => { credentials.set(ref, value) }, unset: async ref => { credentials.delete(ref) },
  })
  const calls = []
  const store = new ConfigStore(join(directory, 'settings.json'))
  await store.load()
  const service = new InstaboxService(host, store, {apiFactory: async () => ({
    async execute(request) { calls.push(request); return {machines: [{id: 'm_test', name: 'test', state: 'running'}]} },
  })})
  host.typert.remotes.register(remoteInfo)
  const handler = host.connection.createSharedFetchHandler('/api')
  const routes = []
  installConnection(client, {interactions: 'none', transport: {
    async fetch(url, init) {
      const request = new Request(new URL(url, 'http://localhost/'), init)
      routes.push(new URL(request.url).pathname)
      return handler.fetch(request, peer)
    },
    openStream() { throw new Error('only unary calls expected') },
  }})
  installRemote(client)
  const unmount = await client.remote.$mount(remoteInfo)
  t.after(unmount)
  const before = await getSettings(client.remote)
  assert.equal(before.credential.configured, false)
  const secret = 'ibk_synthetic_test_key_never_return'
  const saved = await saveSettings(client.remote, {config: before.config, expectedRevision: before.revision, apiKey: secret})
  assert.equal(saved.credential.configured, true)
  assert.equal(JSON.stringify(saved).includes(secret), false)
  assert.equal((await readFile(store.path, 'utf8')).includes(secret), false)
  await assert.rejects(saveSettings(client.remote, {config: before.config, expectedRevision: before.revision, apiKey: 'ibk_should_not_replace_existing_key'}), /其他窗口/)
  assert.deepEqual([...credentials.values()], [secret])
  let job = await execute(client.remote, {action: 'machines.list', input: {}})
  for (let index = 0; ['queued', 'running'].includes(job.status) && index < 20; index++) {
    await new Promise(resolve => setImmediate(resolve))
    job = await getJob(client.remote, {jobId: job.jobId})
  }
  assert.equal(job.status, 'succeeded', job.error)
  assert.equal(job.result.machines[0].id, 'm_test')
  assert.equal(calls.length, 1)
  await assert.rejects(execute(client.remote, {action: 'desktop.click', machineId: 'alias-bypasses-lock', input: {x: 1, y: 2}}))
  assert.ok(routes.includes('/api/instabox/getSettings'))
  assert.ok(routes.includes('/api/instabox/saveSettings'))
  assert.ok(routes.includes('/api/instabox/execute'))
  unmount()

  // Load exactly the built browser module, with only the host's browser imports.
  // Any accidental SDK, filesystem or credential dependency fails this test.
  const definitions = []
  const styleNodes = []
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {__ModuleLoader__: {load: definition => definitions.push(definition)}},
    document: {createElement: () => ({dataset: {}, remove() {}}), head: {appendChild: node => styleNodes.push(node)}},
    URL, AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval,
  })
  assert.equal(definitions.length, 1)
  const dependencies = {react: React, 'react/jsx-runtime': jsxRuntime, 'react-dom': ReactDOM, zod: {z}, '@deepseek-ai/cordis': {Context}}
  const plugin = definitions[0].factory(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `unexpected browser import ${specifier}`)
    return dependencies[specifier]
  })
  const registrations = []
  client.provide('slots', {
    inject: (_slot, callback) => callback(),
    register: (options, component) => { registrations.push({options, component}); return () => {} },
  })
  client.provide('layout', {selectPanel: () => {}, panelInfo: {getSnapshot: () => ({activePanelId: null})}})
  client.provide('locale', {register: () => () => {}, bind: () => key => key})
  await client.plugin(plugin)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(registrations.some(item => item.options.name === 'main' && item.options.key === 'instabox'))
  assert.ok(registrations.some(item => item.options.name === 'sidebar.panellist'))
  assert.ok(registrations.some(item => item.options.name === 'settings.section'))
  const browserFace = registrations.find(item => item.options.name === 'main').options.inject().face
  const browserSettings = await browserFace.read()
  assert.equal(browserSettings.credential.configured, true)
  assert.equal(JSON.stringify(browserSettings).includes(secret), false)
  let browserJob = await browserFace.execute({action: 'machines.list', input: {}})
  for (let index = 0; ['queued', 'running'].includes(browserJob.status) && index < 20; index++) {
    await new Promise(resolve => setImmediate(resolve))
    browserJob = await browserFace.getJob({jobId: browserJob.jobId})
  }
  assert.equal(browserJob.status, 'succeeded', browserJob.error)
  assert.equal(browserJob.result.machines[0].id, 'm_test')
  assert.equal(calls.length, 2)
  await service.executeAgent({action:'commands.run',machineId:'m_test',input:{cmd:'must-not-enter-preview-metadata'}},new AbortController().signal,'session-a',true)
  const activity=await getActivity(client.remote,{sessionId:'session-a'})
  assert.equal(activity.sessionId,'session-a')
  assert.equal(activity.machines[0].machineId,'m_test')
  assert.equal(activity.machines[0].phase,'busy')
  assert.equal(JSON.stringify(activity).includes('must-not-enter-preview-metadata'),false)
  assert.equal(JSON.stringify(activity).includes(secret),false)
  assert.deepEqual((await browserFace.getActivity({sessionId:'session-b'})).machines,[])
  host.emit('agent/status',{agent:{session:{id:'session-a'}},status:'idle'})
  assert.equal((await browserFace.getActivity({sessionId:'session-a'})).machines[0].phase,'idle')
  const placement=await browserFace.save({config:{...browserSettings.config,desktopPlacement:'sidebar'},expectedRevision:browserSettings.revision})
  assert.equal(placement.config.desktopPlacement,'sidebar')
  assert.equal((await browserFace.read()).config.desktopPlacement,'sidebar')
  assert.ok(routes.includes('/api/instabox/getActivity'))
})

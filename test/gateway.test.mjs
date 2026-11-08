import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { registerTools, MODEL_ACTIONS, INSTABOX_DESCRIPTION } from '../lib/tools.js'
import { configSchema } from '../lib/shared.js'

const signal = () => new AbortController().signal
const defaultConfig = () => configSchema.parse({})

function setup(service) {
  const ctx = new Context()
  const tools = new Map()
  ctx.provide('tools', { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } })
  registerTools(ctx, service)
  return { ctx, tools }
}

test('one small resident tool replaces the eight group tools', async t => {
  const { ctx, tools } = setup({ current: defaultConfig })
  t.after(() => ctx.fiber.dispose())
  assert.deepEqual([...tools.keys()], ['instabox'])
  const def = tools.get('instabox')
  const size = JSON.stringify({ name: def.name, description: def.description, parameters: def.parameters }).length
  assert.ok(size < 1800, `instabox definition grew to ${size} chars`)
  assert.ok(INSTABOX_DESCRIPTION.includes('REMOTE'))
  assert.ok(!MODEL_ACTIONS.some(a => a.startsWith('control.') || ['desktop.takeover', 'desktop.handback', 'desktop.view', 'desktop.revoke'].includes(a)))
})

test('help discloses the action list, schemas and family rules on demand', async t => {
  const { ctx, tools } = setup({ current: defaultConfig })
  t.after(() => ctx.fiber.dispose())
  const tool = tools.get('instabox')
  const all = await tool.execute({ action: 'help' }, { signal: signal() })
  assert.ok(all.actions.includes('commands.run') && all.actions.includes('task.get'))
  const files = await tool.execute({ action: 'help', input: { action: 'files.remove' } }, { signal: signal() })
  assert.match(files.rules, /input\.confirm exactly equal to input\.path/)
  assert.ok(files.inputSchema)
  await assert.rejects(tool.execute({ action: 'help', input: { action: 'desktop.takeover' } }, { signal: signal() }), /用户面板/)
  await assert.rejects(tool.execute({ action: 'files.delete' }, { signal: signal() }), /files\.list, files\.read, files\.write, files\.remove/)
})

test('remote actions and plugin tasks route through the single tool', async t => {
  const calls = []
  const service = {
    current: defaultConfig,
    executeAgent: async (...args) => { calls.push(args); return { jobId: 'j1', action: args[0].action, status: 'running', createdAt: 0, updatedAt: 0 } },
    runtime: { listJobs: () => [{ jobId: 'j1', result: { secret: 1 } }], getJob: () => ({ jobId: 'j1', action: 'machines.list', status: 'succeeded', createdAt: 0, updatedAt: 0, result: [] }),
      control: () => ({ controlled: false, url: 'hidden', ownerId: 'hidden' }) },
  }
  const { ctx, tools } = setup(service)
  t.after(() => ctx.fiber.dispose())
  const tool = tools.get('instabox')
  await tool.execute({ action: 'commands.run', machineId: 'm_abc', input: { cmd: 'ls' } }, { signal: signal(), agent: { session: { id: 's1' }, status: 'running' } })
  assert.deepEqual(calls[0].slice(0, 4).map(v => v instanceof AbortSignal ? 'signal' : v), [{ action: 'commands.run', machineId: 'm_abc', input: { cmd: 'ls' } }, 'signal', 's1', true])
  assert.deepEqual(await tool.execute({ action: 'task.list' }, { signal: signal() }), { tasks: [{ jobId: 'j1' }] })
  assert.equal((await tool.execute({ action: 'task.get', jobId: 'j1' }, { signal: signal() })).status, 'succeeded')
  assert.deepEqual(await tool.execute({ action: 'task.control', machineId: 'm_abc' }, { signal: signal() }), { control: { controlled: false } })
})

test('disabling model tools unregisters the tool; enabling registers it again', async t => {
  let config = defaultConfig()
  const listeners = new Set()
  const service = { current: () => config, onSaved: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
  const { ctx, tools } = setup(service)
  t.after(() => ctx.fiber.dispose())
  assert.ok(tools.has('instabox'))
  config = { ...config, modelToolsEnabled: false }
  for (const fn of listeners) fn()
  assert.equal(tools.has('instabox'), false)
  config = { ...config, modelToolsEnabled: true }
  for (const fn of listeners) fn()
  assert.ok(tools.has('instabox'))
})

test('a plugin started with model tools off registers nothing', async t => {
  const { ctx, tools } = setup({ current: () => ({ ...defaultConfig(), modelToolsEnabled: false }) })
  t.after(() => ctx.fiber.dispose())
  assert.equal(tools.size, 0)
})

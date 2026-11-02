import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {TypertRegistry} from '@deepseek-ai/dsh-typert-registry'
import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt'
import {ToolRuntime} from '@deepseek-ai/dsh-tools'
import * as Plugin from '../lib/index.js'

test('actual plugin activates and removes its tools and RPC service under the shipped rc.5 runtimes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'instabox-activation-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = directory
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(directory, {recursive: true, force: true})
  })
  new TypertRegistry(ctx)
  new SystemPrompt(ctx, {includeHarnessIdentity: false, includeRuntimeContext: false})
  new ToolRuntime(ctx)
  ctx.provide('credentials', {describe: async () => ({configured: false, writable: true}), resolve: async () => undefined})
  ctx.provide('attachments', {saveImage: async () => {throw new Error('activation must not generate screenshots')}})
  const toolNames = ['instabox_machine', 'instabox_command', 'instabox_file', 'instabox_desktop', 'instabox_snapshot', 'instabox_network', 'instabox_task', 'instabox_help']
  for (let cycle = 0; cycle < 2; cycle++) {
    const fiber = await ctx.plugin(Plugin)
    await fiber.await()
    assert.equal(fiber.state, 2)
    assert.ok(ctx.get('instabox'))
    for (const name of toolNames) assert.ok(ctx.tools.get(name), name)
    const help = await ctx.tools.execute({callId: 'activation-help', name: 'instabox_help', arguments: {action: 'desktop.drag'}, signal: new AbortController().signal})
    assert.equal(help.isError, false, JSON.stringify(help))
    assert.ok(help.content.some(block => block.type === 'text' && block.text.includes('from')))
    const methods = ctx.typert.remotes
    assert.ok(methods)
    await fiber.dispose()
    assert.equal(ctx.get('instabox'), undefined)
    for (const name of toolNames) assert.equal(ctx.tools.get(name), undefined, name)
  }
})

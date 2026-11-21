import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ConfigStore } from './store.js'
import { InstaboxService } from './service.js'
import { registerTools } from './tools.js'
import { remoteInfo } from './remote.js'
import { bindingForCwd, cloudContextText, workspaceRoot } from './session-context.js'

export const name = 'dsh-instabox'
export const inject = ['credentials', 'typert', 'tools', 'attachments', 'systemPrompt']
export { InstaboxService } from './service.js'
export { InstaboxRuntime } from './runtime.js'
export { ConfigStore } from './store.js'
export async function apply(ctx: Context): Promise<void> {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const store = new ConfigStore(join(home, 'storages', 'instabox', 'settings.json'))
  await store.load()
  const service = new InstaboxService(ctx, store)
  ctx.typert.remotes.register(remoteInfo)
  registerTools(ctx, service)
  installSessionContext(ctx, workspaceRoot(home))
}

/** Tell a Session bound to a cloud directory where its files really live.
 *
 * The Workspace picker adopts a local mirror, so the Session's cwd is an empty
 * directory that stands for a cloud path. Without this context the model reads
 * the empty mirror and never reaches the machine. The section is registered on
 * each Agent's own scope, so it disappears with that Agent and never affects a
 * local Session; a mirror whose meta file is unreadable contributes nothing. */
function installSessionContext(ctx: Context, root: string): void {
  ctx.effect(() => {
    const disposers = new Map<string, () => void>()
    const installed = new Set<string>()
    const dispose = (agent: Agent) => {
      const id = String(agent.session.id)
      installed.delete(id)
      const disposer = disposers.get(id)
      disposers.delete(id)
      try { disposer?.() } catch {}
    }
    // Register the section only once the binding is known. A section whose text
    // provider is still waiting for the mirror read would assemble as empty on
    // the first step, and `refreshContext` refreshes contexts only, so that empty
    // text would persist for every later step of the Session. A local cwd
    // resolves to no record and registers nothing at all.
    const install = async (agent: Agent): Promise<void> => {
      const id = String(agent.session.id)
      if (installed.has(id)) return
      installed.add(id)
      let record: Awaited<ReturnType<typeof bindingForCwd>>
      try { record = await bindingForCwd(root, agent.session.header.cwd) }
      catch { installed.delete(id); return }
      // The Agent may have been disposed while the read was in flight; its scope
      // rejects registration then, and nothing must be left tracked.
      if (!installed.has(id)) return
      if (record === undefined) { installed.delete(id); return }
      // Captured once: the binding is fixed for the life of the mirror.
      const bound = record
      try {
        const disposer = agent.ctx.systemPrompt.section({
          name: 'instabox:session-cloud-directory',
          order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 1,
          text: () => cloudContextText(bound),
          interpolate: false,
        })
        disposers.set(id, disposer)
      } catch { installed.delete(id) }
    }
    const stopCreated = ctx.on('agent/created', ({agent}) => { void install(agent).catch(() => {}) ; return undefined })
    const stopDisposed = ctx.on('agent/disposed', ({agent}) => dispose(agent))
    return () => {
      stopCreated()
      stopDisposed()
      for (const disposer of disposers.values()) { try { disposer() } catch {} }
      disposers.clear()
      installed.clear()
    }
  }, 'instabox: cloud-directory session context')
}

import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition, ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionSnapshot, PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsView } from '../shared.js'
import type { InstaboxPreviewFace } from './face.js'
import { PreviewController } from './preview-controller.js'
import { DesktopPreview } from './DesktopPreview.js'

export const PREVIEW_NODE_KIND = 'instabox-preview-tail'
export const PREVIEW_TAB_KIND = 'instabox-desktop'
export const PREVIEW_TAB_ID = 'dsh-instabox/desktop-preview'
const POLL_MS = 2000
const REQUEST_TIMEOUT_MS = 12000

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'instabox-preview-tail': Record<string, never>
  }
}

/** An additive Session-level Chat node, outside Turn/process disclosures. Its
 * identity never follows the last message, so streaming and paging cannot
 * remount the owner. The published Chat target accepts arbitrary node kinds.
 * Match only event types Chat itself handles, preserving unknown-event fallback. */
export function createPreviewTailDefinition(): ConversationNodeDefinition<Record<string, never>> {
  const match = () => ({id: 'desktop-preview', role: 'start' as const})
  return {
    kind: PREVIEW_NODE_KIND,
    target: 'chat',
    match: event => ['user/message','assistant/message','assistant/attempt','assistant/live-chunk',
      'turn/start','turn/end','tool/call','tool/result'].includes(event.type) ? match() : null,
    start: () => ({}),
    update: context => context.state,
    buildViewNode: context => {
      const existing = context.current.get('chat')
      if (existing) return existing
      return {
        key: context.key, id: context.id, target: 'chat', kind: PREVIEW_NODE_KIND,
        // Chat's contract calls this a sortable render position; synthetic
        // Nodes need not point to a durable event. All actual log seqs precede it.
        anchorSeq: Number.MAX_SAFE_INTEGER,
        location: {kind: 'session'}, visibility: 'visible', groupTree: 'turn',
        data: {},
      } as ConversationViewNode
    },
  }
}

interface SettingsSource {
  getSnapshot(): SettingsView | null
  subscribe(listener: () => void): () => void
}

/** A plugin-owned coordinator. React rows and tab bodies are presentation
 * subscribers only; their unmount never hands back or disposes the controller. */
export function installPreviewPlacements(ctx: Context, face: InstaboxPreviewFace): {
  updateSettings(view: SettingsView): void
  controller: PreviewController
} {
  const controller = new PreviewController(face)
  let settings: SettingsView | null = null
  const listeners = new Set<() => void>()
  const settingsSource: SettingsSource = {
    getSnapshot: () => settings,
    subscribe: listener => {listeners.add(listener); return () => listeners.delete(listener)},
  }
  let disposed = false, activeSession: string | null = null, generation = 0
  let pollAbort = new AbortController()
  let resetting: Promise<void> | null = null
  let inFlight: object | null = null
  let settingsInFlight = false, settingsAttemptAt = -Infinity
  let sidebar: Context['sidebarRight'] | null = null
  const autoOpened = new Set<string>()

  const openSidebar = (sessionId: string): boolean => {
    if (disposed || !sidebar || sidebar.mounted.getSnapshot() !== sessionId || activeSession !== sessionId) return false
    // Focus an existing provider tab wherever it was docked/floated. Opening
    // blindly by kind only deduplicates pages within the target pane.
    const existing = sidebar.tabsIn(sessionId as any).find(tab => tab.kind === PREVIEW_TAB_KIND)
    if (existing) {
      if (!sidebar.isExpanded()) sidebar.toggleExpanded()
      sidebar.focus(existing.id)
    } else sidebar.openTab(PREVIEW_TAB_KIND)
    return true
  }
  const maybeOpenSidebar = () => {
    if (disposed) return
    const snapshot = controller.getSnapshot()
    if (!activeSession || snapshot.sessionId !== activeSession) return
    const busy = new Set(snapshot.items.filter(item => item.phase === 'busy').map(item => item.machineId))
    for (const key of autoOpened) if (!busy.has(key)) autoOpened.delete(key)
    if (settings?.config.desktopPlacement !== 'sidebar') return
    for (const item of snapshot.items) {
      if (item.phase !== 'busy' || !item.expanded || item.manual || autoOpened.has(item.machineId)) continue
      // Mark before opening: synchronous native-store notifications must not
      // recurse into opening again. Collapsing the sidebar remains respected
      // until the machine enters a subsequent busy period.
      autoOpened.add(item.machineId)
      try { if (!openSidebar(activeSession)) autoOpened.delete(item.machineId) }
      catch { autoOpened.delete(item.machineId) }
    }
  }
  const updateSettings = (view: SettingsView) => {
    if (disposed) return
    if (settings && view.revision < settings.revision) return
    const changedPlacement = settings?.config.desktopPlacement !== view.config.desktopPlacement
    settings = structuredClone(view)
    if (changedPlacement) autoOpened.clear()
    for (const listener of listeners) listener()
    maybeOpenSidebar()
    void pollActivity()
  }
  const readSettings = async () => {
    if (disposed || settingsInFlight) return
    settingsInFlight = true; settingsAttemptAt = Date.now()
    try {
      const view = await face.read(AbortSignal.any([pollAbort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]))
      if (!disposed) updateSettings(view)
    } catch { /* A reconnect retries configuration; it never changes placement. */ }
    finally { settingsInFlight = false }
  }
  async function pollActivity(): Promise<void> {
    if (disposed || resetting || !activeSession || inFlight || !settings?.credential.configured) return
    const sessionId = activeSession, epoch = generation, token = {}
    inFlight = token
    const signal = AbortSignal.any([pollAbort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    try {
      const activity = await face.getActivity({sessionId}, signal)
      if (!disposed && generation === epoch && activeSession === sessionId && activity.sessionId === sessionId) {
        controller.updateActivity(activity)
      }
    } catch { /* Keep the last known scoped state during a transient outage. */ }
    finally { if (inFlight === token) inFlight = null }
  }
  const selectSession = () => {
    const next = sidebar?.mounted.getSnapshot() ?? null
    if (next === activeSession) return
    activeSession = next; generation += 1
    pollAbort.abort(); pollAbort = new AbortController(); inFlight = null
    autoOpened.clear()
    // setSession synchronously removes old-session presentation before its
    // asynchronous handback can settle.
    const begin = resetting ? resetting.then(() => {if (!disposed && activeSession === next) return controller.setSession(next)}) : controller.setSession(next)
    void begin.then(() => {
      if (disposed || activeSession !== next) return
      if (!settings) void readSettings()
      void pollActivity()
    }).catch(() => { /* The controller retains its safe cleanup state. */ })
  }

  function SidebarToolbar({sessionId}: {sessionId: string}) {
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    if (snapshot.sessionId !== sessionId || !snapshot.items.length) return null
    const busy = snapshot.items.some(item => item.phase === 'busy')
    return <div className="dsi-preview-toolbar" data-instabox-placement="toolbar" role="group" aria-label="云机桌面预览">
      <span>云机桌面 · {snapshot.items.length} 台</span>
      <span>{snapshot.items.some(item => item.cleanupNeeded) ? '接管待清理' : busy ? 'AI 操作中' : '可观看或接管'}</span>
      <button type="button" onClick={() => openSidebar(sessionId)}>在右侧打开桌面</button>
    </div>
  }
  function InlinePreview(props: Pick<ChatNodeViewProps<typeof PREVIEW_NODE_KIND>, 'sessionId' | 'useSession'>) {
    const view = useSyncExternalStore(settingsSource.subscribe, settingsSource.getSnapshot, settingsSource.getSnapshot)
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const pendingInput = props.useSession((state: SessionSnapshot) => state.pendingSubmissions.some((item: PendingSubmission) => item.placement === 'transcript'))
    if (snapshot.sessionId !== props.sessionId || !snapshot.items.length || pendingInput) return null
    if (view?.config.desktopPlacement === 'sidebar') return <SidebarToolbar sessionId={props.sessionId}/>
    return <div data-instabox-placement="inline"><DesktopPreview controller={controller} presentation="card"/></div>
  }
  function SidebarPreview(props: PropsRuntime<'sidebar.right.pane.tab'>) {
    const tab = props.useTabInfo()
    const view = useSyncExternalStore(settingsSource.subscribe, settingsSource.getSnapshot, settingsSource.getSnapshot)
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const cleanupAttempted = useRef(new Set<string>())
    useEffect(() => {
      // Hiding the *active sidebar presentation* is a deliberate viewer close.
      // A placement change to inline is different: that presentation takes
      // ownership without an old tab effect releasing its new viewer.
      if (view?.config.desktopPlacement !== 'sidebar' || tab.tab.visible || snapshot.sessionId !== props.sessionId) {cleanupAttempted.current.clear(); return}
      for (const item of snapshot.items) if (item.expanded && !item.pending && !cleanupAttempted.current.has(item.machineId)) {
        // A failed revocation keeps the cleanup surface, and must not create
        // a render/retry loop while its tab remains hidden.
        cleanupAttempted.current.add(item.machineId)
        void controller.collapse(item.machineId).catch(() => {})
      }
    }, [view?.config.desktopPlacement, tab.tab.visible, snapshot.sessionId, props.sessionId, snapshot.revision])
    // keepMounted bodies from another Session remain subscribed but reveal
    // neither its machine list nor the foreground Session's viewer.
    if (snapshot.sessionId !== props.sessionId) return null
    if (view?.config.desktopPlacement !== 'sidebar') return <div className="dsi-preview-placeholder">桌面预览当前位于对话末尾，可在 Instabox 设置中切换位置。</div>
    if (!snapshot.items.length) return <div className="dsi-preview-placeholder">当前对话尚未使用云机。模型开始使用 Instabox 后，桌面将在这里显示。</div>
    return <div data-instabox-placement="sidebar" data-instabox-visible={tab.tab.visible ? 'true' : 'false'}><DesktopPreview controller={controller} presentation="sidebar"/></div>
  }

  ctx.inject(['uiConversation'], conversationCtx => {
    conversationCtx.uiConversation.events.register(createPreviewTailDefinition())
    conversationCtx.slots.inject('conversation.chat.node', () => conversationCtx.slots.register({
      name: 'conversation.chat.node', key: PREVIEW_NODE_KIND,
    }, InlinePreview))
  })
  ctx.inject(['sidebarRight','sidebarRightTabs'], sidebarCtx => {
    sidebar = sidebarCtx.sidebarRight
    sidebarCtx.effect(() => sidebarCtx.sidebarRightTabs.register({
      id: PREVIEW_TAB_ID, kind: PREVIEW_TAB_KIND, keepMounted: true,
      title: () => 'Instabox 云桌面',
    }), 'instabox: native desktop tab type')
    sidebarCtx.effect(() => sidebarCtx.sidebarRight.registerCloseHandler(PREVIEW_TAB_KIND, sessionId => {
      const snapshot = controller.getSnapshot()
      if (settings?.config.desktopPlacement !== 'sidebar' || activeSession !== sessionId || snapshot.sessionId !== sessionId) return
      // Explicit native removal may unmount without a visibility commit. Keep
      // cleanup in the plugin owner before allowing the tab occurrence to end.
      for (const item of snapshot.items) if (item.expanded) void controller.collapse(item.machineId).catch(() => {})
    }), 'instabox: explicit native desktop tab close')
    sidebarCtx.slots.inject('sidebar.right.pane.tab', () => sidebarCtx.slots.register({
      name: 'sidebar.right.pane.tab', key: PREVIEW_TAB_ID,
    }, SidebarPreview))
    sidebarCtx.effect(() => sidebarCtx.sidebarRight.mounted.subscribe(selectSession), 'instabox: foreground session')
    selectSession()
  })
  const unsubscribe = controller.subscribe(maybeOpenSidebar)
  ctx.on('connection/reset', () => {
    if (disposed) return
    generation += 1; pollAbort.abort(); pollAbort = new AbortController(); inFlight = null
    settings = null; autoOpened.clear()
    for (const listener of listeners) listener()
    // Host activity revisions are process-local. A new connection generation
    // can legitimately restart at zero, so do not retain the old revision gate.
    const reset = controller.resetActivityEpoch()
    resetting = reset
    void reset.catch(() => {}).finally(() => {
      if (disposed || resetting !== reset) return
      resetting = null
      void controller.setSession(activeSession).then(() => {void readSettings(); void pollActivity()}).catch(() => {})
    })
  })
  const timer = setInterval(() => {
    if (!settings && !settingsInFlight && Date.now() - settingsAttemptAt >= 10000) void readSettings()
    void pollActivity()
  }, POLL_MS)
  void readSettings()
  ctx.effect(() => async () => {
    disposed = true; clearInterval(timer); pollAbort.abort(); unsubscribe(); listeners.clear()
    await controller.dispose()
  }, 'instabox: preview owner')
  return {updateSettings, controller}
}

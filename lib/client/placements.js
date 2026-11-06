import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { PreviewController } from './preview-controller.js';
import { DesktopPreview } from './DesktopPreview.js';
export const PREVIEW_NODE_KIND = 'instabox-preview-tail';
export const PREVIEW_TAB_KIND = 'instabox-desktop';
export const PREVIEW_TAB_ID = 'dsh-instabox/desktop-preview';
const POLL_MS = 2000;
const REQUEST_TIMEOUT_MS = 12000;
/** An additive Session-level Chat node, outside Turn/process disclosures. Its
 * identity never follows the last message, so streaming and paging cannot
 * remount the owner. The published Chat target accepts arbitrary node kinds.
 * Match only event types Chat itself handles, preserving unknown-event fallback. */
export function createPreviewTailDefinition() {
    const match = () => ({ id: 'desktop-preview', role: 'start' });
    return {
        kind: PREVIEW_NODE_KIND,
        target: 'chat',
        match: event => ['user/message', 'assistant/message', 'assistant/attempt', 'assistant/live-chunk',
            'turn/start', 'turn/end', 'tool/call', 'tool/result'].includes(event.type) ? match() : null,
        start: () => ({}),
        update: context => context.state,
        buildViewNode: context => {
            const existing = context.current.get('chat');
            if (existing)
                return existing;
            return {
                key: context.key, id: context.id, target: 'chat', kind: PREVIEW_NODE_KIND,
                // Chat's contract calls this a sortable render position; synthetic
                // Nodes need not point to a durable event. All actual log seqs precede it.
                anchorSeq: Number.MAX_SAFE_INTEGER,
                location: { kind: 'session' }, visibility: 'visible', groupTree: 'turn',
                data: {},
            };
        },
    };
}
/** A plugin-owned coordinator. React rows and tab bodies are presentation
 * subscribers only; their unmount never hands back or disposes the controller. */
export function installPreviewPlacements(ctx, face) {
    const controller = new PreviewController(face);
    let settings = null;
    const listeners = new Set();
    const settingsSource = {
        getSnapshot: () => settings,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    let disposed = false, activeSession = null, generation = 0;
    let pollAbort = new AbortController();
    let resetting = null;
    let inFlight = null;
    let settingsInFlight = false, settingsAttemptAt = -Infinity;
    let sidebar = null;
    const autoOpened = new Set();
    const openSidebar = (sessionId) => {
        if (disposed || !sidebar || sidebar.mounted.getSnapshot() !== sessionId || activeSession !== sessionId)
            return false;
        // Focus an existing provider tab wherever it was docked/floated. Opening
        // blindly by kind only deduplicates pages within the target pane.
        const existing = sidebar.tabsIn(sessionId).find(tab => tab.kind === PREVIEW_TAB_KIND);
        if (existing) {
            if (!sidebar.isExpanded())
                sidebar.toggleExpanded();
            sidebar.focus(existing.id);
        }
        else
            sidebar.openTab(PREVIEW_TAB_KIND);
        return true;
    };
    const maybeOpenSidebar = () => {
        if (disposed)
            return;
        const snapshot = controller.getSnapshot();
        if (!activeSession || snapshot.sessionId !== activeSession)
            return;
        const busy = new Set(snapshot.items.filter(item => item.phase === 'busy').map(item => item.machineId));
        for (const key of autoOpened)
            if (!busy.has(key))
                autoOpened.delete(key);
        if (settings?.config.desktopPlacement !== 'sidebar')
            return;
        for (const item of snapshot.items) {
            if (item.phase !== 'busy' || !item.expanded || item.manual || autoOpened.has(item.machineId))
                continue;
            // Mark before opening: synchronous native-store notifications must not
            // recurse into opening again. Collapsing the sidebar remains respected
            // until the machine enters a subsequent busy period.
            autoOpened.add(item.machineId);
            try {
                if (!openSidebar(activeSession))
                    autoOpened.delete(item.machineId);
            }
            catch {
                autoOpened.delete(item.machineId);
            }
        }
    };
    const updateSettings = (view) => {
        if (disposed)
            return;
        if (settings && view.revision < settings.revision)
            return;
        const changedPlacement = settings?.config.desktopPlacement !== view.config.desktopPlacement;
        settings = structuredClone(view);
        if (changedPlacement)
            autoOpened.clear();
        for (const listener of listeners)
            listener();
        maybeOpenSidebar();
        void pollActivity();
    };
    const readSettings = async () => {
        if (disposed || settingsInFlight)
            return;
        settingsInFlight = true;
        settingsAttemptAt = Date.now();
        try {
            const view = await face.read(AbortSignal.any([pollAbort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]));
            if (!disposed)
                updateSettings(view);
        }
        catch { /* A reconnect retries configuration; it never changes placement. */ }
        finally {
            settingsInFlight = false;
        }
    };
    async function pollActivity() {
        if (disposed || resetting || !activeSession || inFlight || !settings?.credential.configured)
            return;
        const sessionId = activeSession, epoch = generation, token = {};
        inFlight = token;
        const signal = AbortSignal.any([pollAbort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
        try {
            const activity = await face.getActivity({ sessionId }, signal);
            if (!disposed && generation === epoch && activeSession === sessionId && activity.sessionId === sessionId) {
                controller.updateActivity(activity);
            }
        }
        catch { /* Keep the last known scoped state during a transient outage. */ }
        finally {
            if (inFlight === token)
                inFlight = null;
        }
    }
    const selectSession = () => {
        const next = sidebar?.mounted.getSnapshot() ?? null;
        if (next === activeSession)
            return;
        activeSession = next;
        generation += 1;
        pollAbort.abort();
        pollAbort = new AbortController();
        inFlight = null;
        autoOpened.clear();
        // setSession synchronously removes old-session presentation before its
        // asynchronous handback can settle.
        const begin = resetting ? resetting.then(() => { if (!disposed && activeSession === next)
            return controller.setSession(next); }) : controller.setSession(next);
        void begin.then(() => {
            if (disposed || activeSession !== next)
                return;
            if (!settings)
                void readSettings();
            void pollActivity();
        }).catch(() => { });
    };
    function SidebarToolbar({ sessionId }) {
        const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
        if (snapshot.sessionId !== sessionId || !snapshot.items.length)
            return null;
        const busy = snapshot.items.some(item => item.phase === 'busy');
        return _jsxs("div", { className: "dsi-preview-toolbar", "data-instabox-placement": "toolbar", role: "group", "aria-label": "\u4E91\u673A\u684C\u9762\u9884\u89C8", children: [_jsxs("span", { children: ["\u4E91\u673A\u684C\u9762 \u00B7 ", snapshot.items.length, " \u53F0"] }), _jsx("span", { children: snapshot.items.some(item => item.cleanupNeeded) ? '接管待清理' : busy ? 'AI 操作中' : '可观看或接管' }), _jsx("button", { type: "button", onClick: () => openSidebar(sessionId), children: "\u5728\u53F3\u4FA7\u6253\u5F00\u684C\u9762" })] });
    }
    function InlinePreview(props) {
        const view = useSyncExternalStore(settingsSource.subscribe, settingsSource.getSnapshot, settingsSource.getSnapshot);
        const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
        const pendingInput = props.useSession((state) => state.pendingSubmissions.some((item) => item.placement === 'transcript'));
        if (snapshot.sessionId !== props.sessionId || !snapshot.items.length || pendingInput)
            return null;
        if (view?.config.desktopPlacement === 'sidebar')
            return _jsx(SidebarToolbar, { sessionId: props.sessionId });
        return _jsx("div", { "data-instabox-placement": "inline", children: _jsx(DesktopPreview, { controller: controller, presentation: "card" }) });
    }
    function SidebarPreview(props) {
        const tab = props.useTabInfo();
        const view = useSyncExternalStore(settingsSource.subscribe, settingsSource.getSnapshot, settingsSource.getSnapshot);
        const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
        const cleanupAttempted = useRef(new Set());
        useEffect(() => {
            // Hiding the *active sidebar presentation* is a deliberate viewer close.
            // A placement change to inline is different: that presentation takes
            // ownership without an old tab effect releasing its new viewer.
            if (view?.config.desktopPlacement !== 'sidebar' || tab.tab.visible || snapshot.sessionId !== props.sessionId) {
                cleanupAttempted.current.clear();
                return;
            }
            for (const item of snapshot.items)
                if (item.expanded && !item.pending && !cleanupAttempted.current.has(item.machineId)) {
                    // A failed revocation keeps the cleanup surface, and must not create
                    // a render/retry loop while its tab remains hidden.
                    cleanupAttempted.current.add(item.machineId);
                    void controller.collapse(item.machineId).catch(() => { });
                }
        }, [view?.config.desktopPlacement, tab.tab.visible, snapshot.sessionId, props.sessionId, snapshot.revision]);
        // keepMounted bodies from another Session remain subscribed but reveal
        // neither its machine list nor the foreground Session's viewer.
        if (snapshot.sessionId !== props.sessionId)
            return null;
        if (view?.config.desktopPlacement !== 'sidebar')
            return _jsx("div", { className: "dsi-preview-placeholder", children: "\u684C\u9762\u9884\u89C8\u5F53\u524D\u4F4D\u4E8E\u5BF9\u8BDD\u672B\u5C3E\uFF0C\u53EF\u5728 Instabox \u8BBE\u7F6E\u4E2D\u5207\u6362\u4F4D\u7F6E\u3002" });
        if (!snapshot.items.length)
            return _jsx("div", { className: "dsi-preview-placeholder", children: "\u5F53\u524D\u5BF9\u8BDD\u5C1A\u672A\u4F7F\u7528\u4E91\u673A\u3002\u6A21\u578B\u5F00\u59CB\u4F7F\u7528 Instabox \u540E\uFF0C\u684C\u9762\u5C06\u5728\u8FD9\u91CC\u663E\u793A\u3002" });
        return _jsx("div", { "data-instabox-placement": "sidebar", "data-instabox-visible": tab.tab.visible ? 'true' : 'false', children: _jsx(DesktopPreview, { controller: controller, presentation: "sidebar" }) });
    }
    ctx.inject(['uiConversation'], conversationCtx => {
        conversationCtx.uiConversation.events.register(createPreviewTailDefinition());
        conversationCtx.slots.inject('conversation.chat.node', () => conversationCtx.slots.register({
            name: 'conversation.chat.node', key: PREVIEW_NODE_KIND,
        }, InlinePreview));
    });
    ctx.inject(['sidebarRight', 'sidebarRightTabs'], sidebarCtx => {
        sidebar = sidebarCtx.sidebarRight;
        sidebarCtx.effect(() => sidebarCtx.sidebarRightTabs.register({
            id: PREVIEW_TAB_ID, kind: PREVIEW_TAB_KIND, keepMounted: true,
            title: () => 'Instabox 云桌面',
        }), 'instabox: native desktop tab type');
        sidebarCtx.effect(() => sidebarCtx.sidebarRight.registerCloseHandler(PREVIEW_TAB_KIND, sessionId => {
            const snapshot = controller.getSnapshot();
            if (settings?.config.desktopPlacement !== 'sidebar' || activeSession !== sessionId || snapshot.sessionId !== sessionId)
                return;
            // Explicit native removal may unmount without a visibility commit. Keep
            // cleanup in the plugin owner before allowing the tab occurrence to end.
            for (const item of snapshot.items)
                if (item.expanded)
                    void controller.collapse(item.machineId).catch(() => { });
        }), 'instabox: explicit native desktop tab close');
        sidebarCtx.slots.inject('sidebar.right.pane.tab', () => sidebarCtx.slots.register({
            name: 'sidebar.right.pane.tab', key: PREVIEW_TAB_ID,
        }, SidebarPreview));
        sidebarCtx.effect(() => sidebarCtx.sidebarRight.mounted.subscribe(selectSession), 'instabox: foreground session');
        selectSession();
    });
    const unsubscribe = controller.subscribe(maybeOpenSidebar);
    ctx.on('connection/reset', () => {
        if (disposed)
            return;
        generation += 1;
        pollAbort.abort();
        pollAbort = new AbortController();
        inFlight = null;
        settings = null;
        autoOpened.clear();
        for (const listener of listeners)
            listener();
        // Host activity revisions are process-local. A new connection generation
        // can legitimately restart at zero, so do not retain the old revision gate.
        const reset = controller.resetActivityEpoch();
        resetting = reset;
        void reset.catch(() => { }).finally(() => {
            if (disposed || resetting !== reset)
                return;
            resetting = null;
            void controller.setSession(activeSession).then(() => { void readSettings(); void pollActivity(); }).catch(() => { });
        });
    });
    const timer = setInterval(() => {
        if (!settings && !settingsInFlight && Date.now() - settingsAttemptAt >= 10000)
            void readSettings();
        void pollActivity();
    }, POLL_MS);
    void readSettings();
    ctx.effect(() => async () => {
        disposed = true;
        clearInterval(timer);
        pollAbort.abort();
        unsubscribe();
        listeners.clear();
        await controller.dispose();
    }, 'instabox: preview owner');
    return { updateSettings, controller };
}

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
function MachinePreview({ controller, item, presentation }) {
    const [zoom, setZoom] = useState(false);
    const stage = useRef(null);
    const inactive = item.retiring || item.phase === 'inactive' || ['stopped', 'suspended', 'paused', 'deleted'].includes(item.machineState ?? '');
    const foreign = item.control?.mode === 'human' && item.mode !== 'control' && !item.cleanupNeeded;
    const controlling = item.mode === 'control' && !!item.url && !item.cleanupNeeded;
    const title = item.name || item.machineId;
    const invoke = (task) => void task.catch(() => { });
    useEffect(() => { if (!item.expanded)
        setZoom(false); }, [item.expanded]);
    useEffect(() => {
        if (!zoom)
            return;
        const node = stage.current;
        let topLayer = false;
        if (node && typeof node.showPopover === 'function') {
            node.setAttribute('popover', 'manual');
            try {
                node.showPopover();
                topLayer = true;
            }
            catch {
                node.removeAttribute('popover');
            }
        }
        const previous = document.activeElement;
        const first = stage.current?.querySelector('button');
        first?.focus();
        const keydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setZoom(false);
            }
            if (event.key !== 'Tab')
                return;
            const elements = [...(stage.current?.querySelectorAll('button:not(:disabled),a[href],iframe') ?? [])];
            if (!elements.length)
                return;
            const current = elements.indexOf(document.activeElement);
            if (event.shiftKey && current <= 0) {
                event.preventDefault();
                elements.at(-1)?.focus();
            }
            else if (!event.shiftKey && (current === elements.length - 1 || current === -1)) {
                event.preventDefault();
                elements[0]?.focus();
            }
        };
        document.addEventListener('keydown', keydown);
        return () => {
            document.removeEventListener('keydown', keydown);
            if (topLayer) {
                try {
                    node?.hidePopover();
                }
                catch { }
            }
            node?.removeAttribute('popover');
            if (previous?.isConnected)
                previous.focus();
        };
    }, [zoom]);
    return _jsxs("section", { className: `dsi-preview-card ${presentation === 'sidebar' ? 'dsi-preview-sidebar' : ''}`, "data-preview-machine": item.machineId, children: [_jsxs("div", { className: "dsi-preview-heading", children: [_jsxs("div", { className: "dsi-preview-title", children: [_jsxs("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: [_jsx("rect", { x: "3", y: "4", width: "18", height: "13", rx: "2", stroke: "currentColor", strokeWidth: "1.6" }), _jsx("path", { d: "M8 21h8m-4-4v4", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" })] }), _jsx("strong", { children: title }), _jsx("span", { className: `dsi-preview-status ${item.phase === 'busy' ? 'busy' : ''}`, children: item.pending ? '处理中…' : item.cleanupNeeded ? '接管待清理' : controlling ? '人工接管' : foreign ? '其他面板接管' : inactive ? '机器未运行' : item.phase === 'busy' ? '模型使用中' : '云机就绪' })] }), !item.expanded && _jsx("div", { className: "dsi-preview-actions", children: item.cleanupNeeded ? _jsx("button", { type: "button", "data-preview-action": "cleanup", disabled: item.pending, onClick: () => invoke(controller.handback(item.machineId)), children: "\u6E05\u7406\u5E76\u4EA4\u8FD8" }) : _jsxs(_Fragment, { children: [_jsx("button", { type: "button", "data-preview-action": "watch", disabled: item.pending || inactive, onClick: () => invoke(controller.watch(item.machineId)), children: "\u89C2\u770B\u684C\u9762" }), _jsx("button", { type: "button", "data-preview-action": "take", className: "dsi-preview-primary", disabled: item.pending || inactive || foreign, onClick: () => invoke(controller.take(item.machineId)), children: "\u63A5\u7BA1" })] }) })] }), item.error && _jsx("p", { className: "dsi-preview-error", role: "alert", children: item.error }), item.backgroundRunning && _jsx("small", { className: "dsi-preview-hint", children: "\u4E91\u7AEF\u540E\u53F0\u4EFB\u52A1\u4ECD\u5728\u8FD0\u884C\u3002" }), inactive && !item.expanded && _jsx("p", { className: "dsi-preview-hint", children: "\u673A\u5668\u5DF2\u505C\u6B62\u6216\u6682\u505C\uFF0C\u53EF\u5148\u5728\u201CInstabox \u4E91\u7535\u8111\u201D\u4E2D\u6062\u590D\uFF0C\u518D\u6253\u5F00\u684C\u9762\u3002" }), item.expanded && _jsxs("div", { ref: stage, className: `dsi-preview-stage ${zoom ? 'dsi-preview-zoom' : ''}`, role: zoom ? 'dialog' : 'region', "aria-modal": zoom ? true : undefined, "aria-label": `${title} 云桌面`, children: [_jsxs("div", { className: "dsi-preview-toolbar", children: [_jsx("span", { children: item.cleanupNeeded ? '接管状态待清理' : controlling ? '人工接管 · 键鼠由你控制' : '实时桌面 · 只读观看' }), _jsxs("div", { className: "dsi-preview-actions", children: [item.url && _jsx("a", { href: item.url, target: "_blank", rel: "noopener noreferrer", children: "\u65B0\u7A97\u53E3 \u2197" }), item.url && _jsx("button", { type: "button", "data-preview-action": "zoom", onClick: () => setZoom(value => !value), children: zoom ? '缩小' : '放大' }), item.cleanupNeeded ? _jsx("button", { type: "button", "data-preview-action": "cleanup", disabled: item.pending, onClick: () => invoke(controller.handback(item.machineId)), children: "\u6E05\u7406\u5E76\u4EA4\u8FD8" }) :
                                        controlling ? _jsx("button", { type: "button", "data-preview-action": "handback", disabled: item.pending, onClick: () => invoke(controller.handback(item.machineId)), children: "\u4EA4\u8FD8\u5E76\u6536\u8D77" }) :
                                            _jsxs(_Fragment, { children: [_jsx("button", { type: "button", "data-preview-action": "take", className: "dsi-preview-primary", disabled: item.pending || inactive || foreign, onClick: () => invoke(controller.take(item.machineId)), children: "\u63A5\u7BA1" }), _jsx("button", { type: "button", "data-preview-action": "collapse", disabled: item.pending, onClick: () => invoke(controller.collapse(item.machineId)), children: "\u6536\u8D77" })] })] })] }), item.url && !item.cleanupNeeded ? _jsx("iframe", { "data-preview-viewer": "true", title: `${title}${controlling ? '人工接管' : '只读'}桌面`, src: item.url, allow: "clipboard-read; clipboard-write; fullscreen", allowFullScreen: true, referrerPolicy: "no-referrer" }, `${item.mode}:${item.url}`) :
                        _jsxs("div", { className: "dsi-preview-placeholder", role: "status", children: [item.pending ? '正在准备云桌面…' : item.cleanupNeeded ? '交互画面已隐藏。确认清理成功后才会交还模型。' : '桌面暂未打开，可重试观看或检查个人 API Key。', !item.pending && !item.cleanupNeeded && _jsx("button", { type: "button", disabled: inactive, onClick: () => invoke(controller.watch(item.machineId)), children: "\u91CD\u65B0\u89C2\u770B" })] }), controlling && _jsx("p", { className: "dsi-preview-hint", children: "\u6A21\u578B\u5BF9\u8FD9\u53F0\u673A\u5668\u7684\u65B0\u53D8\u66F4\u64CD\u4F5C\u5DF2\u6682\u505C\u3002\u4EA4\u8FD8\u5E76\u6536\u8D77\u540E\uFF0C\u6A21\u578B\u53EF\u7EE7\u7EED\u64CD\u4F5C\uFF1B\u4E91\u673A\u4E2D\u7684\u540E\u53F0\u8FDB\u7A0B\u4F1A\u7EE7\u7EED\u8FD0\u884C\u3002" })] })] });
}
/** This component is a pure subscriber. Message replay, moving between slots,
 * and React unmount do not create viewers, renew, or release a machine lease. */
export function DesktopPreview({ controller, presentation = 'card', machineId }) {
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    const items = machineId ? snapshot.items.filter(item => item.machineId === machineId) : snapshot.items;
    if (!items.length)
        return presentation === 'sidebar' ? _jsx("div", { className: "dsi-preview-empty", children: "\u6B64\u5BF9\u8BDD\u8FD8\u6CA1\u6709\u4F7F\u7528 Instabox \u4E91\u673A\u3002" }) : null;
    return _jsx("div", { className: `dsi-preview-list dsi-preview-${presentation}`, "data-preview-session": snapshot.sessionId ?? '', children: items.map(item => _jsx(MachinePreview, { controller: controller, item: item, presentation: presentation }, `${snapshot.sessionId}:${item.machineId}`)) });
}

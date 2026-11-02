import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { configSchema } from '../shared.js';
export function InstaboxSettings({ face, openPanel, onSaved }) {
    const [view, setView] = useState(null);
    const [draft, setDraft] = useState(null);
    const [apiKey, setApiKey] = useState(''), [clearApiKey, setClearApiKey] = useState(false);
    const [busy, setBusy] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
    const [reload, setReload] = useState(0);
    const controller = useRef(null), active = useRef(false), latest = useRef(face);
    latest.current = face;
    useEffect(() => {
        active.current = true;
        const pending = new AbortController();
        controller.current = pending;
        setBusy(true);
        setError('');
        void latest.current.read(pending.signal).then(value => {
            if (!pending.signal.aborted) {
                setView(value);
                setDraft({ ...value.config });
                setApiKey('');
                setClearApiKey(false);
            }
        }).catch(reason => { if (!pending.signal.aborted)
            setError(reason instanceof Error ? reason.message : '读取设置失败。'); })
            .finally(() => { if (!pending.signal.aborted)
            setBusy(false); });
        return () => { active.current = false; pending.abort(); controller.current?.abort(); };
    }, [reload]);
    const save = async () => {
        if (!view || !draft || busy)
            return;
        const parsed = configSchema.safeParse(draft);
        if (!parsed.success) {
            setError(parsed.error.issues.map(issue => issue.message).join('；'));
            return;
        }
        const pending = new AbortController();
        controller.current = pending;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const value = await latest.current.save({ config: parsed.data, expectedRevision: view.revision,
                ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(clearApiKey ? { clearApiKey: true } : {}) }, pending.signal);
            if (!pending.signal.aborted && active.current) {
                setView(value);
                setDraft({ ...value.config });
                setApiKey('');
                setClearApiKey(false);
                setMessage('已保存。密钥保存在 DSH 凭据服务中。');
                onSaved?.(value);
            }
        }
        catch (reason) {
            if (!pending.signal.aborted && active.current)
                setError(reason instanceof Error ? reason.message : '保存失败。');
        }
        finally {
            if (!pending.signal.aborted && active.current)
                setBusy(false);
        }
    };
    return _jsxs("section", { className: "dsi dsi-setting", "aria-label": "Instabox \u8BBE\u7F6E", children: [_jsx("h2", { children: "Instabox \u8BBE\u7F6E" }), _jsx("p", { className: "dsi-muted", style: { marginTop: 8 }, children: "\u4F7F\u7528\u521B\u5EFA\u4E91\u673A\u7684\u4E2A\u4EBA API Key\uFF0C\u53EF\u5728 DSH \u4E2D\u67E5\u770B\u684C\u9762\u548C\u4EBA\u5DE5\u63A5\u7BA1\u3002\u7EC4\u7EC7 Key \u53EF\u6267\u884C\u547D\u4EE4\u548C\u622A\u56FE\uFF0C\u5B98\u65B9\u4E0D\u5141\u8BB8\u5B83\u751F\u6210\u684C\u9762\u89C2\u770B\u94FE\u63A5\u3002" }), openPanel && _jsx("button", { type: "button", className: "dsi-settingslaunch", onClick: openPanel, children: "\u6253\u5F00\u4E91\u7535\u8111" }), error && _jsx("p", { role: "alert", className: "dsi-error", children: error }), message && _jsx("p", { role: "status", className: "dsi-good", children: message }), busy && !draft && _jsx("p", { role: "status", className: "dsi-loading", children: "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026" }), !draft || !view ? _jsx("button", { type: "button", disabled: busy, onClick: () => setReload(value => value + 1), children: "\u91CD\u65B0\u8BFB\u53D6" }) :
                _jsx("form", { onSubmit: event => { event.preventDefault(); void save(); }, children: _jsx("fieldset", { disabled: busy, style: { border: 0, padding: 0, margin: 0 }, children: _jsxs("div", { className: "dsi-stack", style: { marginTop: 20 }, children: [_jsxs("label", { className: "dsi-field", children: [_jsx("span", { children: "API Key \u51ED\u636E\u5F15\u7528" }), _jsx("input", { "data-setting": "apiKeyRef", value: draft.apiKeyRef, spellCheck: false, autoComplete: "off", onChange: event => setDraft({ ...draft, apiKeyRef: event.target.value }) }), _jsx("small", { children: "\u9ED8\u8BA4 INSTABOX_API_KEY\u3002\u914D\u7F6E\u6587\u4EF6\u53EA\u4FDD\u5B58\u5F15\u7528\uFF0C\u4E0D\u4FDD\u5B58\u5BC6\u94A5\u3002" })] }), _jsxs("label", { className: "dsi-field", children: [_jsxs("span", { children: ["API Key ", view.credential.configured ? '（已配置，留空保留）' : '（尚未配置）'] }), _jsx("input", { "data-setting": "apiKey", type: "password", value: apiKey, autoComplete: "new-password", spellCheck: false, disabled: !view.credential.writable && draft.apiKeyRef === view.config.apiKeyRef, onChange: event => { setApiKey(event.target.value); setClearApiKey(false); }, placeholder: "ibk_\u2026" }), _jsx("small", { children: "\u5BC6\u94A5\u4EC5\u53D1\u9001\u5230\u5F53\u524D DSH \u540E\u7AEF\uFF0C\u4E0D\u4F1A\u56DE\u663E\uFF0C\u4E5F\u4E0D\u4F1A\u5199\u5165\u6D4F\u89C8\u5668\u5B58\u50A8\u3002" })] }), _jsxs("label", { className: "dsi-check", children: [_jsx("input", { "data-setting": "clearApiKey", type: "checkbox", checked: clearApiKey, disabled: !view.credential.writable && draft.apiKeyRef === view.config.apiKeyRef, onChange: event => { setClearApiKey(event.target.checked); if (event.target.checked)
                                                setApiKey(''); } }), "\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684 API Key"] }), !view.credential.writable && _jsx("p", { className: "dsi-note", children: "\u6B64\u51ED\u636E\u6765\u6E90\u4E0D\u53EF\u5199\uFF0C\u8BF7\u5728\u542F\u52A8\u73AF\u5883\u4E2D\u4FEE\u6539\uFF0C\u6216\u4F7F\u7528\u53EF\u5199\u7684\u51ED\u636E\u5F15\u7528\u3002" }), _jsxs("label", { className: "dsi-field", children: [_jsx("span", { children: "\u9ED8\u8BA4\u673A\u5668\u6A21\u677F" }), _jsx("input", { "data-setting": "defaultTemplate", value: draft.defaultTemplate, spellCheck: false, onChange: event => setDraft({ ...draft, defaultTemplate: event.target.value }) }), _jsx("small", { children: "\u684C\u9762\u63A8\u8350 agent-browser\uFF1B\u514D\u8D39\u5957\u9910\u53EF\u7528\u6A21\u677F\u4EE5\u8D26\u6237\u4E3A\u51C6\u3002" })] }), _jsxs("label", { className: "dsi-field", children: [_jsx("span", { children: "\u5355\u6B21 HTTP \u8BF7\u6C42\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09" }), _jsx("input", { "data-setting": "requestTimeoutMs", type: "number", min: 5000, max: 120000, step: 1000, value: draft.requestTimeoutMs, onChange: event => setDraft({ ...draft, requestTimeoutMs: Number(event.target.value) }) }), _jsx("small", { children: "\u957F\u64CD\u4F5C\u5728\u63D2\u4EF6\u540E\u53F0\u6267\u884C\uFF0C\u901A\u8FC7\u77ED\u8BF7\u6C42\u67E5\u8BE2\u8FDB\u5EA6\u3002" })] }), _jsxs("label", { className: "dsi-check", children: [_jsx("input", { "data-setting": "modelToolsEnabled", type: "checkbox", checked: draft.modelToolsEnabled, onChange: event => setDraft({ ...draft, modelToolsEnabled: event.target.checked }) }), "\u5141\u8BB8\u6A21\u578B\u8C03\u7528 Instabox \u5DE5\u5177"] }), _jsxs("label", { className: "dsi-field", children: [_jsx("span", { children: "\u5BF9\u8BDD\u4E2D\u7684\u684C\u9762\u4F4D\u7F6E" }), _jsxs("select", { "data-setting": "desktopPlacement", value: draft.desktopPlacement, onChange: event => setDraft({ ...draft, desktopPlacement: event.target.value }), children: [_jsx("option", { value: "inline", children: "\u6700\u65B0\u6D88\u606F\u4E0B\u65B9" }), _jsx("option", { value: "sidebar", children: "\u53F3\u4FA7\u680F\u9884\u89C8" })] }), _jsx("small", { children: "\u4E91\u7535\u8111\u88AB\u4F7F\u7528\u65F6\u81EA\u52A8\u663E\u793A\u753B\u9762\uFF0C\u5B8C\u6210\u540E\u6536\u6210\u53EF\u5C55\u5F00\u7684\u6309\u94AE\u3002\u4E24\u79CD\u4F4D\u7F6E\u90FD\u53EF\u653E\u5927\u3001\u89C2\u770B\u548C\u63A5\u7BA1\u3002" })] }), _jsx("p", { className: "dsi-muted", children: "\u63A5\u7BA1\u65F6\uFF0C\u8BE5\u673A\u5668\u7684\u6A21\u578B\u53D8\u66F4\u64CD\u4F5C\u4F1A\u6682\u505C\uFF1B\u4EA4\u8FD8\u540E\u6062\u590D\u3002\u4E91\u673A\u8FD0\u884C\u3001\u78C1\u76D8\u548C\u6D41\u91CF\u53D7 Instabox \u5957\u9910\u53CA\u7528\u91CF\u9650\u5236\u3002" }), _jsxs("div", { className: "dsi-actions", children: [_jsx("button", { type: "submit", "data-action": "save-settings", className: "dsi-primary", disabled: busy, children: busy ? '保存中…' : '保存设置' }), _jsx("button", { type: "button", disabled: busy, onClick: () => setReload(value => value + 1), children: "\u91CD\u65B0\u8BFB\u53D6" }), _jsx("a", { href: "https://dashboard.instabox.sh/dashboard/api-keys", target: "_blank", rel: "noopener noreferrer", children: "\u521B\u5EFA API Key \u2197" })] })] }) }) })] });
}

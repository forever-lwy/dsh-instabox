import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIONS, defaultConfig } from '../shared.js';
import { base64ToBytes, bytesToBase64, listOf, machineIdOf, pretty, viewerUrl, waitForJob } from './face.js';
import { InstaboxSettings } from './Settings.js';
import { Resources } from './Resources.js';
const MIB = 1024 * 1024;
const id = () => typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const machineName = (machine) => String(machine?.name ?? machine?.machine?.name ?? machineIdOf(machine));
const stateName = (state) => ({ running: '运行中', suspended: '已暂停', stopped: '已停止', starting: '启动中', stopping: '停止中', paused: '已暂停' }[String(state)] ?? String(state ?? '未知'));
const terminalState = (job) => ({ queued: '等待中', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }[job.status]);
const parentPath = (path) => path.replace(/\/$/, '').replace(/\/[^/]*$/, '') || '/';
const childPath = (path, name) => `${path.replace(/\/$/, '')}/${name}`;
export function InstaboxIcon() {
    return _jsxs("svg", { className: "dsi-icon", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: [_jsx("rect", { x: "3", y: "4", width: "18", height: "13", rx: "2", stroke: "currentColor", strokeWidth: "1.6" }), _jsx("path", { d: "M8 21h8m-4-4v4M7 9l3 2-3 2m6 0h4", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" })] });
}
function ActionCard({ title, description, action, fields = [], run, disabled = false, dangerous = false, onResult, button }) {
    const [values, setValues] = useState(() => Object.fromEntries(fields.filter(field => field.value !== undefined).map(field => [field.key, field.value])));
    const [busy, setBusy] = useState(false), [result, setResult] = useState(), [error, setError] = useState('');
    const mounted = useRef(true), inFlight = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const submit = async (event) => {
        event.preventDefault();
        if (disabled || inFlight.current)
            return;
        const input = {};
        try {
            for (const field of fields) {
                const value = values[field.key];
                if (value === '' || value === undefined) {
                    if (field.required)
                        throw new Error(`请填写${field.label}。`);
                    continue;
                }
                input[field.key] = field.type === 'json' ? JSON.parse(value) : field.type === 'number' ? Number(value) : value;
            }
            if (dangerous && !window.confirm(`确认${title}？此操作可能中断任务或永久删除数据。`))
                return;
            inFlight.current = true;
            setBusy(true);
            setError('');
            const value = await run(action, input);
            if (mounted.current) {
                setResult(value);
                onResult?.(value);
            }
        }
        catch (reason) {
            if (mounted.current)
                setError(reason instanceof Error ? reason.message : '操作失败。');
        }
        finally {
            inFlight.current = false;
            if (mounted.current)
                setBusy(false);
        }
    };
    return _jsxs("form", { className: "dsi-card", onSubmit: event => void submit(event), children: [_jsx("h3", { children: title }), description && _jsx("p", { className: "dsi-muted", style: { marginTop: 6 }, children: description }), _jsxs("fieldset", { disabled: disabled || busy, style: { border: 0, margin: 0, padding: 0 }, children: [_jsx("div", { className: "dsi-fields", children: fields.map(field => field.type === 'checkbox' ? _jsxs("label", { className: "dsi-check", children: [_jsx("input", { type: "checkbox", checked: !!values[field.key], onChange: event => setValues({ ...values, [field.key]: event.target.checked }) }), field.label] }, field.key) :
                            _jsxs("label", { className: "dsi-field", children: [_jsxs("span", { children: [field.label, field.required ? ' *' : ''] }), field.options ? _jsx("select", { value: values[field.key] ?? '', onChange: event => setValues({ ...values, [field.key]: event.target.value }), children: field.options.map(option => _jsx("option", { value: option, children: option }, option)) }) :
                                        field.type === 'textarea' || field.type === 'json' ? _jsx("textarea", { required: field.required, spellCheck: false, value: values[field.key] ?? '', onChange: event => setValues({ ...values, [field.key]: event.target.value }) }) :
                                            _jsx("input", { required: field.required, type: field.type === 'number' ? 'number' : 'text', min: field.min, max: field.max, value: values[field.key] ?? '', spellCheck: false, onChange: event => setValues({ ...values, [field.key]: event.target.value }) }), field.hint && _jsx("small", { children: field.hint })] }, field.key)) }), _jsx("div", { className: "dsi-actions", style: { marginTop: 12 }, children: _jsx("button", { type: "submit", className: dangerous ? 'dsi-danger' : '', children: busy ? '执行中…' : button ?? title }) })] }), error && _jsx("p", { role: "alert", className: "dsi-error", children: error }), result !== undefined && _jsx("pre", { children: pretty(result) })] });
}
function Desktop({ run, machineId, ownerId, control, setControl }) {
    const [url, setUrl] = useState(''), [viewerMode, setViewerMode] = useState(null), [image, setImage] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [x, setX] = useState('0'), [y, setY] = useState('0'), [targetX, setTargetX] = useState('100'), [targetY, setTargetY] = useState('100');
    const [button, setButton] = useState('left'), [text, setText] = useState(''), [keys, setKeys] = useState('ctrl+l'), [website, setWebsite] = useState('https://example.com');
    const [scrollDirection, setScrollDirection] = useState('down'), [amount, setAmount] = useState(3), [width, setWidth] = useState(1280), [height, setHeight] = useState(800);
    const [clickScreenshot, setClickScreenshot] = useState(false);
    const viewer = useRef(null), imageRef = useRef(null), live = useRef(true);
    const pendingCleanup = control?.pendingCleanup === true;
    const mine = control?.mode === 'human' && control.ownerId === ownerId && !pendingCleanup;
    const other = control?.mode === 'human' && !mine && !pendingCleanup;
    useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    useEffect(() => {
        if (pendingCleanup) {
            setUrl('');
            setViewerMode(null);
        }
        else if (mine && control?.url) {
            try {
                setUrl(viewerUrl(control.url));
                setViewerMode('control');
            }
            catch (reason) {
                setError(String(reason));
                setUrl('');
                setViewerMode(null);
            }
        }
        else if (viewerMode === 'control') {
            setUrl('');
            setViewerMode(null);
        }
    }, [mine, pendingCleanup, control?.url, viewerMode]);
    const perform = async (action, input = {}, handler) => {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            const value = await run(action, input);
            if (live.current)
                handler?.(value);
        }
        catch (reason) {
            if (live.current)
                setError(reason instanceof Error ? reason.message : '桌面操作失败。');
        }
        finally {
            if (live.current)
                setBusy(false);
        }
    };
    const watch = () => void perform('desktop.view', { viewOnly: true, ttlSeconds: 600 }, value => { setUrl(viewerUrl(value.url)); setViewerMode('watch'); });
    const take = () => void perform('control.take', { ownerId }, value => { setControl(value); setUrl(viewerUrl(value.url)); setViewerMode('control'); });
    const release = () => { setUrl(''); setViewerMode(null); void perform('control.release', { ownerId }, value => setControl(value)); };
    const screenshot = () => void perform('desktop.screenshot', {}, value => {
        if (value.mimeType !== 'image/png' || typeof value.base64 !== 'string')
            throw new Error('截图格式无效。');
        setImage(`data:image/png;base64,${value.base64}`);
    });
    const inputDisabled = !mine || busy;
    return _jsxs("div", { className: "dsi-stack", children: [_jsxs("div", { className: "dsi-card", children: [_jsxs("div", { className: "dsi-actions", children: [_jsx("h2", { children: "\u4E91\u684C\u9762" }), _jsx("span", { className: `dsi-pill ${mine || other || pendingCleanup ? 'human' : ''}`, children: pendingCleanup ? '上次接管待清理' : mine ? '你正在接管' : other ? '其他窗口正在接管' : control?.mode === 'agent' ? '模型可操作' : '控制状态待确认' }), _jsx("span", { className: "dsi-operation", children: machineId })] }), _jsxs("div", { className: "dsi-actions", children: [_jsx("button", { type: "button", disabled: busy || other || pendingCleanup, onClick: watch, children: "\u67E5\u770B\u684C\u9762" }), pendingCleanup ? _jsx("button", { type: "button", "data-action": "cleanup-control", className: "dsi-primary", disabled: busy, onClick: release, children: "\u6E05\u7406\u5E76\u4EA4\u8FD8" }) : !mine ? _jsx("button", { type: "button", "data-action": "take-control", className: "dsi-primary", disabled: busy || other, onClick: take, children: "\u63A5\u7BA1\u952E\u9F20" }) : _jsx("button", { type: "button", "data-action": "release-control", className: "dsi-primary", disabled: busy, onClick: release, children: "\u4EA4\u8FD8\u7ED9\u6A21\u578B" }), _jsx("button", { type: "button", disabled: busy, onClick: screenshot, children: "\u622A\u56FE" }), _jsx("button", { type: "button", disabled: busy || other, onClick: () => {
                                    if (!window.confirm('撤销这台机器的全部桌面链接并断开所有观看者？'))
                                        return;
                                    setUrl('');
                                    setViewerMode(null);
                                    if (mine || pendingCleanup)
                                        release();
                                    else
                                        void perform('desktop.revoke', {}, () => { void run('control.status', {}, machineId, true).then(setControl).catch(() => { }); });
                                }, children: "\u64A4\u9500\u5168\u90E8\u684C\u9762\u94FE\u63A5" })] }), mine && _jsx("p", { className: "dsi-note", children: "\u63A5\u7BA1\u671F\u95F4\uFF0C\u63D2\u4EF6\u963B\u6B62\u6A21\u578B\u5BF9\u8FD9\u53F0\u673A\u5668\u53D1\u51FA\u65B0\u7684\u53D8\u66F4\u64CD\u4F5C\u3002\u5DF2\u5728\u4E91\u673A\u8FD0\u884C\u7684\u540E\u53F0\u8FDB\u7A0B\u4F1A\u7EE7\u7EED\u3002\u79BB\u5F00\u9762\u677F\u6216\u4EA4\u8FD8\u65F6\u5C06\u64A4\u9500\u4EA4\u4E92\u94FE\u63A5\u3002" }), pendingCleanup && _jsx("p", { className: "dsi-note", role: "status", children: "\u4E0A\u6B21\u63A5\u7BA1\u7684\u684C\u9762\u94FE\u63A5\u5C1A\u672A\u786E\u8BA4\u64A4\u9500\uFF0C\u6A21\u578B\u4ECD\u88AB\u9501\u5B9A\u3002\u8BF7\u5148\u6E05\u7406\u5E76\u4EA4\u8FD8\uFF1B\u82E5\u5BC6\u94A5\u5931\u6548\uFF0C\u53EF\u5728\u201C\u8BBE\u7F6E\u201D\u66F4\u65B0 API Key \u540E\u91CD\u8BD5\u3002\u6E05\u7406\u6210\u529F\u524D\u4E0D\u4F1A\u5F00\u653E\u6A21\u578B\u53D8\u66F4\u64CD\u4F5C\u3002" }), !mine && !pendingCleanup && _jsx("p", { className: "dsi-muted", style: { marginTop: 10 }, children: "\u89C2\u770B\u94FE\u63A5\u53EA\u8BFB\u3002\u70B9\u51FB\u201C\u63A5\u7BA1\u952E\u9F20\u201D\u540E\u53EF\u5728\u684C\u9762\u4E2D\u64CD\u4F5C\uFF1B\u94FE\u63A5\u7B49\u540C\u8BBF\u95EE\u51ED\u8BC1\uFF0C\u8BF7\u52FF\u8F6C\u53D1\u7ED9\u4ED6\u4EBA\u3002" }), error && _jsx("p", { role: "alert", className: "dsi-error", children: error })] }), url && !pendingCleanup && !(viewerMode === 'control' && !mine) ? _jsxs("div", { className: "dsi-view", ref: viewer, children: [_jsxs("div", { className: "dsi-viewbar", children: [_jsx("span", { children: viewerMode === 'control' ? '人工接管 · 可交互' : '实时桌面 · 只读' }), _jsxs("div", { className: "dsi-actions", children: [_jsx("a", { href: url, target: "_blank", rel: "noopener noreferrer", children: "\u65B0\u7A97\u53E3 \u2197" }), _jsx("button", { type: "button", onClick: () => { const pending = document.fullscreenElement ? document.exitFullscreen?.() : viewer.current?.requestFullscreen?.(); if (pending)
                                            void pending.catch(reason => setError(reason instanceof Error ? reason.message : '无法全屏'));
                                        else
                                            setError('当前浏览器未提供全屏功能。'); }, children: "\u5168\u5C4F" }), mine && _jsx("button", { type: "button", onClick: release, disabled: busy, children: "\u4EA4\u8FD8" }), _jsx("button", { type: "button", onClick: () => setUrl(''), children: "\u9690\u85CF\u753B\u9762" })] })] }), _jsx("iframe", { title: viewerMode === 'control' ? 'Instabox 人工接管桌面' : 'Instabox 只读桌面', src: url, allow: "clipboard-read; clipboard-write; fullscreen", allowFullScreen: true, referrerPolicy: "no-referrer" }, `${machineId}:${viewerMode}:${url}`)] }) : _jsxs("div", { className: "dsi-view dsi-empty", style: { color: '#ddd' }, children: [_jsx(InstaboxIcon, {}), _jsx("p", { children: pendingCleanup ? '桌面接管待清理，交互画面已关闭。' : '打开桌面观看或接管；机器须处于运行状态。' }), _jsx("small", { children: "\u672C\u7248\u7EC4\u7EC7 Key \u652F\u6301\u622A\u56FE\u548C\u6A21\u578B\u5DE5\u5177\uFF1B\u4EBA\u5DE5\u952E\u9F20\u63A5\u7BA1\u4E0E\u5B9E\u65F6\u684C\u9762\u9700\u4F7F\u7528\u521B\u5EFA\u673A\u5668\u7684\u4E2A\u4EBA Key\u3002" })] }), image && _jsxs("div", { className: "dsi-card dsi-shot", children: [_jsxs("div", { className: "dsi-actions", children: [_jsx("h3", { children: "\u6700\u65B0\u622A\u56FE" }), _jsxs("label", { className: "dsi-check", children: [_jsx("input", { type: "checkbox", checked: clickScreenshot, disabled: !mine, onChange: event => setClickScreenshot(event.target.checked) }), "\u70B9\u51FB\u622A\u56FE\u53D1\u9001\u9F20\u6807\u70B9\u51FB"] }), _jsx("button", { type: "button", onClick: () => { const link = document.createElement('a'); link.href = image; link.download = `instabox-${machineId}.png`; link.click(); }, children: "\u4FDD\u5B58 PNG" })] }), _jsx("img", { className: "dsi-preview", ref: imageRef, src: image, alt: "Instabox \u4E91\u684C\u9762\u622A\u56FE", onClick: event => {
                            const node = imageRef.current;
                            if (!node || !mine)
                                return;
                            const box = node.getBoundingClientRect();
                            const px = Math.floor((event.clientX - box.left) * node.naturalWidth / box.width), py = Math.floor((event.clientY - box.top) * node.naturalHeight / box.height);
                            setX(String(px));
                            setY(String(py));
                            if (clickScreenshot && !busy)
                                void perform('desktop.click', { x: px, y: py, button });
                        } })] }), _jsxs("div", { className: "dsi-grid", children: [_jsxs("div", { className: "dsi-card", children: [_jsx("h3", { children: "\u952E\u9F20\u4E0E\u8F93\u5165" }), _jsx("p", { className: "dsi-muted", style: { marginTop: 6 }, children: "\u5148\u63A5\u7BA1\uFF0C\u907F\u514D\u4E0E\u6A21\u578B\u540C\u65F6\u64CD\u4F5C\u3002\u5750\u6807\u4EE5\u5B8C\u6574\u5C4F\u5E55\u5DE6\u4E0A\u89D2\u4E3A\u539F\u70B9\u3002" }), _jsxs("fieldset", { disabled: inputDisabled, style: { border: 0, padding: 0, margin: 0 }, children: [_jsxs("div", { className: "dsi-fields", children: [_jsxs("label", { className: "dsi-field", children: ["X", _jsx("input", { className: "dsi-coordinate", type: "number", min: 0, value: x, onChange: event => setX(event.target.value) })] }), _jsxs("label", { className: "dsi-field", children: ["Y", _jsx("input", { className: "dsi-coordinate", type: "number", min: 0, value: y, onChange: event => setY(event.target.value) })] }), _jsxs("label", { className: "dsi-field", children: ["\u9F20\u6807\u952E", _jsxs("select", { value: button, onChange: event => setButton(event.target.value), children: [_jsx("option", { value: "left", children: "\u5DE6\u952E" }), _jsx("option", { value: "right", children: "\u53F3\u952E" }), _jsx("option", { value: "middle", children: "\u4E2D\u952E" })] })] })] }), _jsxs("div", { className: "dsi-actions", style: { marginTop: 10 }, children: [_jsx("button", { type: "button", onClick: () => void perform('desktop.click', { x: Number(x), y: Number(y), button }), children: "\u5355\u51FB" }), _jsx("button", { type: "button", onClick: () => void perform('desktop.click', { x: Number(x), y: Number(y), button, double: true }), children: "\u53CC\u51FB" }), _jsx("button", { type: "button", onClick: () => void perform('desktop.move', { x: Number(x), y: Number(y) }), children: "\u79FB\u52A8\u6307\u9488" }), _jsx("button", { type: "button", onClick: () => void perform('desktop.cursor', {}, v => { setX(String(v.x)); setY(String(v.y)); }), children: "\u8BFB\u53D6\u5750\u6807" })] }), _jsxs("div", { className: "dsi-fields", children: [_jsxs("label", { className: "dsi-field", children: ["\u62D6\u62FD\u76EE\u6807 X", _jsx("input", { type: "number", min: 0, value: targetX, onChange: event => setTargetX(event.target.value) })] }), _jsxs("label", { className: "dsi-field", children: ["\u62D6\u62FD\u76EE\u6807 Y", _jsx("input", { type: "number", min: 0, value: targetY, onChange: event => setTargetY(event.target.value) })] })] }), _jsx("div", { className: "dsi-actions", style: { marginTop: 10 }, children: _jsx("button", { type: "button", onClick: () => void perform('desktop.drag', { from: [Number(x), Number(y)], to: [Number(targetX), Number(targetY)] }), children: "\u62D6\u62FD\u5230\u76EE\u6807" }) }), _jsxs("div", { className: "dsi-fields", children: [_jsxs("label", { className: "dsi-field", children: ["\u6EDA\u52A8\u65B9\u5411", _jsx("select", { value: scrollDirection, onChange: event => setScrollDirection(event.target.value), children: [['up', '上'], ['down', '下'], ['left', '左'], ['right', '右']].map(([value, label]) => _jsx("option", { value: value, children: label }, value)) })] }), _jsxs("label", { className: "dsi-field", children: ["\u683C\u6570", _jsx("input", { type: "number", min: 1, max: 100, value: amount, onChange: event => setAmount(Number(event.target.value)) })] })] }), _jsx("div", { className: "dsi-actions", style: { marginTop: 10 }, children: _jsx("button", { type: "button", onClick: () => void perform('desktop.scroll', { direction: scrollDirection, amount }), children: "\u6EDA\u52A8" }) }), _jsxs("label", { className: "dsi-field", style: { marginTop: 14 }, children: ["\u8F93\u5165\u5230\u5F53\u524D\u7126\u70B9", _jsx("textarea", { value: text, onChange: event => setText(event.target.value), placeholder: "\u652F\u6301\u4E2D\u6587\u3001\u591A\u884C\u6587\u672C" })] }), _jsx("div", { className: "dsi-actions", style: { marginTop: 10 }, children: _jsx("button", { type: "button", onClick: () => void perform('desktop.type', { text }), children: "\u8F93\u5165\u6587\u672C" }) }), _jsxs("label", { className: "dsi-field", style: { marginTop: 14 }, children: ["\u6309\u952E\u6216\u7EC4\u5408\u952E", _jsx("input", { value: keys, onChange: event => setKeys(event.target.value), placeholder: "Enter \u6216 ctrl+l" })] }), _jsx("div", { className: "dsi-actions", style: { marginTop: 10 }, children: _jsx("button", { type: "button", onClick: () => void perform('desktop.press', { keys: keys.includes('+') ? keys.split('+').map(key => key.trim()) : keys }), children: "\u53D1\u9001\u6309\u952E" }) }), _jsxs("label", { className: "dsi-field", style: { marginTop: 14 }, children: ["\u6253\u5F00\u7F51\u9875", _jsx("input", { type: "url", value: website, onChange: event => setWebsite(event.target.value) })] }), _jsx("div", { className: "dsi-actions", style: { marginTop: 10 }, children: _jsx("button", { type: "button", onClick: () => void perform('desktop.open', { url: website }), children: "\u5728\u4E91\u6D4F\u89C8\u5668\u6253\u5F00" }) })] })] }), _jsxs("div", { className: "dsi-card", children: [_jsx("h3", { children: "\u684C\u9762\u670D\u52A1" }), _jsxs("div", { className: "dsi-fields", children: [_jsxs("label", { className: "dsi-field", children: ["\u5BBD\u5EA6", _jsx("input", { type: "number", min: 800, max: 2560, value: width, onChange: event => setWidth(Number(event.target.value)) })] }), _jsxs("label", { className: "dsi-field", children: ["\u9AD8\u5EA6", _jsx("input", { type: "number", min: 600, max: 1600, value: height, onChange: event => setHeight(Number(event.target.value)) })] })] }), _jsxs("div", { className: "dsi-actions", children: [_jsx("button", { type: "button", disabled: busy || other || pendingCleanup, onClick: () => void perform('desktop.start', { width, height }), children: "\u542F\u52A8\u684C\u9762\u670D\u52A1" }), _jsx("button", { type: "button", disabled: busy, onClick: () => void perform('desktop.status', {}, v => setError(`桌面状态：${pretty(v)}`)), children: "\u67E5\u8BE2\u72B6\u6001" })] }), _jsx("p", { className: "dsi-muted", style: { marginTop: 14 }, children: "\u542F\u52A8\u4F1A\u4FDD\u7559\u5DF2\u8FD0\u884C\u7684\u684C\u9762\u3002\u90E8\u5206\u6A21\u677F\u9996\u6B21\u4F7F\u7528\u9700\u8981\u5B89\u88C5\u684C\u9762\uFF1B\u514D\u8D39\u5957\u9910\u63A8\u8350 agent-browser\u3002\u622A\u56FE\u5DE5\u5177\u53EF\u8FD4\u56DE\u56FE\u7247\u7ED9\u652F\u6301\u89C6\u89C9\u8F93\u5165\u7684\u6A21\u578B\u3002" })] })] })] });
}
function Terminal({ run }) {
    const [jobs, setJobs] = useState([]), [output, setOutput] = useState(''), [error, setError] = useState('');
    const refresh = async () => { try {
        const value = await run('jobs.list');
        setJobs(listOf(value, 'jobs'));
    }
    catch (reason) {
        setError(String(reason));
    } };
    return _jsxs("div", { className: "dsi-stack", children: [_jsx(ActionCard, { title: "\u6267\u884C\u4E91\u7AEF\u547D\u4EE4", description: "\u547D\u4EE4\u8FD0\u884C\u5728\u9009\u4E2D\u7684 Instabox \u4E91\u673A\uFF0C\u4E0D\u662F DSH \u6240\u5728\u670D\u52A1\u5668\u3002\u957F\u4EFB\u52A1\u52FE\u9009\u540E\u53F0\u6267\u884C\uFF0C\u7136\u540E\u67E5\u8BE2\u65E5\u5FD7\u3002", action: "commands.run", run: run, fields: [{ key: 'cmd', label: '命令', type: 'textarea', required: true }, { key: 'cwd', label: '工作目录', value: '/data/home' }, { key: 'timeoutSeconds', label: '前台超时（秒）', type: 'number', value: 60, min: 1, max: 600 }, { key: 'background', label: '后台执行', type: 'checkbox', value: false }, { key: 'envs', label: '环境变量 JSON', type: 'json', hint: '例如 {"NODE_ENV":"test"}' }, { key: 'stdin', label: '标准输入', type: 'textarea' }] }), _jsxs("div", { className: "dsi-card", children: [_jsxs("div", { className: "dsi-actions", children: [_jsx("h3", { children: "\u540E\u53F0\u4EFB\u52A1" }), _jsx("button", { type: "button", onClick: () => void refresh(), children: "\u5237\u65B0\u4EFB\u52A1" })] }), error && _jsx("p", { className: "dsi-error", role: "alert", children: error }), jobs.length === 0 ? _jsx("p", { className: "dsi-muted", style: { marginTop: 10 }, children: "\u5237\u65B0\u4EE5\u8BFB\u53D6\u4E91\u673A\u4E2D\u7684\u540E\u53F0\u4EFB\u52A1\u3002" }) : _jsx("div", { className: "dsi-scroll", children: _jsxs("table", { className: "dsi-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u4EFB\u52A1" }), _jsx("th", { children: "\u72B6\u6001" }), _jsx("th", { children: "\u64CD\u4F5C" })] }) }), _jsx("tbody", { children: jobs.map((job, index) => { const jobId = String(job.jobId ?? job.id ?? index); return _jsxs("tr", { children: [_jsx("td", { children: jobId }), _jsx("td", { children: job.state ?? job.status ?? (job.exitCode === undefined ? '运行中' : `退出 ${job.exitCode}`) }), _jsx("td", { children: _jsxs("div", { className: "dsi-actions", children: [_jsx("button", { type: "button", onClick: () => void run('jobs.get', { jobId, tail: 200 }).then(v => setOutput(pretty(v))).catch(reason => setError(String(reason))), children: "\u72B6\u6001\u4E0E\u65E5\u5FD7" }), _jsx("button", { type: "button", className: "dsi-danger", onClick: () => { if (window.confirm('终止这个后台任务？'))
                                                                void run('jobs.kill', { jobId }).then(() => refresh()).catch(reason => setError(String(reason))); }, children: "\u7EC8\u6B62" })] }) })] }, jobId); }) })] }) }), output && _jsx("pre", { children: output })] }), _jsx(ActionCard, { title: "\u6309\u4EFB\u52A1 ID \u67E5\u8BE2\u65E5\u5FD7", action: "jobs.get", run: run, fields: [{ key: 'jobId', label: '任务 ID', required: true }, { key: 'tail', label: '末尾行数', type: 'number', value: 200, min: 1, max: 2000 }] })] });
}
function Files({ run }) {
    const [path, setPath] = useState('/data/home'), [entries, setEntries] = useState([]), [selected, setSelected] = useState(''), [content, setContent] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const perform = async (task) => { if (busy)
        return; setBusy(true); setError(''); setMessage(''); try {
        await task();
    }
    catch (reason) {
        if (mounted.current)
            setError(reason instanceof Error ? reason.message : String(reason));
    }
    finally {
        if (mounted.current)
            setBusy(false);
    } };
    const browse = async (target = path) => { const value = await run('files.list', { path: target }); if (mounted.current) {
        setPath(target);
        setEntries(listOf(value, 'entries', 'files'));
    } };
    const read = async (target) => { const value = await run('files.read', { path: target, format: 'text' }); if (mounted.current) {
        setSelected(target);
        setContent(String(value.content ?? ''));
    } };
    const download = async (target) => { const value = await run('files.read', { path: target, format: 'base64' }); const bytes = base64ToBytes(value.content); const blob = new Blob([bytes.buffer], { type: 'application/octet-stream' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = target.split('/').at(-1) || 'download'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    const upload = async (file) => { if (file.size > 10 * MIB)
        throw new Error('单个文件最大 10 MiB。'); const target = childPath(path, file.name); if (entries.some(item => item.name === file.name) && !window.confirm(`覆盖 ${target}？`))
        return; const bytes = new Uint8Array(await file.arrayBuffer()); await run('files.write', { path: target, format: 'base64', content: bytesToBase64(bytes) }); await browse(); if (mounted.current)
        setMessage(`已上传 ${file.name}`); };
    return _jsxs("div", { className: "dsi-stack", children: [_jsxs("div", { className: "dsi-card", children: [_jsx("h3", { children: "\u4E91\u673A\u6587\u4EF6" }), _jsx("div", { className: "dsi-fields", children: _jsxs("label", { className: "dsi-field", children: ["\u76EE\u5F55", _jsx("input", { value: path, onChange: event => setPath(event.target.value), spellCheck: false })] }) }), _jsxs("div", { className: "dsi-actions", children: [_jsx("button", { type: "button", disabled: busy, onClick: () => void perform(() => browse()), children: "\u6253\u5F00\u76EE\u5F55" }), _jsx("button", { type: "button", disabled: busy, onClick: () => void perform(() => browse(parentPath(path))), children: "\u4E0A\u4E00\u7EA7" }), _jsxs("label", { className: "dsi-upload", "aria-disabled": busy, children: ["\u4E0A\u4F20\u6587\u4EF6", _jsx("input", { "aria-label": "\u4E0A\u4F20\u6587\u4EF6", type: "file", disabled: busy, onChange: event => { const file = event.target.files?.[0]; event.target.value = ''; if (file)
                                            void perform(() => upload(file)); } })] }), _jsx("small", { children: "\u5355\u6B21\u4E0A\u4F20\u3001\u4E0B\u8F7D\u6700\u591A 10 MiB" })] }), error && _jsx("p", { role: "alert", className: "dsi-error", children: error }), message && _jsx("p", { role: "status", className: "dsi-good", children: message }), _jsx("div", { className: "dsi-stack", style: { marginTop: 12 }, children: entries.map((entry, index) => { const target = String(entry.path ?? childPath(path, entry.name)), directory = entry.type === 'dir' || entry.type === 'directory'; return _jsxs("div", { className: "dsi-file", children: [_jsxs("button", { type: "button", disabled: busy, onClick: () => void perform(() => directory ? browse(target) : read(target)), children: [directory ? '▸' : '·', " ", entry.name ?? target] }), !directory && _jsx("button", { type: "button", disabled: busy, onClick: () => void perform(() => download(target)), children: "\u4E0B\u8F7D" }), _jsx("button", { type: "button", disabled: busy, className: "dsi-danger", onClick: () => { if (window.confirm(`永久删除 ${target}${directory ? ' 及其全部内容' : ''}？`))
                                        void perform(async () => { await run('files.remove', { path: target, confirm: target }); await browse(); }); }, children: "\u5220\u9664" })] }, `${target}-${index}`); }) })] }), _jsxs("div", { className: "dsi-card", children: [_jsx("h3", { children: "\u6587\u672C\u7F16\u8F91\u5668" }), _jsxs("label", { className: "dsi-field", style: { marginTop: 12 }, children: ["\u6587\u4EF6\u8DEF\u5F84", _jsx("input", { value: selected, onChange: event => setSelected(event.target.value), spellCheck: false, placeholder: "/data/home/notes.txt" })] }), _jsxs("label", { className: "dsi-field", style: { marginTop: 10 }, children: ["\u5185\u5BB9", _jsx("textarea", { className: "dsi-json", value: content, onChange: event => setContent(event.target.value), spellCheck: false })] }), _jsxs("div", { className: "dsi-actions", children: [_jsx("button", { type: "button", disabled: busy || !selected, onClick: () => void perform(() => read(selected)), children: "\u8BFB\u53D6\u6587\u672C" }), _jsx("button", { type: "button", className: "dsi-primary", disabled: busy || !selected, onClick: () => { if (window.confirm(`保存并覆盖 ${selected}？`))
                                    void perform(async () => { await run('files.write', { path: selected, format: 'text', content }); setMessage('文件已保存。'); }); }, children: "\u4FDD\u5B58\u6587\u4EF6" }), _jsx("button", { type: "button", disabled: busy || !selected, onClick: () => void perform(() => download(selected)), children: "\u4E0B\u8F7D\u6587\u4EF6" })] })] })] });
}
function Snapshots({ run, refreshMachines, machineId }) {
    const [snapshots, setSnapshots] = useState([]), [error, setError] = useState('');
    const refresh = async () => { try {
        setSnapshots(listOf(await run('snapshots.list'), 'snapshots', 'images'));
    }
    catch (reason) {
        setError(String(reason));
    } };
    return _jsxs("div", { className: "dsi-stack", children: [_jsxs("div", { className: "dsi-card", children: [_jsxs("div", { className: "dsi-actions", children: [_jsx("h3", { children: "\u8D26\u6237\u5FEB\u7167" }), _jsx("button", { type: "button", onClick: () => void refresh(), children: "\u5237\u65B0\u5FEB\u7167" })] }), error && _jsx("p", { className: "dsi-error", role: "alert", children: error }), _jsx("div", { className: "dsi-scroll", children: _jsxs("table", { className: "dsi-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u540D\u79F0 / ID" }), _jsx("th", { children: "\u72B6\u6001" }), _jsx("th", { children: "\u64CD\u4F5C" })] }) }), _jsx("tbody", { children: snapshots.map((snapshot, index) => { const snapshotId = String(snapshot.id ?? snapshot.snapshotId ?? index); return _jsxs("tr", { children: [_jsxs("td", { children: [snapshot.name, _jsx("small", { style: { display: 'block' }, children: snapshotId })] }), _jsx("td", { children: snapshot.status ?? snapshot.state ?? '—' }), _jsx("td", { children: _jsxs("div", { className: "dsi-actions", children: [_jsx("button", { type: "button", onClick: () => void run('snapshots.get', { snapshotId }).catch(reason => setError(String(reason))), children: "\u8BE6\u60C5" }), _jsx("button", { type: "button", onClick: () => { if (window.confirm('从此快照创建一台新机器？可能产生费用。'))
                                                                void run('machines.create', { snapshotId }).then(() => refreshMachines()).catch(reason => setError(String(reason))); }, children: "\u521B\u5EFA\u673A\u5668" }), _jsx("button", { type: "button", className: "dsi-danger", onClick: () => { if (window.confirm('永久删除此快照？'))
                                                                void run('snapshots.delete', { snapshotId, confirm: snapshotId }).then(() => refresh()).catch(reason => setError(String(reason))); }, children: "\u5220\u9664" })] }) })] }, snapshotId); }) })] }) })] }), _jsx(ActionCard, { title: "\u4FDD\u5B58\u5F53\u524D\u673A\u5668\u5FEB\u7167", action: "snapshots.create", run: run, disabled: !machineId, fields: [{ key: 'name', label: '快照名称', required: true }, { key: 'description', label: '描述' }, { key: 'rootOnly', label: '仅保存系统盘（不含 /data）', type: 'checkbox', value: false }], onResult: () => void refresh() })] });
}
function Network({ run }) {
    const [ports, setPorts] = useState([]), [error, setError] = useState('');
    const refresh = async () => { try {
        const value = await run('ports.list');
        setPorts(listOf(value, 'ports', 'publicPorts'));
    }
    catch (reason) {
        setError(String(reason));
    } };
    return _jsxs("div", { className: "dsi-stack", children: [_jsxs("div", { className: "dsi-card", children: [_jsxs("div", { className: "dsi-actions", children: [_jsx("h3", { children: "\u5DF2\u53D1\u5E03\u7AEF\u53E3" }), _jsx("button", { type: "button", onClick: () => void refresh(), children: "\u5237\u65B0\u7AEF\u53E3" })] }), error && _jsx("p", { className: "dsi-error", role: "alert", children: error }), ports.length === 0 ? _jsx("p", { className: "dsi-muted", style: { marginTop: 10 }, children: "\u5237\u65B0\u4EE5\u8BFB\u53D6\u5DF2\u53D1\u5E03\u7684 HTTPS \u670D\u52A1\u5165\u53E3\u3002" }) : _jsx("div", { className: "dsi-scroll", children: _jsxs("table", { className: "dsi-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u7AEF\u53E3" }), _jsx("th", { children: "\u5165\u53E3" }), _jsx("th", { children: "\u64CD\u4F5C" })] }) }), _jsx("tbody", { children: ports.map((port, index) => { const address = port.url ?? port.privateUrl ?? port.publicUrl; let href = ''; try {
                                        const u = new URL(address);
                                        if (u.protocol === 'https:')
                                            href = u.href;
                                    }
                                    catch { } return _jsxs("tr", { children: [_jsxs("td", { children: [port.port, " ", port.name] }), _jsx("td", { children: href ? _jsx("a", { href: href, target: "_blank", rel: "noopener noreferrer", children: "\u6253\u5F00\u670D\u52A1 \u2197" }) : pretty(port) }), _jsx("td", { children: _jsx("button", { type: "button", className: "dsi-danger", onClick: () => { if (window.confirm('取消发布此端口？'))
                                                        void run('ports.unpublish', { port: Number(port.port) }).then(() => refresh()).catch(reason => setError(String(reason))); }, children: "\u53D6\u6D88\u53D1\u5E03" }) })] }, port.port ?? index); }) })] }) })] }), _jsx(ActionCard, { title: "\u53D1\u5E03\u4E91\u673A\u7AEF\u53E3", description: "\u79C1\u6709\u5165\u53E3\u4F7F\u7528\u6301\u6709\u5373\u8BBF\u95EE\u7684\u4EE4\u724C\u94FE\u63A5\uFF1B\u516C\u5F00\u5165\u53E3\u5141\u8BB8\u4EFB\u4F55\u4EBA\u8BBF\u95EE\u3002", action: "ports.publish", run: run, onResult: () => void refresh(), fields: [{ key: 'port', label: '端口', type: 'number', value: 3000, min: 1, max: 65535, required: true }, { key: 'name', label: '名称' }, { key: 'access', label: '访问范围', options: ['private', 'public'], value: 'private' }, { key: 'rotateToken', label: '轮换私有令牌', type: 'checkbox', value: false }] }), _jsx(ActionCard, { title: "\u751F\u6210 SSH \u767B\u5F55\u51ED\u8BC1", description: "\u53EA\u63D0\u4EA4 SSH \u516C\u94A5\uFF1B\u79C1\u94A5\u7559\u5728\u4F60\u7684\u7535\u8111\u3002\u8FD4\u56DE\u7684\u77ED\u65F6\u8BC1\u4E66\u548C\u4E3B\u673A\u4FE1\u606F\u7528\u4E8E\u672C\u673A ssh \u767B\u5F55\u3002", action: "ssh.credentials", run: run, fields: [{ key: 'publicKey', label: 'SSH 公钥', type: 'textarea', required: true }, { key: 'ttlSeconds', label: '有效期（秒）', type: 'number', value: 3600, min: 1, max: 86400 }] })] });
}
function Advanced({ run, machineId }) {
    const allowed = ACTIONS.filter(action => !action.startsWith('control.') && !['desktop.takeover', 'desktop.handback', 'desktop.revoke', 'desktop.view'].includes(action));
    const [action, setAction] = useState('machines.get'), [input, setInput] = useState('{}'), [result, setResult] = useState(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const examples = { 'machines.get': {}, 'machines.update': { persistentDiskGiB: 50 }, 'machines.fork': { name: 'my-copy' }, 'machines.logs': { tail: 200 }, 'machines.delete': { confirm: machineId }, 'operations.get': { operationId: 'op_…' }, 'desktop.drag': { from: [100, 100], to: [200, 200] }, 'desktop.press': { keys: ['ctrl', 'l'] }, 'snapshots.delete': { snapshotId: 'sn_…', confirm: 'sn_…' } };
    return _jsxs("div", { className: "dsi-card", children: [_jsx("h3", { children: "\u5B8C\u6574\u64CD\u4F5C\u63A5\u53E3" }), _jsx("p", { className: "dsi-muted", style: { marginTop: 8 }, children: "\u7528\u4E8E\u673A\u5668\u89C4\u683C\u3001\u65E5\u5FD7\u3001\u5F02\u6B65 operation\u3001\u5FEB\u7167\u8BE6\u60C5\u7B49\u9AD8\u7EA7\u64CD\u4F5C\u3002\u8F93\u5165\u683C\u5F0F\u53C2\u89C1\u63D2\u4EF6\u8BF4\u660E\uFF1B\u8F93\u5165\u6309\u540E\u7AEF\u63A5\u53E3\u4E25\u683C\u6821\u9A8C\u3002\u684C\u9762\u63A5\u7BA1\u7531\u201C\u684C\u9762\u201D\u9875\u7684\u63A7\u5236\u6309\u94AE\u7BA1\u7406\u3002" }), _jsxs("form", { onSubmit: event => { event.preventDefault(); if (busy)
                    return; void (async () => { try {
                    const value = JSON.parse(input);
                    if (!value || typeof value !== 'object' || Array.isArray(value))
                        throw new Error('输入必须是 JSON 对象。');
                    if (/delete|remove|stop|kill|unpublish/.test(action) && !window.confirm(`确认执行 ${action}？`))
                        return;
                    setBusy(true);
                    setError('');
                    setResult(await run(action, value));
                }
                catch (reason) {
                    setError(reason instanceof Error ? reason.message : String(reason));
                }
                finally {
                    setBusy(false);
                } })(); }, children: [_jsx("div", { className: "dsi-fields", children: _jsxs("label", { className: "dsi-field", children: ["\u64CD\u4F5C", _jsx("select", { "data-field": "advanced-action", value: action, onChange: event => { const value = event.target.value; setAction(value); setInput(JSON.stringify(examples[value] ?? {}, null, 2)); }, children: allowed.map(value => _jsx("option", { value: value, children: value }, value)) })] }) }), _jsxs("label", { className: "dsi-field", style: { marginTop: 12 }, children: ["\u8F93\u5165 JSON", _jsx("textarea", { "data-field": "advanced-input", className: "dsi-json", value: input, onChange: event => setInput(event.target.value), spellCheck: false })] }), _jsxs("div", { className: "dsi-actions", style: { marginTop: 12 }, children: [_jsx("button", { type: "submit", disabled: busy, children: busy ? '执行中…' : '执行操作' }), _jsx("a", { href: "https://instabox.sh/docs/api", target: "_blank", rel: "noopener noreferrer", children: "\u5B98\u65B9 API \u6587\u6863 \u2197" })] })] }), error && _jsx("p", { role: "alert", className: "dsi-error", children: error }), result !== undefined && _jsx("pre", { children: pretty(result) })] });
}
export function InstaboxPanel({ face, closePanel }) {
    const [settings, setSettings] = useState(null), [machines, setMachines] = useState([]), [machineId, setMachineId] = useState('');
    const [tab, setTab] = useState('desktop'), [create, setCreate] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
    const [control, setControl] = useState(null), [history, setHistory] = useState([]);
    const ownerId = useRef(id()).current, lifetime = useRef(null), faceRef = useRef(face), machineRef = useRef(machineId), controlRef = useRef(control);
    faceRef.current = face;
    machineRef.current = machineId;
    controlRef.current = control;
    const updateJob = useCallback((job) => { if (!lifetime.current?.signal.aborted)
        setHistory(previous => [job, ...previous.filter(item => item.jobId !== job.jobId)].slice(0, 24)); }, []);
    const run = useCallback(async (action, input = {}, target, quiet = false) => {
        const signal = lifetime.current?.signal;
        if (!signal || signal.aborted)
            throw new Error('面板已关闭。');
        const request = { action, input, ...((target ?? machineRef.current) ? { machineId: target ?? machineRef.current } : {}), clientId: ownerId };
        const initial = await faceRef.current.execute(request, signal);
        const done = await waitForJob(faceRef.current, initial, signal, quiet ? undefined : updateJob);
        return done.result;
    }, [ownerId, updateJob]);
    const refresh = useCallback(async () => {
        const value = await run('machines.list', {}, '', true);
        const list = listOf(value, 'machines');
        if (!lifetime.current?.signal.aborted) {
            setMachines(list);
            setMachineId(previous => list.some(item => machineIdOf(item) === previous) ? previous : machineIdOf(list[0]));
            setError('');
        }
    }, [run]);
    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        void faceRef.current.read(controller.signal).then(async (value) => {
            if (controller.signal.aborted)
                return;
            setSettings(value);
            if (value.credential.configured)
                await refresh();
            else
                setTab('settings');
        }).catch(reason => { if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : String(reason)); })
            .finally(() => { if (!controller.signal.aborted)
            setLoading(false); });
        return () => { controller.abort(); };
    }, [refresh]);
    useEffect(() => {
        if (!machineId)
            return;
        let active = true;
        const status = () => void run('control.status', {}, machineId, true).then(value => { if (active)
            setControl(value); }).catch(() => { });
        status();
        const timer = setInterval(() => {
            const lease = controlRef.current;
            if (lease?.mode === 'human' && lease.ownerId === ownerId && !lease.pendingCleanup) {
                void run('control.renew', { ownerId }, machineId, true).then(value => { if (active)
                    setControl(previous => ({ ...value, url: previous?.url })); }).catch(reason => {
                    if (!active)
                        return;
                    setError(`接管续期失败，已隐藏交互桌面并核对控制状态：${reason instanceof Error ? reason.message : String(reason)}`);
                    setControl(previous => previous ? { ...previous, url: undefined } : previous);
                    void run('control.status', {}, machineId, true).then(value => { if (active)
                        setControl({ ...value, url: undefined }); }).catch(() => { });
                });
            }
            else
                status();
        }, 10000);
        return () => {
            active = false;
            clearInterval(timer);
            // This independent request must outlive the React component and its
            // aborted polling signal. The Host validates ownerId before revocation.
            void faceRef.current.execute({ action: 'control.release', machineId, input: { ownerId }, clientId: ownerId }).catch(() => { });
            setControl(null);
        };
    }, [machineId, ownerId, run]);
    const selected = machines.find(item => machineIdOf(item) === machineId);
    const mutate = async (action, input = {}) => { try {
        await run(action, input);
        await refresh();
    }
    catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
    } };
    const requireMachine = !machineId && !['settings', 'resources', 'snapshots', 'advanced'].includes(tab);
    return _jsxs("main", { className: "dsi", "aria-label": "Instabox \u4E91\u7535\u8111", children: [_jsxs("header", { className: "dsi-head", children: [_jsxs("div", { children: [_jsxs("div", { className: "dsi-brand", children: [_jsx(InstaboxIcon, {}), _jsx("h1", { children: "Instabox \u4E91\u7535\u8111" })] }), _jsx("p", { children: "\u72EC\u7ACB Linux \u4E91\u673A \u00B7 \u684C\u9762 \u00B7 \u4EBA\u5DE5\u63A5\u7BA1" })] }), _jsxs("div", { className: "dsi-actions", children: [_jsx("button", { type: "button", disabled: loading || !settings?.credential.configured, onClick: () => void refresh().catch(reason => setError(String(reason))), children: "\u5237\u65B0\u673A\u5668" }), _jsx("button", { type: "button", "data-action": "new-machine", disabled: !settings?.credential.configured, className: "dsi-primary", onClick: () => setCreate(value => !value), children: "\u65B0\u5EFA\u673A\u5668" }), closePanel && _jsx("button", { type: "button", onClick: closePanel, children: "\u8FD4\u56DE\u4F1A\u8BDD" })] })] }), error && _jsx("p", { role: "alert", className: "dsi-error", children: error }), loading && _jsx("p", { role: "status", className: "dsi-loading", children: "\u6B63\u5728\u8BFB\u53D6\u914D\u7F6E\u4E0E\u673A\u5668\u2026" }), create && _jsx("div", { style: { marginBottom: 14 }, children: _jsx(ActionCard, { title: "\u521B\u5EFA\u72EC\u7ACB\u4E91\u673A", description: "\u4F1A\u5360\u7528 Instabox \u914D\u989D\uFF1B\u4ED8\u8D39\u5957\u9910\u53EF\u80FD\u4EA7\u751F\u7528\u91CF\u8D39\u7528\u3002\u9ED8\u8BA4\u4E0D\u6CE8\u5165\u4E2A\u4EBA Vault \u6216\u7EC4\u7EC7 Secrets\u3002", action: "machines.create", run: run, fields: [
                        { key: 'name', label: '名称', hint: '小写字母、数字和短横线' }, { key: 'templateId', label: '模板', value: settings?.config.defaultTemplate ?? defaultConfig().defaultTemplate }, { key: 'snapshotId', label: '或从快照 ID 创建', hint: '填写快照时请清空模板' },
                        { key: 'vcpus', label: 'vCPU（可选）', type: 'number', min: 1, max: 32 }, { key: 'memMiB', label: '内存 MiB（可选）', type: 'number', min: 1024, max: 65536 }, { key: 'metadata', label: '标签 JSON', type: 'json' }
                    ], onResult: () => { setCreate(false); void refresh(); } }) }), _jsxs("div", { className: "dsi-machinebar", children: [_jsx("span", { children: "\u5F53\u524D\u673A\u5668" }), _jsxs("select", { "aria-label": "\u5F53\u524D\u673A\u5668", value: machineId, onChange: event => setMachineId(event.target.value), children: [_jsx("option", { value: "", children: machines.length ? '请选择机器' : '暂无机器' }), machines.map(machine => _jsxs("option", { value: machineIdOf(machine), children: [machineName(machine), " \u00B7 ", stateName(machine.state ?? machine.machine?.state)] }, machineIdOf(machine)))] }), selected && _jsxs(_Fragment, { children: [_jsx("span", { className: "dsi-pill", children: stateName(selected.state ?? selected.machine?.state) }), _jsxs("div", { className: "dsi-actions", children: [_jsx("button", { type: "button", onClick: () => void mutate('machines.start'), children: "\u542F\u52A8" }), _jsx("button", { type: "button", onClick: () => void mutate('machines.resume'), children: "\u6062\u590D" }), _jsx("button", { type: "button", onClick: () => { if (window.confirm('暂停机器并保留内存状态？'))
                                            void mutate('machines.suspend'); }, children: "\u6682\u505C" }), _jsx("button", { type: "button", onClick: () => { if (window.confirm('关闭机器？正在运行的进程会结束。'))
                                            void mutate('machines.stop'); }, children: "\u5173\u673A" }), _jsx("button", { type: "button", className: "dsi-danger", onClick: () => { if (window.confirm(`永久删除 ${machineName(selected)} 及其全部磁盘数据？`))
                                            void mutate('machines.delete', { confirm: machineId }); }, children: "\u5220\u9664" })] })] })] }), _jsx("nav", { className: "dsi-tabs", "aria-label": "\u4E91\u673A\u529F\u80FD", role: "tablist", children: [['desktop', '桌面'], ['terminal', '终端与任务'], ['files', '文件'], ['snapshots', '快照'], ['network', '端口与 SSH'], ['resources', '资源与用量'], ['advanced', '高级操作'], ['settings', '设置']].map(([key, label]) => _jsx("button", { type: "button", role: "tab", "aria-selected": tab === key, "data-tab": key, onClick: () => setTab(key), children: label }, key)) }), tab === 'settings' ? _jsx(InstaboxSettings, { face: face, onSaved: value => { setSettings(value); if (value.credential.configured)
                    void refresh().catch(reason => setError(String(reason))); } }) :
                requireMachine ? _jsxs("div", { className: "dsi-empty", children: [_jsx(InstaboxIcon, {}), _jsx("p", { children: settings?.credential.configured ? '创建或选择一台云机后开始操作。' : '先在设置中保存 Instabox API Key。' }), _jsx("button", { type: "button", onClick: () => setTab('settings'), children: "\u6253\u5F00\u8BBE\u7F6E" })] }) :
                    _jsxs("div", { role: "tabpanel", "aria-label": tab, children: [tab === 'desktop' && _jsx(Desktop, { run: run, machineId: machineId, ownerId: ownerId, control: control, setControl: setControl }), tab === 'terminal' && _jsx(Terminal, { run: run }), tab === 'files' && _jsx(Files, { run: run }), tab === 'snapshots' && _jsx(Snapshots, { run: run, refreshMachines: refresh, machineId: machineId }), tab === 'network' && _jsx(Network, { run: run }), tab === 'resources' && _jsxs("div", { className: "dsi-stack", children: [_jsx(Resources, { run: run, machineId: machineId, onUpdated: refresh }), _jsx(ActionCard, { title: "\u590D\u5236\u5F53\u524D\u673A\u5668", action: "machines.fork", run: run, disabled: !machineId, fields: [{ key: 'name', label: '新机器名称' }, { key: 'metadata', label: '标签 JSON', type: 'json' }], onResult: () => void refresh() })] }), tab === 'advanced' && _jsx(Advanced, { run: run, machineId: machineId })] }, `${machineId}:${tab}`), history.length > 0 && _jsxs("details", { className: "dsi-card", style: { marginTop: 20 }, children: [_jsxs("summary", { children: ["\u6700\u8FD1\u64CD\u4F5C \u00B7 ", history.filter(job => ['queued', 'running'].includes(job.status)).length, " \u4E2A\u6267\u884C\u4E2D"] }), _jsx("div", { className: "dsi-jobs", style: { marginTop: 12 }, children: history.map(job => _jsxs("details", { className: "dsi-job", children: [_jsxs("summary", { children: [terminalState(job), " \u00B7 ", job.action, " ", _jsx("small", { children: new Date(job.createdAt).toLocaleTimeString() })] }), job.error ? _jsx("p", { role: "alert", className: "dsi-error", children: job.error }) : _jsx("pre", { children: pretty(job.result ?? { jobId: job.jobId, status: job.status }) })] }, job.jobId)) })] })] });
}

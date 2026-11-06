import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { pretty } from './face.js';
import { array, bytes, changedSpec, duration, emptyDraft, finite, gibibytes, GiB, machineData, machineSpec, mebibytes, number, percentage, record, specDraft, stateLabel, timestamp, usd } from './resources-data.js';
const actions = { machine: 'machines.get', account: 'account.me', quota: 'account.usage', metrics: 'metrics.get', disk: 'machines.disk', usage: 'usage.get', templates: 'templates.list', logs: 'machines.logs' };
const machineKeys = new Set(['machine', 'metrics', 'disk', 'usage', 'logs']);
const emptyEntries = () => Object.fromEntries(Object.keys(actions).map(key => [key, { loading: false }]));
const title = { machine: '当前机器', account: '账户与可用规格', quota: '账户配额与账单', metrics: 'CPU 与内存', disk: '磁盘空间', usage: '本机累计用量', templates: '可用模板', logs: '机器日志与操作' };
function Rows({ items }) {
    return _jsx("dl", { className: "dsi-resource-rows", children: items.map(([label, value]) => _jsxs("div", { children: [_jsx("dt", { children: label }), _jsx("dd", { children: value ?? '未提供' })] }, label)) });
}
function Stat({ label, value, hint }) {
    return _jsxs("div", { className: "dsi-resource-stat", children: [_jsx("span", { children: label }), _jsx("strong", { children: value }), hint && _jsx("small", { children: hint })] });
}
function Meter({ label, used, total, unit = '', format = number }) {
    const maximum = finite(total), current = finite(used), ratio = percentage(current, maximum);
    return _jsxs("div", { className: "dsi-resource-meter", children: [_jsxs("div", { children: [_jsx("span", { children: label }), _jsxs("span", { children: [current === undefined ? '未提供' : format(current), maximum === undefined ? ' / 上限未提供' : maximum < 0 ? ' / 不限' : ` / ${format(maximum)}`, unit ? ` ${unit}` : ''] })] }), ratio !== undefined && _jsx("progress", { "aria-label": label, value: ratio, max: 100 })] });
}
function Raw({ value }) { return value === undefined ? null : _jsxs("details", { className: "dsi-resource-raw", children: [_jsx("summary", { children: "\u67E5\u770B\u539F\u59CB\u54CD\u5E94" }), _jsx("pre", { children: pretty(value) })] }); }
function Card({ name, entry, retry, children, disabled = false }) {
    return _jsxs("section", { className: "dsi-card dsi-resource-card", "data-resource": name, "aria-busy": entry.loading, children: [_jsxs("div", { className: "dsi-resource-heading", children: [_jsx("h3", { children: title[name] }), _jsx("button", { type: "button", disabled: entry.loading || disabled, onClick: retry, children: "\u5237\u65B0" })] }), entry.loading && entry.value === undefined && _jsx("p", { className: "dsi-muted", role: "status", children: "\u8BFB\u53D6\u4E2D\u2026" }), entry.error && _jsx("p", { className: "dsi-error", role: "alert", children: entry.error }), children, _jsx(Raw, { value: entry.value })] });
}
/** API reads are independent: a missing metrics scope does not hide the disk,
 * quota, or the editable specification. Generation guards discard late reads
 * and saves from the machine the user has already left. */
export function Resources({ run, machineId, onUpdated }) {
    const [entries, setEntries] = useState(emptyEntries), [entriesMachine, setEntriesMachine] = useState(machineId), [epoch, setEpoch] = useState(0);
    const [original, setOriginal] = useState(emptyDraft), [draft, setDraft] = useState(emptyDraft), [specMachine, setSpecMachine] = useState(machineId);
    const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(''), [message, setMessage] = useState('');
    const generation = useRef(0), mounted = useRef(false), current = useRef(machineId), latest = useRef({ run, onUpdated }), saveInFlight = useRef(false);
    latest.current = { run, onUpdated };
    current.current = machineId;
    const read = useCallback(async (key, target, version) => {
        if (machineKeys.has(key) && !target)
            return false;
        const valid = () => mounted.current && generation.current === version && current.current === target;
        if (valid())
            setEntries(previous => ({ ...previous, [key]: { ...previous[key], loading: true, error: undefined } }));
        try {
            const value = await latest.current.run(actions[key], key === 'logs' ? { tail: 200 } : {}, machineKeys.has(key) ? target : '', true);
            if (!valid())
                return false;
            setEntries(previous => ({ ...previous, [key]: { value, loading: false } }));
            if (key === 'machine') {
                const values = specDraft(value);
                setOriginal(values);
                setDraft(values);
                setSpecMachine(target);
            }
            return true;
        }
        catch (error) {
            if (valid())
                setEntries(previous => ({ ...previous, [key]: { ...previous[key], loading: false, error: error instanceof Error ? error.message : '读取失败，请重试。' } }));
            return false;
        }
    }, []);
    useEffect(() => {
        mounted.current = true;
        const version = ++generation.current;
        setEntries(emptyEntries());
        setEntriesMachine(machineId);
        setOriginal(emptyDraft());
        setDraft(emptyDraft());
        setSpecMachine(machineId);
        setSaving(false);
        saveInFlight.current = false;
        setSaveError('');
        setMessage('');
        for (const key of Object.keys(actions))
            void read(key, machineId, version);
        return () => { mounted.current = false; generation.current++; };
    }, [machineId, epoch, read]);
    const data = entriesMachine === machineId ? entries : emptyEntries();
    const machine = machineData(data.machine.value), spec = machineSpec(data.machine.value), account = record(data.account.value), quota = record(data.quota.value), limits = record(quota.limits), cost = record(quota.cost);
    const samples = array(data.metrics.value, 'metrics'), latestSample = record(samples.at(-1)), disk = record(data.disk.value ?? record(data.metrics.value).disk), filesystems = array(disk, 'filesystems'), usage = record(data.usage.value);
    const templates = array(data.templates.value, 'templates'), logs = record(data.logs.value), operations = array(logs, 'operations'), allowed = array(account, 'allowedSpecs');
    const draftValues = specMachine === machineId ? draft : emptyDraft(), originalValues = specMachine === machineId ? original : emptyDraft();
    const dirty = Object.keys(draftValues).some(key => draftValues[key] !== originalValues[key]);
    const refresh = (key) => void read(key, machineId, generation.current);
    const save = async () => {
        if (saveInFlight.current || !machineId || !data.machine.value)
            return;
        let input;
        try {
            input = changedSpec(draftValues, originalValues);
        }
        catch (error) {
            setSaveError(error instanceof Error ? error.message : '规格输入无效。');
            return;
        }
        if (!Object.keys(input).length) {
            setMessage('当前没有需要保存的修改。');
            return;
        }
        const version = generation.current, target = machineId;
        const valid = () => mounted.current && generation.current === version && current.current === target;
        saveInFlight.current = true;
        setSaving(true);
        setSaveError('');
        setMessage('');
        try {
            await latest.current.run('machines.update', input, target);
            if (!valid())
                return;
            const refreshed = await read('machine', target, version);
            if (!valid())
                return;
            setMessage(refreshed ? '修改已提交，已重新读取服务器当前规格。' : '修改已提交，但读取最新规格失败，请刷新“当前机器”卡片核对。');
            try {
                await latest.current.onUpdated();
            }
            catch {
                if (valid())
                    setMessage('修改已提交；刷新未完成，请手动刷新机器列表和当前规格。');
            }
        }
        catch (error) {
            if (valid())
                setSaveError(error instanceof Error ? error.message : '保存失败。');
        }
        finally {
            if (valid()) {
                saveInFlight.current = false;
                setSaving(false);
            }
        }
    };
    const specField = (key, label, min, max, hint) => _jsxs("label", { className: "dsi-field", children: [_jsx("span", { children: label }), _jsx("input", { "data-spec": key, type: "number", min: min, max: max, step: 1, value: draftValues[key], placeholder: "\u670D\u52A1\u672A\u63D0\u4F9B\u5F53\u524D\u503C", onChange: event => { setDraft(previous => ({ ...previous, [key]: event.target.value })); setMessage(''); setSaveError(''); } }), hint && _jsx("small", { children: hint })] }, key);
    return _jsxs("div", { className: "dsi-stack dsi-resources", children: [_jsxs("div", { className: "dsi-resource-heading", children: [_jsxs("div", { children: [_jsx("h2", { children: "\u8D44\u6E90\u4E0E\u7528\u91CF" }), _jsx("p", { className: "dsi-muted", children: "\u81EA\u52A8\u8BFB\u53D6\u5F53\u524D\u673A\u5668\u548C\u8D26\u6237\u6570\u636E\uFF1B\u91D1\u989D\u4EC5\u5C55\u793A\u5E73\u53F0\u5DF2\u8FD4\u56DE\u7684\u8BA1\u91CF\u7ED3\u679C\u3002" })] }), _jsx("button", { type: "button", disabled: saving, onClick: () => setEpoch(value => value + 1), children: "\u5237\u65B0\u5168\u90E8" })] }), _jsxs("div", { className: "dsi-grid", children: [_jsx(Card, { name: "machine", entry: data.machine, disabled: !machineId || saving, retry: () => refresh('machine'), children: !machineId ? _jsx("p", { className: "dsi-muted", children: "\u5148\u9009\u62E9\u4E00\u53F0\u673A\u5668\u67E5\u770B\u8BE6\u60C5\u3002" }) : data.machine.value !== undefined && _jsxs(_Fragment, { children: [_jsxs("div", { className: "dsi-resource-stats", children: [_jsx(Stat, { label: "vCPU", value: spec.vcpus === undefined ? '未提供' : `${number(spec.vcpus, 0)} 核` }), _jsx(Stat, { label: "\u5185\u5B58", value: mebibytes(spec.memMiB) }), _jsx(Stat, { label: "\u6301\u4E45\u76D8 /data", value: gibibytes(spec.persistentDiskGiB) })] }), _jsx(Rows, { items: [["机器名称", machine.name], ["机器 ID", machine.id ?? machineId], ["状态", stateLabel(machine.state)], ["模板", record(machine.template).id ?? machine.templateId], ["空闲暂停", spec.autoSuspendAfterSeconds === undefined ? '未提供' : spec.autoSuspendAfterSeconds === 0 ? '关闭（保持运行）' : duration(spec.autoSuspendAfterSeconds)], ["创建时间", timestamp(machine.createdAt)]] }), machine.metadata && Object.keys(record(machine.metadata)).length > 0 && _jsxs("p", { className: "dsi-muted", children: ["\u6807\u7B7E\uFF1A", Object.entries(record(machine.metadata)).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')] }), record(machine.lastError).message && _jsx("p", { className: "dsi-error", children: String(record(machine.lastError).message) })] }) }), _jsx(Card, { name: "metrics", entry: data.metrics, disabled: !machineId, retry: () => refresh('metrics'), children: !machineId ? _jsx("p", { className: "dsi-muted", children: "\u9009\u62E9\u673A\u5668\u540E\u67E5\u770B\u5B9E\u65F6\u6307\u6807\u3002" }) : data.metrics.value !== undefined && (samples.length === 0 ? _jsx("p", { className: "dsi-muted", children: "\u5E73\u53F0\u5C1A\u672A\u8FD4\u56DE\u91C7\u6837\u3002\u65B0\u673A\u5668\u901A\u5E38\u7EA6 30 \u79D2\u540E\u6709\u9996\u4E2A\u6837\u672C\uFF1B\u6682\u505C\u7684\u673A\u5668\u53EF\u80FD\u6CA1\u6709\u8FD1\u671F\u6570\u636E\u3002" }) : _jsxs(_Fragment, { children: [_jsxs("div", { className: "dsi-resource-stats", children: [_jsx(Stat, { label: "CPU \u4F7F\u7528\u7387", value: finite(latestSample.cpuUsedPct) === undefined ? '未提供' : `${number(latestSample.cpuUsedPct)}%`, hint: finite(latestSample.cpuCount) === undefined ? undefined : `${number(latestSample.cpuCount, 0)} vCPU` }), _jsx(Stat, { label: "\u5185\u5B58\u5360\u7528", value: bytes(latestSample.memUsed), hint: `总量 ${bytes(latestSample.memTotal)}` })] }), _jsx(Meter, { label: "CPU", used: latestSample.cpuUsedPct, total: 100, unit: "%" }), _jsx(Meter, { label: "\u5185\u5B58", used: latestSample.memUsed, total: latestSample.memTotal, format: bytes }), ['netInBytesPerSec', 'netOutBytesPerSec', 'diskReadBytesPerSec', 'diskWriteBytesPerSec'].some(key => finite(latestSample[key]) !== undefined) && _jsx(Rows, { items: [["网络接收", finite(latestSample.netInBytesPerSec) === undefined ? '未提供' : `${bytes(latestSample.netInBytesPerSec)}/秒`], ["网络发送", finite(latestSample.netOutBytesPerSec) === undefined ? '未提供' : `${bytes(latestSample.netOutBytesPerSec)}/秒`], ["磁盘读取", finite(latestSample.diskReadBytesPerSec) === undefined ? '未提供' : `${bytes(latestSample.diskReadBytesPerSec)}/秒`], ["磁盘写入", finite(latestSample.diskWriteBytesPerSec) === undefined ? '未提供' : `${bytes(latestSample.diskWriteBytesPerSec)}/秒`]] }), _jsxs("p", { className: "dsi-muted", children: ["\u91C7\u6837\u65F6\u95F4\uFF1A", timestamp(latestSample.timestamp), " \u00B7 \u5171 ", samples.length, " \u4E2A\u6837\u672C"] })] })) }), _jsx(Card, { name: "disk", entry: data.disk, disabled: !machineId, retry: () => refresh('disk'), children: !machineId ? _jsx("p", { className: "dsi-muted", children: "\u9009\u62E9\u673A\u5668\u540E\u67E5\u770B\u78C1\u76D8\u7A7A\u95F4\u3002" }) : filesystems.length > 0 ? _jsxs(_Fragment, { children: [filesystems.map((filesystem, index) => _jsxs("div", { className: "dsi-resource-filesystem", children: [_jsxs("div", { className: "dsi-resource-heading", children: [_jsx("strong", { children: filesystem.mount ?? '磁盘' }), _jsx("span", { className: `dsi-pill ${['high', 'critical', 'full'].includes(filesystem.level) ? 'human' : ''}`, children: { ok: '空间正常', high: '空间偏高', critical: '空间紧张', full: '已满' }[filesystem.level] ?? '已测量' })] }), _jsx(Meter, { label: `${filesystem.mount ?? '磁盘'} 已用`, used: filesystem.usedBytes, total: filesystem.sizeBytes, format: bytes }), _jsx(Rows, { items: [["可用空间", bytes(filesystem.availableBytes)], ["空间占用", finite(filesystem.usedPct) === undefined ? '未提供' : `${number(filesystem.usedPct)}%`], ["inode 使用率", finite(filesystem.inodesUsedPct) === undefined ? '未提供' : `${number(filesystem.inodesUsedPct)}%`]] })] }, filesystem.mount ?? index)), _jsxs("p", { className: "dsi-muted", children: ["\u6D4B\u91CF\u65F6\u95F4\uFF1A", timestamp(disk.measuredAt)] }), disk.warning && _jsx("p", { className: "dsi-note", children: typeof disk.warning === 'string' ? disk.warning : String(record(disk.warning).message ?? '请检查磁盘空间。') })] }) : data.disk.value !== undefined && _jsx("p", { className: "dsi-muted", children: "\u5E73\u53F0\u5C1A\u672A\u8FD4\u56DE\u6587\u4EF6\u7CFB\u7EDF\u5BB9\u91CF\uFF1B\u53EF\u7A0D\u540E\u5237\u65B0\u3002" }) }), _jsx(Card, { name: "usage", entry: data.usage, disabled: !machineId, retry: () => refresh('usage'), children: !machineId ? _jsx("p", { className: "dsi-muted", children: "\u9009\u62E9\u673A\u5668\u540E\u67E5\u770B\u7D2F\u8BA1\u7528\u91CF\u3002" }) : data.usage.value !== undefined && _jsxs(_Fragment, { children: [_jsxs("div", { className: "dsi-resource-stats", children: [_jsx(Stat, { label: "\u7D2F\u8BA1\u8FD0\u884C", value: duration(usage.runningSeconds) }), _jsx(Stat, { label: "CPU \u7528\u91CF", value: finite(usage.vcpuSeconds) === undefined ? '未提供' : `${number(usage.vcpuSeconds / 3600, 2)} vCPU·小时` })] }), _jsx(Rows, { items: [["内存用量", finite(usage.memGiBSeconds) === undefined ? '未提供' : `${number(usage.memGiBSeconds / 3600, 2)} GiB·小时`], ["磁盘用量", finite(usage.diskGiBSeconds) === undefined ? '未提供' : `${number(usage.diskGiBSeconds / 3600, 2)} GiB·小时`], ["开始时间", timestamp(usage.from)], ["截至时间", timestamp(usage.to)]] }), _jsx("p", { className: "dsi-muted", children: "\u9ED8\u8BA4\u7EDF\u8BA1\u672C\u6708\uFF08UTC\uFF09\u81F3\u4ECA\u3002\u8D44\u6E90\u7528\u91CF\u4E0D\u662F\u8D26\u5355\u91D1\u989D\u3002" })] }) })] }), _jsxs("section", { className: "dsi-card", "data-resource": "specification", children: [_jsx("h3", { children: "\u8C03\u6574\u673A\u5668\u89C4\u683C\u4E0E\u78C1\u76D8" }), _jsx("p", { className: "dsi-muted", children: "\u4E0B\u65B9\u662F\u670D\u52A1\u5668\u8FD4\u56DE\u7684\u5F53\u524D\u503C\u3002\u4EC5\u63D0\u4EA4\u5B9E\u9645\u4FEE\u6539\u7684\u5B57\u6BB5\uFF1B\u4FEE\u6539 CPU \u6216\u5185\u5B58\u901A\u5E38\u9700\u8981\u5148\u5173\u673A\uFF0C\u5957\u9910\u9650\u5236\u4EE5\u5E73\u53F0\u53CD\u9988\u4E3A\u51C6\u3002" }), !machineId && _jsx("p", { className: "dsi-note", children: "\u5148\u9009\u62E9\u4E00\u53F0\u673A\u5668\u3002" }), data.machine.error && _jsx("p", { className: "dsi-error", children: "\u5F53\u524D\u89C4\u683C\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u5148\u5237\u65B0\u201C\u5F53\u524D\u673A\u5668\u201D\u5361\u7247\u3002" }), _jsx("form", { onSubmit: event => { event.preventDefault(); void save(); }, children: _jsxs("fieldset", { disabled: !machineId || !data.machine.value || data.machine.loading || saving, style: { border: 0, padding: 0, margin: 0 }, children: [_jsxs("div", { className: "dsi-fields", children: [specField('vcpus', 'vCPU（核）', 1, 32), specField('memMiB', '内存（MiB）', 1024, 65536, spec.memMiB === undefined ? undefined : `当前 ${mebibytes(spec.memMiB)}`), specField('persistentDiskGiB', '持久盘 /data（GiB）', 1, 1024), specField('autoSuspendAfterSeconds', '空闲暂停（秒）', 0, 1800, '0 为关闭；免费套餐通常固定 1800 秒。')] }), allowed.length > 0 && _jsxs("p", { className: "dsi-muted", style: { marginTop: 10 }, children: ["\u8D26\u6237\u53EF\u9009\u89C4\u683C\uFF1A", allowed.map(item => `${number(item.vcpus, 0)} 核 / ${mebibytes(item.memMiB)}`).join('；')] }), _jsxs("div", { className: "dsi-actions", style: { marginTop: 14 }, children: [_jsx("button", { type: "submit", "data-action": "save-specification", className: "dsi-primary", disabled: !dirty || saving, children: saving ? '保存中…' : '保存修改' }), _jsx("button", { type: "button", disabled: !dirty || saving, onClick: () => { setDraft({ ...originalValues }); setSaveError(''); setMessage(''); }, children: "\u8FD8\u539F\u5F53\u524D\u503C" })] })] }) }), saveError && _jsx("p", { className: "dsi-error", role: "alert", children: saveError }), message && _jsx("p", { className: data.machine.error ? 'dsi-note' : 'dsi-good', role: "status", children: message })] }), _jsxs("div", { className: "dsi-grid", children: [_jsx(Card, { name: "quota", entry: data.quota, retry: () => refresh('quota'), children: data.quota.value !== undefined && _jsxs(_Fragment, { children: [_jsx(Meter, { label: "\u673A\u5668\u914D\u989D", used: quota.machines, total: limits.maxMachines, unit: "\u53F0" }), _jsx(Meter, { label: "\u5FEB\u7167\u914D\u989D", used: quota.snapshots ?? quota.images, total: limits.maxSnapshots ?? limits.maxImages, unit: "\u4E2A" }), quota.computedAt === null ? _jsx("p", { className: "dsi-muted", children: "\u5B58\u50A8\u5360\u7528\u7B49\u5F85\u5E73\u53F0\u9996\u6B21\u7EDF\u8BA1\u3002" }) : _jsx(Meter, { label: "\u5B58\u50A8\u5360\u7528", used: quota.storedBytes, total: finite(limits.maxStoredGiB) === undefined ? undefined : limits.maxStoredGiB < 0 ? -1 : limits.maxStoredGiB * GiB, format: bytes }), _jsxs("p", { className: "dsi-muted", children: ["\u5B58\u50A8\u7EDF\u8BA1\u65F6\u95F4\uFF1A", timestamp(quota.computedAt)] }), finite(cost.costUSD) === undefined ? _jsx("p", { className: "dsi-muted", children: "\u670D\u52A1\u5C1A\u672A\u8FD4\u56DE\u8D26\u5355\u91D1\u989D\u3002\u8D26\u5355\u4EE5 Instabox \u63A7\u5236\u53F0\u4E3A\u51C6\u3002" }) : _jsxs(_Fragment, { children: [_jsxs("div", { className: "dsi-resource-stats", children: [_jsx(Stat, { label: "\u672C\u6708\u5DF2\u8BA1\u91CF\u8D39\u7528", value: usd(cost.costUSD) }), _jsx(Stat, { label: "\u5305\u542B\u989D\u5EA6\u5269\u4F59", value: usd(cost.creditRemainingUSD) })] }), _jsx(Rows, { items: [["计算费用", usd(cost.runtimeUSD)], ["存储费用", usd(cost.storageUSD)], ["出站流量费用", usd(cost.egressUSD)], ["本月包含额度", usd(cost.allowanceUSD)], ["超出包含额度", usd(cost.overageUSD)], ["额外点数余额", usd(cost.creditsUSD)], ["计量截至", timestamp(cost.ratedUntil)]] }), _jsx("p", { className: "dsi-muted", children: "\u5DF2\u8BA1\u91CF\u8D39\u7528\u6309\u5E73\u53F0\u8D26\u5355\u5468\u671F\u7EDF\u8BA1\uFF0C\u4E0D\u5305\u542B\u672A\u6765\u9884\u6D4B\u3002\u505C\u673A\u652F\u51FA\u9650\u989D\u4F59\u91CF\u4E0D\u4F5C\u4E3A\u8D26\u6237\u4F59\u989D\u5C55\u793A\u3002" })] })] }) }), _jsx(Card, { name: "account", entry: data.account, retry: () => refresh('account'), children: data.account.value !== undefined && _jsxs(_Fragment, { children: [_jsx(Rows, { items: [["名称", account.name ?? account.login], ["登录名", account.login], ["邮箱", account.email], ["用户 ID", account.userId], ["凭据范围", account.orgId ? '组织空间' : '个人空间'], ["组织", record(account.org).name ?? account.orgId ?? '—']] }), allowed.length > 0 && _jsxs("p", { className: "dsi-muted", children: ["\u53EF\u7528\u8BA1\u7B97\u89C4\u683C\uFF1A", allowed.map(item => `${number(item.vcpus, 0)} vCPU / ${mebibytes(item.memMiB)}`).join('；')] }), finite(account.fixedAutoSuspendSeconds) !== undefined && _jsxs("p", { className: "dsi-muted", children: ["\u8D26\u6237\u56FA\u5B9A\u7A7A\u95F2\u6682\u505C\uFF1A", duration(account.fixedAutoSuspendSeconds)] })] }) })] }), _jsx(Card, { name: "templates", entry: data.templates, retry: () => refresh('templates'), children: data.templates.value !== undefined && (templates.length === 0 ? _jsx("p", { className: "dsi-muted", children: "\u5E73\u53F0\u672A\u8FD4\u56DE\u53EF\u7528\u6A21\u677F\u3002" }) : _jsx("div", { className: "dsi-scroll", children: _jsxs("table", { className: "dsi-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u6A21\u677F" }), _jsx("th", { children: "\u8BF4\u660E" }), _jsx("th", { children: "\u9ED8\u8BA4\u89C4\u683C" }), _jsx("th", { children: "\u53EF\u521B\u5EFA" })] }) }), _jsx("tbody", { children: templates.map((template, index) => _jsxs("tr", { children: [_jsxs("td", { children: [template.id, _jsxs("small", { style: { display: 'block' }, children: [template.version ?? '', template.default ? ' · 默认' : ''] })] }), _jsx("td", { children: template.description ?? '—' }), _jsxs("td", { children: [number(record(template.defaultSpec).vcpus, 0), " \u6838 / ", mebibytes(record(template.defaultSpec).memMiB), " / ", gibibytes(record(template.defaultSpec).persistentDiskGiB)] }), _jsx("td", { children: template.creatable === false || template.hidden === true ? '不可创建' : template.creatable === true ? '可创建' : '以套餐与实际创建结果为准' })] }, `${template.id}-${template.version ?? index}`)) })] }) })) }), _jsx(Card, { name: "logs", entry: data.logs, disabled: !machineId, retry: () => refresh('logs'), children: !machineId ? _jsx("p", { className: "dsi-muted", children: "\u9009\u62E9\u673A\u5668\u540E\u67E5\u770B\u63A7\u5236\u53F0\u65E5\u5FD7\u4E0E\u64CD\u4F5C\u8BB0\u5F55\u3002" }) : data.logs.value !== undefined && _jsxs(_Fragment, { children: [_jsxs("div", { className: "dsi-resource-heading", children: [_jsx("strong", { children: "\u63A7\u5236\u53F0\u8F93\u51FA" }), _jsx("span", { className: "dsi-pill", children: stateLabel(logs.state) })] }), logs.consoleUnavailable && _jsx("p", { className: "dsi-note", children: typeof logs.consoleUnavailable === 'string' ? logs.consoleUnavailable : '平台暂时无法提供控制台输出。' }), logs.consoleTruncated && _jsx("p", { className: "dsi-muted", children: "\u4EC5\u663E\u793A\u6700\u8FD1\u8F93\u51FA\uFF0C\u8F83\u65E9\u5185\u5BB9\u5DF2\u622A\u65AD\u3002" }), logs.consoleReset && _jsx("p", { className: "dsi-muted", children: "\u63A7\u5236\u53F0\u8BB0\u5F55\u5DF2\u5728\u673A\u5668\u91CD\u542F\u540E\u91CD\u7F6E\u3002" }), typeof logs.console === 'string' && logs.console ? _jsx("pre", { "aria-label": "\u673A\u5668\u63A7\u5236\u53F0\u65E5\u5FD7", children: logs.console }) : _jsx("p", { className: "dsi-muted", children: "\u6682\u65E0\u63A7\u5236\u53F0\u8F93\u51FA\u3002" }), operations.length > 0 && _jsx("div", { className: "dsi-scroll", children: _jsxs("table", { className: "dsi-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u64CD\u4F5C" }), _jsx("th", { children: "\u72B6\u6001" }), _jsx("th", { children: "\u65F6\u95F4" }), _jsx("th", { children: "\u8BF4\u660E" })] }) }), _jsx("tbody", { children: operations.map((operation, index) => _jsxs("tr", { children: [_jsx("td", { children: { create: '创建', start: '启动', stop: '关机', suspend: '暂停', resume: '恢复', delete: '删除', fork: '复制' }[operation.type] ?? operation.type ?? operation.id }), _jsx("td", { children: stateLabel(operation.state) }), _jsx("td", { children: timestamp(operation.createdAt ?? operation.startedAt) }), _jsx("td", { children: record(operation.error).message ?? '—' })] }, operation.id ?? index)) })] }) })] }) })] });
}

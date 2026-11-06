/** Presentation of the official REST/SDK units. Missing values stay unknown;
 * this module never estimates prices or turns a spend limit into a balance. */
export const GiB = 1024 ** 3;
export const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
export const number = (value, digits = 1) => finite(value) === undefined ? '未提供' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits });
export function bytes(value) {
    const amount = finite(value);
    if (amount === undefined || amount < 0)
        return '未提供';
    if (amount < 1024)
        return `${number(amount, 0)} B`;
    if (amount < 1024 ** 2)
        return `${number(amount / 1024)} KiB`;
    if (amount < GiB)
        return `${number(amount / 1024 ** 2)} MiB`;
    return `${number(amount / GiB, 2)} GiB`;
}
export const gibibytes = (value) => finite(value) === undefined ? '未提供' : `${number(value, 2)} GiB`;
export const mebibytes = (value) => finite(value) === undefined ? '未提供' : `${number(value / 1024, 2)} GiB`;
export const usd = (value) => finite(value) === undefined ? '未提供' : `${number(value, 2)} USD`;
export function timestamp(value) {
    if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date))
        return '未提供';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未提供';
}
export function duration(value) {
    const seconds = finite(value);
    if (seconds === undefined || seconds < 0)
        return '未提供';
    const whole = Math.floor(seconds);
    if (whole < 60)
        return `${whole} 秒`;
    if (whole < 3600)
        return `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`;
    if (whole < 86400)
        return `${Math.floor(whole / 3600)} 小时 ${Math.floor(whole % 3600 / 60)} 分`;
    return `${Math.floor(whole / 86400)} 天 ${Math.floor(whole % 86400 / 3600)} 小时`;
}
export const percentage = (used, total) => {
    const value = finite(used), limit = finite(total);
    if (value === undefined || limit === undefined || value < 0 || limit < 0)
        return undefined;
    return limit === 0 ? value > 0 ? 100 : 0 : Math.max(0, Math.min(100, value / limit * 100));
};
export const stateLabel = (value) => ({ creating: '创建中', starting: '启动中', running: '运行中', stopping: '停止中', stopped: '已停止', suspending: '暂停中', suspended: '已暂停', resuming: '恢复中', deleting: '删除中', deleted: '已删除', error: '发生错误', queued: '等待中', succeeded: '已完成', failed: '失败' }[String(value)] ?? (typeof value === 'string' ? value : '未提供'));
export const machineData = (value) => {
    const source = record(value);
    return source.machine && typeof source.machine === 'object' ? record(source.machine) : source;
};
export const array = (value, key) => {
    const items = Array.isArray(value) ? value : record(value)[key];
    return Array.isArray(items) ? items.filter(item => item && typeof item === 'object') : [];
};
export const SPEC_KEYS = ['vcpus', 'memMiB', 'persistentDiskGiB', 'autoSuspendAfterSeconds'];
export const emptyDraft = () => ({ vcpus: '', memMiB: '', persistentDiskGiB: '', autoSuspendAfterSeconds: '' });
export function machineSpec(value) {
    const machine = machineData(value), spec = record(machine.spec), storage = record(machine.storage);
    const pick = (...values) => values.map(finite).find(value => value !== undefined);
    const idle = machine.autoSuspendAfterSeconds === null ? 0 : pick(machine.autoSuspendAfterSeconds, finite(record(value).autoSuspendMs) === undefined ? undefined : record(value).autoSuspendMs / 1000);
    return {
        vcpus: pick(spec.vcpus, machine.vcpus), memMiB: pick(spec.memMiB, machine.memMiB),
        persistentDiskGiB: pick(spec.persistentDiskGiB, storage.sizeGiB, machine.persistentDiskGiB),
        autoSuspendAfterSeconds: idle,
    };
}
export function specDraft(value) {
    const current = machineSpec(value);
    return Object.fromEntries(SPEC_KEYS.map(key => [key, current[key] === undefined ? '' : String(current[key])]));
}
const bounds = {
    vcpus: [1, 32, 'vCPU'], memMiB: [1024, 65536, '内存'], persistentDiskGiB: [1, 1024, '持久盘'], autoSuspendAfterSeconds: [0, 1800, '空闲暂停'],
};
export function changedSpec(draft, original) {
    const changes = {};
    for (const key of SPEC_KEYS) {
        const input = draft[key].trim(), previous = original[key].trim();
        if (input === previous)
            continue;
        if (!input)
            throw new Error(`${bounds[key][2]}不能为空；不修改时请保留当前值。`);
        const value = Number(input);
        if (!Number.isSafeInteger(value) || value < bounds[key][0] || value > bounds[key][1])
            throw new Error(`${bounds[key][2]}必须是 ${bounds[key][0]}–${bounds[key][1]} 范围内的整数。`);
        if (previous !== '' && value === Number(previous))
            continue;
        changes[key] = value;
    }
    return changes;
}

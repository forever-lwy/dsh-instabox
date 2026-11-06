export const settled = (job) => !['queued', 'running'].includes(job.status);
/** Each HTTP request is short; waiting for a cloud operation never occupies a
 * single Gateway request. Aborting the UI stops polling, not a submitted job. */
export async function waitForJob(face, initial, signal, update, delayMs = 1000) {
    let job = initial;
    update?.(job);
    while (!settled(job)) {
        signal.throwIfAborted();
        await new Promise((resolve, reject) => {
            const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(); };
            const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('已取消')); };
            const timer = setTimeout(done, delayMs);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted)
                abort();
        });
        job = await face.getJob({ jobId: job.jobId }, signal);
        update?.(job);
    }
    signal.throwIfAborted();
    if (job.status !== 'succeeded')
        throw new Error(job.error || (job.status === 'cancelled' ? '任务已取消。' : '云端操作失败。'));
    return job;
}
export function listOf(value, ...keys) {
    if (Array.isArray(value))
        return value;
    if (!value || typeof value !== 'object')
        return [];
    const record = value;
    for (const key of keys)
        if (Array.isArray(record[key]))
            return record[key];
    return [];
}
export const pretty = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
export const machineIdOf = (machine) => String(machine?.id ?? machine?.sandboxId ?? machine?.machine?.id ?? '');
export function viewerUrl(value) {
    if (typeof value !== 'string')
        throw new Error('桌面服务没有返回有效链接。');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'instabox.sh' || url.hostname.endsWith('.instabox.sh'))) {
        throw new Error('已拒绝非官方 InstaBox HTTPS 桌面链接。');
    }
    return url.href;
}
export function bytesToBase64(bytes) {
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 8192)
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    return btoa(chunks.join(''));
}
export function base64ToBytes(value) {
    const binary = atob(value), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}

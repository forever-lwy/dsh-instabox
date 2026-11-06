import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const recordSchema = z.object({
    machineId: z.string().regex(/^m_[A-Za-z0-9_-]+$/).max(160),
    ownerId: z.string().regex(/^[A-Za-z0-9_-]{8,160}$/),
    since: z.number().finite(), expiresAt: z.number().finite(),
}).strict();
const journalSchema = z.object({ version: z.literal(1), leases: z.array(recordSchema).max(512) }).strict();
/** An acknowledged desktop capability must survive a Host reload as a lock,
 * even when revoking the old viewer fails. This file deliberately contains no
 * API key, URL, screenshot or other machine data. It is not a browser session. */
export class ControlLeaseStore {
    path;
    constructor(path) {
        this.path = path;
    }
    async load() {
        try {
            return journalSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))).leases;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return [];
            throw new Error('无法读取 Instabox 接管清理记录，模型操作保持暂停；请检查持久目录的格式与权限。');
        }
    }
    async save(records) {
        const next = journalSchema.parse({ version: 1, leases: records });
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
            await rename(temporary, this.path);
        }
        finally {
            await unlink(temporary).catch(() => { });
        }
    }
}

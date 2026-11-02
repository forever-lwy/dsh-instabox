import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configSchema, defaultConfig } from './shared.js';
export class ConfigConflict extends Error {
}
export class ConfigStore {
    path;
    record = { revision: 0, config: defaultConfig() };
    constructor(path) {
        this.path = path;
    }
    current() { return structuredClone(this.record.config); }
    revision() { return this.record.revision; }
    async load() {
        try {
            const value = JSON.parse(await readFile(this.path, 'utf8'));
            if (!Number.isSafeInteger(value.revision) || value.revision < 0)
                throw new Error('revision');
            this.record = { revision: value.revision, config: configSchema.parse(value.config) };
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw new Error('无法读取 Instabox 插件配置，请检查配置文件格式和权限。');
        }
    }
    async save(config, expectedRevision) {
        await this.load();
        if (expectedRevision !== this.record.revision)
            throw new ConfigConflict('配置已在其他窗口修改，请重新加载后保存。');
        const next = { revision: expectedRevision + 1, config: configSchema.parse(config) };
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temp = `${this.path}.${randomUUID()}.tmp`;
        try {
            await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
            await rename(temp, this.path);
            this.record = next;
        }
        finally {
            await unlink(temp).catch(() => { });
        }
    }
}

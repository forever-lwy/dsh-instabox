import { join } from 'node:path';
import { homedir } from 'node:os';
import { ConfigStore } from './store.js';
import { InstaboxService } from './service.js';
import { registerTools } from './tools.js';
import { remoteInfo } from './remote.js';
export const name = 'dsh-instabox';
export const inject = ['credentials', 'typert', 'tools', 'attachments', 'systemPrompt'];
export { InstaboxService } from './service.js';
export { InstaboxRuntime } from './runtime.js';
export { ConfigStore } from './store.js';
export async function apply(ctx) {
    const store = new ConfigStore(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'instabox', 'settings.json'));
    await store.load();
    const service = new InstaboxService(ctx, store);
    ctx.typert.remotes.register(remoteInfo);
    registerTools(ctx, service);
    // Usage rules now live in the single tool's description and its help action;
    // no per-session runtime context is injected.
}

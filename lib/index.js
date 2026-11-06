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
    ctx.systemPrompt.context({ name: 'instabox-remote-computer', order: 310, interpolate: false, text: () => service.current().modelToolsEnabled
            ? 'InstaBox tools operate separate REMOTE cloud computers, not this DSH host or its local workspace. Use machine IDs from instabox_machine list. Never assume local files are synchronized. Long tasks return jobId; poll instabox_task get rather than resubmitting a mutation. commands.run input.background=true launches a detached remote job; inspect it with instabox_command jobs actions. A user who takes control in the InstaBox panel blocks new model writes and input until they hand back. Observe this lock, do not bypass it via other shell/network tools. Already detached remote programs may keep running. Screenshots are durable image attachments; inspect them only with an image-capable selected model. Never request or print API keys. Destructive deletes require the exact target in input.confirm.'
            : '' });
}

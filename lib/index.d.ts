import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-instabox";
export declare const inject: string[];
export { InstaboxService } from './service.js';
export { InstaboxRuntime } from './runtime.js';
export { ConfigStore } from './store.js';
export declare function apply(ctx: Context): Promise<void>;

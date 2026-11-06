import type { Context } from '@deepseek-ai/cordis';
import type { InstaboxService } from './service.js';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'instabox-screen': {
            kind: 'instabox-screen';
            jobId: string;
        };
    }
}
export declare function registerTools(ctx: Context, service: InstaboxService): void;

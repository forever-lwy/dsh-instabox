import { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type ActionRequest, type ConfigData, type JobView, type SaveSettingsRequest, type SettingsView } from './shared.js';
import { ConfigStore } from './store.js';
import { InstaboxRuntime, type ApiPort } from './runtime.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        instabox: InstaboxService;
    }
}
export interface ServiceOptions {
    apiFactory?: () => Promise<ApiPort>;
}
export declare class InstaboxService extends TypertRemoteService {
    readonly store: ConfigStore;
    readonly runtime: InstaboxRuntime;
    private saves;
    constructor(ctx: Context, store: ConfigStore, options?: ServiceOptions);
    current(): ConfigData;
    private createApi;
    getSettings(request: Record<string, never>, signal: AbortSignal): Promise<SettingsView>;
    saveSettings(request: SaveSettingsRequest, signal: AbortSignal): Promise<SettingsView>;
    private saveExclusive;
    execute(request: ActionRequest, signal: AbortSignal): Promise<JobView>;
    getJob(request: {
        jobId: string;
    }, signal: AbortSignal): Promise<JobView>;
    executeAgent(request: ActionRequest, signal: AbortSignal): Promise<JobView>;
}

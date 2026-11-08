import { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type ActionRequest, type ActivityView, type ConfigData, type JobView, type SaveSettingsRequest, type SettingsView } from './shared.js';
import { ConfigStore } from './store.js';
import { InstaboxRuntime, type ApiPort } from './runtime.js';
import { ActivityTracker } from './activity.js';
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
    readonly activity: ActivityTracker;
    private activityJobs;
    private activityDisposed;
    private saves;
    constructor(ctx: Context, store: ConfigStore, options?: ServiceOptions);
    current(): ConfigData;
    private readonly savedListeners;
    private sweepTimer;
    /** Observe successful settings saves; returns the disposer. */
    onSaved(listener: () => void): () => void;
    private ensureSweep;
    private stopSweep;
    private createApi;
    getSettings(request: Record<string, never>, signal: AbortSignal): Promise<SettingsView>;
    saveSettings(request: SaveSettingsRequest, signal: AbortSignal): Promise<SettingsView>;
    private saveExclusive;
    execute(request: ActionRequest, signal: AbortSignal): Promise<JobView>;
    getJob(request: {
        jobId: string;
    }, signal: AbortSignal): Promise<JobView>;
    getActivity(request: {
        sessionId: string;
    }, signal: AbortSignal): Promise<ActivityView>;
    executeAgent(request: ActionRequest, signal: AbortSignal, sessionId?: string, running?: boolean): Promise<JobView>;
    private watchActivityJob;
    private sweepActivityJobs;
}

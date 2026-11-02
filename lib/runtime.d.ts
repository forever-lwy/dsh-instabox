import { type ActionRequest, type ControlView, type JobView } from './shared.js';
import type { ControlJournal } from './control-store.js';
export type Actor = 'human' | 'agent';
export interface ApiPort {
    execute(request: ActionRequest, signal?: AbortSignal): Promise<unknown>;
}
export declare class RuntimeError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
export declare function safeError(error: unknown): string;
export declare function isReadAction(action: string): boolean;
/** Jobs own accepted requests after the short RPC/tool call returns. The runtime
 * retains their results for polling, bounds retention, and aborts them on dispose. */
export declare class InstaboxRuntime {
    private readonly apiFactory;
    private readonly now;
    private readonly options;
    readonly ready: Promise<void>;
    private jobs;
    private leases;
    private lanes;
    private disposed;
    private journalWrites;
    private timer;
    constructor(apiFactory: () => Promise<ApiPort>, now?: () => number, options?: {
        journal?: ControlJournal;
    });
    control(machineId: string): ControlView;
    listJobs(): JobView[];
    cancelAgentJobs(): void;
    getJob(jobId: string): JobView;
    submit(raw: ActionRequest, actor: Actor, signal?: AbortSignal, waitMs?: number): Promise<JobView>;
    cancel(jobId: string): JobView;
    private assertAgentAccess;
    private owner;
    private machine;
    private claim;
    private run;
    private release;
    private releaseExclusive;
    private expireLeases;
    releaseAll(): Promise<void>;
    /** Recovery may need a newly saved key; keep tombstones while the old key is
     * invalid, then try the current credential on the next explicit retry. */
    retryCleanup(): Promise<void>;
    private initialize;
    private records;
    private journalWrite;
    private persist;
    private forget;
    private trimJobs;
    dispose(): Promise<void>;
}

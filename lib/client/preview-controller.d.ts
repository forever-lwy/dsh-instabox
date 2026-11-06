import type { ActivityMachine, ActivityView, ControlView } from '../shared.js';
import { type InstaboxFace } from './face.js';
export interface PreviewMachine extends ActivityMachine {
    expanded: boolean;
    mode: 'closed' | 'watch' | 'control';
    url?: string;
    pending: boolean;
    error?: string;
    control?: ControlView;
    manual: boolean;
    cleanupNeeded: boolean;
    retiring: boolean;
}
export interface PreviewSnapshot {
    sessionId: string | null;
    items: PreviewMachine[];
    revision: number;
}
interface Timers {
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    setInterval(handler: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}
export interface PreviewControllerOptions {
    heartbeatMs?: number;
    idleGraceMs?: number;
    pollMs?: number;
    createId?: () => string;
    timers?: Timers;
}
/** One owner at browser-plugin scope, independent of React/message lifetimes.
 * Calls are serialized per physical machine, including across two sessions.
 * A queued release therefore also cleans up a take that completes after the
 * user switched chats. Only the controller owns lease and heartbeat effects. */
export declare class PreviewController {
    private readonly face;
    private readonly options;
    private readonly records;
    private readonly machineQueues;
    private readonly activityRevisions;
    private readonly listeners;
    private readonly lifetime;
    private readonly clock;
    private readonly interval;
    private currentSession;
    private disposed;
    private disposeTask?;
    private version;
    private snapshot;
    constructor(face: InstaboxFace, options?: PreviewControllerOptions);
    readonly subscribe: (listener: () => void) => () => void;
    readonly getSnapshot: () => PreviewSnapshot;
    private key;
    private emit;
    private clearGrace;
    private active;
    private entry;
    private queue;
    private request;
    private applyControl;
    private inspect;
    private releaseOwned;
    setSession(sessionId: string | null): Promise<void>;
    resetActivityEpoch(): Promise<void>;
    updateActivity(view: ActivityView): void;
    private openWatch;
    watch(machineId: string): Promise<void>;
    take(machineId: string): Promise<void>;
    private collapseEntry;
    collapse(machineId: string): Promise<void>;
    handback(machineId: string): Promise<void>;
    private heartbeat;
    dispose(): Promise<void>;
}
export {};

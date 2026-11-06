import type { ActionRequest, ActivityView, JobView } from './shared.js';
/** Keeps only the machine metadata needed to render a session's cloud-computer
 * entry. Arguments, tool results, URLs, credentials and file bytes never enter
 * a retained record. No unknown session inherits a global "last machine". */
export declare class ActivityTracker {
    private readonly now;
    private readonly maxMachines;
    private readonly maxSessions;
    private sessions;
    private tasks;
    private disposed;
    constructor(now?: () => number, maxMachines?: number, maxSessions?: number);
    begin(sessionId: string | undefined, request: ActionRequest, running?: boolean): string | undefined;
    finish(token: string | undefined, job?: JobView): void;
    /** Observe state changes made in the dedicated panel without creating an
     * activity entry for sessions that never used the machine. */
    observe(request: ActionRequest, job: JobView): void;
    beginTurn(sessionId: string): void;
    setRunning(sessionId: string, running: boolean): void;
    snapshot(sessionId: string): ActivityView;
    dispose(): void;
    private trackable;
    private validSession;
    private ensure;
    private touch;
    private refresh;
    private setState;
    private describe;
    private observeMachine;
    private trimMachines;
    private prune;
}

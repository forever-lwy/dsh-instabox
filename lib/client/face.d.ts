import type { ActionRequest, JobView, SaveSettingsRequest, SettingsView, ActivityView } from '../shared.js';
export interface InstaboxFace {
    read(signal?: AbortSignal): Promise<SettingsView>;
    save(request: SaveSettingsRequest, signal?: AbortSignal): Promise<SettingsView>;
    execute(request: ActionRequest, signal?: AbortSignal): Promise<JobView>;
    getJob(request: {
        jobId: string;
    }, signal?: AbortSignal): Promise<JobView>;
}
export interface InstaboxPreviewFace extends InstaboxFace {
    getActivity(request: {
        sessionId: string;
    }, signal?: AbortSignal): Promise<ActivityView>;
}
export declare const settled: (job: JobView) => boolean;
/** Each HTTP request is short; waiting for a cloud operation never occupies a
 * single Gateway request. Aborting the UI stops polling, not a submitted job. */
export declare function waitForJob(face: InstaboxFace, initial: JobView, signal: AbortSignal, update?: (job: JobView) => void, delayMs?: number): Promise<JobView>;
export declare function listOf(value: unknown, ...keys: string[]): any[];
export declare const pretty: (value: unknown) => string;
export declare const machineIdOf: (machine: any) => string;
export declare function viewerUrl(value: unknown): string;
export declare function bytesToBase64(bytes: Uint8Array): string;
export declare function base64ToBytes(value: string): Uint8Array;

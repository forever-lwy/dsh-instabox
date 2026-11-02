import { z } from 'zod';
import type { ActionRequest } from './shared.js';
/** This schema belongs on the Host; importing it in a browser would bundle the SDK. */
export declare const ACTION_INPUT_SCHEMAS: Record<string, z.ZodType>;
export interface ApiOptions {
    apiKey: string;
    requestTimeoutMs: number;
    fetch?: typeof fetch;
    operationTimeoutMs?: number;
}
export declare class InstaboxApiError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;
    readonly operationId?: string | undefined;
    constructor(message: string, code?: string, status?: number, retryable?: boolean, operationId?: string | undefined);
}
export declare class InstaboxApi {
    private readonly options;
    private readonly fetchImpl;
    constructor(options: ApiOptions);
    private safeMessage;
    private request;
    private sandbox;
    private finishOperation;
    private finishSnapshot;
    execute(request: ActionRequest, signal?: AbortSignal): Promise<unknown>;
}

import { z } from 'zod';
declare const recordSchema: z.ZodObject<{
    machineId: z.ZodString;
    ownerId: z.ZodString;
    since: z.ZodNumber;
    expiresAt: z.ZodNumber;
}, z.core.$strict>;
export type ControlRecord = z.infer<typeof recordSchema>;
export interface ControlJournal {
    load(): Promise<ControlRecord[]>;
    save(records: ControlRecord[]): Promise<void>;
}
/** An acknowledged desktop capability must survive a Host reload as a lock,
 * even when revoking the old viewer fails. This file deliberately contains no
 * API key, URL, screenshot or other machine data. It is not a browser session. */
export declare class ControlLeaseStore implements ControlJournal {
    readonly path: string;
    constructor(path: string);
    load(): Promise<ControlRecord[]>;
    save(records: ControlRecord[]): Promise<void>;
}
export {};

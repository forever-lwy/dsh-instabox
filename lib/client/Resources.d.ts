import type { Action } from '../shared.js';
export type ResourceRun = (action: Action, input?: Record<string, unknown>, machineId?: string, quiet?: boolean) => Promise<any>;
/** API reads are independent: a missing metrics scope does not hide the disk,
 * quota, or the editable specification. Generation guards discard late reads
 * and saves from the machine the user has already left. */
export declare function Resources({ run, machineId, onUpdated }: {
    run: ResourceRun;
    machineId: string;
    onUpdated: () => Promise<void>;
}): import("react").JSX.Element;

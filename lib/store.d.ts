import { type ConfigData } from './shared.js';
export declare class ConfigConflict extends Error {
}
export declare class ConfigStore {
    readonly path: string;
    private record;
    constructor(path: string);
    current(): ConfigData;
    revision(): number;
    load(): Promise<void>;
    save(config: ConfigData, expectedRevision: number): Promise<void>;
}

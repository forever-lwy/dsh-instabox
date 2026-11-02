import type { ActionRequest, SaveSettingsRequest } from './shared.js';
export declare const remoteInfo: import("@deepseek-ai/dsh-typert-protocol").TypertRemoteInfo<Readonly<Record<string, import("@deepseek-ai/dsh-typert-protocol").TypertRemoteMethod<object, unknown, "unary", never, unknown> | import("@deepseek-ai/dsh-typert-protocol").TypertRemoteMethod<object, unknown, "stream", unknown, unknown>>>>;
export declare const getSettings: (remote: any, signal?: AbortSignal) => Promise<{
    config: {
        apiKeyRef: string;
        defaultTemplate: string;
        requestTimeoutMs: number;
        modelToolsEnabled: boolean;
    };
    revision: number;
    credential: {
        configured: boolean;
        writable: boolean;
    };
}>;
export declare const saveSettings: (remote: any, request: SaveSettingsRequest, signal?: AbortSignal) => Promise<{
    config: {
        apiKeyRef: string;
        defaultTemplate: string;
        requestTimeoutMs: number;
        modelToolsEnabled: boolean;
    };
    revision: number;
    credential: {
        configured: boolean;
        writable: boolean;
    };
}>;
export declare const execute: (remote: any, request: ActionRequest, signal?: AbortSignal) => Promise<{
    jobId: string;
    action: "account.me" | "account.usage" | "templates.list" | "machines.list" | "machines.get" | "machines.create" | "machines.update" | "machines.start" | "machines.stop" | "machines.suspend" | "machines.resume" | "machines.delete" | "machines.fork" | "machines.logs" | "machines.disk" | "operations.get" | "commands.run" | "jobs.list" | "jobs.get" | "jobs.kill" | "files.list" | "files.read" | "files.write" | "files.remove" | "desktop.start" | "desktop.status" | "desktop.screenshot" | "desktop.click" | "desktop.move" | "desktop.drag" | "desktop.scroll" | "desktop.type" | "desktop.press" | "desktop.open" | "desktop.cursor" | "desktop.view" | "desktop.revoke" | "desktop.takeover" | "desktop.handback" | "snapshots.list" | "snapshots.get" | "snapshots.create" | "snapshots.delete" | "ports.list" | "ports.publish" | "ports.unpublish" | "ssh.credentials" | "metrics.get" | "usage.get" | "control.take" | "control.release" | "control.status" | "control.renew";
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    createdAt: number;
    updatedAt: number;
    machineId?: string | undefined;
    result?: unknown;
    error?: string | undefined;
}>;
export declare const getJob: (remote: any, request: {
    jobId: string;
}, signal?: AbortSignal) => Promise<{
    jobId: string;
    action: "account.me" | "account.usage" | "templates.list" | "machines.list" | "machines.get" | "machines.create" | "machines.update" | "machines.start" | "machines.stop" | "machines.suspend" | "machines.resume" | "machines.delete" | "machines.fork" | "machines.logs" | "machines.disk" | "operations.get" | "commands.run" | "jobs.list" | "jobs.get" | "jobs.kill" | "files.list" | "files.read" | "files.write" | "files.remove" | "desktop.start" | "desktop.status" | "desktop.screenshot" | "desktop.click" | "desktop.move" | "desktop.drag" | "desktop.scroll" | "desktop.type" | "desktop.press" | "desktop.open" | "desktop.cursor" | "desktop.view" | "desktop.revoke" | "desktop.takeover" | "desktop.handback" | "snapshots.list" | "snapshots.get" | "snapshots.create" | "snapshots.delete" | "ports.list" | "ports.publish" | "ports.unpublish" | "ssh.credentials" | "metrics.get" | "usage.get" | "control.take" | "control.release" | "control.status" | "control.renew";
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    createdAt: number;
    updatedAt: number;
    machineId?: string | undefined;
    result?: unknown;
    error?: string | undefined;
}>;

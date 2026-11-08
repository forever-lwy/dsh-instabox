import type { Context } from '@deepseek-ai/cordis';
import type { InstaboxService } from './service.js';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'instabox-screen': {
            kind: 'instabox-screen';
            jobId: string;
        };
    }
}
export declare const FAMILIES: readonly [{
    readonly prefix: RegExp;
    readonly rules: "Machines and account. machineId must be the canonical m_ ID from machines.list; names/aliases are refused so they cannot bypass a human takeover lock. machines.create accepts input.templateId (default agent-browser) OR snapshotId, name, vcpus, memMiB, metadata, autoSuspendAfterSeconds; creation receives no personal Vault or org Secrets. Mutation timeouts may leave cloud work in progress: poll the returned plugin jobId with task.get. Deletion requires input.confirm exactly equal to machineId.";
}, {
    readonly prefix: RegExp;
    readonly rules: "Runs on the REMOTE machine, never the DSH host. commands.run input: {cmd, cwd?, envs?, timeoutSeconds?, background?}. For long work use background:true; it returns the remote jobId. jobs.list/get/kill inspect or terminate remote detached jobs; input.jobId is that remote job, distinct from a plugin task jobId. Human desktop takeover blocks model commands and job termination.";
}, {
    readonly prefix: RegExp;
    readonly rules: "input.path is a remote Linux path, relative to remote HOME if not absolute. files.read input.format text|base64; files.write input.content and format text|base64. Binary reads become durable DSH file attachments. Per-file limit is 10 MiB. files.remove requires input.confirm exactly equal to input.path; recursive deletion cannot be undone.";
}, {
    readonly prefix: RegExp;
    readonly rules: "Screenshot returns an image attachment usable with image-capable models; coordinates are native screen pixels (screenWidth/screenHeight). click/move use input.x,y; click adds button:left|right|middle and double:boolean. drag uses input.from:[x,y],to:[x,y]; scroll direction up|down|left|right,amount; type text; press keys:string or string[]; open url:http(s). Model keyboard/mouse actions are blocked during human takeover; takeover/handback/viewer controls are only in the user panel.";
}, {
    readonly prefix: RegExp;
    readonly rules: "create needs machineId and input.name, description?, rootOnly?. get/delete use input.snapshotId; delete requires input.confirm exactly equal to snapshotId. To restore, create a new machine with machines.create input.snapshotId.";
}, {
    readonly prefix: RegExp;
    readonly rules: "ports.list/publish/unpublish; publishing needs input.port (1024..65535; reserved ports refused), access:private|public (default private), name?, rotateToken?. Private publishes a token-protected HTTPS URL; public deliberately exposes it. ssh.credentials needs input.publicKey, ttlSeconds?; never generate or send a private SSH key.";
}];
export declare const MODEL_ACTIONS: string[];
export declare const INSTABOX_DESCRIPTION: string;
export declare function registerTools(ctx: Context, service: InstaboxService): void;

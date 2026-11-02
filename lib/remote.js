import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { actionSchema, settingsViewSchema, saveSettingsSchema, jobViewSchema, getJobSchema } from './shared.js';
const codec = (schema, typeSymbol) => ({ mode: 'strict', typeSymbol, create: () => schema });
const method = (input, output) => ({
    service: 'instabox', invocation: { kind: 'direct' },
    parameters: [{ name: 'request', source: 'json', codec: codec(input, 'InstaboxRequest'), strictCodec: codec(input, 'InstaboxRequest') }],
    result: codec(output, 'InstaboxResult'), cancellation: { parameter: 'signal' },
});
export const remoteInfo = createTypertRemoteInfo({ package: 'dsh-instabox', methods: {
        'instabox/getSettings': method(z.object({}).strict(), settingsViewSchema),
        'instabox/saveSettings': method(saveSettingsSchema, settingsViewSchema),
        'instabox/execute': method(actionSchema, jobViewSchema),
        'instabox/getJob': method(getJobSchema, jobViewSchema),
    } }, z);
async function invoke(remote, key, request, signal) {
    const result = await remoteInfo.methods[key].invoke(remote, { request }, signal);
    if (!result.ok)
        throw new Error(result.error.message);
    return result.value;
}
export const getSettings = (remote, signal) => invoke(remote, 'instabox/getSettings', {}, signal);
export const saveSettings = (remote, request, signal) => invoke(remote, 'instabox/saveSettings', request, signal);
export const execute = (remote, request, signal) => invoke(remote, 'instabox/execute', request, signal);
export const getJob = (remote, request, signal) => invoke(remote, 'instabox/getJob', request, signal);

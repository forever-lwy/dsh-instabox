import { execute, getJob, getSettings, remoteInfo, saveSettings } from '../remote.js';
import { InstaboxIcon, InstaboxPanel } from './Panel.js';
import { InstaboxSettings } from './Settings.js';
import { styles } from './styles.js';
export const name = 'dsh-instabox-client';
export const inject = ['slots', 'remote', 'layout'];
export async function apply(ctx) {
    const unmount = await ctx.remote.$mount(remoteInfo);
    ctx.effect(() => unmount, 'instabox: remote schema');
    ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-instabox';
        style.textContent = styles;
        document.head.appendChild(style);
        return () => style.remove();
    }, 'instabox: styles');
    ctx.inject(['remote.instabox'], (remoteCtx) => {
        const face = {
            read: signal => getSettings(remoteCtx.remote, signal),
            save: (request, signal) => saveSettings(remoteCtx.remote, request, signal),
            execute: (request, signal) => execute(remoteCtx.remote, request, signal),
            getJob: (request, signal) => getJob(remoteCtx.remote, request, signal),
        };
        const slots = remoteCtx.slots;
        const closePanel = () => { try {
            remoteCtx.layout.selectPanel(null);
        }
        catch { } };
        // Register the keyed panel before its navigation row; rc.5 refuses to
        // select a panel that is not present in the live main registry.
        slots.inject('main', () => slots.register({ name: 'main', key: 'instabox', inject: () => ({ face, closePanel }) }, InstaboxPanel));
        slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: 'instabox', order: 45, label: () => 'Instabox 云电脑' }, InstaboxIcon));
        slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: 'instabox', order: 45, label: () => 'Instabox 云电脑',
            inject: () => ({ face, openPanel: () => remoteCtx.layout.selectPanel('instabox') }) }, InstaboxSettings));
        remoteCtx.effect(() => () => {
            if (remoteCtx.layout.panelInfo.getSnapshot().activePanelId === 'instabox')
                closePanel();
        }, 'instabox: leave panel on unload');
    });
}
export { InstaboxPanel, InstaboxSettings };

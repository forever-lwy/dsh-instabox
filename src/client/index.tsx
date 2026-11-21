import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { execute, getJob, getSettings, getActivity, remoteInfo, saveSettings, bindWorkspace } from '../remote.js'
import { InstaboxIcon, InstaboxPanel } from './Panel.js'
import { InstaboxSettings } from './Settings.js'
import { styles } from './styles.js'
import { previewStyles } from './preview-styles.js'
import type { InstaboxFace, InstaboxPreviewFace } from './face.js'
import { installPreviewPlacements } from './placements.js'

export const name = 'dsh-instabox-client'
export const inject = ['slots', 'remote', 'layout']
export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(remoteInfo)
  ctx.effect(() => unmount, 'instabox: remote schema')
  ctx.effect(() => {
    const style = document.createElement('style'); style.dataset.plugin='dsh-instabox'; style.textContent=styles+'\n'+previewStyles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'instabox: styles')
  ctx.inject(['remote.instabox'], (remoteCtx: Context) => {
    let previews: ReturnType<typeof installPreviewPlacements> | undefined
    const face: InstaboxPreviewFace = {
      read: signal => getSettings(remoteCtx.remote,signal),
      save: async(request,signal) => {
        const view=await saveSettings(remoteCtx.remote,request,signal)
        previews?.updateSettings(view)
        return view
      },
      execute: (request,signal) => execute(remoteCtx.remote,request,signal),
      getJob: (request,signal) => getJob(remoteCtx.remote,request,signal),
      getActivity: (request,signal) => getActivity(remoteCtx.remote,request,signal),
      bindWorkspace: (request,signal) => bindWorkspace(remoteCtx.remote,request,signal),
    }
    previews=installPreviewPlacements(remoteCtx,face)
    const slots = remoteCtx.slots as any
    const closePanel = () => { try {remoteCtx.layout.selectPanel(null)} catch {} }
    // The cloud-directory picker adopts the local mirror the Host returns as a
    // Workspace and opens a Session in it. `startSession` takes a WORKSPACE ID,
    // so the path goes through `workspaces.create` first.
    //
    // Cordis only exposes an injected service on a context that declared it, so
    // this runs inside a dedicated `inject(['workspaces','uiWorkspace'])` child
    // instead of reading `remoteCtx.workspaces` directly. The panel's own
    // registration stays untouched: a composition without these services simply
    // never offers the Session, and the rest of the panel keeps working.
    let openCloudWorkspace: ((localPath: string, signal?: AbortSignal) => Promise<void>) | undefined
    remoteCtx.inject(['workspaces','uiWorkspace'], (workspaceCtx: any) => {
      const workspaces = workspaceCtx.workspaces
      const uiWorkspace = workspaceCtx.uiWorkspace
      openCloudWorkspace = async (localPath: string, signal?: AbortSignal): Promise<void> => {
        const workspace = await workspaces.create({path: localPath})
        if (signal?.aborted) return
        closePanel()
        if (uiWorkspace && typeof uiWorkspace.startSession === 'function') uiWorkspace.startSession(workspace.workspaceId)
      }
    })
    // Register the keyed panel before its navigation row; rc.5 refuses to
    // select a panel that is not present in the live main registry.
    slots.inject('main', () => slots.register({name:'main',key:'instabox',inject:()=>({face,closePanel,openCloudWorkspace:openCloudWorkspace && ((p:string)=>openCloudWorkspace!(p))})},InstaboxPanel))
    slots.inject('sidebar.panellist', () => slots.register({name:'sidebar.panellist',id:'instabox',order:45,label:()=> 'Instabox 云电脑'},InstaboxIcon))
    slots.inject('settings.section', () => slots.register({name:'settings.section',id:'instabox',order:45,label:()=> 'Instabox 云电脑',
      inject:()=>({face,openPanel:()=>remoteCtx.layout.selectPanel('instabox' as MainPanelId)})},InstaboxSettings))
    remoteCtx.effect(() => () => {
      if (remoteCtx.layout.panelInfo.getSnapshot().activePanelId === 'instabox') closePanel()
    }, 'instabox: leave panel on unload')
  })
}
export { InstaboxPanel, InstaboxSettings }
export type { InstaboxFace }

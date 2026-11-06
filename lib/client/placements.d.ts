import type { Context } from '@deepseek-ai/cordis';
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { SettingsView } from '../shared.js';
import type { InstaboxPreviewFace } from './face.js';
import { PreviewController } from './preview-controller.js';
export declare const PREVIEW_NODE_KIND = "instabox-preview-tail";
export declare const PREVIEW_TAB_KIND = "instabox-desktop";
export declare const PREVIEW_TAB_ID = "dsh-instabox/desktop-preview";
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
    interface ChatNodeDataMap {
        'instabox-preview-tail': Record<string, never>;
    }
}
/** An additive Session-level Chat node, outside Turn/process disclosures. Its
 * identity never follows the last message, so streaming and paging cannot
 * remount the owner. The published Chat target accepts arbitrary node kinds.
 * Match only event types Chat itself handles, preserving unknown-event fallback. */
export declare function createPreviewTailDefinition(): ConversationNodeDefinition<Record<string, never>>;
/** A plugin-owned coordinator. React rows and tab bodies are presentation
 * subscribers only; their unmount never hands back or disposes the controller. */
export declare function installPreviewPlacements(ctx: Context, face: InstaboxPreviewFace): {
    updateSettings(view: SettingsView): void;
    controller: PreviewController;
};

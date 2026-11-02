import { PreviewController } from './preview-controller.js';
/** This component is a pure subscriber. Message replay, moving between slots,
 * and React unmount do not create viewers, renew, or release a machine lease. */
export declare function DesktopPreview({ controller, presentation, machineId }: {
    controller: PreviewController;
    presentation?: 'card' | 'sidebar';
    machineId?: string;
}): import("react").JSX.Element | null;

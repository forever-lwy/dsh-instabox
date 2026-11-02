import { type SettingsView } from '../shared.js';
import type { InstaboxFace } from './face.js';
export declare function InstaboxSettings({ face, openPanel, onSaved }: {
    face: InstaboxFace;
    openPanel?: () => void;
    onSaved?: (view: SettingsView) => void;
}): import("react").JSX.Element;

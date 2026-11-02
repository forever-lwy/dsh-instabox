import type { Context } from '@deepseek-ai/cordis';
import { InstaboxPanel } from './Panel.js';
import { InstaboxSettings } from './Settings.js';
import type { InstaboxFace } from './face.js';
export declare const name = "dsh-instabox-client";
export declare const inject: string[];
export declare function apply(ctx: Context): Promise<void>;
export { InstaboxPanel, InstaboxSettings };
export type { InstaboxFace };

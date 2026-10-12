import type { Scene } from '../model/scene.types';

/**
 * How deep mirrors and glass are traced, and how Render View draws. The final
 * render's depth belongs to the scene (Render, Render to Image, movies) and is
 * saved with it; the live depth and Render View's options are personal settings
 * (world/settings.ts), because the right trade of speed for quality depends on
 * the machine, not on the scene.
 */

/** Mirror and glass bounces a ray may take: every depth setting stays in this range. */
export const BOUNCES = { min: 1, max: 16 } as const;
/** The live view's depth: Fast's and Full's settled picture; Detailed traces twice as deep. */
export const DEFAULT_LIVE_BOUNCES = 4;
/** The final render's depth until a scene sets its own (the depth Render always had). */
export const DEFAULT_FINAL_BOUNCES = 6;

export const isBounces = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= BOUNCES.min && (v as number) <= BOUNCES.max;
export const clampBounces = (v: number): number => Math.round(Math.min(BOUNCES.max, Math.max(BOUNCES.min, v)));

/** The scene's final-render depth: Render, Render to Image, movies and Render View's Final preset. */
export const finalBounces = (scene: Scene): number => scene.render?.bounces ?? DEFAULT_FINAL_BOUNCES;

/** Render View presets; a preset fixes every option, Custom keeps the user's own. */
export enum RenderPreset {
  Draft = 'draft',
  Balanced = 'balanced',
  Final = 'final',
  Custom = 'custom',
}

/** Soft shadows in Render View: drawn hard, or one (as Render) or four shadow rays per light and ray. */
export enum ShadowQuality {
  Off = 'off',
  Low = 'low',
  High = 'high',
}

/** Render View's picture size against the scene window, per side. */
export const VIEW_SCALES = [0.25, 0.5, 0.75, 1] as const;
/** Rays per pixel Render View refines to. */
export const VIEW_SAMPLES = [4, 16, 64, 256, 1024] as const;

/** What Render View traces: the final render's look, or a cheaper one to keep up while you work. */
export interface RenderViewOptions {
  /** Traced pixels per scene-window pixel, per side (VIEW_SCALES). */
  readonly scale: number;
  /** Rays per pixel to refine to while nothing changes (VIEW_SAMPLES). */
  readonly samples: number;
  /** Mirror and glass bounces (BOUNCES). */
  readonly bounces: number;
  readonly shadows: ShadowQuality;
  /** The camera's aperture; off traces a pinhole. */
  readonly depthOfField: boolean;
  /** Each ray lands somewhere else in its pixel, so edges smooth out as rays add up. */
  readonly antialias: boolean;
}

type NamedPreset = Exclude<RenderPreset, RenderPreset.Custom>;

/** Final is what Render draws (its depth comes from the scene), refined further; the others trade it for speed. */
const PRESETS: Readonly<Record<NamedPreset, RenderViewOptions>> = {
  [RenderPreset.Draft]: { scale: 0.5, samples: 4, bounces: 2, shadows: ShadowQuality.Off, depthOfField: false, antialias: false },
  [RenderPreset.Balanced]: { scale: 0.75, samples: 16, bounces: 4, shadows: ShadowQuality.Low, depthOfField: true, antialias: true },
  [RenderPreset.Final]: { scale: 1, samples: 64, bounces: DEFAULT_FINAL_BOUNCES, shadows: ShadowQuality.Low, depthOfField: true, antialias: true },
};
const NAMED: readonly NamedPreset[] = [RenderPreset.Draft, RenderPreset.Balanced, RenderPreset.Final];

export const DEFAULT_VIEW_PRESET = RenderPreset.Final;
/** What Custom holds until the user changes an option. */
export const DEFAULT_VIEW_CUSTOM: RenderViewOptions = PRESETS[RenderPreset.Balanced];

/** The options a preset sets; `finalDepth` is the scene's final-render depth (Final follows it). */
export function presetOptions(preset: NamedPreset, finalDepth: number): RenderViewOptions {
  return preset === RenderPreset.Final ? { ...PRESETS[preset], bounces: finalDepth } : PRESETS[preset];
}

/** What Render View traces now. */
export function renderViewOptions(preset: RenderPreset, custom: RenderViewOptions, finalDepth: number): RenderViewOptions {
  return preset === RenderPreset.Custom ? custom : presetOptions(preset, finalDepth);
}

export const sameOptions = (a: RenderViewOptions, b: RenderViewOptions): boolean =>
  a.scale === b.scale && a.samples === b.samples && a.bounces === b.bounces && a.shadows === b.shadows
  && a.depthOfField === b.depthOfField && a.antialias === b.antialias;

/**
 * One option changed from what Render View traces now: the result becomes the
 * Custom set, and the preset is the named one it equals, or Custom.
 */
export function withOption(preset: RenderPreset, custom: RenderViewOptions, finalDepth: number, patch: Partial<RenderViewOptions>): { preset: RenderPreset; custom: RenderViewOptions } {
  const next = { ...renderViewOptions(preset, custom, finalDepth), ...patch };
  const named = NAMED.find((p) => sameOptions(presetOptions(p, finalDepth), next));
  return { preset: named ?? RenderPreset.Custom, custom: next };
}

const SHADOWS: ReadonlySet<unknown> = new Set(Object.values(ShadowQuality));
const SCALES: ReadonlySet<unknown> = new Set(VIEW_SCALES);
const SAMPLES: ReadonlySet<unknown> = new Set(VIEW_SAMPLES);

/** A stored Custom set is used only when every option is one Render View offers. */
export function isRenderViewOptions(v: unknown): v is RenderViewOptions {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Partial<Record<keyof RenderViewOptions, unknown>>;
  return SCALES.has(o.scale) && SAMPLES.has(o.samples) && isBounces(o.bounces) && SHADOWS.has(o.shadows)
    && typeof o.depthOfField === 'boolean' && typeof o.antialias === 'boolean';
}

import type { EditorStore } from './editor-store';
import { LiveQuality } from './world.enums';
import { DEFAULT_LIVE_BOUNCES, DEFAULT_VIEW_CUSTOM, DEFAULT_VIEW_PRESET, RenderPreset, type RenderViewOptions, isBounces, isRenderViewOptions } from './render-setup';
import { DEFAULT_PLAYER, type PlayerSettings, isPlayerSettings } from './player-settings';
import { DEFAULT_PLANE, type PlaneSettings, PlayActor, isPlaneSettings, isPlayActor } from './plane-settings';
import { DEFAULT_EXAMPLE_LIST, type ExampleList, isExampleList } from './example-list';

/** How fast W/A/S/D walk the camera (the speed also follows the scene's size). */
export enum WalkSpeed {
  Slow = 'slow',
  Normal = 'normal',
  Fast = 'fast',
}

/** How fast a drag turns the camera. */
export enum OrbitSpeed {
  Slow = 'slow',
  Normal = 'normal',
  Fast = 'fast',
}

export const SNAP_GRID_STEPS = [0.25, 0.5, 1, 2, 5] as const;
export type SnapGrid = (typeof SNAP_GRID_STEPS)[number];
export const DEFAULT_SNAP_GRID: SnapGrid = 0.5;

/** The interface's colours: Bryce's light stone, a dark one, or as the system asks. */
export enum ThemeMode {
  Light = 'light',
  Dark = 'dark',
  System = 'system',
}

/** How long a message (toast) stays on screen. */
export enum MessageTime {
  Short = 'short',
  Normal = 'normal',
  Long = 'long',
}

/**
 * Personal settings from the Settings window. They outlive the session
 * (io/prefs.ts stores them) and code reads them as `editor.state.settings`;
 * `onSetting` reacts to one of them changing. A new setting is one field here,
 * one default, one check and one row in ui/labs/settings-window.ts.
 */
export interface Settings {
  /** The start window (new scene, files, examples) opens at launch. */
  readonly showStart: boolean;
  /** The welcome splash plays while the ray tracer starts. */
  readonly splash: boolean;
  /** The scene is kept in the browser and comes back on the next visit. */
  readonly autosave: boolean;
  readonly messageTime: MessageTime;
  /** The help line under the render balls. */
  readonly hintLine: boolean;
  readonly walkSpeed: WalkSpeed;
  readonly orbitSpeed: OrbitSpeed;
  readonly snapGrid: SnapGrid;
  /** How hard the live picture works while you edit. */
  readonly liveQuality: LiveQuality;
  /** Mirror and glass bounces of the live picture (Detailed twice as many): world/render-setup.ts. */
  readonly liveBounces: number;
  /** Render View: the preset, and the user's own options for Custom. */
  readonly renderViewPreset: RenderPreset;
  readonly renderViewCustom: RenderViewOptions;
  readonly theme: ThemeMode;
  /** Play mode's player: size, speed, gravity, jump and mouse (world/player-settings.ts). */
  readonly player: PlayerSettings;
  /** Play mode's actor: the walker or the plane (world/plane-settings.ts). */
  readonly playActor: PlayActor;
  /** The plane's speed, turn rate and pitch direction (world/plane-settings.ts). */
  readonly plane: PlaneSettings;
  /** The start window's examples: their order and the hidden ones (world/example-list.ts). */
  readonly examples: ExampleList;
}

export const DEFAULT_SETTINGS: Settings = {
  showStart: true,
  splash: true,
  autosave: true,
  messageTime: MessageTime.Normal,
  hintLine: true,
  walkSpeed: WalkSpeed.Normal,
  orbitSpeed: OrbitSpeed.Normal,
  snapGrid: DEFAULT_SNAP_GRID,
  liveQuality: LiveQuality.Fast,
  liveBounces: DEFAULT_LIVE_BOUNCES,
  renderViewPreset: DEFAULT_VIEW_PRESET,
  renderViewCustom: DEFAULT_VIEW_CUSTOM,
  theme: ThemeMode.Light,
  player: DEFAULT_PLAYER,
  playActor: PlayActor.Walker,
  plane: DEFAULT_PLANE,
  examples: DEFAULT_EXAMPLE_LIST,
};

type Check = (value: unknown) => boolean;
const oneOf = (values: readonly unknown[]): Check => (value) => values.includes(value);
const isBoolean: Check = (value) => typeof value === 'boolean';

/** What a stored value may be; anything else falls back to the default. */
const CHECKS: { readonly [K in keyof Settings]: Check } = {
  showStart: isBoolean,
  splash: isBoolean,
  autosave: isBoolean,
  messageTime: oneOf(Object.values(MessageTime)),
  hintLine: isBoolean,
  walkSpeed: oneOf(Object.values(WalkSpeed)),
  orbitSpeed: oneOf(Object.values(OrbitSpeed)),
  snapGrid: oneOf(SNAP_GRID_STEPS),
  liveQuality: oneOf(Object.values(LiveQuality)),
  liveBounces: isBounces,
  renderViewPreset: oneOf(Object.values(RenderPreset)),
  renderViewCustom: isRenderViewOptions,
  theme: oneOf(Object.values(ThemeMode)),
  player: isPlayerSettings,
  playActor: isPlayActor,
  plane: isPlaneSettings,
  examples: isExampleList,
};

/** The settings stored in `stored`: each value checked, a missing or broken one is the default. */
export function settingsFrom(stored: object): Settings {
  const raw = stored as Readonly<Record<string, unknown>>;
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(CHECKS) as (keyof Settings)[]) if (CHECKS[key](raw[key])) out[key] = raw[key];
  return out as unknown as Settings;
}

/** Changes one setting; the app stores it (app/bootstrap.ts) and the listeners of `onSetting` hear it. */
export function changeSetting<K extends keyof Settings>(editor: EditorStore, key: K, value: Settings[K]): void {
  if (editor.state.settings[key] === value) return;
  editor.update({ settings: { ...editor.state.settings, [key]: value } });
}

/** Calls `listener` whenever one setting changes (not at once); returns the unsubscribe handle. */
export function onSetting<K extends keyof Settings>(editor: EditorStore, key: K, listener: (value: Settings[K]) => void): () => void {
  return editor.events.on('changed', ({ state, previous }) => {
    if (state.settings[key] !== previous.settings[key]) listener(state.settings[key]);
  });
}

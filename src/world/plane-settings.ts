/**
 * Play mode's actor choice and the plane's feel (docs/play-mode.md), kept with
 * the personal settings (world/settings.ts) beside the walker's `player`. The
 * plane's size follows the player's height; these only bend how it flies.
 */

/** Who the keys drive in Play. */
export enum PlayActor {
  /** Half-Life's walker (src/play/sim/fps-actor.ts). */
  Walker = 'walker',
  /** The toy plane (src/play/sim/plane-actor.ts). */
  Plane = 'plane',
}

export interface PlaneSettings {
  /** Multiplies every speed of the flight (and gravity with it, so loops keep their shape). */
  readonly speedScale: number;
  /** Multiplies how fast it pitches, rolls and turns. */
  readonly turnRate: number;
  /** The mouse and the arrows pitch the other way: pull back to climb, like a stick. */
  readonly invertPitch: boolean;
}

export const DEFAULT_PLANE: PlaneSettings = { speedScale: 1, turnRate: 1, invertPitch: false };

/** Accepted values (files from elsewhere, hand edits). */
export const PLANE_LIMITS = {
  speedScale: { min: 0.25, max: 4 },
  turnRate: { min: 0.25, max: 3 },
} as const;

const ACTORS: ReadonlySet<unknown> = new Set(Object.values(PlayActor));
const within = (v: unknown, r: { readonly min: number; readonly max: number }): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max;

export const isPlayActor = (v: unknown): boolean => ACTORS.has(v);

/** A stored plane is used only when every value is sound. */
export function isPlaneSettings(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<Record<keyof PlaneSettings, unknown>>;
  return within(p.speedScale, PLANE_LIMITS.speedScale) && within(p.turnRate, PLANE_LIMITS.turnRate) && typeof p.invertPitch === 'boolean';
}

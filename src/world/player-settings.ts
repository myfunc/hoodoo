/**
 * Play mode's player (docs/play-mode.md): its size and how it moves, kept with
 * the personal settings (world/settings.ts). Lengths are world units; Half-Life's
 * proportions give the defaults: a 72-unit hull, eyes at 64, 32 wide, a 45-unit
 * jump. Play scales every length and speed of the movement with the height, so
 * a giant moves exactly like a human, ten times larger.
 */

export enum PlayerPreset {
  Human = 'human',
  Tiny = 'tiny',
  Giant = 'giant',
  Custom = 'custom',
}

export interface PlayerSettings {
  readonly preset: PlayerPreset;
  /** From the feet to the top of the standing hull. */
  readonly height: number;
  /** From the feet to the eyes, standing. */
  readonly eyeHeight: number;
  /** Half the width of the hull. */
  readonly radius: number;
  readonly jumpHeight: number;
  /** Multiplies run speed and acceleration (1: Half-Life's 320 units a second, scaled to the height). */
  readonly speedScale: number;
  /** Multiplies gravity (1: Half-Life's 800, scaled to the height). */
  readonly gravityScale: number;
  /** Degrees the view turns per pixel of mouse motion, as a factor of the default. */
  readonly sensitivity: number;
}

/** A person in a Hoodoo scene: about 1.8 units, as the scenes are built near metres. */
export const HUMAN_HEIGHT = 1.8;
/** Half-Life's standing hull, in its own units: the yardstick of every proportion here. */
export const HL_HULL = { height: 72, eye: 64, radius: 16, jump: 45 } as const;
const PRESET_SCALE: Readonly<Record<Exclude<PlayerPreset, PlayerPreset.Custom>, number>> = {
  [PlayerPreset.Human]: 1,
  [PlayerPreset.Tiny]: 0.1,
  [PlayerPreset.Giant]: 10,
};

/** Accepted values (files from elsewhere, hand edits). */
export const PLAYER_LIMITS = {
  height: { min: 0.01, max: 1000 },
  scale: { min: 0.05, max: 20 },
  sensitivity: { min: 0.05, max: 10 },
} as const;

/** The player of a preset at Half-Life's proportions; the mouse sensitivity is the caller's. */
export function presetPlayer(preset: PlayerPreset, sensitivity = 1): PlayerSettings {
  const k = (preset === PlayerPreset.Custom ? 1 : PRESET_SCALE[preset]) * (HUMAN_HEIGHT / HL_HULL.height);
  return {
    preset,
    height: HL_HULL.height * k,
    eyeHeight: HL_HULL.eye * k,
    radius: HL_HULL.radius * k,
    jumpHeight: HL_HULL.jump * k,
    speedScale: 1,
    gravityScale: 1,
    sensitivity,
  };
}

export const DEFAULT_PLAYER: PlayerSettings = presetPlayer(PlayerPreset.Human);

const PRESETS: ReadonlySet<unknown> = new Set(Object.values(PlayerPreset));
const within = (v: unknown, r: { readonly min: number; readonly max: number }): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max;

/** A stored player is used only when every value is sound; the eyes sit inside the hull, the hull is taller than wide. */
export function isPlayerSettings(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<Record<keyof PlayerSettings, unknown>>;
  const lengths = [p.height, p.eyeHeight, p.radius, p.jumpHeight].every((x) => within(x, PLAYER_LIMITS.height));
  if (!PRESETS.has(p.preset) || !lengths) return false;
  if (!within(p.speedScale, PLAYER_LIMITS.scale) || !within(p.gravityScale, PLAYER_LIMITS.scale) || !within(p.sensitivity, PLAYER_LIMITS.sensitivity)) return false;
  return (p.eyeHeight as number) <= (p.height as number) && (p.radius as number) * 2 <= (p.height as number);
}

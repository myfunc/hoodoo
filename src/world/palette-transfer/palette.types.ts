/**
 * A colour palette handed over by another tool (Atmosphere Palette): nine colour
 * roles and, optionally, five scene dials. The wire format is docs/palette-transfer.md.
 */

export const SKY_ROLES = ['sky', 'horizon', 'haze', 'fog', 'sun', 'ambient', 'cloud'] as const;
export const OBJECT_ROLES = ['ground', 'accent'] as const;
export const PALETTE_ROLES = [...SKY_ROLES, ...OBJECT_ROLES] as const;

export type SkyRole = (typeof SKY_ROLES)[number];
export type ObjectRole = (typeof OBJECT_ROLES)[number];
export type PaletteRole = (typeof PALETTE_ROLES)[number];

export const ROLE_NAMES: Readonly<Record<PaletteRole, string>> = {
  sky: 'Sky',
  horizon: 'Horizon',
  haze: 'Haze',
  fog: 'Fog',
  sun: 'Sun',
  ambient: 'Ambient',
  cloud: 'Clouds',
  ground: 'Ground',
  accent: 'Accent',
};

/** The scene dials a palette may carry, each 0..100 like Hoodoo's own. */
export const PALETTE_DIALS = ['shadows', 'softShadows', 'fog', 'haze', 'clouds'] as const;
export type PaletteDial = (typeof PALETTE_DIALS)[number];

export const DIAL_NAMES: Readonly<Record<PaletteDial, string>> = {
  shadows: 'Shadows',
  softShadows: 'Soft shadows',
  fog: 'Fog',
  haze: 'Haze',
  clouds: 'Clouds',
};

export interface Palette {
  /** Shown to the user and offered as the My skies name. */
  readonly name: string;
  /** Which tool made it, for the dialog's caption. */
  readonly source: string;
  /** '#rrggbb', lower case. */
  readonly colors: Readonly<Record<PaletteRole, string>>;
  readonly dials: Readonly<Record<PaletteDial, number>> | null;
}

/** What Apply changes beyond the sky colours. */
export enum ObjectTarget {
  None = 'none',
  Ground = 'ground',
  Accent = 'accent',
}

export interface ApplyOptions {
  /** Take Shadows, Soft shadows, Fog, Haze and Clouds from the palette as well. */
  readonly dials: boolean;
  /** Recolour the selected objects with the Ground or Accent colour. */
  readonly objects: ObjectTarget;
}

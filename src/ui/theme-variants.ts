import type { SurfaceSet } from './kit/texture';

/**
 * The dark theme's looks. Each is a stone set painted at start (kit/texture.ts),
 * the seed colours in theme-dark.css under `[data-variant=…]`, and the colour of
 * the browser's title bar. One of them is the Dark theme; the others stay here
 * to compare and to change to with one line (DARK_VARIANT).
 */
export enum DarkVariant {
  /** Brushed graphite: smooth, cool, metallic faces. */
  Graphite = 'graphite',
  /** Bryce's stone gone slate: grained blue-grey panels, teal accents. */
  Slate = 'slate',
  /** Midnight blue-teal, like a Bryce night sky. */
  Midnight = 'midnight',
  /** Walnut and bronze: streaked dark wood, warm parchment titles. */
  Walnut = 'walnut',
  /** The Materials Lab's own charcoal stone everywhere, with its gold titles and amber switches. */
  Lab = 'lab',
}

/** The Dark theme. */
export const DARK_VARIANT: DarkVariant = DarkVariant.Slate;

export interface DarkLook {
  readonly surfaces: SurfaceSet;
  /** The browser's and the installed app's title bar (meta theme-color). */
  readonly titleBar: string;
}

/** Wood: few mottle cells across, many down, so the mottling runs in long horizontal streaks. */
const WOOD_CELLS: readonly [number, number] = [3, 40];
/** Brushed metal: one cell across, a row every two pixels: fine horizontal lines. */
const BRUSHED_CELLS: readonly [number, number] = [1, 96];
const COOL: readonly [number, number, number] = [0.85, 1, 1.15];
const BLUE: readonly [number, number, number] = [0.6, 1, 1.3];
const WARM: readonly [number, number, number] = [1.25, 1, 0.7];

/** Dark stone takes gentler grain than the light one: the same noise reads twice as loud near black. */
export const DARK_LOOKS: Readonly<Record<DarkVariant, DarkLook>> = {
  [DarkVariant.Graphite]: {
    titleBar: '#252629',
    surfaces: {
      '--tex-stone': { base: [50, 51, 54], grain: 4, mottle: 5, seed: 3, cells: BRUSHED_CELLS },
      '--tex-stone-dark': { base: [37, 38, 41], grain: 4, mottle: 4, seed: 5, cells: BRUSHED_CELLS },
      '--tex-lab': { base: [46, 46, 50], grain: 10, mottle: 6, seed: 7 },
      '--tex-paper': { base: [44, 45, 48], grain: 4, mottle: 3, seed: 9 },
    },
  },
  [DarkVariant.Slate]: {
    titleBar: '#292c2e',
    surfaces: {
      '--tex-stone': { base: [56, 60, 62], grain: 9, mottle: 6, seed: 3, tint: COOL },
      '--tex-stone-dark': { base: [41, 44, 46], grain: 9, mottle: 6, seed: 5, tint: COOL },
      '--tex-lab': { base: [48, 49, 53], grain: 11, mottle: 7, seed: 7 },
      '--tex-paper': { base: [48, 52, 54], grain: 6, mottle: 4, seed: 9, tint: COOL },
    },
  },
  [DarkVariant.Midnight]: {
    titleBar: '#121d25',
    surfaces: {
      '--tex-stone': { base: [27, 41, 50], grain: 6, mottle: 6, seed: 3, tint: BLUE },
      '--tex-stone-dark': { base: [18, 29, 37], grain: 6, mottle: 6, seed: 5, tint: BLUE },
      '--tex-lab': { base: [34, 40, 48], grain: 10, mottle: 6, seed: 7 },
      '--tex-paper': { base: [30, 44, 53], grain: 4, mottle: 4, seed: 9, tint: BLUE },
    },
  },
  [DarkVariant.Walnut]: {
    titleBar: '#2c231c',
    surfaces: {
      '--tex-stone': { base: [58, 46, 37], grain: 6, mottle: 9, seed: 3, tint: WARM, cells: WOOD_CELLS },
      '--tex-stone-dark': { base: [44, 35, 28], grain: 6, mottle: 8, seed: 5, tint: WARM, cells: WOOD_CELLS },
      '--tex-lab': { base: [48, 44, 42], grain: 10, mottle: 6, seed: 7 },
      '--tex-paper': { base: [60, 50, 41], grain: 4, mottle: 5, seed: 9, tint: WARM },
    },
  },
  [DarkVariant.Lab]: {
    titleBar: '#262629',
    surfaces: {
      '--tex-stone': { base: [50, 50, 54], grain: 12, mottle: 8, seed: 3 },
      '--tex-stone-dark': { base: [38, 38, 42], grain: 11, mottle: 7, seed: 5 },
      '--tex-lab': { base: [60, 60, 65], grain: 12, mottle: 8, seed: 7 },
      '--tex-paper': { base: [46, 46, 50], grain: 8, mottle: 5, seed: 9 },
    },
  },
};

import { Logger } from '../../core/log';
import { Rng } from '../../core/rng';

const logger = Logger.create('Surfaces');

/**
 * The stone-paper surface of the Bryce 2 interface, generated at start-up
 * (no bitmap assets): fine grain plus soft mottling, tiled as a CSS background.
 * The dark theme paints its own set (ui/theme-variants.ts): a darker base,
 * gentler grain, and mottling that may lean to a hue or run in streaks.
 */
export interface Surface {
  readonly base: readonly [number, number, number];
  readonly grain: number;
  readonly mottle: number;
  readonly seed: number;
  /** How much of the mottling each channel takes (a warm or cool cast); all 1 by default. */
  readonly tint?: readonly [number, number, number];
  /** Mottle cells across and down the tile; more down than across makes horizontal streaks (wood). */
  readonly cells?: readonly [number, number];
}

/** The four surfaces the styles use, by CSS variable. */
export type SurfaceSet = Readonly<Record<'--tex-stone' | '--tex-stone-dark' | '--tex-lab' | '--tex-paper', Surface>>;

const TILE = 192;
const MOTTLE_CELLS = 6;
const OPAQUE = 255;
const NEUTRAL: readonly [number, number, number] = [1, 1, 1];
export const LIGHT_SURFACES: SurfaceSet = {
  '--tex-stone': { base: [212, 211, 206], grain: 14, mottle: 10, seed: 3 },
  '--tex-stone-dark': { base: [188, 187, 182], grain: 14, mottle: 10, seed: 5 },
  '--tex-lab': { base: [54, 54, 58], grain: 12, mottle: 8, seed: 7 },
  '--tex-paper': { base: [234, 234, 230], grain: 8, mottle: 6, seed: 9 },
};

interface Field {
  readonly cells: Float32Array;
  readonly cx: number;
  readonly cy: number;
}

/** Random values on a (cx+1)×(cy+1) lattice whose last row and column repeat the first, so the tile wraps. */
function mottleField(rng: Rng, cx: number, cy: number): Field {
  const row = cx + 1;
  const cells = new Float32Array(row * (cy + 1));
  for (let i = 0; i < cells.length; i++) cells[i] = rng.next() - 0.5;
  for (let j = 0; j <= cy; j++) cells[j * row + cx] = cells[j * row];
  for (let i = 0; i <= cx; i++) cells[cy * row + i] = cells[i];
  return { cells, cx, cy };
}

function mottleAt(f: Field, x: number, y: number): number {
  const fx = (x / TILE) * f.cx;
  const fy = (y / TILE) * f.cy;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const row = f.cx + 1;
  const a = f.cells[iy * row + ix] * (1 - tx) + f.cells[iy * row + ix + 1] * tx;
  const b = f.cells[(iy + 1) * row + ix] * (1 - tx) + f.cells[(iy + 1) * row + ix + 1] * tx;
  return a * (1 - ty) + b * ty;
}

function paint(s: Surface): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const rng = new Rng(s.seed);
  const [cx, cy] = s.cells ?? [MOTTLE_CELLS, MOTTLE_CELLS];
  const field = mottleField(rng, cx, cy);
  const tint = s.tint ?? NEUTRAL;
  const img = g.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const grain = (rng.next() - 0.5) * s.grain;
      const mottle = mottleAt(field, x, y) * s.mottle * 2;
      const i = (y * TILE + x) * 4;
      img.data[i] = s.base[0] + (grain + mottle * tint[0]);
      img.data[i + 1] = s.base[1] + (grain + mottle * tint[1]);
      img.data[i + 2] = s.base[2] + (grain + mottle * tint[2]);
      img.data[i + 3] = OPAQUE;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/** Encoded tiles by surface, so switching theme back and forth paints each tile once. */
const tiles = new Map<string, Promise<string | null>>();
let installed: SurfaceSet | null = null;

function tileUrl(s: Surface): Promise<string | null> {
  const key = JSON.stringify(s);
  let url = tiles.get(key);
  if (!url) {
    url = new Promise((resolve) => {
      const canvas = paint(s);
      if (!canvas) { resolve(null); return; }
      canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null));
    });
    tiles.set(key, url);
  }
  return url;
}

/**
 * Paints the tiles and hands them to CSS as blob URLs. PNG encoding runs off the
 * main thread (toBlob); a synchronous toDataURL of these noisy tiles blocked the
 * first start for ~0.9 s on Windows. Until a tile lands, styles show the flat base colour.
 * A later call (another theme) replaces the set; a tile of a set no longer wanted is not applied.
 */
export function installSurfaces(root: HTMLElement, set: SurfaceSet = LIGHT_SURFACES): void {
  installed = set;
  for (const [name, surface] of Object.entries(set)) {
    void tileUrl(surface).then((url) => {
      if (installed !== set) return;
      if (url) root.style.setProperty(name, `url(${url})`);
      else logger.warn('surface tile not encoded', { name });
    });
  }
}

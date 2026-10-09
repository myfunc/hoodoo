import { Logger } from '../../core/log';
import { Rng } from '../../core/rng';

const logger = Logger.create('Surfaces');

/**
 * The stone-paper surface of the Bryce 2 interface, generated at start-up
 * (no bitmap assets): fine grain plus soft mottling, tiled as a CSS background.
 */
interface Surface {
  readonly base: readonly [number, number, number];
  readonly grain: number;
  readonly mottle: number;
  readonly seed: number;
}

const TILE = 192;
const MOTTLE_CELLS = 6;
const OPAQUE = 255;
const SURFACES: Readonly<Record<string, Surface>> = {
  '--tex-stone': { base: [212, 211, 206], grain: 14, mottle: 10, seed: 3 },
  '--tex-stone-dark': { base: [188, 187, 182], grain: 14, mottle: 10, seed: 5 },
  '--tex-lab': { base: [54, 54, 58], grain: 12, mottle: 8, seed: 7 },
  '--tex-paper': { base: [234, 234, 230], grain: 8, mottle: 6, seed: 9 },
};

function mottleField(rng: Rng): Float32Array {
  const cells = new Float32Array((MOTTLE_CELLS + 1) * (MOTTLE_CELLS + 1));
  for (let i = 0; i < cells.length; i++) cells[i] = rng.next() - 0.5;
  for (let i = 0; i <= MOTTLE_CELLS; i++) {
    cells[i * (MOTTLE_CELLS + 1) + MOTTLE_CELLS] = cells[i * (MOTTLE_CELLS + 1)];
    cells[MOTTLE_CELLS * (MOTTLE_CELLS + 1) + i] = cells[i];
  }
  return cells;
}

function mottleAt(cells: Float32Array, x: number, y: number): number {
  const fx = (x / TILE) * MOTTLE_CELLS;
  const fy = (y / TILE) * MOTTLE_CELLS;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const row = MOTTLE_CELLS + 1;
  const a = cells[iy * row + ix] * (1 - tx) + cells[iy * row + ix + 1] * tx;
  const b = cells[(iy + 1) * row + ix] * (1 - tx) + cells[(iy + 1) * row + ix + 1] * tx;
  return a * (1 - ty) + b * ty;
}

function paint(s: Surface): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const rng = new Rng(s.seed);
  const cells = mottleField(rng);
  const img = g.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = (rng.next() - 0.5) * s.grain + mottleAt(cells, x, y) * s.mottle * 2;
      const i = (y * TILE + x) * 4;
      img.data[i] = s.base[0] + v;
      img.data[i + 1] = s.base[1] + v;
      img.data[i + 2] = s.base[2] + v;
      img.data[i + 3] = OPAQUE;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Paints the tiles and hands them to CSS as blob URLs. PNG encoding runs off the
 * main thread (toBlob); a synchronous toDataURL of these noisy tiles blocked the
 * first start for ~0.9 s on Windows. Until a tile lands, styles show the flat base colour.
 */
export function installSurfaces(root: HTMLElement): void {
  for (const [name, surface] of Object.entries(SURFACES)) {
    paint(surface)?.toBlob((blob) => {
      if (blob) root.style.setProperty(name, `url(${URL.createObjectURL(blob)})`);
      else logger.warn('surface tile not encoded', { name });
    });
  }
}

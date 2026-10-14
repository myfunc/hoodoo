/**
 * READ ME — the effect textures of Sandbox's own guns, drawn on canvases for
 * players without Garry's Mod's sprites: white on black for additive drawing
 * (the weapon colour tints them). Beams carry the texture's u across them and
 * v along them, repeating, so their flicker scrolls with the beam.
 */

const SIZE = 128;
const BEAM = { wide: 64, long: 256, core: 0.07, glow: 0.3, flicker: 0.45, seed: 7 } as const;
const TRACER = { core: 0.12, glow: 0.35 } as const;
const RING = { at: 0.78, width: 0.12 } as const;
const BLACK = '#000';
const WHITE = '#fff';
const GREY = '#555';
const BYTE = 255;
/** Glows: full to `inner`, gone at `outer` (fractions of the radius). */
const GLOWS = { soft: [0, 1], core: [0.15, 0.6], dot: [0.2, 0.5] } as const;
/** Linear congruential steps for a fixed flicker. */
const LCG = { a: 1664525, c: 1013904223, m: 4294967296 } as const;

/** Texture names the hands layer asks for, and whether the texture repeats along v. */
export const OWN_SPRITES: Readonly<Record<string, { readonly draw: () => HTMLCanvasElement; readonly repeat: boolean }>> = {
  beamHeld: { draw: () => beam(BEAM.core, BEAM.glow, BEAM.flicker), repeat: true },
  beamFree: { draw: () => beam(BEAM.core, BEAM.glow, BEAM.flicker), repeat: true },
  endGlow: { draw: () => glow(...GLOWS.soft), repeat: false },
  muzzleGlow: { draw: () => glow(...GLOWS.soft), repeat: false },
  core: { draw: () => glow(...GLOWS.core), repeat: false },
  toolTracer: { draw: () => beam(TRACER.core, TRACER.glow, 0), repeat: true },
  selectRing: { draw: ring, repeat: false },
  selectDot: { draw: () => glow(...GLOWS.dot), repeat: false },
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = BLACK;
  g.fillRect(0, 0, w, h);
  return [c, g];
}

/** A beam: a white core and a soft glow across, brightness flickering along. */
function beam(core: number, glowWidth: number, flicker: number): HTMLCanvasElement {
  const [c, g] = canvas(BEAM.wide, BEAM.long);
  const img = g.getImageData(0, 0, BEAM.wide, BEAM.long);
  let seed: number = BEAM.seed;
  const rows = Array.from({ length: BEAM.long }, () => {
    seed = (seed * LCG.a + LCG.c) % LCG.m;
    return 1 - flicker * (seed / LCG.m);
  });
  // Smooth the flicker a little along the beam, wrapping so the repeat has no seam.
  const smooth = rows.map((_, y) => (rows[(y + BEAM.long - 1) % BEAM.long] + rows[y] * 2 + rows[(y + 1) % BEAM.long]) / 4);
  for (let y = 0; y < BEAM.long; y++) {
    for (let x = 0; x < BEAM.wide; x++) {
      const d = Math.abs((x + 0.5) / BEAM.wide - 0.5) * 2;
      const v = Math.exp(-((d / core) ** 2)) + 0.5 * Math.exp(-((d / glowWidth) ** 2));
      const b = Math.min(1, v * smooth[y]) * BYTE;
      const i = (y * BEAM.wide + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = b;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** A round glow: full from the centre to `inner`, fading to nothing at `outer` (fractions of the radius). */
function glow(inner: number, outer: number): HTMLCanvasElement {
  const [c, g] = canvas(SIZE, SIZE);
  const r = SIZE / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r * outer);
  grad.addColorStop(0, WHITE);
  grad.addColorStop(inner, WHITE);
  grad.addColorStop(0.5 * (1 + inner), GREY);
  grad.addColorStop(1, BLACK);
  g.fillStyle = grad;
  g.fillRect(0, 0, SIZE, SIZE);
  return c;
}

/** A thin bright ring. */
function ring(): HTMLCanvasElement {
  const [c, g] = canvas(SIZE, SIZE);
  const r = SIZE / 2;
  const grad = g.createRadialGradient(r, r, r * (RING.at - RING.width), r, r, r * (RING.at + RING.width));
  grad.addColorStop(0, BLACK);
  grad.addColorStop(0.5, WHITE);
  grad.addColorStop(1, BLACK);
  g.fillStyle = grad;
  g.fillRect(0, 0, SIZE, SIZE);
  return c;
}

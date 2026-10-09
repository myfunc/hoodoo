/** Linear-ish RGB colour in 0..1, stored as a tuple for JSON. Hex is for UI only. */
export type Rgb = readonly [number, number, number];

const HEX_RADIX = 16;
const CHANNEL_MAX = 255;
const HEX_PAIR = 2;

export const rgb = (r: number, g: number, b: number): Rgb => [r, g, b];

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const channel = (i: number) => parseInt(clean.slice(i * HEX_PAIR, i * HEX_PAIR + HEX_PAIR), HEX_RADIX) / CHANNEL_MAX;
  return [channel(0), channel(1), channel(2)];
}

export function rgbToHex(c: Rgb): string {
  const part = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * CHANNEL_MAX)
      .toString(HEX_RADIX)
      .padStart(HEX_PAIR, '0');
  return `#${part(c[0])}${part(c[1])}${part(c[2])}`;
}

const SECTORS = 6;

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const i = Math.floor(h * SECTORS);
  const f = h * SECTORS - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const table: Rgb[] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]];
  return table[((i % SECTORS) + SECTORS) % SECTORS];
}

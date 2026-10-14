import { keyValue, keyValues, parseKeyValues } from '../../../io/source/keyvalues';
import { loadMaterial } from '../../../io/source/material';
import type { KeyValues, SourceFiles } from '../../../io/source/source.types';
import { decodeVtf } from '../../../io/source/vtf';
import { PLAIN_COLORS, PLAIN_FONTS } from './hl2-plain';

/**
 * READ ME — Half-Life 2's HUD scheme from the player's game files: the fonts
 * of resource/clientscheme.res (the custom TrueType ones loaded from the game,
 * the rest from the system) sized the way Source sizes them, its colours, the
 * element boxes of scripts/hudlayout.res in the 640×480 units Source scales by
 * the screen's height, weapon icons from the weapon scripts, and the images of
 * Garry's Mod's notices.
 */

export type Rgba = readonly [number, number, number, number];

/** A scheme font at one screen height, ready for canvas. */
export interface HudFont {
  /** The CSS font. */
  readonly css: string;
  /** Source's height of the font in pixels (the cell: ascent plus descent). */
  readonly tall: number;
  /** From the cell's top to the baseline, pixels. */
  readonly ascent: number;
  readonly blur: number;
  readonly scanlines: number;
  /** Source draws it with hard edges ("antialias" "0"). */
  readonly hard: boolean;
}

interface FontVariant {
  readonly family: string;
  readonly tall: number;
  readonly weight: number;
  readonly blur: number;
  readonly scanlines: number;
  readonly antialias: boolean;
  readonly yres: readonly [number, number] | null;
}

/** Cell height and ascent per em of the faces the scheme names (Windows' winAscent and winDescent). */
interface Metrics {
  readonly cell: number;
  readonly ascent: number;
}

const FILES = {
  scheme: 'resource/clientscheme.res',
  layout: 'scripts/hudlayout.res',
  textures: 'scripts/hud_textures.txt',
} as const;
/** Source lays the HUD out on a screen 480 units tall. */
export const HUD_UNITS_TALL = 480;
const SYSTEM_METRICS: Readonly<Record<string, Metrics>> = {
  verdana: { cell: 2489 / 2048, ascent: 2059 / 2048 },
  arial: { cell: 2288 / 2048, ascent: 1854 / 2048 },
  tahoma: { cell: 2472 / 2048, ascent: 2049 / 2048 },
};
const DEFAULT_METRICS: Metrics = { cell: 1.2, ascent: 0.95 };
const FALLBACK_STACK = 'Verdana, Tahoma, Arial, sans-serif';
const WEIGHT = { min: 100, max: 900, normal: 400 } as const;
const BYTE = 255;
const ALIAS_DEPTH = 8;
/** TrueType tables read for a face's family and metrics. */
const TTF = {
  numTables: 4, dirStart: 12, dirEntry: 16, tagLength: 4, offset: 8,
  nameCount: 2, nameStrings: 4, nameRecords: 6, nameRecord: 12, nameId: 6, nameLength: 8, nameOffset: 10, platform: 0, family: 1,
  unitsPerEm: 18, winAscent: 74, winDescent: 76, mac: 1,
} as const;

export class Hl2Scheme {
  private constructor(
    private readonly fonts: ReadonlyMap<string, readonly FontVariant[]>,
    private readonly colors: ReadonlyMap<string, string>,
    private readonly layout: ReadonlyMap<string, readonly KeyValues[]>,
    private readonly metrics: ReadonlyMap<string, Metrics>,
    private readonly files: SourceFiles,
  ) {}

  /** Reads the scheme and loads its TrueType faces into the page; null without a scheme in the files. */
  static async load(files: SourceFiles): Promise<Hl2Scheme | null> {
    const scheme = await readKv(files, FILES.scheme);
    if (!scheme) return null;
    const root = keyValue(scheme, 'Scheme')?.children ?? scheme;
    const colors = new Map<string, string>();
    for (const block of ['Colors', 'BaseSettings']) for (const kv of keyValue(root, block)?.children ?? []) if (kv.value !== null) colors.set(kv.key.toLowerCase(), kv.value);
    const fonts = new Map<string, FontVariant[]>();
    for (const font of keyValue(root, 'Fonts')?.children ?? []) fonts.set(font.key.toLowerCase(), font.children.map(variant));
    const metrics = new Map(Object.entries(SYSTEM_METRICS));
    for (const kv of keyValue(root, 'CustomFontFiles')?.children ?? []) {
      const face = kv.value ? await loadFace(files, kv.value) : null;
      if (face) metrics.set(face.family.toLowerCase(), face.metrics);
    }
    const layout = new Map<string, readonly KeyValues[]>();
    const hud = await readKv(files, FILES.layout);
    for (const el of hud?.[0]?.children ?? []) layout.set(el.key.toLowerCase(), el.children);
    return new Hl2Scheme(fonts, colors, layout, metrics, files);
  }

  /** The HUD's scheme without the game's files: its fonts in system faces and its colours (hl2-plain.ts). */
  static plain(): Hl2Scheme {
    const fonts = new Map(Object.entries(PLAIN_FONTS).map(([name, vs]) => [name, vs.map((v) => ({ ...v, blur: 0, scanlines: 0, antialias: true }))]));
    const none: SourceFiles = { has: () => false, read: async () => null, list: () => [] };
    return new Hl2Scheme(fonts, new Map(Object.entries(PLAIN_COLORS)), new Map(), new Map(Object.entries(SYSTEM_METRICS)), none);
  }

  /** A scheme colour by name, following names that point at other names ("SelectionTextFg" → "FgColorHud"). */
  color(name: string, fallback: Rgba): Rgba {
    let value: string | undefined = name;
    for (let i = 0; i < ALIAS_DEPTH && value; i++) {
      const parts = value.trim().split(/\s+/).map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) return [parts[0], parts[1], parts[2], parts[3] ?? BYTE];
      value = this.colors.get(value.toLowerCase());
    }
    return fallback;
  }

  /**
   * A scheme font for a screen this many pixels tall: the variant for that
   * height, its size grown with the screen unless the variant names the
   * heights it is for (as Source does).
   */
  font(name: string, screenTall: number): HudFont | null {
    const variants = this.fonts.get(name.toLowerCase()) ?? [];
    const v = variants.find((f) => !f.yres || (screenTall >= f.yres[0] && screenTall <= f.yres[1])) ?? null;
    if (!v) return null;
    const grow = v.yres ? 1 : screenTall / HUD_UNITS_TALL;
    const tall = Math.round(v.tall * grow);
    const m = this.metrics.get(v.family.toLowerCase()) ?? DEFAULT_METRICS;
    const weight = v.weight ? Math.min(WEIGHT.max, Math.max(WEIGHT.min, v.weight)) : WEIGHT.normal;
    const size = tall / m.cell;
    return {
      css: `${weight} ${size}px "${v.family}", ${FALLBACK_STACK}`,
      tall,
      ascent: size * m.ascent,
      blur: v.blur * grow,
      scanlines: Math.max(0, Math.round(v.scanlines * grow)),
      hard: !v.antialias,
    };
  }

  /** A field of a hudlayout.res element ("HudHealth", "xpos"), as written. */
  field(element: string, key: string): string | null {
    return keyValue(this.layout.get(element.toLowerCase()) ?? [], key)?.value ?? null;
  }

  /** A weapon script's icon: the font and character of one of its TextureData entries ("weapon", "weapon_s", "crosshair"). */
  async weaponIcon(script: string, entry: string): Promise<{ font: string; char: string } | null> {
    const kv = await readKv(this.files, `scripts/${script}.txt`);
    const data = keyValue(kv?.[0]?.children ?? [], 'TextureData')?.children ?? [];
    const icon = keyValue(data, entry)?.children ?? [];
    const font = keyValue(icon, 'font')?.value;
    const char = keyValue(icon, 'character')?.value;
    return font && char ? { font, char } : null;
  }

  /** A material's base texture as an image (notice icons, the Tool Gun's icon), or null. */
  async image(material: string): Promise<HTMLCanvasElement | null> {
    const path = `materials/${material}.vmt`;
    if (!this.files.has(path)) return null;
    const base = (await loadMaterial(this.files, path)).params.get('$basetexture');
    const bytes = base ? await this.files.read(`materials/${base}.vtf`) : null;
    if (!bytes) return null;
    const t = decodeVtf(bytes);
    const c = document.createElement('canvas');
    c.width = t.width;
    c.height = t.height;
    (c.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(t.rgba()), t.width, t.height), 0, 0);
    return c;
  }
}

async function readKv(files: SourceFiles, path: string): Promise<KeyValues[] | null> {
  const bytes = await files.read(path);
  return bytes ? parseKeyValues(new TextDecoder().decode(bytes)) : null;
}

function variant(kv: KeyValues): FontVariant {
  const v = kv.children;
  const num = (key: string) => Number(keyValue(v, key)?.value ?? 0) || 0;
  const yres = keyValue(v, 'yres')?.value?.trim().split(/\s+/).map(Number);
  // Of several "name" lines the platform conditions kept the first that applies.
  const family = keyValues(v, 'name')[0]?.value ?? 'Verdana';
  const antialias = keyValue(v, 'antialias')?.value !== '0';
  return { family, tall: num('tall'), weight: num('weight'), blur: num('blur'), scanlines: num('scanlines'), antialias, yres: yres?.length === 2 ? [yres[0], yres[1]] : null };
}

/** Loads a TrueType face from the game into the page under its own family name. */
async function loadFace(files: SourceFiles, path: string): Promise<{ family: string; metrics: Metrics } | null> {
  const bytes = await files.read(path);
  if (!bytes) return null;
  const info = ttfInfo(bytes);
  if (!info) return null;
  const face = new FontFace(info.family, bytes.slice().buffer);
  await face.load();
  document.fonts.add(face);
  return info;
}

/** The family name and Windows cell metrics of a TrueType font. */
export function ttfInfo(bytes: Uint8Array): { family: string; metrics: Metrics } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, number>();
  const count = v.getUint16(TTF.numTables);
  for (let i = 0; i < count; i++) {
    const at = TTF.dirStart + i * TTF.dirEntry;
    tables.set(String.fromCharCode(...bytes.subarray(at, at + TTF.tagLength)), v.getUint32(at + TTF.offset));
  }
  const [head, os2, name] = [tables.get('head'), tables.get('OS/2'), tables.get('name')];
  if (head === undefined || os2 === undefined || name === undefined) return null;
  const em = v.getUint16(head + TTF.unitsPerEm);
  const ascent = v.getUint16(os2 + TTF.winAscent);
  const descent = v.getUint16(os2 + TTF.winDescent);
  const strings = name + v.getUint16(name + TTF.nameStrings);
  let family = '';
  for (let i = 0; i < v.getUint16(name + TTF.nameCount) && !family; i++) {
    const r = name + TTF.nameRecords + i * TTF.nameRecord;
    if (v.getUint16(r + TTF.nameId) !== TTF.family) continue;
    const raw = bytes.subarray(strings + v.getUint16(r + TTF.nameOffset), strings + v.getUint16(r + TTF.nameOffset) + v.getUint16(r + TTF.nameLength));
    // Unicode and Windows names are UTF-16; Macintosh ones one byte a character.
    const mac = v.getUint16(r + TTF.platform) === TTF.mac;
    family = mac ? String.fromCharCode(...raw) : new TextDecoder('utf-16be').decode(raw);
  }
  return family ? { family, metrics: { cell: (ascent + descent) / em, ascent: ascent / em } } : null;
}

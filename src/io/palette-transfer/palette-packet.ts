import { PALETTE_DIALS, PALETTE_ROLES, type Palette, type PaletteDial, type PaletteRole } from '../../world/palette-transfer/palette.types';

/**
 * Reads a palette handed over by another tool: a link whose fragment is
 * `#palette=<base64url of UTF-8 JSON>`, the same JSON pasted as text, or a
 * `.hoodoo-palette.json` file. The fragment never reaches a server. Every size is
 * bounded and anything malformed is refused with a reason a person can act on;
 * nothing here touches the scene. Format: docs/palette-transfer.md.
 */

export const PALETTE_FORMAT = 'hoodoo-palette';
export const PALETTE_VERSION = 1;
export const PALETTE_PARAM = 'palette';
export const PALETTE_FILE_SUFFIX = '.hoodoo-palette.json';
/** Bytes of JSON a palette may take; a real one is about 500. */
export const MAX_PALETTE_BYTES = 16 * 1024;
/** Characters of a link or pasted text; a real link is about 800. */
export const MAX_PALETTE_TEXT = 32 * 1024;
export const MAX_NAME_CHARS = 100;
const DIAL_MAX = 100;
const DEFAULT_NAME = 'Imported palette';
const DEFAULT_SOURCE = 'another tool';
const HEX = /^#[0-9a-f]{6}$/i;
const CONTROL_CHARS = /\p{Cc}/gu;
const SPACES = /\s+/g;
const NOT_JSON = 'The palette is not valid JSON.';
const DAMAGED = 'The palette link is damaged. Copy it again.';

export type PaletteResult = { readonly ok: true; readonly palette: Palette } | { readonly ok: false; readonly error: string };

const fail = (error: string): PaletteResult => ({ ok: false, error });

function cleanText(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const chars = Array.from(v.replace(CONTROL_CHARS, ' ').replace(SPACES, ' ').trim());
  return chars.length ? chars.slice(0, MAX_NAME_CHARS).join('') : fallback;
}

/** Checks a parsed packet; the palette when it holds all nine colours. */
export function paletteFrom(raw: unknown): PaletteResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('This is not a palette.');
  const r = raw as Record<string, unknown>;
  if (r.format !== PALETTE_FORMAT) return fail('This is not a Hoodoo palette.');
  if (typeof r.version !== 'number' || !Number.isInteger(r.version) || r.version < 1) return fail('The palette has no valid version.');
  if (r.version > PALETTE_VERSION) return fail(`The palette was made for a newer Hoodoo (format ${r.version}). Reload Hoodoo and try again.`);
  const c = r.colors;
  if (typeof c !== 'object' || c === null) return fail('The palette has no colours.');
  const colors = {} as Record<PaletteRole, string>;
  for (const role of PALETTE_ROLES) {
    const hex = (c as Record<string, unknown>)[role];
    if (typeof hex !== 'string' || !HEX.test(hex)) return fail(`The palette's ${role} colour is missing or not #rrggbb.`);
    colors[role] = hex.toLowerCase();
  }
  let dials: Record<PaletteDial, number> | null = null;
  if (r.scene !== undefined) {
    if (typeof r.scene !== 'object' || r.scene === null) return fail('The palette\'s scene settings are unreadable.');
    dials = {} as Record<PaletteDial, number>;
    for (const k of PALETTE_DIALS) {
      const v = (r.scene as Record<string, unknown>)[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > DIAL_MAX) return fail(`The palette's ${k} setting must be 0 to 100.`);
      dials[k] = Math.round(v);
    }
  }
  return { ok: true, palette: { name: cleanText(r.name, DEFAULT_NAME), source: cleanText(r.source, DEFAULT_SOURCE), colors, dials } };
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function paletteFromJson(json: string): PaletteResult {
  if (new TextEncoder().encode(json).length > MAX_PALETTE_BYTES) return fail('The palette is too large.');
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fail(NOT_JSON);
  }
  return paletteFrom(raw);
}

/** The `palette=` value of a link (base64url of UTF-8 JSON). */
export function paletteFromParam(value: string): PaletteResult {
  if (value.length > MAX_PALETTE_TEXT) return fail('The palette link is too long.');
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(value));
  } catch {
    return fail(DAMAGED);
  }
  const r = paletteFromJson(json);
  return !r.ok && r.error === NOT_JSON ? fail(DAMAGED) : r;
}

/** Where a fragment names a palette: `palette=` at its start or after `&`, up to the next `&`. */
const LINK_KEY = new RegExp(`[#&]${PALETTE_PARAM}=([^&]*)`);
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const EMPTY = 'The palette link is empty. Copy it again.';

/**
 * Null when the fragment names no palette (a scene link, or nothing). A fragment
 * that names one but carries nothing usable gets a reason, never silence.
 */
export function paletteFromHash(hash: string): PaletteResult | null {
  if (hash.length > MAX_PALETTE_TEXT) return LINK_KEY.test(hash.slice(0, MAX_PALETTE_TEXT)) ? fail('The palette link is too long.') : null;
  const m = LINK_KEY.exec(hash);
  if (!m) return null;
  if (!m[1]) return fail(EMPTY);
  return BASE64URL.test(m[1]) ? paletteFromParam(m[1]) : fail(DAMAGED);
}

/** A pasted link or JSON. */
export function paletteFromText(text: string): PaletteResult {
  const t = text.trim();
  if (!t) return fail('Paste a palette link or its JSON first.');
  if (t.length > MAX_PALETTE_TEXT) return fail('The pasted text is too long for a palette.');
  if (t.startsWith('{')) return paletteFromJson(t);
  return paletteFromHash(t) ?? fail('This is neither a palette link nor palette JSON.');
}

export const isPaletteFile = (file: { readonly name: string }): boolean => file.name.toLowerCase().endsWith(PALETTE_FILE_SUFFIX);

export async function paletteFromFile(file: Blob): Promise<PaletteResult> {
  if (file.size > MAX_PALETTE_BYTES) return fail('The file is too large for a palette.');
  return paletteFromJson(await file.text());
}

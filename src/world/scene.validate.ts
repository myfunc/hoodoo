import { DEFAULT_LIGHT } from '../assets/object.catalog';
import type { Vec3 } from '../core/vec3';
import { VALUE_LIMITS } from '../model/material.factory';
import type { Rgb } from '../core/color';
import { BooleanMode, ChannelSource, ColorChannel, Family, ShapeKind, SkyMode, TextureKind, TextureMapping, ValueChannel } from '../model/scene.enums';
import type { Camera, CloudSettings, DocumentSetup, LightData, OrthoView, ProceduralTexture, Sky, Transform } from '../model/scene.types';

/**
 * Guards for scene data that arrives from outside (files, share links, autosave):
 * anything that would crash the renderer every frame is refused here.
 */
export class SceneFileError extends Error {}

export const TERRAIN_RES = { min: 2, max: 512 } as const;
/** Limits for files and links from elsewhere: enough for any real scene, too little to hang a browser. */
export const SCENE_LIMITS = { objects: 400, terrainSamples: 4194304, booleanMembers: 24, name: 80, id: 64 } as const;
const MAX_COORD = 1e6;
const MIN_SIZE = 1e-4;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < MAX_COORD;

const values = <T extends Record<string, string | number>>(e: T): ReadonlySet<unknown> =>
  new Set(Object.values(e).filter((v) => typeof v === 'number'));
const SHAPES = values(ShapeKind);
const BOOLEANS = values(BooleanMode);
const FAMILIES = values(Family);

export function vec3(v: unknown, what: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) throw new SceneFileError(`${what} is not three numbers`);
  return [v[0], v[1], v[2]];
}

export function transform(t: unknown): Transform {
  const r = (t ?? {}) as Partial<Record<keyof Transform, unknown>>;
  const size = vec3(r.size, 'size').map((s) => (Math.abs(s) < MIN_SIZE ? MIN_SIZE : s)) as unknown as Vec3;
  return { position: vec3(r.position, 'position'), rotation: vec3(r.rotation, 'rotation'), size };
}

export function shapeKind(k: unknown): ShapeKind {
  if (!SHAPES.has(k)) throw new SceneFileError(`unknown object kind ${String(k)}`);
  return k as ShapeKind;
}

export const booleanMode = (b: unknown): BooleanMode => (BOOLEANS.has(b) ? (b as BooleanMode) : BooleanMode.Neutral);
export const family = (f: unknown): Family => (FAMILIES.has(f) ? (f as Family) : Family.Gray);

export function terrainResolution(res: unknown): number {
  if (!Number.isInteger(res) || (res as number) < TERRAIN_RES.min || (res as number) > TERRAIN_RES.max) {
    throw new SceneFileError(`terrain resolution ${String(res)} is out of range`);
  }
  return res as number;
}

const num = (v: unknown, fallback: number): number => (isNum(v) ? v : fallback);
const DOC = { min: 32, max: 8192 } as const;
const DIAL = { min: 0, max: 100 } as const;
const CONE = { min: 1, max: 179 } as const;
const ALTITUDE = { min: -90, max: 90 } as const;
const HEIGHT = { min: 0, max: 1000 } as const;
const OCTAVES = { min: 1, max: 8 } as const;
const FREQUENCY = { min: 1e-3, max: 1e3 } as const;
const clampNum = (v: unknown, fallback: number, r: { readonly min: number; readonly max: number }): number =>
  Math.min(r.max, Math.max(r.min, num(v, fallback)));

/** Names shown in the outliner and history are cut to a sane length. */
export const label = (v: unknown, fallback: string): string => (typeof v === 'string' ? v.slice(0, SCENE_LIMITS.name) : fallback);

export function light(l: unknown): LightData {
  const r = (l ?? {}) as Partial<LightData>;
  return {
    color: Array.isArray(r.color) && r.color.length === 3 && r.color.every(isNum) ? (r.color as LightData['color']) : DEFAULT_LIGHT.color,
    intensity: clampNum(r.intensity, DEFAULT_LIGHT.intensity, DIAL),
    cone: clampNum(r.cone, DEFAULT_LIGHT.cone, CONE),
    falloff: clampNum(r.falloff, DEFAULT_LIGHT.falloff, DIAL),
  };
}

const FOV = { min: 1, max: 170 } as const;
const FOCUS = { min: 0.5, max: 1e5 } as const;

export function camera(c: unknown, d: Camera): Camera {
  const r = (c ?? {}) as Partial<Record<keyof Camera, unknown>>;
  const p = r.position;
  const position: Vec3 = Array.isArray(p) && p.length === 3 && p.every(isNum) ? [p[0], p[1], p[2]] : d.position;
  return {
    position,
    yaw: num(r.yaw, d.yaw),
    pitch: num(r.pitch, d.pitch),
    bank: num(r.bank, d.bank),
    fov: clampNum(r.fov, d.fov, FOV),
    focus: clampNum(r.focus, d.focus, FOCUS),
    aperture: clampNum(r.aperture, d.aperture, DIAL),
  };
}

export function documentSetup(doc: unknown, d: DocumentSetup): DocumentSetup {
  const r = (doc ?? {}) as Partial<Record<keyof DocumentSetup, unknown>>;
  const dim = (v: unknown, f: number) => Math.round(Math.min(DOC.max, Math.max(DOC.min, num(v, f))));
  return { width: dim(r.width, d.width), height: dim(r.height, d.height) };
}

const isRgb = (c: unknown): c is Rgb => Array.isArray(c) && c.length === 3 && c.every(isNum);
const rgbOr = (c: unknown, d: Rgb): Rgb => (isRgb(c) ? [c[0], c[1], c[2]] : d);
const TEXTURES = values(TextureKind);
const MAPPINGS = values(TextureMapping);
const SOURCES = values(ChannelSource);
const SKY_MODES = values(SkyMode);
const MIN_SPAN = 0.01;

export function sky(s: unknown, d: Sky): Sky {
  const r = (s ?? {}) as Partial<Record<keyof Sky, unknown>>;
  const c = (r.clouds ?? {}) as Partial<Record<keyof CloudSettings, unknown>>;
  const bool = (v: unknown, f: boolean) => (typeof v === 'boolean' ? v : f);
  return {
    mode: SKY_MODES.has(r.mode) ? (r.mode as SkyMode) : d.mode,
    skyColor: rgbOr(r.skyColor, d.skyColor),
    horizonColor: rgbOr(r.horizonColor, d.horizonColor),
    sunColor: rgbOr(r.sunColor, d.sunColor),
    ambientColor: rgbOr(r.ambientColor, d.ambientColor),
    sunAzimuth: num(r.sunAzimuth, d.sunAzimuth),
    sunAltitude: clampNum(r.sunAltitude, d.sunAltitude, ALTITUDE),
    sunVisible: bool(r.sunVisible, d.sunVisible),
    shadows: clampNum(r.shadows, d.shadows, DIAL),
    fogAmount: clampNum(r.fogAmount, d.fogAmount, DIAL),
    fogHeight: clampNum(r.fogHeight, d.fogHeight, HEIGHT),
    fogColor: rgbOr(r.fogColor, d.fogColor),
    hazeAmount: clampNum(r.hazeAmount, d.hazeAmount, DIAL),
    hazeColor: rgbOr(r.hazeColor, d.hazeColor),
    stars: bool(r.stars, d.stars),
    clouds: {
      cumulus: bool(c.cumulus, d.clouds.cumulus),
      stratus: bool(c.stratus, d.clouds.stratus),
      cover: clampNum(c.cover, d.clouds.cover, DIAL),
      height: clampNum(c.height, d.clouds.height, HEIGHT),
      frequency: clampNum(c.frequency, d.clouds.frequency, DIAL),
      amplitude: clampNum(c.amplitude, d.clouds.amplitude, DIAL),
      color: rgbOr(c.color, d.clouds.color),
    },
  };
}

export function orthoView(v: unknown, d: OrthoView): OrthoView {
  const r = (v ?? {}) as Partial<Record<keyof OrthoView, unknown>>;
  const p = r.center;
  const center: Vec3 = Array.isArray(p) && p.length === 3 && p.every(isNum) ? [p[0], p[1], p[2]] : d.center;
  return { center, span: isNum(r.span) && r.span > MIN_SPAN ? r.span : d.span };
}

/** A texture record, or null when it is not one. */
export function proceduralTexture(t: unknown): ProceduralTexture | null {
  const r = (t ?? {}) as Partial<Record<keyof ProceduralTexture, unknown>>;
  if (!TEXTURES.has(r.kind) || !Array.isArray(r.colors) || r.colors.length !== 3 || !r.colors.every(isRgb)) return null;
  if (!isNum(r.frequency) || !isNum(r.detail) || !isNum(r.contrast) || !isNum(r.seed)) return null;
  return {
    kind: r.kind as TextureKind,
    mapping: MAPPINGS.has(r.mapping) ? (r.mapping as TextureMapping) : TextureMapping.World,
    frequency: clampNum(r.frequency, 1, FREQUENCY),
    detail: Math.round(clampNum(r.detail, 1, OCTAVES)),
    contrast: clampNum(r.contrast, 0, DIAL),
    seed: r.seed,
    colors: [r.colors[0], r.colors[1], r.colors[2]],
  };
}

/** Channel colours, values and sources keep only well-formed entries; the factory fills the rest. */
export function materialParts(m: unknown): {
  name: string;
  colors: Partial<Record<ColorChannel, Rgb>>;
  values: Partial<Record<ValueChannel, number>>;
  colorSources: Partial<Record<ColorChannel, ChannelSource>>;
  valueSources: Partial<Record<ValueChannel, ChannelSource>>;
  textures: (ProceduralTexture | null)[];
} {
  const r = (m ?? {}) as Record<string, unknown>;
  const pick = <K extends string, V>(src: unknown, keys: readonly K[], ok: (v: unknown) => boolean): Partial<Record<K, V>> => {
    const o = (src ?? {}) as Record<string, unknown>;
    return Object.fromEntries(keys.filter((k) => ok(o[k])).map((k) => [k, o[k]])) as Partial<Record<K, V>>;
  };
  const colorKeys = Object.values(ColorChannel);
  const valueKeys = Object.values(ValueChannel);
  return {
    name: label(r.name, 'Untitled'),
    colors: pick<ColorChannel, Rgb>(r.colors, colorKeys, isRgb),
    values: Object.fromEntries(Object.entries(pick<ValueChannel, number>(r.values, valueKeys, isNum)).map(([k, v]) =>
      [k, clampNum(v, 0, { min: 0, max: VALUE_LIMITS[k as ValueChannel] })])) as Partial<Record<ValueChannel, number>>,
    colorSources: pick<ColorChannel, ChannelSource>(r.colorSources, colorKeys, (v) => SOURCES.has(v)),
    valueSources: pick<ValueChannel, ChannelSource>(r.valueSources, valueKeys, (v) => SOURCES.has(v)),
    textures: Array.isArray(r.textures) ? r.textures.slice(0, 3).map(proceduralTexture) : [],
  };
}

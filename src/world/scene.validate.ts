import { DEFAULT_LIGHT } from '../assets/object.catalog';
import { latheIndex } from '../assets/lathe.profiles';
import type { Vec3 } from '../core/vec3';
import { VALUE_LIMITS, material } from '../model/material.factory';
import type { Rgb } from '../core/color';
import { BooleanMode, ChannelSource, ColorChannel, Ease, Family, ShapeKind, SmartRuleKind, SkyMode, TextureKind, TextureMapping, ValueChannel } from '../model/scene.enums';
import { asGroupId, asSmartGroupId, newSmartGroupId } from '../model/scene.ids';
import type { Animation, Camera, CloudSettings, DocumentSetup, GroupNode, Key, LightData, MaterialKey, ObjectKey, OrthoView, ProceduralTexture, RenderSetup, RigFlags, Scene, Sky, SmartGroup, SmartRule, Transform } from '../model/scene.types';
import { clampBounces } from './render-setup';
import type { BodyFlags } from '../model/scene.types';
import { MASS_RANGE } from './body-flags';
import { playScript } from './play/script-validate';
import { SCENE_LIMITS } from './scene.constants';
import { smartName } from './smart-groups';

/**
 * Guards for scene data that arrives from outside (files, share links, autosave):
 * anything that would crash the renderer every frame is refused here.
 */
export class SceneFileError extends Error {}

export const TERRAIN_RES = { min: 2, max: 512 } as const;
export { SCENE_LIMITS } from './scene.constants';
/** What a group is called until it is renamed. */
export const GROUP_NAME = 'Group';
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

/** A shape's parameter: a number, and for a Lathe one of its profiles (an unknown one becomes the nearest). */
export function shapeParam(kind: ShapeKind, v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return kind === ShapeKind.Lathe ? latheIndex(n) : n;
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
  const size = { width: dim(r.width, d.width), height: dim(r.height, d.height) };
  return r.fit === true ? { ...size, fit: true } : size;
}

/** The final render's options; null when there are none (the defaults then apply). */
export function renderSetup(r: unknown): RenderSetup | null {
  const raw = (r ?? {}) as Partial<Record<keyof RenderSetup, unknown>>;
  return isNum(raw.bounces) ? { bounces: clampBounces(raw.bounces) } : null;
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
    softShadows: clampNum(r.softShadows, d.softShadows, DIAL),
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

export const ANIMATION_LIMITS = { duration: { min: 0.5, max: 600 }, fps: { min: 6, max: 60 } } as const;

const EASES: ReadonlySet<unknown> = new Set(Object.values(Ease));

/** Keys of one track: well-formed ones only, sorted, at most keysPerTrack. Keys past the end are kept (world/animation/duration). */
function keys<T>(v: unknown, value: (raw: unknown) => T): Key<T>[] {
  if (!Array.isArray(v)) return [];
  const out: Key<T>[] = [];
  for (const k of v.slice(0, SCENE_LIMITS.keysPerTrack)) {
    const r = (k ?? {}) as Partial<Record<keyof Key<T>, unknown>>;
    if (!isNum(r.time)) continue;
    // Smooth is the default: only the other eases are written down.
    const ease = r.ease !== Ease.Smooth && EASES.has(r.ease) ? { ease: r.ease as Ease } : {};
    try {
      out.push({ time: Math.min(ANIMATION_LIMITS.duration.max, Math.max(0, r.time)), value: value(r.value), ...ease });
    } catch {
      // A malformed key is dropped; the rest of the track still plays.
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

const unitRgb = (c: Rgb): Rgb => [Math.min(1, Math.max(0, c[0])), Math.min(1, Math.max(0, c[1])), Math.min(1, Math.max(0, c[2]))];
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const unlessEmpty = <T extends object>(o: T): T | null => (Object.keys(o).length ? o : null);

/** The material values a key holds: colours in 0..1, dials in their range, a whole look or none. */
function materialKey(v: unknown): MaterialKey | null {
  if (!isRecord(v)) return null;
  const parts = materialParts({ colors: v.colors, values: v.values });
  const colors = unlessEmpty(Object.fromEntries(Object.entries(parts.colors).map(([k, c]) => [k, unitRgb(c)])));
  const values = unlessEmpty(parts.values);
  const m = isRecord(v.look) ? material(materialParts(v.look)) : null;
  const look = m ? { name: m.name, colorSources: m.colorSources, valueSources: m.valueSources, textures: m.textures } : null;
  return unlessEmpty({ ...(colors ? { colors } : {}), ...(values ? { values } : {}), ...(look ? { look } : {}) });
}

/** The light values a key holds, each clamped like the light's own. */
function lightKey(v: unknown): Partial<LightData> | null {
  if (!isRecord(v)) return null;
  return unlessEmpty({
    ...(isRgb(v.color) ? { color: unitRgb(v.color) } : {}),
    ...(isNum(v.intensity) ? { intensity: clampNum(v.intensity, 0, DIAL) } : {}),
    ...(isNum(v.falloff) ? { falloff: clampNum(v.falloff, 0, DIAL) } : {}),
    ...(isNum(v.cone) ? { cone: clampNum(v.cone, CONE.min, CONE) } : {}),
  });
}

/** An object key: its pose, and the material, light and visibility values it changes (world/animation/prop-channels). */
export function objectKey(v: unknown): ObjectKey {
  const r = isRecord(v) ? v : {};
  const m = materialKey(r.material);
  const l = lightKey(r.light);
  return { ...transform(v), ...(m ? { material: m } : {}), ...(l ? { light: l } : {}), ...(typeof r.hidden === 'boolean' ? { hidden: r.hidden } : {}) };
}

/** A group's transform: like an object's, its scale kept positive (a group cannot mirror what it holds). */
export function groupTransform(t: unknown): Transform {
  const out = transform(t);
  return { ...out, size: out.size.map(Math.abs) as unknown as Vec3 };
}

/** Transform tracks of the given ids, well-formed keys only; empty tracks go. */
function transformTracks<T extends Transform>(v: unknown, ids: ReadonlySet<string>, value: (raw: unknown) => T): Record<string, Key<T>[]> {
  const tracks = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(tracks).filter((id) => ids.has(id)).map((id) => [id, keys(tracks[id], value)] as const).filter(([, k]) => k.length > 0),
  );
}

/** Track names of closed paths (`object:<id>`, `group:<id>`, `camera:`, `sky:`) whose track exists. */
function cyclicTracks(v: unknown, a: Pick<Animation, 'objects' | 'groups' | 'camera' | 'sky'>): string[] {
  if (!Array.isArray(v)) return [];
  const live = new Set([
    ...Object.keys(a.objects).map((id) => `object:${id}`),
    ...Object.keys(a.groups ?? {}).map((id) => `group:${id}`),
    ...(a.camera.length ? ['camera:'] : []),
    ...(a.sky.length ? ['sky:'] : []),
  ]);
  return [...new Set(v.filter((n): n is string => typeof n === 'string' && live.has(n)))];
}

/** The timeline of a file; tracks of objects and groups that are not in the scene are dropped. */
export function animation(v: unknown, d: Animation, objectIds: ReadonlySet<string>, cam: Camera, skyDefault: Sky, groupIds: ReadonlySet<string> = new Set()): Animation {
  const r = (v ?? {}) as Partial<Record<keyof Animation, unknown>>;
  const duration = clampNum(r.duration, d.duration, ANIMATION_LIMITS.duration);
  const objects = transformTracks(r.objects, objectIds, objectKey);
  const groups = transformTracks(r.groups, groupIds, groupTransform);
  const out: Animation = {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    duration,
    fps: Math.round(clampNum(r.fps, d.fps, ANIMATION_LIMITS.fps)),
    loop: typeof r.loop === 'boolean' ? r.loop : d.loop,
    objects,
    ...(Object.keys(groups).length ? { groups } : {}),
    camera: keys(r.camera, (c) => camera(c, cam)),
    sky: keys(r.sky, (s) => sky(s, skyDefault)),
  };
  const cyclic = cyclicTracks(r.cyclic, out);
  return cyclic.length ? { ...out, cyclic } : out;
}

/** A malformed group transform leaves the group where it was built. */
function optionalGroupTransform(t: unknown): Transform | null {
  try {
    return groupTransform(t);
  } catch (e) {
    if (!(e instanceof SceneFileError)) throw e;
    return null;
  }
}

/** An object or group id: a short non-empty string. */
export const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= SCENE_LIMITS.id;

/**
 * The group table of a file: well-formed entries only, the first of each id.
 * A missing parent makes a top-level group; a loop or a chain deeper than
 * groupDepth is cut at the link that breaks it, so every chain ends at the top.
 */
export function groupTable(v: unknown): GroupNode[] {
  if (!Array.isArray(v)) return [];
  const nodes = new Map<string, GroupNode>();
  for (const raw of v.slice(0, SCENE_LIMITS.groups)) {
    const r = (raw ?? {}) as Partial<Record<keyof GroupNode, unknown>>;
    if (!isId(r.id) || nodes.has(r.id)) continue;
    const id = asGroupId(r.id);
    const node: GroupNode = { id, name: label(r.name, GROUP_NAME) || GROUP_NAME, parentId: isId(r.parentId) ? asGroupId(r.parentId) : null, collapsed: r.collapsed === true };
    const pose = r.transform === undefined ? null : optionalGroupTransform(r.transform);
    const body = bodyFlags(r.body);
    const script = playScript(r.script);
    nodes.set(id, { ...node, ...(pose ? { transform: pose } : {}), ...(body ? { body } : {}), ...(script ? { script } : {}) });
  }
  const parent = new Map([...nodes.values()].map((n) => [n.id as string, n.parentId && nodes.has(n.parentId) ? n.parentId : null]));
  for (const id of parent.keys()) {
    const seen = new Set([id]);
    let at = id;
    for (let depth = 1; ; depth++) {
      const up = parent.get(at) ?? null;
      if (up === null) break;
      if (seen.has(up) || depth >= SCENE_LIMITS.groupDepth) {
        parent.set(at, null);
        break;
      }
      seen.add(up);
      at = up;
    }
  }
  return [...nodes.values()].map((n) => ({ ...n, parentId: parent.get(n.id) ?? null }));
}

/** The camera's and the sun's eye and lock: true values only; absent when both are shown and free. */
export function rigTable(v: unknown): Scene['rig'] {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const flags = (f: unknown): RigFlags | null => {
    const o = (f && typeof f === 'object' ? f : {}) as Partial<Record<keyof RigFlags, unknown>>;
    return o.hidden === true || o.locked === true ? { hidden: o.hidden === true, locked: o.locked === true } : null;
  };
  const camera = flags(r.camera);
  const sun = flags(r.sun);
  return camera || sun ? { ...(camera ? { camera } : {}), ...(sun ? { sun } : {}) } : undefined;
}

/** Play mode's physics flags of an object or a group; null when absent or unreadable (the kind's defaults then apply). */
export function bodyFlags(v: unknown): BodyFlags | null {
  const r = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof BodyFlags, unknown>>;
  if (typeof r.solid !== 'boolean' || typeof r.physical !== 'boolean') return null;
  return { solid: r.solid, physical: r.physical, ...(isNum(r.mass) && r.mass > 0 ? { mass: clampNum(r.mass, MASS_RANGE.min, MASS_RANGE) } : {}) };
}

/** A saved membership rule, or null when its inputs are not usable. */
export function smartRule(v: unknown): SmartRule | null {
  const r = (v ?? {}) as { readonly by?: unknown; readonly kinds?: unknown; readonly material?: unknown; readonly text?: unknown };
  switch (r.by) {
    case SmartRuleKind.Kind:
      if (!Array.isArray(r.kinds) || !r.kinds.length || !r.kinds.every((k) => SHAPES.has(k))) return null;
      return { by: r.by, kinds: [...new Set(r.kinds as ShapeKind[])] };
    case SmartRuleKind.Material:
      return typeof r.material === 'string' && r.material.trim() ? { by: r.by, material: r.material.trim().slice(0, SCENE_LIMITS.name) } : null;
    case SmartRuleKind.Name:
      return typeof r.text === 'string' && r.text.trim() ? { by: r.by, text: r.text.trim().slice(0, SCENE_LIMITS.name) } : null;
    default: return null;
  }
}

/** Saved smart groups have valid rules and short, unique ids and names. */
export function smartGroupTable(v: unknown): SmartGroup[] {
  if (!Array.isArray(v)) return [];
  const groups: SmartGroup[] = [];
  const seen = new Set<string>();
  const entries = v.slice(0, SCENE_LIMITS.smartGroups);
  const reserved = new Set(entries.flatMap((raw) => isId(raw?.id) ? [raw.id as string] : []));
  for (const raw of entries) {
    const r = (raw ?? {}) as Partial<Record<keyof SmartGroup, unknown>>;
    const rule = smartRule(r.rule);
    if (!rule) continue;
    let id = isId(r.id) && !seen.has(r.id) ? asSmartGroupId(r.id) : newSmartGroupId();
    if (id !== r.id) while (seen.has(id) || reserved.has(id)) id = newSmartGroupId();
    seen.add(id);
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, SCENE_LIMITS.name) : '';
    groups.push({ id, name: name || smartName(rule), rule });
  }
  return groups;
}

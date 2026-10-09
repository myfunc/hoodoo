import type { Rgb } from '../../core/color';
import { invert, transformDir } from '../../core/mat4';
import { normalize } from '../../core/vec3';
import { COLOR_CHANNELS, VALUE_CHANNELS } from '../../model/material.factory';
import { BooleanMode, ChannelSource, ShapeKind, SkyMode, ValueChannel } from '../../model/scene.enums';
import type { GroupId } from '../../model/scene.ids';
import type { Material, Scene, SceneObject, Sky } from '../../model/scene.types';
import { boxSphere, objectMatrix, worldBox } from '../../world/bounds';
import { INFINITE_KINDS, LIGHT_KINDS, TERRAIN_KINDS } from '../../world/objects.factory';
import { field, resample } from '../../world/terrain/heightfield';
import {
  CLOUD_BASE_HEIGHT, CLOUD_HEIGHT_RANGE, DEG, DIAL, FLAG_HAS_MODIFIERS, FLAG_NO_SHADOW, FLAG_OPAQUE, LIGHT_FALLOFF_SCALE,
  LIGHT_INTENSITY_SCALE, MAT_TEXELS, MAX_LIGHTS, MAX_OBJECTS, MAX_TERRAIN_RES, MIN_TERRAIN_RES, OBJ_TEXELS,
  REFRACTION_UNIT, TERRAIN_CELL, TEXEL_FLOATS,
} from './render.constants';

export interface PackedTerrains {
  readonly res: number;
  readonly layers: readonly Float32Array[];
  /** Per layer: max height of each TERRAIN_CELL² block (one texel of padding included). */
  readonly maxLayers: readonly Float32Array[];
  readonly cells: number;
  /** Identity of the source arrays: unchanged key means no re-upload. */
  readonly key: string;
}

export interface PackedScene {
  readonly count: number;
  readonly objects: Float32Array;
  readonly materials: Float32Array;
  readonly terrains: PackedTerrains;
  readonly lightCount: number;
  readonly lightPos: Float32Array;
  readonly lightColor: Float32Array;
  readonly lightDir: Float32Array;
  readonly dropped: number;
}

const ROW_OBJ = OBJ_TEXELS * TEXEL_FLOATS;
const ROW_MAT = MAT_TEXELS * TEXEL_FLOATS;
const SPOT_DOWN = [0, -1, 0] as const;
const T = TEXEL_FLOATS;
/** Float offsets of the texels in a material row (see 60-shade.glsl / 20-textures.glsl). */
const MAT_AT = { diffuse: 0, ambient: T, specular: 2 * T, transparent: 3 * T, extra: 4 * T, colorSources: 5 * T, valueSources: 6 * T, textures: 8 * T } as const;
const TEX_STRIDE = 4 * T;
const TEX_AT = { header: 0, color0: T, color1: 2 * T, color2: 3 * T } as const;
/** Float offsets of the texels in an object row (see 40-scene.glsl). */
const OBJ_AT = { header: 3 * T, params: 4 * T, bound: 5 * T } as const;

const terrainIds = new WeakMap<Float32Array, number>();
let nextTerrainId = 1;
const arrayId = (a: Float32Array): number => {
  let id = terrainIds.get(a);
  if (!id) {
    id = nextTerrainId++;
    terrainIds.set(a, id);
  }
  return id;
};

function writeRgb(out: Float32Array, at: number, c: Rgb, w: number): void {
  out[at] = c[0]; out[at + 1] = c[1]; out[at + 2] = c[2]; out[at + 3] = w;
}

function packMaterial(out: Float32Array, row: number, m: Material): void {
  const base = row * ROW_MAT;
  const v = (k: ValueChannel) => m.values[k] / DIAL;
  writeRgb(out, base + MAT_AT.diffuse, m.colors.diffuse, v(ValueChannel.Diffusion));
  writeRgb(out, base + MAT_AT.ambient, m.colors.ambient, v(ValueChannel.Ambience));
  writeRgb(out, base + MAT_AT.specular, m.colors.specular, v(ValueChannel.Specularity));
  writeRgb(out, base + MAT_AT.transparent, m.colors.transparent, v(ValueChannel.Transparency));
  out.set([v(ValueChannel.Metallicity), v(ValueChannel.Reflection), Math.max(m.values.refraction, 1) / REFRACTION_UNIT, v(ValueChannel.Bump)], base + MAT_AT.extra);
  out.set(COLOR_CHANNELS.map((c) => m.colorSources[c]), base + MAT_AT.colorSources);
  out.set(VALUE_CHANNELS.map((c) => m.valueSources[c]), base + MAT_AT.valueSources);
  m.textures.forEach((t, slot) => {
    const at = base + MAT_AT.textures + slot * TEX_STRIDE;
    if (!t) return;
    out.set([t.kind, t.frequency, t.detail, t.mapping], at + TEX_AT.header);
    writeRgb(out, at + TEX_AT.color0, t.colors[0], t.seed);
    writeRgb(out, at + TEX_AT.color1, t.colors[1], t.contrast);
    writeRgb(out, at + TEX_AT.color2, t.colors[2], 0);
  });
}

function packTerrains(objs: readonly SceneObject[]): PackedTerrains {
  const terrains = objs.filter((o) => o.terrain).map((o) => o.terrain!);
  const res = Math.min(MAX_TERRAIN_RES, Math.max(MIN_TERRAIN_RES, ...terrains.map((t) => t.resolution)));
  const layers = terrains.map((t) => (t.resolution === res ? t.heights : resample(field(t.resolution, t.heights), res).h));
  const cells = Math.max(1, Math.floor(res / TERRAIN_CELL));
  return { res, layers, maxLayers: layers.map((l) => maxGrid(l, res, cells)), cells, key: `${res}:${terrains.map((t) => arrayId(t.heights)).join(',')}` };
}

/** Conservative block maxima: each cell also covers one texel around it (bilinear reach). */
export function maxGrid(h: Float32Array, res: number, cells: number): Float32Array {
  const out = new Float32Array(cells * cells);
  const span = res / cells;
  for (let cz = 0; cz < cells; cz++) {
    for (let cx = 0; cx < cells; cx++) {
      let m = 0;
      const x0 = Math.max(0, Math.floor(cx * span) - 1);
      const x1 = Math.min(res - 1, Math.ceil((cx + 1) * span));
      const z0 = Math.max(0, Math.floor(cz * span) - 1);
      const z1 = Math.min(res - 1, Math.ceil((cz + 1) * span));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) m = Math.max(m, h[z * res + x]);
      out[cz * cells + cx] = m;
    }
  }
  return out;
}

function groupIndex(objs: readonly SceneObject[]): Map<GroupId, number> {
  const map = new Map<GroupId, number>();
  for (const o of objs) if (o.groupId && !map.has(o.groupId)) map.set(o.groupId, map.size + 1);
  return map;
}

export function packScene(scene: Scene): PackedScene {
  const visible = scene.objects.filter((o) => !o.hidden);
  const lights = visible.filter((o) => LIGHT_KINDS.has(o.kind)).slice(0, MAX_LIGHTS);
  const all = visible.filter((o) => !LIGHT_KINDS.has(o.kind));
  const solids = all.slice(0, MAX_OBJECTS);
  const groups = groupIndex(solids);
  const modified = new Set(solids.filter((o) => o.groupId && o.boolean >= BooleanMode.Negative).map((o) => o.groupId));
  const objects = new Float32Array(Math.max(solids.length, 1) * ROW_OBJ);
  const materials = new Float32Array(Math.max(solids.length, 1) * ROW_MAT);
  const terrains = packTerrains(solids);
  let terrainLayer = 0;
  solids.forEach((o, i) => {
    const base = i * ROW_OBJ;
    const inv = invert(objectMatrix(o));
    for (let r = 0; r < 3; r++) out4(objects, base + r * T, inv[r], inv[T + r], inv[2 * T + r], inv[3 * T + r]);
    const group = o.groupId ? groups.get(o.groupId) ?? 0 : 0;
    let flags = 0;
    if (o.boolean === BooleanMode.Positive && o.groupId && modified.has(o.groupId)) flags |= FLAG_HAS_MODIFIERS;
    if (o.kind === ShapeKind.WaterPlane) flags |= FLAG_NO_SHADOW;
    if (o.material.values.transparency === 0 && o.material.valueSources.transparency === ChannelSource.Flat) flags |= FLAG_OPAQUE;
    out4(objects, base + OBJ_AT.header, o.kind, o.boolean, group, flags);
    const layer = TERRAIN_KINDS.has(o.kind) ? terrainLayer++ : 0;
    out4(objects, base + OBJ_AT.params, layer, o.shapeParam, terrains.res, 0);
    if (INFINITE_KINDS.has(o.kind)) out4(objects, base + OBJ_AT.bound, 0, 0, 0, -1);
    else {
      const s = boxSphere(worldBox(o));
      out4(objects, base + OBJ_AT.bound, s.center[0], s.center[1], s.center[2], s.radius);
    }
    packMaterial(materials, i, o.material);
  });
  const lightPos = new Float32Array(MAX_LIGHTS * TEXEL_FLOATS);
  const lightColor = new Float32Array(MAX_LIGHTS * TEXEL_FLOATS);
  const lightDir = new Float32Array(MAX_LIGHTS * TEXEL_FLOATS);
  lights.forEach((o, i) => {
    const l = o.light!;
    const p = o.transform.position;
    const k = (l.intensity / DIAL) * LIGHT_INTENSITY_SCALE;
    out4(lightPos, i * 4, p[0], p[1], p[2], o.kind === ShapeKind.SpotLight ? 1 : 0);
    out4(lightColor, i * 4, l.color[0] * k, l.color[1] * k, l.color[2] * k, ((l.falloff / DIAL) ** 2) * LIGHT_FALLOFF_SCALE);
    const d = normalize(transformDir(objectMatrix(o), SPOT_DOWN));
    out4(lightDir, i * 4, d[0], d[1], d[2], Math.cos(l.cone * DEG));
  });
  return {
    count: solids.length, objects, materials, terrains, lightCount: lights.length, lightPos, lightColor, lightDir,
    dropped: all.length - solids.length,
  };
}

function out4(a: Float32Array, at: number, x: number, y: number, z: number, w: number): void {
  a[at] = x; a[at + 1] = y; a[at + 2] = z; a[at + 3] = w;
}

/** Uniform values of the atmosphere. */
export interface SkyUniforms {
  readonly sunDir: readonly [number, number, number];
  readonly skyParams: readonly [number, number, number, number];
  readonly fogParams: readonly [number, number, number, number];
  readonly cloudParams: readonly [number, number, number, number];
  readonly cloudKinds: readonly [number, number];
}

export function skyUniforms(sky: Sky): SkyUniforms {
  const az = sky.sunAzimuth * DEG;
  const alt = sky.sunAltitude * DEG;
  const night = sky.sunAltitude < 0 ? 1 : 0;
  const off = sky.mode === SkyMode.AtmosphereOff;
  return {
    sunDir: [Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt)],
    skyParams: [sky.mode, sky.shadows / DIAL, off ? 0 : sky.hazeAmount / DIAL, sky.stars ? 1 : 0],
    fogParams: [off ? 0 : sky.fogAmount / DIAL, sky.fogHeight, sky.sunVisible ? 1 : 0, night],
    cloudParams: [
      off ? 0 : sky.clouds.cover / DIAL,
      CLOUD_BASE_HEIGHT + (sky.clouds.height / DIAL) * CLOUD_HEIGHT_RANGE,
      sky.clouds.frequency / DIAL,
      sky.clouds.amplitude / DIAL,
    ],
    cloudKinds: [sky.clouds.cumulus ? 1 : 0, sky.clouds.stratus ? 1 : 0],
  };
}

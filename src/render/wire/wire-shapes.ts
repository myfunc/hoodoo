import type { Vec3 } from '../../core/vec3';
import { ShapeKind } from '../../model/scene.enums';
import type { SceneObject, TerrainData } from '../../model/scene.types';
import { PLANE_EXTENT } from '../../world/bounds';

/** Line list in object space: [a, b, a, b, …]. */
export type Lines = Vec3[];

const CIRCLE_SEGMENTS = 24;
const LATITUDES = 5;
const LONGITUDES = 8;
const TERRAIN_LINES = 24;
const PLANE_LINES = 10;
const TORUS_RINGS = 10;
const STONE_WOBBLE = 0.14;
const WOBBLE_LAT = 3.1;
const WOBBLE_LON = 2.3;
const WOBBLE_SEED = 0.7;
const LIGHT_RAY = 2;
const SPOT_RADIUS = 2.5;
const SPOT_DEPTH = -4;

function circle(out: Lines, radius: number, y: number, axis: 'y' | 'x' | 'z' = 'y', cx = 0, cz = 0): void {
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a0 = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
    const p = (a: number): Vec3 => {
      const u = Math.cos(a) * radius;
      const v = Math.sin(a) * radius;
      if (axis === 'y') return [cx + u, y, cz + v];
      if (axis === 'x') return [y, u, v];
      return [u, v, y];
    };
    out.push(p(a0), p(a1));
  }
}

function sphere(out: Lines, wobble = 0, seed = 0): void {
  const r = (lat: number, lon: number) => 1 - wobble + wobble * Math.sin(lat * WOBBLE_LAT + seed) * Math.cos(lon * WOBBLE_LON + seed * WOBBLE_SEED);
  for (let i = 1; i < LATITUDES + 1; i++) {
    const lat = (i / (LATITUDES + 1)) * Math.PI;
    for (let j = 0; j < CIRCLE_SEGMENTS; j++) {
      const a0 = (j / CIRCLE_SEGMENTS) * Math.PI * 2;
      const a1 = ((j + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
      const p = (a: number): Vec3 => {
        const k = r(lat, a);
        return [Math.sin(lat) * Math.cos(a) * k, Math.cos(lat) * k, Math.sin(lat) * Math.sin(a) * k];
      };
      out.push(p(a0), p(a1));
    }
  }
  for (let j = 0; j < LONGITUDES; j++) {
    const lon = (j / LONGITUDES) * Math.PI * 2;
    for (let i = 0; i < CIRCLE_SEGMENTS / 2; i++) {
      const p = (t: number): Vec3 => {
        const lat = (t / (CIRCLE_SEGMENTS / 2)) * Math.PI;
        const k = r(lat, lon);
        return [Math.sin(lat) * Math.cos(lon) * k, Math.cos(lat) * k, Math.sin(lat) * Math.sin(lon) * k];
      };
      out.push(p(i), p(i + 1));
    }
  }
}

const BOX_EDGES: readonly [Vec3, Vec3][] = [
  [[-1, -1, -1], [1, -1, -1]], [[1, -1, -1], [1, -1, 1]], [[1, -1, 1], [-1, -1, 1]], [[-1, -1, 1], [-1, -1, -1]],
  [[-1, 1, -1], [1, 1, -1]], [[1, 1, -1], [1, 1, 1]], [[1, 1, 1], [-1, 1, 1]], [[-1, 1, 1], [-1, 1, -1]],
  [[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]], [[1, -1, 1], [1, 1, 1]], [[-1, -1, 1], [-1, 1, 1]],
];

function box(out: Lines): void {
  for (const [a, b] of BOX_EDGES) out.push(a, b);
}

function terrain(out: Lines, t: TerrainData, mirrored: boolean): void {
  const h = (u: number, v: number) => {
    const x = Math.round(u * (t.resolution - 1));
    const z = Math.round(v * (t.resolution - 1));
    return t.heights[z * t.resolution + x];
  };
  const y = (u: number, v: number, down: boolean) => (mirrored ? (down ? -h(u, v) : h(u, v)) : h(u, v) * 2 - 1);
  const sides = mirrored ? [false, true] : [false];
  for (const down of sides) {
    for (let i = 0; i <= TERRAIN_LINES; i++) {
      const a = i / TERRAIN_LINES;
      for (let j = 0; j < TERRAIN_LINES; j++) {
        const b0 = j / TERRAIN_LINES;
        const b1 = (j + 1) / TERRAIN_LINES;
        out.push([a * 2 - 1, y(a, b0, down), b0 * 2 - 1], [a * 2 - 1, y(a, b1, down), b1 * 2 - 1]);
        out.push([b0 * 2 - 1, y(b0, a, down), a * 2 - 1], [b1 * 2 - 1, y(b1, a, down), a * 2 - 1]);
      }
    }
  }
}

function plane(out: Lines, extent: number): void {
  for (let i = 0; i <= PLANE_LINES; i++) {
    const t = (i / PLANE_LINES) * 2 - 1;
    out.push([t * extent, 0, -extent], [t * extent, 0, extent]);
    out.push([-extent, 0, t * extent], [extent, 0, t * extent]);
  }
}

function build(o: SceneObject): Lines {
  const out: Lines = [];
  if (o.showAsBox) {
    box(out);
    return out;
  }
  switch (o.kind) {
    case ShapeKind.Sphere: sphere(out); break;
    case ShapeKind.Stone: sphere(out, STONE_WOBBLE, o.shapeParam); break;
    case ShapeKind.Cube: box(out); break;
    case ShapeKind.Cylinder:
      circle(out, 1, 1); circle(out, 1, -1); circle(out, 1, 0);
      for (let i = 0; i < LONGITUDES; i++) {
        const a = (i / LONGITUDES) * Math.PI * 2;
        out.push([Math.cos(a), -1, Math.sin(a)], [Math.cos(a), 1, Math.sin(a)]);
      }
      break;
    case ShapeKind.Cone:
      circle(out, 1, -1); circle(out, 1 / 2, 0);
      for (let i = 0; i < LONGITUDES; i++) {
        const a = (i / LONGITUDES) * Math.PI * 2;
        out.push([Math.cos(a), -1, Math.sin(a)], [0, 1, 0]);
      }
      break;
    case ShapeKind.Pyramid:
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) out.push([x, -1, z], [0, 1, 0]);
      out.push([-1, -1, -1], [1, -1, -1], [1, -1, -1], [1, -1, 1], [1, -1, 1], [-1, -1, 1], [-1, -1, 1], [-1, -1, -1]);
      break;
    case ShapeKind.Torus: {
      const tube = o.shapeParam;
      const major = 1 - tube;
      circle(out, 1, 0); circle(out, major - tube, 0); circle(out, major, tube); circle(out, major, -tube);
      for (let i = 0; i < TORUS_RINGS; i++) {
        const a = (i / TORUS_RINGS) * Math.PI * 2;
        for (let j = 0; j < CIRCLE_SEGMENTS; j++) {
          const p = (k: number): Vec3 => {
            const b = (k / CIRCLE_SEGMENTS) * Math.PI * 2;
            const r = major + Math.cos(b) * tube;
            return [Math.cos(a) * r, Math.sin(b) * tube, Math.sin(a) * r];
          };
          out.push(p(j), p(j + 1));
        }
      }
      break;
    }
    case ShapeKind.Disk:
      circle(out, 1, 0); out.push([-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]);
      break;
    case ShapeKind.Square:
      out.push([-1, 0, -1], [1, 0, -1], [1, 0, -1], [1, 0, 1], [1, 0, 1], [-1, 0, 1], [-1, 0, 1], [-1, 0, -1], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]);
      break;
    case ShapeKind.Terrain:
    case ShapeKind.Lattice:
      if (o.terrain) terrain(out, o.terrain, o.kind === ShapeKind.Lattice);
      break;
    case ShapeKind.WaterPlane:
    case ShapeKind.GroundPlane:
    case ShapeKind.CloudPlane:
      plane(out, PLANE_EXTENT);
      break;
    case ShapeKind.RadialLight:
    case ShapeKind.SpotLight:
      sphere(out);
      out.push([-LIGHT_RAY, 0, 0], [LIGHT_RAY, 0, 0], [0, -LIGHT_RAY, 0], [0, LIGHT_RAY, 0], [0, 0, -LIGHT_RAY], [0, 0, LIGHT_RAY]);
      if (o.kind === ShapeKind.SpotLight) {
        circle(out, SPOT_RADIUS, SPOT_DEPTH);
        for (const [x, z] of [[SPOT_RADIUS, 0], [-SPOT_RADIUS, 0], [0, SPOT_RADIUS], [0, -SPOT_RADIUS]] as const) out.push([0, 0, 0], [x, SPOT_DEPTH, z]);
      }
      break;
  }
  return out;
}

/** Infinite planes are drawn in world units (their size is ignored), everything else in unit space. */
export const drawsInWorldUnits = (o: SceneObject): boolean =>
  o.kind === ShapeKind.WaterPlane || o.kind === ShapeKind.GroundPlane || o.kind === ShapeKind.CloudPlane;

const terrainCache = new WeakMap<Float32Array, { key: string; lines: Lines }>();
const shapeCache = new Map<string, Lines>();

/** Cached by the fields that change an outline; terrains by their height array. */
export function wireLines(o: SceneObject): Lines {
  const key = `${o.kind}|${o.shapeParam}|${o.showAsBox}`;
  if (o.terrain && !o.showAsBox) {
    const hit = terrainCache.get(o.terrain.heights);
    if (hit && hit.key === key) return hit.lines;
    const lines = build(o);
    terrainCache.set(o.terrain.heights, { key, lines });
    return lines;
  }
  let lines = shapeCache.get(key);
  if (!lines) {
    lines = build(o);
    shapeCache.set(key, lines);
  }
  return lines;
}

import { latheProfile } from '../../assets/lathe.profiles';
import { type Vec3, ZERO3, add } from '../../core/vec3';
import { ShapeKind } from '../../model/scene.enums';
import type { SceneObject } from '../../model/scene.types';
import { IDENTITY_Q, type Quat, mulQ, rotateQ } from './quat';

/**
 * READ ME — collision shapes in the physics layer's own terms, free of the
 * engine: a body is a list of these, each placed in the body's frame. Hoodoo's
 * shapes map onto them here (`shapesOf`): spheres, boxes, cylinders and cones
 * exactly when they are round, as convex hulls when stretched; pyramids,
 * lathes and stones as hulls; tori as a ring of hulls; terrains as height
 * fields; the ground as a half-space; water and clouds, when solid, as a thin
 * sheet. The size is baked into the shape, so frames carry place and turn only.
 */
export enum ShapeType {
  Ball = 'ball',
  Box = 'box',
  Cylinder = 'cylinder',
  Cone = 'cone',
  Hull = 'hull',
  Mesh = 'mesh',
  HeightField = 'heightfield',
  HalfSpace = 'halfspace',
}

interface Placed {
  /** Where the shape sits in its body's frame (default: at the origin, unturned). */
  readonly offset?: Vec3;
  readonly rotation?: Quat;
}

export type ShapeSpec = Placed & (
  | { readonly type: ShapeType.Ball; readonly radius: number }
  | { readonly type: ShapeType.Box; readonly half: Vec3 }
  | { readonly type: ShapeType.Cylinder | ShapeType.Cone; readonly halfHeight: number; readonly radius: number }
  | { readonly type: ShapeType.Hull; readonly points: Float32Array }
  | { readonly type: ShapeType.Mesh; readonly vertices: Float32Array; readonly indices: Uint32Array }
  /** Heights along local Y, column-major (row = Z, column = X), spanning `scale` centred on the origin. */
  | { readonly type: ShapeType.HeightField; readonly rows: number; readonly cols: number; readonly heights: Float32Array; readonly scale: Vec3 }
  /** Solid on the side opposite `normal`. */
  | { readonly type: ShapeType.HalfSpace; readonly normal: Vec3 }
);

/** Half the thickness given to flat shapes (disks, squares, solid water and clouds), in world units. */
export const THIN = 0.01;
/** Solid water or clouds reach this far each way: a sheet as large as any scene. */
const SHEET_HALF = 1e4;
/** Sizes within this ratio count as round. */
const ROUND = 1e-3;
const ELLIPSOID = { rings: 8, sides: 16 } as const;
const ROUND_SIDES = 24;
const TORUS = { segments: 12, sides: 8 } as const;
const LATHE_SIDES = 16;
const TORUS_TUBE = 0.25;
/** Turned half a turn about X: a lattice's lower half faces down. */
const FLIP_X: Quat = [1, 0, 0, 0];

const near = (a: number, b: number): boolean => Math.abs(a - b) <= ROUND * Math.max(Math.abs(a), Math.abs(b));
const hull = (pts: readonly number[]): ShapeSpec => ({ type: ShapeType.Hull, points: new Float32Array(pts) });

/** Points on an ellipsoid with these half-axes. */
function ellipsoid([a, b, c]: Vec3): number[] {
  const out = [0, b, 0, 0, -b, 0];
  for (let i = 1; i < ELLIPSOID.rings; i++) {
    const phi = (Math.PI * i) / ELLIPSOID.rings;
    for (let j = 0; j < ELLIPSOID.sides; j++) {
      const th = (2 * Math.PI * j) / ELLIPSOID.sides;
      out.push(a * Math.sin(phi) * Math.cos(th), b * Math.cos(phi), c * Math.sin(phi) * Math.sin(th));
    }
  }
  return out;
}

/** An ellipse of half-axes a, c at height y. */
function ring(a: number, c: number, y: number, sides = ROUND_SIDES): number[] {
  const out: number[] = [];
  for (let j = 0; j < sides; j++) {
    const th = (2 * Math.PI * j) / sides;
    out.push(a * Math.cos(th), y, c * Math.sin(th));
  }
  return out;
}

/** A ring of convex pieces around Y: the tube of radius `tube` about a circle of radius 1 - tube (unit space), scaled. */
function torus([a, b, c]: Vec3, tube: number): ShapeSpec[] {
  const major = 1 - tube;
  const piece = (th: number) => {
    const out: number[] = [];
    for (let k = 0; k < TORUS.sides; k++) {
      const ph = (2 * Math.PI * k) / TORUS.sides;
      const r = major + tube * Math.cos(ph);
      out.push(r * Math.cos(th) * a, tube * Math.sin(ph) * b, r * Math.sin(th) * c);
    }
    return out;
  };
  return Array.from({ length: TORUS.segments }, (_, i) => {
    const step = (2 * Math.PI) / TORUS.segments;
    return hull([...piece(i * step), ...piece((i + 1) * step)]);
  });
}

/** A lathe's outline turned about Y: its convex hull (crenellations and a knight's head are filled). */
function lathe(o: SceneObject, [a, b, c]: Vec3): ShapeSpec {
  const p = latheProfile(o.shapeParam);
  const pts: number[] = [];
  for (const s of p.segments) {
    for (const [r, y] of [[s.r0, s.y0], [s.r1, s.y1]] as const) {
      const k = r / p.aspect;
      pts.push(...(k > 0 ? ring(k * a, k * c, y * b, LATHE_SIDES) : [0, y * b, 0]));
    }
  }
  return hull(pts);
}

/**
 * A terrain's heights as a height field: Hoodoo keeps rows of X along Z (index z·res + x) in 0..1
 * over the unit box; the field wants columns of Z along X. A lattice is solid where |y| < h.
 */
function terrain(o: SceneObject, [a, b, c]: Vec3): ShapeSpec[] {
  const t = o.terrain;
  if (!t) return [];
  const n = t.resolution;
  const lattice = o.kind === ShapeKind.Lattice;
  const field = (flipZ: boolean): Float32Array => {
    const out = new Float32Array(n * n);
    for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) out[x * n + z] = t.heights[(flipZ ? n - 1 - z : z) * n + x];
    return out;
  };
  const base = { type: ShapeType.HeightField, rows: n - 1, cols: n - 1 } as const;
  if (!lattice) return [{ ...base, heights: field(false), scale: [2 * a, 2 * b, 2 * c], offset: [0, -b, 0] }];
  return [
    { ...base, heights: field(false), scale: [2 * a, b, 2 * c] },
    { ...base, heights: field(true), scale: [2 * a, b, 2 * c], rotation: FLIP_X },
  ];
}

/**
 * The collision shapes of an object, in its own frame (its place and turn; the size is baked in).
 * Empty for what has no body: lights and portals.
 */
export function shapesOf(o: SceneObject): ShapeSpec[] {
  const size = o.transform.size.map(Math.abs) as unknown as Vec3;
  const [a, b, c] = size;
  const round = near(a, c);
  switch (o.kind) {
    case ShapeKind.Sphere:
    case ShapeKind.Stone:
      return [round && near(a, b) ? { type: ShapeType.Ball, radius: a } : hull(ellipsoid(size))];
    case ShapeKind.Cube: return [{ type: ShapeType.Box, half: size }];
    case ShapeKind.Cylinder: return [round ? { type: ShapeType.Cylinder, halfHeight: b, radius: a } : hull([...ring(a, c, -b), ...ring(a, c, b)])];
    case ShapeKind.Cone: return [round ? { type: ShapeType.Cone, halfHeight: b, radius: a } : hull([...ring(a, c, -b), 0, b, 0])];
    case ShapeKind.Pyramid: return [hull([-a, -b, -c, a, -b, -c, a, -b, c, -a, -b, c, 0, b, 0])];
    case ShapeKind.Torus: return torus(size, o.shapeParam > 0 ? o.shapeParam : TORUS_TUBE);
    case ShapeKind.Disk: return [round ? { type: ShapeType.Cylinder, halfHeight: THIN, radius: a } : hull([...ring(a, c, -THIN), ...ring(a, c, THIN)])];
    case ShapeKind.Square: return [{ type: ShapeType.Box, half: [a, THIN, c] }];
    case ShapeKind.Lathe: return [lathe(o, size)];
    case ShapeKind.Terrain:
    case ShapeKind.Lattice:
      return terrain(o, size);
    case ShapeKind.GroundPlane: return [{ type: ShapeType.HalfSpace, normal: [0, 1, 0] }];
    case ShapeKind.WaterPlane:
    case ShapeKind.CloudPlane:
      return [{ type: ShapeType.Box, half: [SHEET_HALF, THIN, SHEET_HALF], offset: [0, -THIN, 0] }];
    default: return [];
  }
}

/** The shapes moved into another frame: `offset` and `turn` place the object's frame in it. */
export const placedShapes = (shapes: readonly ShapeSpec[], offset: Vec3, turn: Quat): ShapeSpec[] =>
  shapes.map((s) => ({ ...s, offset: add(rotateQ(turn, s.offset ?? ZERO3), offset), rotation: mulQ(turn, s.rotation ?? IDENTITY_Q) }));

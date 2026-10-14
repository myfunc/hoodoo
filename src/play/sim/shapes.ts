import { fieldAt } from '../../assets/lathe-head';
import { latheProfile } from '../../assets/lathe.profiles';
import { type Vec3, ZERO3, add } from '../../core/vec3';
import { ShapeKind } from '../../model/scene.enums';
import type { SceneObject } from '../../model/scene.types';
import { Layer } from './layers';
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
  /** The shape's own layer and what it meets, when not its body's (the ground's sheet for props). */
  readonly layer?: number;
  readonly collidesWith?: number;
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
/**
 * The ground: a half-space, which the player and every query meet; and under it a sheet as large as
 * any scene that only props touch, since Rapier's half-space holds a convex hull (a game prop) by
 * one point and it topples where it should stand.
 */
export const GROUND: readonly ShapeSpec[] = [
  { type: ShapeType.HalfSpace, normal: [0, 1, 0] },
  { type: ShapeType.Box, half: [SHEET_HALF, 1, SHEET_HALF], offset: [0, -1, 0], layer: Layer.Floor, collidesWith: Layer.Prop | Layer.Debris },
];
/** Sizes within this ratio count as round. */
const ROUND = 1e-3;
const ELLIPSOID = { rings: 8, sides: 16 } as const;
const ROUND_SIDES = 24;
/** A torus's ring: at least `segments` pieces, more until a straight piece sags in by at most `sag` of the tube. */
const TORUS = { segments: 12, maxSegments: 48, sides: 8, sag: 0.25 } as const;
const LATHE_SIDES = 16;
const TORUS_TUBE = 0.25;
/** The picture reads terrain heights as half floats: their step at 1 lifts the body by as much. */
const HALF_FLOAT_STEP = 2 ** -11;
/** Turned half a turn about X: a lattice's lower half faces down. */
const FLIP_X: Quat = [1, 0, 0, 0];

const near = (a: number, b: number): boolean => Math.abs(a - b) <= ROUND * Math.max(Math.abs(a), Math.abs(b));
const hull = (pts: readonly number[]): ShapeSpec => ({ type: ShapeType.Hull, points: new Float32Array(pts) });
/** How far out a polygon of `sides` puts its corners so its edges touch the circle (1 / cos of half a side's angle). */
const OUT = (sides: number): number => 1 / Math.cos(Math.PI / sides);

/** Points around an ellipsoid with these half-axes, far enough out that their hull holds it. */
function ellipsoid([a, b, c]: Vec3): number[] {
  // A face spans a ring's angle down and a side's angle round; corners this far out bring its middle to the surface.
  const k = OUT(ELLIPSOID.sides) * OUT(2 * ELLIPSOID.rings);
  const out = [0, b * k, 0, 0, -b * k, 0];
  for (let i = 1; i < ELLIPSOID.rings; i++) {
    const phi = (Math.PI * i) / ELLIPSOID.rings;
    for (let j = 0; j < ELLIPSOID.sides; j++) {
      const th = (2 * Math.PI * j) / ELLIPSOID.sides;
      out.push(a * k * Math.sin(phi) * Math.cos(th), b * k * Math.cos(phi), c * k * Math.sin(phi) * Math.sin(th));
    }
  }
  return out;
}

/** A polygon around the ellipse of half-axes a, c at height y. */
function ring(a: number, c: number, y: number, sides = ROUND_SIDES): number[] {
  const out: number[] = [];
  const k = OUT(sides);
  for (let j = 0; j < sides; j++) {
    const th = (2 * Math.PI * j) / sides;
    out.push(a * k * Math.cos(th), y, c * k * Math.sin(th));
  }
  return out;
}

/**
 * A ring of convex pieces around Y: the tube of radius `tube` about a circle of radius 1 - tube (unit
 * space), scaled. A straight piece is nearer the axis in its middle than the ring is (its sag), so each
 * end's section is a polygon round a circle grown by the sag: the piece's middle still holds the tube.
 * Thin tubes get more, shorter pieces.
 */
function torus([a, b, c]: Vec3, tube: number): ShapeSpec[] {
  const major = 1 - tube;
  const share = Math.min(1, (TORUS.sag * tube) / Math.max(major, tube));
  const segments = Math.min(TORUS.maxSegments, Math.max(TORUS.segments, Math.ceil(Math.PI / Math.acos(1 - share))));
  const step = (2 * Math.PI) / segments;
  const middle = Math.cos(step / 2);
  const round = ((tube + major * (1 - middle)) / middle) * OUT(TORUS.sides);
  const piece = (th: number) => {
    const out: number[] = [];
    for (let k = 0; k < TORUS.sides; k++) {
      const ph = (2 * Math.PI * k) / TORUS.sides;
      const r = major + round * Math.cos(ph);
      out.push(r * Math.cos(th) * a, round * Math.sin(ph) * b, r * Math.sin(th) * c);
    }
    return out;
  };
  return Array.from({ length: segments }, (_, i) => hull([...piece(i * step), ...piece((i + 1) * step)]));
}

/**
 * A lathe's outline turned about Y (crenellations and cuts are filled), plus what stands off it: a
 * knight's head as a slab of its side view at its widest, and a king's cross as boxes. Profile space
 * is the unit box with X and Z times the profile's aspect.
 */
function lathe(o: SceneObject, [a, b, c]: Vec3): ShapeSpec[] {
  const p = latheProfile(o.shapeParam);
  const [ax, az] = [a / p.aspect, c / p.aspect];
  const pts: number[] = [];
  for (const s of p.segments) {
    for (const [r, y] of [[s.r0, s.y0], [s.r1, s.y1]] as const) {
      pts.push(...(r > 0 ? ring(r * ax, r * az, y * b, LATHE_SIDES) : [0, y * b, 0]));
    }
  }
  const out = [hull(pts)];
  for (const k of p.blocks) out.push({ type: ShapeType.Box, half: [k.half[0] * ax, k.half[1] * b, k.half[2] * az], offset: [k.center[0] * ax, k.center[1] * b, k.center[2] * az] });
  const head = p.head;
  if (head) {
    // The width is a ramp clamped to a ceiling: its largest over the side view is at one of the outline's points.
    const half = Math.max(...head.outline.map(([x, y]) => fieldAt(head.width, x, y)));
    out.push(hull(head.outline.flatMap(([x, y]) => [x * ax, y * b, half * az, x * ax, y * b, -half * az])));
  }
  return out;
}

/**
 * Heights raised so a cell's two flat triangles are nowhere under the picture's surface, which is
 * smooth (bilinear) between the samples: across the wrong diagonal it bulges a quarter of the cell's
 * twist above them. Smooth ground barely moves; a cliff's foot comes out by at most a cell.
 */
function lifted(heights: Float32Array, n: number): Float32Array {
  const lift = new Float32Array(n * n);
  for (let z = 0; z < n - 1; z++) {
    for (let x = 0; x < n - 1; x++) {
      const i = z * n + x;
      const twist = Math.abs(heights[i] + heights[i + n + 1] - heights[i + 1] - heights[i + n]) / 4;
      for (const j of [i, i + 1, i + n, i + n + 1]) lift[j] = Math.max(lift[j], twist);
    }
  }
  return heights.map((h, i) => h + lift[i] + HALF_FLOAT_STEP);
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
  const heights = lifted(t.heights, n);
  const field = (flipZ: boolean): Float32Array => {
    const out = new Float32Array(n * n);
    for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) out[x * n + z] = heights[(flipZ ? n - 1 - z : z) * n + x];
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
    case ShapeKind.Lathe: return lathe(o, size);
    case ShapeKind.Terrain:
    case ShapeKind.Lattice:
      return terrain(o, size);
    case ShapeKind.GroundPlane: return [...GROUND];
    case ShapeKind.WaterPlane:
    case ShapeKind.CloudPlane:
      return [{ type: ShapeType.Box, half: [SHEET_HALF, THIN, SHEET_HALF], offset: [0, -THIN, 0] }];
    default: return [];
  }
}

/** The shapes moved into another frame: `offset` and `turn` place the object's frame in it. */
export const placedShapes = (shapes: readonly ShapeSpec[], offset: Vec3, turn: Quat): ShapeSpec[] =>
  shapes.map((s) => ({ ...s, offset: add(rotateQ(turn, s.offset ?? ZERO3), offset), rotation: mulQ(turn, s.rotation ?? IDENTITY_Q) }));

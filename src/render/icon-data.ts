import type { Vec3 } from '../core/vec3';

/**
 * Compositions of the rendered interface icons, as data: which primitives,
 * where, how big, in which material. `mat` is 'teal', 'trackball' or a preset name.
 */
export interface PieceData {
  readonly entry: string;
  readonly position?: Vec3;
  readonly size?: Vec3;
  readonly rotation?: Vec3;
  readonly mat: string;
}

export interface IconData {
  readonly pieces: readonly PieceData[];
  readonly from: Vec3;
  /** Light the icon under the preview sky, so chrome has a horizon to reflect. */
  readonly studio?: boolean;
}

export const TEAL = 'teal';
export const TRACKBALL = 'trackball';

export const VIEW_FROM = {
  angled: [2.6, 2.1, 3.8] as Vec3,
  front: [0, 0.4, 4.4] as Vec3,
  side: [4.4, 0.6, 0.6] as Vec3,
  top: [0.4, 4.2, 2.0] as Vec3,
  library: [2.4, 2.2, 3.4] as Vec3,
  preview: [0, 1.2, 4.2] as Vec3,
  sky: [0, 1.5, 6] as Vec3,
};

export const SKY_LOOK_AT: Vec3 = [0, 3, -10];
export const ICON_FOV = 30;
export const PREVIEW_FOV = 34;
export const SKY_FOV = 70;
export const SKY_ASPECT = 4 / 3;
export const ICON_SEED = 3;
export const TERRAIN_SEED = 5;
export const ICON_TERRAIN_SIZE: Vec3 = [1.1, 0.55, 1.1];
export const LATTICE_ICON_SIZE: Vec3 = [1, 0.55, 1];
export const ICON_FIT = 0.9;
export const LIBRARY_FIT = 1.1;
export const PREVIEW_FLOOR_Y = -1;

const ARROW: Vec3 = [0.2, 0.26, 0.2];
const OUT = 0.62;
const HUB: Vec3 = [0.2, 0.2, 0.2];

const arrows = (mat: string, dirs: readonly { p: Vec3; r: Vec3 }[]): PieceData[] => dirs.map((d) => ({ entry: 'cone', position: d.p, size: ARROW, rotation: d.r, mat }));

const XZ = [{ p: [OUT, 0, 0], r: [0, 0, -90] }, { p: [-OUT, 0, 0], r: [0, 0, 90] }, { p: [0, 0, OUT], r: [90, 0, 0] }, { p: [0, 0, -OUT], r: [-90, 0, 0] }] as const;

const hub = (mat: string): PieceData => ({ entry: 'sphere', size: HUB, mat });

/** The flat arrow of Bryce's camera crosses: a thin pyramid head on a short block stem, pointing along local +y. */
const FLAT = { head: { at: 0.68, w: 0.38, h: 0.2 }, stemWidth: 0.15, thick: 0.1 } as const;
const CROSS_HUB: Vec3 = [0.24, 0.24, 0.24];

export enum Plane { XY = 'xy', XZ = 'xz', YZ = 'yz' }

/** The local axis that carries an arrow's width; the other one of x/z is its thickness. */
enum Wide { X = 'x', Z = 'z' }

interface Direction { readonly axis: Vec3; readonly rotation: Vec3; readonly wide: Wide }

/**
 * The four in-plane directions; `rotation` turns local +y onto `axis`, and `wide`
 * says which local axis must carry the arrow's width so that it lies in the plane.
 */
const DIRECTIONS: Record<Plane, readonly Direction[]> = {
  [Plane.XY]: [
    { axis: [1, 0, 0], rotation: [0, 0, -90], wide: Wide.X }, { axis: [-1, 0, 0], rotation: [0, 0, 90], wide: Wide.X },
    { axis: [0, 1, 0], rotation: [0, 0, 0], wide: Wide.X }, { axis: [0, -1, 0], rotation: [0, 0, 180], wide: Wide.X },
  ],
  [Plane.XZ]: [
    { axis: [1, 0, 0], rotation: [0, 0, -90], wide: Wide.Z }, { axis: [-1, 0, 0], rotation: [0, 0, 90], wide: Wide.Z },
    { axis: [0, 0, 1], rotation: [90, 0, 0], wide: Wide.X }, { axis: [0, 0, -1], rotation: [-90, 0, 0], wide: Wide.X },
  ],
  [Plane.YZ]: [
    { axis: [0, 1, 0], rotation: [0, 0, 0], wide: Wide.Z }, { axis: [0, -1, 0], rotation: [180, 0, 0], wide: Wide.Z },
    { axis: [0, 0, 1], rotation: [90, 0, 0], wide: Wide.Z }, { axis: [0, 0, -1], rotation: [-90, 0, 0], wide: Wide.Z },
  ],
};

const scaled = (v: Vec3, k: number, at: Vec3 = [0, 0, 0]): Vec3 => [at[0] + v[0] * k, at[1] + v[1] * k, at[2] + v[2] * k];

interface FlatPiece {
  readonly entry: 'pyramid' | 'cube';
  readonly direction: Direction;
  /** Distance of the piece centre from the cross centre, before scaling. */
  readonly at: number;
  readonly width: number;
  readonly halfLength: number;
  readonly mat: string;
  readonly scale: number;
  readonly centre: Vec3;
}

function flatPiece(p: FlatPiece): PieceData {
  const { width: w, halfLength: h, scale: k } = p;
  const size: Vec3 = p.direction.wide === Wide.X ? [w * k, h * k, FLAT.thick * k] : [FLAT.thick * k, h * k, w * k];
  return { entry: p.entry, position: scaled(p.direction.axis, p.at * k, p.centre), size, rotation: p.direction.rotation, mat: p.mat };
}

/** Four flat arrows in `plane`, scaled by `k` around `centre`; each stem starts `stemFrom` out from the centre. */
export function flatArrows(plane: Plane, mat: string, k = 1, centre: Vec3 = [0, 0, 0], stemFrom = 0): PieceData[] {
  const base = FLAT.head.at - FLAT.head.h;
  const stemHalf = (base - stemFrom) / 2;
  return DIRECTIONS[plane].flatMap((direction) => [
    flatPiece({ entry: 'pyramid', direction, at: FLAT.head.at, width: FLAT.head.w, halfLength: FLAT.head.h, mat, scale: k, centre }),
    flatPiece({ entry: 'cube', direction, at: stemFrom + stemHalf, width: FLAT.stemWidth, halfLength: stemHalf, mat, scale: k, centre }),
  ]);
}

/** Bryce 2's camera cross: salmon arrows around a teal ball. */
const cross = (plane: Plane): PieceData[] => [{ entry: 'sphere', size: CROSS_HUB, mat: TEAL }, ...flatArrows(plane, TRACKBALL, 1, [0, 0, 0], CROSS_HUB[0] - FLAT.thick)];

const TRACKBALL_R = 0.8;
const TRACKBALL_ARROW_K = 0.68;
const TRACKBALL_ARROW_Z = 0.8;

/** Viewpoints of the left-column icons, a little above so the flat crosses read in perspective like Bryce's. */
const CONTROL_FROM = {
  crossXY: [-1.4, 1.8, 3.8] as Vec3,
  crossYZ: [-3.7, 2.0, 1.6] as Vec3,
  crossXZ: [0, 3.4, 2.3] as Vec3,
  trackball: [0, 0.35, 4.4] as Vec3,
  view: [2.7, 2.3, 3.3] as Vec3,
};

/** Bryce's render balls are all chrome; the hint text tells them apart. */
const CHROME_BALL: IconData = { from: VIEW_FROM.front, studio: true, pieces: [{ entry: 'sphere', mat: 'Chrome' }] };

export const CONTROL_ICON_DATA = {
  trackball: {
    from: CONTROL_FROM.trackball,
    pieces: [
      { entry: 'sphere', size: [TRACKBALL_R, TRACKBALL_R, TRACKBALL_R], mat: TRACKBALL },
      ...flatArrows(Plane.XY, TEAL, TRACKBALL_ARROW_K, [0, 0, TRACKBALL_ARROW_Z]),
    ],
  },
  'cross-xy': { from: CONTROL_FROM.crossXY, pieces: cross(Plane.XY) },
  'cross-xz': { from: CONTROL_FROM.crossXZ, pieces: cross(Plane.XZ) },
  'cross-yz': { from: CONTROL_FROM.crossYZ, pieces: cross(Plane.YZ) },
  view: {
    from: CONTROL_FROM.view,
    pieces: [
      { entry: 'cube', position: [0, -0.42, 0], size: [0.95, 0.07, 0.95], mat: 'Polished Wood' },
      { entry: 'terrain', position: [-0.12, -0.05, -0.15], size: [0.62, 0.32, 0.62], mat: 'Red Rock' },
      { entry: 'cube', position: [-0.62, -0.23, 0.55], size: [0.13, 0.13, 0.13], mat: TEAL },
      { entry: 'sphere', position: [0.1, -0.21, 0.66], size: [0.14, 0.14, 0.14], mat: TEAL },
      { entry: 'pyramid', position: [0.66, -0.21, 0.2], size: [0.15, 0.15, 0.15], mat: TEAL },
    ],
  },
  render: CHROME_BALL,
  stop: CHROME_BALL,
  clear: CHROME_BALL,
  materials: { from: VIEW_FROM.front, pieces: [{ entry: 'sphere', mat: 'Psycho Chrome' }] },
  resize: { from: VIEW_FROM.angled, pieces: [{ entry: 'cube', size: [0.7, 0.7, 0.7], mat: TEAL }, { entry: 'cube', position: [0.55, 0.55, 0.55], size: [0.28, 0.28, 0.28], mat: TRACKBALL }] },
  rotate: { from: VIEW_FROM.front, pieces: [{ entry: 'torus', rotation: [60, 0, 20], size: [0.95, 0.95, 0.95], mat: TEAL }] },
  reposition: { from: VIEW_FROM.top, pieces: [hub(TRACKBALL), ...arrows(TRACKBALL, XZ)] },
  align: {
    from: VIEW_FROM.front,
    pieces: [
      { entry: 'cube', position: [-0.7, -0.15, 0], size: [0.3, 0.3, 0.3], mat: TEAL },
      { entry: 'cube', position: [0, 0, 0], size: [0.3, 0.4, 0.3], mat: TEAL },
      { entry: 'cube', position: [0.7, 0.15, 0], size: [0.3, 0.5, 0.3], mat: TEAL },
    ],
  },
  randomize: {
    from: VIEW_FROM.angled,
    pieces: [
      { entry: 'sphere', position: [-0.6, 0.3, 0], size: [0.22, 0.22, 0.22], mat: TEAL },
      { entry: 'sphere', position: [0.5, 0.6, -0.2], size: [0.26, 0.26, 0.26], mat: TRACKBALL },
      { entry: 'sphere', position: [0.1, -0.4, 0.3], size: [0.3, 0.3, 0.3], mat: TEAL },
      { entry: 'sphere', position: [-0.3, -0.2, -0.5], size: [0.34, 0.34, 0.34], mat: TRACKBALL },
      { entry: 'sphere', position: [0.7, -0.3, 0.2], size: [0.38, 0.38, 0.38], mat: TEAL },
    ],
  },
  'edit-terrain': { from: VIEW_FROM.angled, pieces: [{ entry: 'terrain', size: ICON_TERRAIN_SIZE, mat: 'Snowy Peaks' }] },
  land: { from: VIEW_FROM.angled, pieces: [{ entry: 'sphere', position: [0, 0.35, 0], size: [0.45, 0.45, 0.45], mat: TRACKBALL }, { entry: 'disk', position: [0, -0.4, 0], size: [0.9, 0.9, 0.9], mat: TEAL }] },
  library: { from: VIEW_FROM.angled, pieces: [{ entry: 'terrain', size: [0.8, 0.5, 0.8], mat: 'Canyon Strata' }, { entry: 'sphere', position: [0.65, 0.45, 0.4], size: [0.28, 0.28, 0.28], mat: 'Trapper Purple' }] },
} satisfies Record<string, IconData>;

export const CLOUD_ICON: readonly PieceData[] = [
  { entry: 'square', size: [0.95, 1, 0.95], mat: 'Glow White' },
  { entry: 'sphere', position: [-0.35, 0.2, 0.1], size: [0.32, 0.22, 0.32], mat: 'Glow White' },
  { entry: 'sphere', position: [0.2, 0.25, -0.1], size: [0.32, 0.22, 0.32], mat: 'Glow White' },
  { entry: 'sphere', position: [0.05, 0.3, 0.35], size: [0.32, 0.22, 0.32], mat: 'Glow White' },
];

export const PLANE_ICON_SIZE: Vec3 = [0.95, 1, 0.95];
export const LIGHT_ICON: readonly PieceData[] = [{ entry: 'sphere', size: [0.45, 0.45, 0.45], mat: 'Gold' }];
export const SPOT_ICON: readonly PieceData[] = [...LIGHT_ICON, { entry: 'cone', position: [0, -0.35, 0], size: [0.6, 0.5, 0.6], mat: 'Glow White' }];

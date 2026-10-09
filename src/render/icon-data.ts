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
const BALL_OUT = 0.71;
const BALL_FRONT = 0.72;

const arrows = (mat: string, dirs: readonly { p: Vec3; r: Vec3 }[]): PieceData[] => dirs.map((d) => ({ entry: 'cone', position: d.p, size: ARROW, rotation: d.r, mat }));

const XY = [{ p: [OUT, 0, 0], r: [0, 0, -90] }, { p: [-OUT, 0, 0], r: [0, 0, 90] }, { p: [0, OUT, 0], r: [0, 0, 0] }, { p: [0, -OUT, 0], r: [180, 0, 0] }] as const;
const XZ = [{ p: [OUT, 0, 0], r: [0, 0, -90] }, { p: [-OUT, 0, 0], r: [0, 0, 90] }, { p: [0, 0, OUT], r: [90, 0, 0] }, { p: [0, 0, -OUT], r: [-90, 0, 0] }] as const;
const YZ = [{ p: [0, 0, OUT], r: [90, 0, 0] }, { p: [0, 0, -OUT], r: [-90, 0, 0] }, { p: [0, OUT, 0], r: [0, 0, 0] }, { p: [0, -OUT, 0], r: [180, 0, 0] }] as const;
const BALL = [{ p: [BALL_OUT, 0, BALL_FRONT], r: [0, 0, -90] }, { p: [-BALL_OUT, 0, BALL_FRONT], r: [0, 0, 90] }, { p: [0, BALL_OUT, BALL_FRONT], r: [0, 0, 0] }, { p: [0, -BALL_OUT, BALL_FRONT], r: [180, 0, 0] }] as const;

const hub = (mat: string): PieceData => ({ entry: 'sphere', size: HUB, mat });

export const CONTROL_ICON_DATA = {
  trackball: { from: VIEW_FROM.front, pieces: [{ entry: 'sphere', size: [0.8, 0.8, 0.8], mat: TRACKBALL }, ...arrows(TEAL, BALL)] },
  'cross-xy': { from: VIEW_FROM.front, pieces: [hub(TEAL), ...arrows(TEAL, XY)] },
  'cross-xz': { from: VIEW_FROM.top, pieces: [hub(TEAL), ...arrows(TEAL, XZ)] },
  'cross-yz': { from: VIEW_FROM.side, pieces: [hub(TEAL), ...arrows(TEAL, YZ)] },
  view: { from: VIEW_FROM.angled, pieces: [{ entry: 'cube', position: [0, -0.35, 0], size: [0.75, 0.3, 0.75], mat: TEAL }, { entry: 'terrain', position: [0, 0.4, 0], size: [0.7, 0.45, 0.7], mat: 'Snowy Peaks' }] },
  render: { from: VIEW_FROM.front, pieces: [{ entry: 'sphere', mat: 'Chrome' }] },
  stop: { from: VIEW_FROM.front, pieces: [{ entry: 'sphere', mat: 'Red Plastic' }] },
  clear: { from: VIEW_FROM.front, pieces: [{ entry: 'sphere', mat: 'Flat Black' }] },
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

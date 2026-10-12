import type { Vec3 } from '../core/vec3';

/**
 * Compositions of the rendered interface icons, as data: which primitives,
 * where, how big, in which material. `mat` is one of the icon materials below or a preset name.
 */
export interface PieceData {
  readonly entry: string;
  readonly position?: Vec3;
  readonly size?: Vec3;
  readonly rotation?: Vec3;
  readonly mat: string;
}

/** The light an icon is rendered under. */
export enum IconLight {
  /** A plain grey studio: flat shapes read by their shading. */
  Plain = 'plain',
  /** The pale chrome of the left column, a little brighter than Plain. */
  Column = 'column',
  /** The preview sky, so chrome has a horizon to reflect. */
  Studio = 'studio',
}

export interface IconData {
  readonly pieces: readonly PieceData[];
  readonly from: Vec3;
  readonly light?: IconLight;
  readonly fov?: number;
}

export const TEAL = 'teal';
export const TRACKBALL = 'trackball';
/** The glossier teal of the left column's hubs and trackball arrows. */
export const HUB_TEAL = 'hub-teal';
/** Bryce's white render balls. */
export const PEARL = 'pearl';
/** The light icons' bulb: Bryce's gold, lit brighter on dark chrome. */
export const LAMP = 'lamp';

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

/** An arrow pointing along local +y: a pyramid head on a block stem; sizes are half-extents. */
export interface ArrowShape {
  readonly headAt: number;
  readonly headW: number;
  readonly headH: number;
  readonly stemW: number;
  readonly thick: number;
}

/** The chunky arrow of Bryce's camera crosses. */
export const CROSS_ARROW: ArrowShape = { headAt: 0.72, headW: 0.3, headH: 0.22, stemW: 0.12, thick: 0.13 };
const CROSS_HUB = 0.27;
/** The stems start inside the hub ball, so no gap shows between them. */
const CROSS_STEM_FROM = CROSS_HUB * 0.8;

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
  readonly thick: number;
  readonly mat: string;
  readonly scale: number;
  readonly centre: Vec3;
}

function flatPiece(p: FlatPiece): PieceData {
  const { width: w, halfLength: h, thick: t, scale: k } = p;
  const size: Vec3 = p.direction.wide === Wide.X ? [w * k, h * k, t * k] : [t * k, h * k, w * k];
  return { entry: p.entry, position: scaled(p.direction.axis, p.at * k, p.centre), size, rotation: p.direction.rotation, mat: p.mat };
}

/** Options of `flatArrows`. */
export interface ArrowOptions {
  readonly k?: number;
  readonly centre?: Vec3;
  /** Each stem starts this far out from the centre, before scaling. */
  readonly stemFrom?: number;
  readonly shape?: ArrowShape;
}

/** Four flat arrows in `plane`, scaled by `k` around `centre`. */
export function flatArrows(plane: Plane, mat: string, o: ArrowOptions = {}): PieceData[] {
  const { k = 1, centre = [0, 0, 0], stemFrom = 0, shape = CROSS_ARROW } = o;
  const base = shape.headAt - shape.headH;
  const stemHalf = (base - stemFrom) / 2;
  const common = { thick: shape.thick, mat, scale: k, centre };
  return DIRECTIONS[plane].flatMap((direction) => [
    flatPiece({ entry: 'pyramid', direction, at: shape.headAt, width: shape.headW, halfLength: shape.headH, ...common }),
    flatPiece({ entry: 'cube', direction, at: stemFrom + stemHalf, width: shape.stemW, halfLength: stemHalf, ...common }),
  ]);
}

/** Bryce 2's camera cross: chunky salmon arrows around a glossy teal ball. */
const cross = (plane: Plane): PieceData[] => [
  { entry: 'sphere', size: [CROSS_HUB, CROSS_HUB, CROSS_HUB], mat: HUB_TEAL },
  ...flatArrows(plane, TRACKBALL, { stemFrom: CROSS_STEM_FROM }),
];

/**
 * The trackball's arrows are embossed on the ball, as in Bryce: each stem is a run of
 * short blocks laid tangent to the ball and half sunk into it, so the relief follows
 * the curvature; each head is a flattened cone lying on the ball, tangent at its middle:
 * a triangle seen from the front, rounded across, sinking into the ball at the tip.
 */
export interface Relief {
  /** Ball radius. */
  readonly r: number;
  /** Height of the stems above the ball. */
  readonly height: number;
  readonly stemW: number;
  /** Polar angles (degrees from the arrows' centre) of the stem end and the head tip. */
  readonly stemTo: number;
  readonly tipAt: number;
  readonly headW: number;
  /** Half the head's thickness at its base; the head's axis sits this deep under the ball's surface. */
  readonly headRise: number;
  readonly headSink: number;
  readonly segments: number;
}

const TRACKBALL_RELIEF: Relief = { r: 0.8, height: 0.05, stemW: 0.105, stemTo: 27, tipAt: 60, headW: 0.27, headRise: 0.075, headSink: 0.025, segments: 6 };
/** Neighbouring blocks overlap a little, so no seam opens on the curve. */
const SEGMENT_OVERLAP = 1.12;
const DEG = Math.PI / 180;
const RIGHT_ANGLE = 90;
const ARROW_HEADINGS = [0, 90, 180, 270] as const;

/** A piece on the ball at polar angle `theta`, heading `phi`, `lift` above the surface, its local +y along the arrow. */
function onBall(rel: Relief, entry: string, theta: number, phi: number, lift: number, size: Vec3, mat: string): PieceData {
  const rho = rel.r + lift;
  const s = Math.sin(theta * DEG);
  const position: Vec3 = [rho * s * Math.cos(phi * DEG), rho * s * Math.sin(phi * DEG), rho * Math.cos(theta * DEG)];
  return { entry, position, size, rotation: [-theta, 0, phi - RIGHT_ANGLE], mat };
}

/** Four embossed arrows centred on the ball's +z pole. */
export function embossedArrows(rel: Relief, mat: string): PieceData[] {
  const step = rel.stemTo / rel.segments;
  const halfStep = ((step * DEG * rel.r) / 2) * SEGMENT_OVERLAP;
  const headAngle = rel.tipAt - rel.stemTo;
  const headHalf = (headAngle * DEG * rel.r) / 2;
  // A flat cap at the pole covers the four stems' overlapping first blocks.
  const cap = onBall(rel, 'cube', 0, 0, 0, [rel.stemW, rel.stemW, rel.height], mat);
  return [cap, ...ARROW_HEADINGS.flatMap((phi) => [
    ...Array.from({ length: rel.segments }, (_, i) =>
      onBall(rel, 'cube', step * (i + 0.5), phi, 0, [rel.stemW, halfStep, rel.height], mat)),
    onBall(rel, 'cone', rel.stemTo + headAngle / 2, phi, -rel.headSink, [rel.headW, headHalf, rel.headRise], mat),
  ])];
}

const trackball = (): PieceData[] => {
  const r = TRACKBALL_RELIEF.r;
  return [{ entry: 'sphere', size: [r, r, r], mat: TRACKBALL }, ...embossedArrows(TRACKBALL_RELIEF, HUB_TEAL)];
};

/** Viewpoints of the left-column icons, a little above so the flat crosses read in perspective like Bryce's. */
const CONTROL_FROM = {
  crossXY: [-1.5, 1.3, 3.9] as Vec3,
  crossYZ: [-3.9, 1.3, 1.5] as Vec3,
  crossXZ: [0, 2.5, 3.3] as Vec3,
  trackball: [0, 0.6, 4.4] as Vec3,
  view: [2.5, 1.9, 3.4] as Vec3,
  ball: [0, 0.5, 4.4] as Vec3,
};
const CROSS_FOV = 26;

/** Bryce's render balls are white pearls; the hint text tells them apart. */
const PEARL_BALL: IconData = { from: CONTROL_FROM.ball, light: IconLight.Studio, pieces: [{ entry: 'sphere', mat: PEARL }] };

export const CONTROL_ICON_DATA = {
  trackball: { from: CONTROL_FROM.trackball, light: IconLight.Column, pieces: trackball() },
  'cross-xy': { from: CONTROL_FROM.crossXY, light: IconLight.Column, fov: CROSS_FOV, pieces: cross(Plane.XY) },
  'cross-xz': { from: CONTROL_FROM.crossXZ, light: IconLight.Column, fov: CROSS_FOV, pieces: cross(Plane.XZ) },
  'cross-yz': { from: CONTROL_FROM.crossYZ, light: IconLight.Column, fov: CROSS_FOV, pieces: cross(Plane.YZ) },
  view: {
    from: CONTROL_FROM.view,
    light: IconLight.Column,
    pieces: [
      { entry: 'cube', position: [0, -0.42, 0], size: [0.95, 0.07, 0.95], mat: 'Polished Wood' },
      { entry: 'terrain', position: [-0.12, -0.05, -0.15], size: [0.62, 0.36, 0.62], mat: 'Red Rock' },
      { entry: 'cube', position: [-0.62, -0.23, 0.55], size: [0.13, 0.13, 0.13], mat: HUB_TEAL },
      { entry: 'sphere', position: [0.1, -0.21, 0.66], size: [0.14, 0.14, 0.14], mat: HUB_TEAL },
      { entry: 'pyramid', position: [0.66, -0.21, 0.2], size: [0.15, 0.15, 0.15], mat: HUB_TEAL },
    ],
  },
  render: PEARL_BALL,
  stop: PEARL_BALL,
  clear: PEARL_BALL,
  live: PEARL_BALL,
  'save-image': PEARL_BALL,
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
export const LIGHT_ICON: readonly PieceData[] = [{ entry: 'sphere', size: [0.45, 0.45, 0.45], mat: LAMP }];
export const SPOT_ICON: readonly PieceData[] = [...LIGHT_ICON, { entry: 'cone', position: [0, -0.35, 0], size: [0.6, 0.5, 0.6], mat: 'Glow White' }];

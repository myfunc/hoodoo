import type { Vec3 } from '../../core/vec3';
import type { ViewBasis } from '../../world/camera-math';

/** What a handle does. */
export enum GizmoKind {
  Move = 'move',
  Resize = 'resize',
  Rotate = 'rotate',
}

export const EVEN_AXIS = -1;

export const BOX_CORNERS = 8;
const FAR_X = 1, FAR_Y = 2, FAR_Z = 4;

/** The selection box's twelve edges as pairs of corner indices (bit 0 X, bit 1 Y, bit 2 Z on the far side). */
export const BOX_EDGES: readonly (readonly [number, number])[] = Array.from({ length: BOX_CORNERS }, (_, a) =>
  [FAR_X, FAR_Y, FAR_Z].filter((bit) => !(a & bit)).map((bit) => [a, a | bit] as const)).flat();

/**
 * One handle: its kind and axis (0 X, 1 Y, 2 Z; EVEN_AXIS for an even resize).
 * `grip` is its index in GizmoHandles.grips, so two handles of one job (the
 * corners of the selection box) are told apart; rings have none.
 */
export interface GizmoPart {
  readonly kind: GizmoKind;
  readonly axis: number;
  readonly grip?: number;
}

export const samePart = (a: GizmoPart | null, b: GizmoPart | null): boolean =>
  a === b || (!!a && !!b && a.kind === b.kind && a.axis === b.axis && a.grip === b.grip);

/**
 * The axes the handles work along, as the Edit palette's tools read them
 * (transform-ops `resized`, `turned`): one object resizes along its own axes
 * about its position and turns about its Euler axes (Z, then Y turned by Z,
 * then X turned by both); several resize and turn about world axes through
 * the centre of their box.
 */
export interface GizmoFrame {
  readonly centre: Vec3;
  /** The point resizing keeps still. */
  readonly pivot: Vec3;
  readonly sizeAxes: readonly Vec3[];
  /** Half the extent along each size axis. */
  readonly extents: Vec3;
  readonly turnAxes: readonly Vec3[];
  /** Below the pivot on the floor of the box: what an even resize with Alt keeps still. */
  readonly base: Vec3;
}

/** Where a handle is drawn and grabbed on screen. */
export interface GizmoGrip {
  readonly part: GizmoPart;
  readonly at: readonly [number, number];
  /** How far from `at` a press still takes the handle (pixels); 0 shows it greyed (its axis points at the viewer). */
  readonly reach: number;
  /** Set apart from its axis (a pebble beside the selection): a drag reads the pointer's travel, not its distance from the centre. */
  readonly detached: boolean;
  /** Which face of the box a stretch handle sits on: +1 the far end of its axis, -1 the near end. */
  readonly side: number;
}

export interface GizmoHandles {
  readonly origin: readonly [number, number];
  /** Screen end points of the X, Y, Z move axes; null when an axis points at the viewer. The drags read directions from these. */
  readonly tips: readonly ([number, number] | null)[];
  readonly worldOrigin: Vec3;
  readonly worldAxes: readonly Vec3[];
  /** World length of each move axis. */
  readonly axisLength: number;
  /** Screen points part way along the size axes; null when an axis points at the viewer. */
  readonly cubes: readonly ([number, number] | null)[];
  /** A point in the widest gap between the axes. */
  readonly even: readonly [number, number];
  /** Rotate rings as closed screen polylines (x, y pairs); point k is k steps the positive way round. Null behind the eye. */
  readonly rings: readonly (Float32Array | null)[];
  /** Which ring points lie beyond the centre (drawn fainter), per ring. */
  readonly ringBack: readonly (readonly boolean[] | null)[];
  /** How squarely each ring faces the eye: 1 a full circle, near 0 a line. */
  readonly facing: readonly number[];
  /** Ring radius on screen (pixels). */
  readonly ringRadius: number;
  /** How far from a ring a press still takes it (pixels); 0 when the rings show only while turning. */
  readonly ringReach: number;
  /** The rings come up within this many pixels of one of them; 0: within the rings' reach of the centre. */
  readonly nearBand: number;
  /** The handles drawn and grabbed, in the style's layout. */
  readonly grips: readonly GizmoGrip[];
  /** The selection box's corners on screen, null behind the eye (bit 0 X, bit 1 Y, bit 2 Z on the far side; gizmo.ts BOX_EDGES joins them). */
  readonly box: readonly ([number, number] | null)[];
  /** Pixels per world unit at the centre: what solid handles are sized by. */
  readonly pixelsPerUnit: number;
  readonly frame: GizmoFrame;
}

/** What drawing needs of the wireframe projector (wireframe.ts). */
export interface GizmoProjector {
  readonly basis: ViewBasis;
  /** Where the picture lands on the canvas: placed handles keep inside it. */
  readonly frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  view(p: Vec3): Vec3;
  screen(v: Vec3): [number, number];
  pixelsPerUnitAt(p: Vec3): number;
}

export interface GizmoLook {
  readonly hover: GizmoPart | null;
  /** The pointer is near: the rings show in full. */
  readonly near: boolean;
}

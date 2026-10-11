import { Family } from '../../model/scene.enums';

export const FAMILY_COLORS: Readonly<Record<Family, string>> = {
  [Family.Gray]: '#2b2b2b',
  [Family.Blue]: '#2a4fa8',
  [Family.Green]: '#2f7a35',
  [Family.Orange]: '#c46a1a',
  [Family.Purple]: '#7a2fa0',
  [Family.Teal]: '#1f7f7f',
  [Family.Brown]: '#7a4a22',
};

export const WIRE = {
  selected: '#d0202a',
  hover: '#ff6a4a',
  grid: 'rgba(200, 70, 130, 0.42)',
  gridAxis: 'rgba(200, 40, 90, 0.7)',
  horizon: '#5aa0e0',
  frameShade: 'rgba(60, 60, 58, 0.28)',
  frameLine: 'rgba(0, 0, 0, 0.55)',
  gizmo: ['#d43030', '#2c9a3a', '#2f5fd8'] as const,
  gizmoHover: '#ffd030',
  lineWidth: 1,
  selectedWidth: 1.4,
  gridStep: 2,
  gridExtent: 40,
  nearPlane: 0.05,
  depthCueFloor: 0.25,
  gizmoPixels: 64,
  gizmoHandle: 6,
  negativeDash: [4, 3] as const,
  intersectDash: [1, 3] as const,
  horizonFar: 100000,
  horizonSpread: 0.9,
  orthoGridLines: 60,
  parallelEps: 1e-6,
} as const;

/** The selection's handles beside WIRE.gizmo* (move tips): resize cubes, the even-resize square, rotate rings. */
export const GIZMO = {
  /** Resize cubes sit this far along each axis, as a share of the move axis. */
  cubeAt: 0.55,
  cubeHalf: 4,
  evenHalf: 5,
  evenFill: '#ece8dc',
  evenLine: '#34332f',
  /** Ring radius as a share of the move axis: the rings enclose the other handles. */
  ringScale: 1.3,
  ringSteps: 72,
  /** Rings seen closer to edge-on than this (|cos| of the axis to the eye) are drawn leaned toward the eye. */
  ringMinFacing: 0.3,
  ringWidth: 1.25,
  ringHoverWidth: 2.25,
  /** The far half of a ring is drawn fainter, like the far wires of a lattice. */
  ringBackAlpha: 0.35,
  /** Rings come up while the pointer is this many pixels outside them or closer. */
  ringNearPx: 28,
  /** How visible the rings are while the pointer is away. */
  ringIdleAlpha: 0.35,
} as const;

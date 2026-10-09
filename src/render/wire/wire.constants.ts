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

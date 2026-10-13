import { Family } from '../../model/scene.enums';
import { Tone, tonedTable } from '../tone';

/** Wire colours of the object families: deep inks on Bryce's stone, lighter ones that read on dark chrome. */
const FAMILY_LIGHT: Readonly<Record<Family, string>> = {
  [Family.Gray]: '#2b2b2b',
  [Family.Blue]: '#2a4fa8',
  [Family.Green]: '#2f7a35',
  [Family.Orange]: '#c46a1a',
  [Family.Purple]: '#7a2fa0',
  [Family.Teal]: '#1f7f7f',
  [Family.Brown]: '#7a4a22',
};
const FAMILY_DARK: Readonly<Record<Family, string>> = {
  [Family.Gray]: '#c9c8c2',
  [Family.Blue]: '#8fb0ff',
  [Family.Green]: '#74c97a',
  [Family.Orange]: '#f0a054',
  [Family.Purple]: '#d2a4f6',
  [Family.Teal]: '#52cfca',
  [Family.Brown]: '#dcae80',
};
export const FAMILY_COLORS = tonedTable({ [Tone.Light]: FAMILY_LIGHT, [Tone.Dark]: FAMILY_DARK });

const WIRE_LIGHT = {
  selected: '#d0202a' as string,
  hover: '#ff6a4a' as string,
  grid: 'rgba(200, 70, 130, 0.42)' as string,
  gridAxis: 'rgba(200, 40, 90, 0.7)' as string,
  horizon: '#5aa0e0' as string,
  frameShade: 'rgba(60, 60, 58, 0.28)' as string,
  frameLine: 'rgba(0, 0, 0, 0.55)' as string,
  lineWidth: 1,
  selectedWidth: 1.4,
  gridStep: 2,
  gridExtent: 40,
  nearPlane: 0.05,
  depthCueFloor: 0.25,
  /** Edit Group: the rest of the scene. */
  ghostColor: '#6b6b66' as string,
  ghostAlpha: 0.35,
  negativeDash: [4, 3] as const,
  intersectDash: [1, 3] as const,
  /** Play's trigger zones: long dashes, never rendered. */
  zoneDash: [7, 4] as const,
  horizonFar: 100000,
  horizonSpread: 0.9,
  orthoGridLines: 60,
  parallelEps: 1e-6,
} as const;

/** On dark chrome: a brighter red, Bryce's pink grid a little stronger, the picture frame drawn light. */
const WIRE_DARK: typeof WIRE_LIGHT = {
  ...WIRE_LIGHT,
  selected: '#ff4f4a',
  hover: '#ff9a70',
  grid: 'rgba(226, 92, 156, 0.42)',
  gridAxis: 'rgba(246, 84, 132, 0.8)',
  horizon: '#6cb4f2',
  frameShade: 'rgba(0, 0, 0, 0.3)',
  frameLine: 'rgba(225, 222, 214, 0.5)',
};
/** Both sets, for tables that copy a wire colour (motion paths); painters read `WIRE`. */
export const WIRE_TONES: Readonly<Record<Tone, typeof WIRE_LIGHT>> = { [Tone.Light]: WIRE_LIGHT, [Tone.Dark]: WIRE_DARK };
/** The wireframe's look: colours follow the tone (render/tone.ts), sizes are the same in both. */
export const WIRE = tonedTable(WIRE_TONES);

/** The rotate rings' geometry; the handles' looks and sizes are in gizmo-style.ts. */
export const GIZMO = {
  ringSteps: 72,
  /** Rings seen closer to edge-on than this (|cos| of the axis to the eye) are drawn leaned toward the eye. */
  ringMinFacing: 0.3,
  /** Rings come up while the pointer is this many pixels outside them or closer. */
  ringNearPx: 28,
  /** A press this close to a handle's line takes the handle, not only one on its end. */
  shaftReachPx: 7,
  /** The lines take a press only from this far out: the middle stays a free move of the selection. */
  shaftStartPx: 14,
} as const;

/**
 * READ ME — the looks of the selection's handles. Every look keeps the same
 * jobs (move along an axis, stretch along an axis, even resize, turn on a
 * ring); they differ in where the handles sit (GizmoLayout) and how they are
 * painted (gizmo-paint*.ts). Switch the app's look with GIZMO_STYLE below;
 * `?gizmo=1`…`5` tries another one for a visit.
 */
export enum GizmoStyle {
  /** Glossy balls and bevelled copper arrows, like the control panel's icons. */
  Glossy = 'glossy',
  /** Bryce's selection box: square handles at its corners and faces, chunky arrows outside it. */
  Box = 'box',
  /** Thick two-tone lines in a dark outline with big round tips. */
  Outline = 'outline',
  /** A compact cluster of pebbles beside the selection, like the A / M / E tags. */
  Pebbles = 'pebbles',
  /** Lit solids in the scene: cones, cubes and tube rings, shaded as the ray tracer would. */
  Sculpted = 'sculpted',
}

/** Where the handles sit. */
export enum GizmoLayout {
  /** On the axes through the centre. */
  Axes = 'axes',
  /** On the selection box, move arrows just outside it. */
  Box = 'box',
  /** In a cluster beside the selection; the axis or ring shows while a pebble is in use. */
  Pebbles = 'pebbles',
}

export interface GizmoStyleSpec {
  readonly layout: GizmoLayout;
  /** Move axis length on screen (pixels). */
  readonly axisPx: number;
  /** Resize handles sit this far along each axis, as a share of the move axis. */
  readonly cubeAt: number;
  /** Ring radius as a share of the move axis (Axes, Pebbles), or pixels beyond the box (Box). */
  readonly ringScale: number;
  /** How far from a handle's centre a press still takes it (pixels). */
  readonly tipReach: number;
  readonly cubeReach: number;
  readonly evenReach: number;
  /** How far from a ring a press still takes it; 0 while the rings show only in use. */
  readonly ringReach: number;
  /** The rings come up within this many pixels of one of them; 0: anywhere near the handles. */
  readonly nearBand: number;
}

/** The app's look. */
export const GIZMO_STYLE: GizmoStyle = GizmoStyle.Outline;

/** The looks by number, as `?gizmo=` counts them. */
export const GIZMO_STYLES: readonly GizmoStyle[] = [GizmoStyle.Glossy, GizmoStyle.Box, GizmoStyle.Outline, GizmoStyle.Pebbles, GizmoStyle.Sculpted];

export const GIZMO_SPECS: Readonly<Record<GizmoStyle, GizmoStyleSpec>> = {
  [GizmoStyle.Glossy]: { layout: GizmoLayout.Axes, axisPx: 78, cubeAt: 0.55, ringScale: 1.32, tipReach: 15, cubeReach: 13, evenReach: 15, ringReach: 8, nearBand: 0 },
  [GizmoStyle.Box]: { layout: GizmoLayout.Box, axisPx: 78, cubeAt: 0.55, ringScale: 20, tipReach: 15, cubeReach: 11, evenReach: 11, ringReach: 9, nearBand: 30 },
  [GizmoStyle.Outline]: { layout: GizmoLayout.Axes, axisPx: 80, cubeAt: 0.56, ringScale: 1.3, tipReach: 15, cubeReach: 13, evenReach: 14, ringReach: 8, nearBand: 0 },
  [GizmoStyle.Pebbles]: { layout: GizmoLayout.Pebbles, axisPx: 78, cubeAt: 0.55, ringScale: 1.3, tipReach: 12, cubeReach: 12, evenReach: 12, ringReach: 0, nearBand: 0 },
  [GizmoStyle.Sculpted]: { layout: GizmoLayout.Axes, axisPx: 80, cubeAt: 0.56, ringScale: 1.32, tipReach: 16, cubeReach: 13, evenReach: 14, ringReach: 9, nearBand: 0 },
};

/** Pebbles: size and spacing; the cluster sits right of the selection under the A / M / E tags (pixels). */
export const PEBBLE = { w: 24, h: 20, gap: 4, margin: 6, apart: 8, belowTags: 76, radius: 9 } as const;

/** Axis tones: X copper (never the selection's red), Y green, Z blue; hover gold; the even handle teal. */
export interface Tone {
  readonly base: string;
  readonly light: string;
  readonly dark: string;
}

export const AXIS_TONES: readonly Tone[] = [
  { base: '#f07a2c', light: '#ffd0a0', dark: '#7a3210' },
  { base: '#46b43a', light: '#c4f2a8', dark: '#1a5214' },
  { base: '#3a76ec', light: '#b6d0ff', dark: '#122a74' },
];
export const HOVER_TONE: Tone = { base: '#ffcf2a', light: '#fff6c0', dark: '#8a5e00' };
export const EVEN_TONE: Tone = { base: '#1f9396', light: '#a6f0ee', dark: '#0a4244' };
/** Bryce's embossed chrome: the A / M / E tags' face and rim. */
export const CHROME_TONE: Tone = { base: '#dedcd6', light: '#fbfbf9', dark: '#6a6a66' };
/** The dark rim round every handle: what keeps it readable on bright sky, dark water and red wires alike. */
export const INK = '#16130f';
/** The selection box's frame: light, so it never reads as part of the red wireframe. */
export const BOX_LINE = '#fffaf0';
export const SHADOW = 'rgba(10, 8, 6, 0.45)';

const STYLE_PARAM = 'gizmo';

/** The look an address asks for (`?gizmo=3` or `?gizmo=outline`), else GIZMO_STYLE. */
export function gizmoStyleIn(search: string): GizmoStyle {
  const asked = new URLSearchParams(search).get(STYLE_PARAM);
  if (!asked) return GIZMO_STYLE;
  const byNumber = GIZMO_STYLES[Number(asked) - 1];
  return byNumber ?? GIZMO_STYLES.find((s) => s === asked) ?? GIZMO_STYLE;
}

/** The look the scene window draws: GIZMO_STYLE unless the address asks for another. */
export const ACTIVE_GIZMO_STYLE: GizmoStyle = gizmoStyleIn(typeof location === 'undefined' ? '' : location.search);

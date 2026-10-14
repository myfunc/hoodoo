export enum SelectMode {
  Replace = 'replace',
  Add = 'add',
  Toggle = 'toggle',
}

/** What two-finger scrolling does in the scene window; the user can fix it when the guess is wrong (View menu). */
export enum ScrollPreference {
  Auto = 'auto',
  Wheel = 'wheel',
  Trackpad = 'trackpad',
}

/** How hard the live picture works while you edit: the renderer reads it from the settings (Settings › Render). */
export enum LiveQuality {
  Fast = 'fast',
  Full = 'full',
  Detailed = 'detailed',
}

/**
 * What draws the scene window's picture. Edit: the live preview while you edit
 * (Settings › Live quality), or Bryce's render on request with Live off. Final:
 * Render View, the final render refining in place (Render Options). Game: the game
 * renderer, Play's picture, previewed while you edit (Render Options › Game look).
 */
export enum PictureMode {
  Edit = 'edit',
  Final = 'final',
  Game = 'game',
}

/** What Play draws with (SceneView.setPlay): the game renderer, or the live preview at one of its qualities. */
export type PlayQuality = LiveQuality | PictureMode.Game;

/** The scene members that are not objects: listed above the objects, selected, keyed, hidden and locked like them. */
export enum Rig {
  Camera = 'camera',
  Sun = 'sun',
}

/** The looks of the selection's handles (render/wire/gizmo-style.ts; View › Gizmo). */
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

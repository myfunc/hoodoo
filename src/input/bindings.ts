import { KEY, TEXT_TAGS } from '../core/keys';
import { Action } from './actions';

/** A key chord; `code` is layout-independent (KeyZ), `mod` means Ctrl on PC and Cmd on Mac. */
export interface Chord {
  readonly code: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export interface ActionInfo {
  readonly label: string;
  readonly menu: MenuName;
  readonly chords: readonly Chord[];
}

export enum MenuName {
  /** The app menu under the Hoodoo title. */
  App = 'Hoodoo',
  File = 'File',
  Edit = 'Edit',
  Objects = 'Objects',
  View = 'View',
  Render = 'Render',
  Animation = 'Animation',
  /** Play mode, portals and trigger zones: the scene's game parts. */
  Play = 'Play',
  Help = 'Help',
  Palette = 'Palette',
}

const c = (code: string, mods: Omit<Chord, 'code'> = {}): Chord => ({ code, ...mods });
const M = { mod: true } as const;
const MS = { mod: true, shift: true } as const;

/** The single table of labels and shortcuts. */
export const ACTIONS: Readonly<Record<Action, ActionInfo>> = {
  [Action.New]: { label: 'New Scene', menu: MenuName.File, chords: [c('KeyN', { alt: true })] },
  [Action.Open]: { label: 'Open…', menu: MenuName.File, chords: [c('KeyO', M)] },
  [Action.Save]: { label: 'Save', menu: MenuName.File, chords: [c('KeyS', M)] },
  [Action.ExportImage]: { label: 'Render to Image…', menu: MenuName.File, chords: [c('KeyE', MS)] },
  [Action.ExportMovie]: { label: 'Render Turntable Movie…', menu: MenuName.File, chords: [c('KeyE', { mod: true, alt: true })] },
  [Action.CopyImage]: { label: 'Copy Render to Clipboard', menu: MenuName.File, chords: [c('KeyC', MS)] },
  [Action.ShareLink]: { label: 'Copy Share Link', menu: MenuName.File, chords: [c('KeyL', MS)] },
  [Action.DocumentSetup]: { label: 'Document Setup…', menu: MenuName.File, chords: [c('KeyD', MS)] },
  [Action.SurpriseScene]: { label: 'Surprise Me: Random Landscape', menu: MenuName.File, chords: [c('KeyN', { alt: true, shift: true })] },
  [Action.LoadDemo]: { label: 'Open Demo: Trapper Keeper Canyon', menu: MenuName.File, chords: [] },
  [Action.Undo]: { label: 'Undo', menu: MenuName.Edit, chords: [c('KeyZ', M)] },
  [Action.Redo]: { label: 'Redo', menu: MenuName.Edit, chords: [c('KeyZ', MS), c('KeyY', M)] },
  [Action.Cut]: { label: 'Cut', menu: MenuName.Edit, chords: [c('KeyX', M)] },
  [Action.Copy]: { label: 'Copy', menu: MenuName.Edit, chords: [c('KeyC', M)] },
  [Action.Paste]: { label: 'Paste', menu: MenuName.Edit, chords: [c('KeyV', M)] },
  [Action.Duplicate]: { label: 'Duplicate', menu: MenuName.Edit, chords: [c('KeyD', M)] },
  [Action.Replicate]: { label: 'Multi-Replicate…', menu: MenuName.Edit, chords: [c('KeyD', { mod: true, alt: true })] },
  [Action.Delete]: { label: 'Clear', menu: MenuName.Edit, chords: [c('Delete'), c('Backspace')] },
  [Action.SelectAll]: { label: 'Select All', menu: MenuName.Edit, chords: [c('KeyA', M)] },
  [Action.SelectNone]: { label: 'Select None', menu: MenuName.Edit, chords: [c('Escape')] },
  [Action.CopyMaterial]: { label: 'Copy Material', menu: MenuName.Edit, chords: [c('KeyC', { mod: true, alt: true })] },
  [Action.PasteMaterial]: { label: 'Paste Material', menu: MenuName.Edit, chords: [c('KeyV', { mod: true, alt: true })] },
  [Action.Group]: { label: 'Group', menu: MenuName.Objects, chords: [c('KeyG', M)] },
  [Action.Ungroup]: { label: 'Ungroup', menu: MenuName.Objects, chords: [c('KeyG', MS)] },
  [Action.NewGroup]: { label: 'New Group', menu: MenuName.Objects, chords: [] },
  [Action.Land]: { label: 'Land Object', menu: MenuName.Objects, chords: [c('KeyL')] },
  [Action.Attributes]: { label: 'Object Attributes…', menu: MenuName.Objects, chords: [c('KeyA', { alt: true })] },
  [Action.EditMaterial]: { label: 'Materials Lab…', menu: MenuName.Objects, chords: [c('KeyM')] },
  [Action.ChooseMaterial]: { label: 'Choose Material…', menu: MenuName.Objects, chords: [] },
  [Action.PrevMaterial]: { label: 'Previous Material', menu: MenuName.Objects, chords: [c('ArrowUp')] },
  [Action.NextMaterial]: { label: 'Next Material', menu: MenuName.Objects, chords: [c('ArrowDown')] },
  [Action.EditObject]: { label: 'Edit Terrain…', menu: MenuName.Objects, chords: [c('KeyE')] },
  [Action.ObjectLibrary]: { label: 'Object Library…', menu: MenuName.Objects, chords: [c('KeyO', { alt: true })] },
  // Menu and Edit palette only: a chord ran it by accident (TO576), and R is the walk's rise key.
  [Action.Randomize]: { label: 'Randomize', menu: MenuName.Objects, chords: [] },
  [Action.HideSelected]: { label: 'Hide Selection', menu: MenuName.Objects, chords: [c('KeyH')] },
  [Action.ShowAll]: { label: 'Show All', menu: MenuName.Objects, chords: [c('KeyH', { alt: true })] },
  [Action.CreatePortals]: { label: 'Create Portal Pair', menu: MenuName.Play, chords: [] },
  [Action.LinkPortals]: { label: 'Link Two Portals', menu: MenuName.Play, chords: [] },
  [Action.CreateTriggerZone]: { label: 'Create Trigger Zone', menu: MenuName.Play, chords: [] },
  [Action.PortalsTriggers]: { label: 'Portals & Triggers…', menu: MenuName.Play, chords: [] },
  [Action.Play]: { label: 'Play: Walk the Scene', menu: MenuName.View, chords: [c('KeyP', { shift: true })] },
  // G starts a keyboard Move; R and S switch it to Rotate and Size from inside only, as they walk outside it (TRANSFORM_KEYS).
  [Action.MoveSelection]: { label: 'Move Selection', menu: MenuName.Objects, chords: [c('KeyG')] },
  [Action.RotateSelection]: { label: 'Rotate Selection', menu: MenuName.Objects, chords: [] },
  [Action.SizeSelection]: { label: 'Size Selection', menu: MenuName.Objects, chords: [] },
  [Action.CloudPublish]: { label: 'Publish to Gallery…', menu: MenuName.File, chords: [] },
  [Action.CloudGallery]: { label: 'Gallery…', menu: MenuName.File, chords: [] },
  [Action.CloudAccount]: { label: 'Cloud Account…', menu: MenuName.File, chords: [] },
  [Action.FrameSelected]: { label: 'Frame Selection', menu: MenuName.View, chords: [c('KeyF')] },
  [Action.FrameAll]: { label: 'Frame Scene', menu: MenuName.View, chords: [c('KeyF', { shift: true })] },
  [Action.ViewCamera]: { label: 'Camera View', menu: MenuName.View, chords: [c('Digit1', { alt: true }), c('Numpad0')] },
  [Action.ViewDirector]: { label: "Director's View", menu: MenuName.View, chords: [c('Digit2', { alt: true })] },
  [Action.ViewTop]: { label: 'Top View', menu: MenuName.View, chords: [c('Digit3', { alt: true }), c('Numpad7')] },
  [Action.ViewFront]: { label: 'Front View', menu: MenuName.View, chords: [c('Digit4', { alt: true }), c('Numpad1')] },
  [Action.ViewSide]: { label: 'Side View', menu: MenuName.View, chords: [c('Digit5', { alt: true }), c('Numpad3')] },
  [Action.QuadView]: { label: 'Four Views', menu: MenuName.View, chords: [c('KeyQ')] },
  [Action.ToggleSidePanel]: { label: 'Scene Panel', menu: MenuName.View, chords: [c('Tab')] },
  [Action.ToggleLeftPanel]: { label: 'Left Panel', menu: MenuName.View, chords: [c('Tab', { shift: true })] },
  [Action.MaximizeView]: { label: 'Maximize View', menu: MenuName.View, chords: [c('Backquote')] },
  [Action.ToggleDepthCue]: { label: 'Depth Cue', menu: MenuName.View, chords: [] },
  [Action.ToggleGrid]: { label: 'Ground Grid', menu: MenuName.View, chords: [c('KeyG', { alt: true })] },
  [Action.ToggleGizmo]: { label: 'Move Handles', menu: MenuName.View, chords: [c('KeyT')] },
  [Action.ToggleSnap]: { label: 'Snap to Grid', menu: MenuName.View, chords: [c('KeyS', { alt: true })] },
  [Action.PreviewFeatures]: { label: 'Preview Features…', menu: MenuName.View, chords: [] },
  [Action.Settings]: { label: 'Settings…', menu: MenuName.App, chords: [c('Comma', M)] },
  [Action.ResetCamera]: { label: 'Reset Camera', menu: MenuName.View, chords: [c('Home')] },
  [Action.PickFocus]: { label: 'Pick Focus Point', menu: MenuName.View, chords: [c('KeyF', { alt: true })] },
  [Action.CameraFromView]: { label: 'Camera to Director', menu: MenuName.View, chords: [] },
  [Action.ZoomIn]: { label: 'Zoom In', menu: MenuName.View, chords: [c('Equal'), c('NumpadAdd')] },
  [Action.ZoomOut]: { label: 'Zoom Out', menu: MenuName.View, chords: [c('Minus'), c('NumpadSubtract')] },
  [Action.Render]: { label: 'Render', menu: MenuName.Render, chords: [c('KeyR', M), c('F12')] },
  [Action.StopRender]: { label: 'Stop Render', menu: MenuName.Render, chords: [c('Period', M)] },
  [Action.ClearRender]: { label: 'Clear Render', menu: MenuName.Render, chords: [c('KeyK', MS)] },
  [Action.ToggleLiveRender]: { label: 'Live Render Preview', menu: MenuName.Render, chords: [c('KeyP')] },
  [Action.ToggleRenderView]: { label: 'Render View', menu: MenuName.Render, chords: [c('KeyP', { alt: true })] },
  [Action.RenderOptions]: { label: 'Render Options…', menu: MenuName.Render, chords: [] },
  [Action.TakeSnapshot]: { label: 'Take Snapshot', menu: MenuName.Render, chords: [c('KeyB')] },
  [Action.CompareSnapshot]: { label: 'Compare with Last Snapshot', menu: MenuName.Render, chords: [c('KeyB', { shift: true })] },
  [Action.TabCreate]: { label: 'Create Palette', menu: MenuName.Palette, chords: [c('Digit1', M)] },
  [Action.TabEdit]: { label: 'Edit Palette', menu: MenuName.Palette, chords: [c('Digit2', M)] },
  [Action.TabSky]: { label: 'Sky & Fog Palette', menu: MenuName.Palette, chords: [c('Digit3', M)] },
  [Action.SkyLibrary]: { label: 'Sky Presets…', menu: MenuName.Palette, chords: [] },
  [Action.MaterialLibrary]: { label: 'Material Presets…', menu: MenuName.Palette, chords: [] },
  [Action.CommandPalette]: { label: 'Command Palette…', menu: MenuName.Help, chords: [c('KeyP', M), c('KeyK', M), c('Slash', M)] },
  [Action.Shortcuts]: { label: 'Keyboard Shortcuts', menu: MenuName.Help, chords: [c('Slash', { shift: true })] },
  [Action.InstallApp]: { label: 'Install as App…', menu: MenuName.Help, chords: [] },
  [Action.About]: { label: 'About Hoodoo', menu: MenuName.Help, chords: [] },
  [Action.SourceCode]: { label: 'Source Code on GitHub', menu: MenuName.Help, chords: [] },
  [Action.TutorialBook]: { label: 'Tutorial Book…', menu: MenuName.Help, chords: [] },
  [Action.ScrollAuto]: { label: 'Scroll Gestures: Detect Device', menu: MenuName.View, chords: [] },
  [Action.ScrollWheel]: { label: 'Scroll Gestures: Mouse Wheel Zooms', menu: MenuName.View, chords: [] },
  [Action.ScrollTrackpad]: { label: 'Scroll Gestures: Trackpad Orbits', menu: MenuName.View, chords: [] },
  [Action.StartWindow]: { label: 'Start Window…', menu: MenuName.File, chords: [] },
  [Action.ToggleAnimation]: { label: 'Animation', menu: MenuName.Animation, chords: [c('KeyA', { shift: true })] },
  [Action.PlayPause]: { label: 'Play / Pause', menu: MenuName.Animation, chords: [c('Space', { shift: true })] },
  [Action.FirstFrame]: { label: 'Go to Start', menu: MenuName.Animation, chords: [c('Home', { shift: true })] },
  [Action.LastFrame]: { label: 'Go to End', menu: MenuName.Animation, chords: [c('End', { shift: true })] },
  [Action.PrevFrame]: { label: 'Previous Frame', menu: MenuName.Animation, chords: [c('Comma')] },
  [Action.NextFrame]: { label: 'Next Frame', menu: MenuName.Animation, chords: [c('Period')] },
  [Action.PrevKey]: { label: 'Previous Key', menu: MenuName.Animation, chords: [c('Comma', { shift: true })] },
  [Action.NextKey]: { label: 'Next Key', menu: MenuName.Animation, chords: [c('Period', { shift: true })] },
  [Action.AddKey]: { label: 'Add Key for Selection', menu: MenuName.Animation, chords: [c('KeyK')] },
  [Action.RemoveKey]: { label: 'Remove Key at Playhead', menu: MenuName.Animation, chords: [c('KeyK', { alt: true })] },
  [Action.KeyCamera]: { label: 'Animate Camera (key it here)', menu: MenuName.Animation, chords: [c('KeyK', { shift: true })] },
  [Action.ToggleLoop]: { label: 'Loop Playback', menu: MenuName.Animation, chords: [] },
  [Action.ToggleMotionPaths]: { label: 'Show Motion Paths', menu: MenuName.Animation, chords: [] },
  [Action.SelectAllKeys]: { label: 'Select All Keys', menu: MenuName.Animation, chords: [c('KeyA', { alt: true, shift: true })] },
  // Delete and Backspace (Action.Delete) remove the picked keys while any are picked.
  [Action.DeleteKeys]: { label: 'Delete Selected Keys', menu: MenuName.Animation, chords: [] },
  [Action.ClosePathLoop]: { label: 'Close Path Loop', menu: MenuName.Animation, chords: [] },
  [Action.OpenPath]: { label: 'Open Path', menu: MenuName.Animation, chords: [] },
  [Action.AnimationSetup]: { label: 'Animation Setup…', menu: MenuName.Animation, chords: [] },
  [Action.ClearAnimation]: { label: 'Clear All Keys', menu: MenuName.Animation, chords: [] },
  [Action.Bookmark]: { label: 'Go to Camera Bookmark', menu: MenuName.View, chords: [] },
  [Action.SaveBookmark]: { label: 'Save Camera Bookmark', menu: MenuName.View, chords: [] },
};

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const KEY_NAMES: Readonly<Record<string, string>> = {
  Delete: 'Del', Backspace: 'Bksp', Escape: 'Esc', Equal: '+', Minus: '-', Slash: '/', Period: '.', Home: 'Home',
  NumpadAdd: 'Num+', NumpadSubtract: 'Num-', Tab: 'Tab', F12: 'F12', Comma: ',', Space: 'Space', End: 'End',
  ArrowUp: '↑', ArrowDown: '↓', Backquote: '`',
};
const CODE_PREFIXES = ['Key', 'Digit', 'Numpad'] as const;

export function chordLabel(ch: Chord): string {
  let key = KEY_NAMES[ch.code] ?? ch.code;
  for (const p of CODE_PREFIXES) if (key.startsWith(p) && !KEY_NAMES[ch.code]) key = (p === 'Numpad' ? 'Num' : '') + key.slice(p.length);
  const parts = [ch.mod ? (IS_MAC ? 'Cmd' : 'Ctrl') : '', ch.alt ? (IS_MAC ? 'Opt' : 'Alt') : '', ch.shift ? 'Shift' : '', key].filter(Boolean);
  return parts.join('+');
}

export const shortcutOf = (a: Action): string => {
  const first = ACTIONS[a].chords[0];
  return first ? chordLabel(first) : '';
};

const BOOKMARK_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

/** Keyboard event → action call; bookmark digits without modifiers recall, with Shift save. */
export function matchKey(e: KeyboardEvent): { action: Action; arg?: number } | null {
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  const slot = BOOKMARK_CODES.indexOf(e.code);
  if (slot >= 0 && !mod && !e.altKey) return { action: e.shiftKey ? Action.SaveBookmark : Action.Bookmark, arg: slot };
  for (const [action, info] of Object.entries(ACTIONS) as [Action, ActionInfo][]) {
    for (const ch of info.chords) {
      if (ch.code === e.code && !!ch.mod === mod && !!ch.shift === e.shiftKey && !!ch.alt === e.altKey) return { action };
    }
  }
  return null;
}

/** True when the event target is a text field and plain keys belong to it. */
export const isTyping = (e: KeyboardEvent): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (TEXT_TAGS.has(t.tagName) || t.isContentEditable) && e.key !== KEY.Escape;
};

/**
 * Held keys that walk the camera while the pointer is over the scene window, as [right, up, forward]:
 * W/S forward and back, A/D sideways, R/C rise and sink. Orthographic views pan with W/A/S/D.
 */
export const WALK_KEYS: Readonly<Record<string, readonly [number, number, number]>> = {
  KeyW: [0, 0, 1],
  KeyS: [0, 0, -1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyR: [0, 1, 0],
  KeyC: [0, -1, 0],
};

/** While the right button is held the walk keys fly, and E/Q rise and sink too (they open Edit Terrain and Four Views otherwise). */
export const FLY_KEYS: Readonly<Record<string, readonly [number, number, number]>> = {
  ...WALK_KEYS,
  KeyE: [0, 1, 0],
  KeyQ: [0, -1, 0],
};

/** Held with a selection: drag left/right in the scene window or scroll to resize it (Bryce's Resize tool). */
export const RESIZE_KEY = 'KeyZ';

/**
 * A keyboard Move, Rotate or Size (key-transform.ts) owns the keyboard while it runs: G, R and S
 * pick the job, X, Y and Z lock to that world axis (again: unlock; Shift: the plane without it).
 * X, Y and Z also lock a drag of objects or of a handle.
 */
export const TRANSFORM_KEYS = { move: 'KeyG', rotate: 'KeyR', size: 'KeyS' } as const;
export const AXIS_KEYS: readonly string[] = ['KeyX', 'KeyY', 'KeyZ'];

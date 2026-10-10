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
  File = 'File',
  Edit = 'Edit',
  Objects = 'Objects',
  View = 'View',
  Render = 'Render',
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
  [Action.Land]: { label: 'Land Object', menu: MenuName.Objects, chords: [c('KeyL')] },
  [Action.Attributes]: { label: 'Object Attributes…', menu: MenuName.Objects, chords: [c('KeyA', { alt: true })] },
  [Action.EditMaterial]: { label: 'Materials Lab…', menu: MenuName.Objects, chords: [c('KeyM')] },
  [Action.EditObject]: { label: 'Edit Terrain…', menu: MenuName.Objects, chords: [c('KeyE')] },
  [Action.ObjectLibrary]: { label: 'Object Library…', menu: MenuName.Objects, chords: [c('KeyO', { alt: true })] },
  [Action.Randomize]: { label: 'Randomize', menu: MenuName.Objects, chords: [c('KeyR', { alt: true })] },
  [Action.HideSelected]: { label: 'Hide Selection', menu: MenuName.Objects, chords: [c('KeyH')] },
  [Action.ShowAll]: { label: 'Show All', menu: MenuName.Objects, chords: [c('KeyH', { alt: true })] },
  [Action.FrameSelected]: { label: 'Frame Selection', menu: MenuName.View, chords: [c('KeyF')] },
  [Action.FrameAll]: { label: 'Frame Scene', menu: MenuName.View, chords: [c('KeyF', { shift: true })] },
  [Action.ViewCamera]: { label: 'Camera View', menu: MenuName.View, chords: [c('Digit1', { alt: true }), c('Numpad0')] },
  [Action.ViewDirector]: { label: "Director's View", menu: MenuName.View, chords: [c('Digit2', { alt: true })] },
  [Action.ViewTop]: { label: 'Top View', menu: MenuName.View, chords: [c('Digit3', { alt: true }), c('Numpad7')] },
  [Action.ViewFront]: { label: 'Front View', menu: MenuName.View, chords: [c('Digit4', { alt: true }), c('Numpad1')] },
  [Action.ViewSide]: { label: 'Side View', menu: MenuName.View, chords: [c('Digit5', { alt: true }), c('Numpad3')] },
  [Action.QuadView]: { label: 'Four Views', menu: MenuName.View, chords: [c('KeyQ')] },
  [Action.ToggleSidePanel]: { label: 'Scene Panel', menu: MenuName.View, chords: [c('Tab')] },
  [Action.ToggleDepthCue]: { label: 'Depth Cue', menu: MenuName.View, chords: [] },
  [Action.ToggleGrid]: { label: 'Ground Grid', menu: MenuName.View, chords: [c('KeyG', { alt: true })] },
  [Action.ToggleGizmo]: { label: 'Move Handles', menu: MenuName.View, chords: [c('KeyT')] },
  [Action.ToggleSnap]: { label: 'Snap to Grid', menu: MenuName.View, chords: [c('KeyS', { alt: true })] },
  [Action.ResetCamera]: { label: 'Reset Camera', menu: MenuName.View, chords: [c('Home')] },
  [Action.PickFocus]: { label: 'Pick Focus Point', menu: MenuName.View, chords: [c('KeyF', { alt: true })] },
  [Action.CameraFromView]: { label: 'Camera to Director', menu: MenuName.View, chords: [] },
  [Action.ZoomIn]: { label: 'Zoom In', menu: MenuName.View, chords: [c('Equal'), c('NumpadAdd')] },
  [Action.ZoomOut]: { label: 'Zoom Out', menu: MenuName.View, chords: [c('Minus'), c('NumpadSubtract')] },
  [Action.Render]: { label: 'Render', menu: MenuName.Render, chords: [c('KeyR', M), c('F12')] },
  [Action.StopRender]: { label: 'Stop Render', menu: MenuName.Render, chords: [c('Period', M)] },
  [Action.ClearRender]: { label: 'Clear Render', menu: MenuName.Render, chords: [c('KeyK', MS)] },
  [Action.ToggleLiveRender]: { label: 'Live Render Preview', menu: MenuName.Render, chords: [c('KeyP')] },
  [Action.TakeSnapshot]: { label: 'Take Snapshot', menu: MenuName.Render, chords: [c('KeyB')] },
  [Action.CompareSnapshot]: { label: 'Compare with Last Snapshot', menu: MenuName.Render, chords: [c('KeyB', { shift: true })] },
  [Action.TabCreate]: { label: 'Create Palette', menu: MenuName.Palette, chords: [c('Digit1', M)] },
  [Action.TabEdit]: { label: 'Edit Palette', menu: MenuName.Palette, chords: [c('Digit2', M)] },
  [Action.TabSky]: { label: 'Sky & Fog Palette', menu: MenuName.Palette, chords: [c('Digit3', M)] },
  [Action.SkyLibrary]: { label: 'Sky Presets…', menu: MenuName.Palette, chords: [] },
  [Action.MaterialLibrary]: { label: 'Material Presets…', menu: MenuName.Palette, chords: [] },
  [Action.CommandPalette]: { label: 'Command Palette…', menu: MenuName.Help, chords: [c('KeyK', M), c('Slash', M)] },
  [Action.Shortcuts]: { label: 'Keyboard Shortcuts', menu: MenuName.Help, chords: [c('Slash', { shift: true })] },
  [Action.InstallApp]: { label: 'Install as App…', menu: MenuName.Help, chords: [] },
  [Action.About]: { label: 'About Hoodoo', menu: MenuName.Help, chords: [] },
  [Action.SourceCode]: { label: 'Source Code on GitHub', menu: MenuName.Help, chords: [] },
  [Action.Bookmark]: { label: 'Go to Camera Bookmark', menu: MenuName.View, chords: [] },
  [Action.SaveBookmark]: { label: 'Save Camera Bookmark', menu: MenuName.View, chords: [] },
};

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const KEY_NAMES: Readonly<Record<string, string>> = {
  Delete: 'Del', Backspace: 'Bksp', Escape: 'Esc', Equal: '+', Minus: '-', Slash: '/', Period: '.', Home: 'Home',
  NumpadAdd: 'Num+', NumpadSubtract: 'Num-', Tab: 'Tab', F12: 'F12',
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

/** Held keys of the fly camera (Director / Camera view navigation). */
export const FLY_KEYS: Readonly<Record<string, readonly [number, number, number]>> = {
  KeyW: [0, 0, 1],
  KeyS: [0, 0, -1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyE: [0, 1, 0],
  KeyQ: [0, -1, 0],
};

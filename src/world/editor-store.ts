import { Bus } from '../core/bus';
import { ViewKind } from '../model/scene.enums';
import type { Camera } from '../model/scene.types';
import { DEFAULT_CAMERA } from './scene.defaults';

export enum PaletteTab {
  Create = 'create',
  Edit = 'edit',
  Sky = 'sky',
}

export interface Hint {
  readonly title: string;
  readonly text: string;
}

/** Session state of the editor: which view, which palette, what is drawn. Not part of the scene or undo. */
export interface EditorState {
  readonly tab: PaletteTab;
  readonly view: ViewKind;
  readonly director: Camera;
  readonly quad: boolean;
  /** Modern: re-render continuously while editing. Classic Bryce renders only on request. */
  readonly liveRender: boolean;
  /** Whether the last render stays visible under the wireframe. */
  readonly showRender: boolean;
  readonly depthCue: boolean;
  readonly grid: boolean;
  readonly gizmo: boolean;
  readonly snap: boolean;
  readonly sidePanel: boolean;
  readonly renderSamples: number;
  readonly hint: Hint;
  /** The next click in a perspective view sets the camera's focus distance. */
  readonly pickingFocus: boolean;
}

export const IDLE_HINT: Hint = { title: 'Ready', text: 'Point at any control to see what it does' };

export const RENDER_SAMPLE_CHOICES = [1, 4, 9, 16, 32, 64] as const;
const DEFAULT_SAMPLES = 16;

export const INITIAL_EDITOR: EditorState = {
  tab: PaletteTab.Create,
  view: ViewKind.Camera,
  director: DEFAULT_CAMERA,
  quad: false,
  liveRender: true,
  showRender: true,
  depthCue: true,
  grid: true,
  gizmo: true,
  snap: false,
  sidePanel: true,
  renderSamples: DEFAULT_SAMPLES,
  hint: IDLE_HINT,
  pickingFocus: false,
};

export interface EditorEvents {
  changed: { readonly state: EditorState; readonly previous: EditorState };
}

export class EditorStore {
  readonly events = new Bus<EditorEvents>();
  private current: EditorState;

  constructor(initial: EditorState = INITIAL_EDITOR) {
    this.current = initial;
  }

  get state(): EditorState {
    return this.current;
  }

  update(patch: Partial<EditorState>): void {
    const previous = this.current;
    this.current = { ...previous, ...patch };
    this.events.emit('changed', { state: this.current, previous });
  }

  setHint(hint: Hint): void {
    if (hint.title === this.current.hint.title && hint.text === this.current.hint.text) return;
    this.update({ hint });
  }
}

/** The camera a perspective view looks through: the scene camera or the free director camera. */
export const isPerspective = (v: ViewKind): boolean => v === ViewKind.Camera || v === ViewKind.Director;

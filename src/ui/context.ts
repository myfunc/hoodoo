import type { Action } from '../input/actions';
import type { Thumbnailer } from '../render/thumbs';
import type { SceneView } from '../render/viewport';
import type { EditorStore, Hint } from '../world/editor-store';
import type { World } from '../world/world';
import type { SnapshotStore } from './snapshot-store';

/** What every UI part may use: the domain, the session, the thumbnail renderer and the command dispatcher. */
export interface UiContext {
  readonly world: World;
  readonly editor: EditorStore;
  readonly thumbs: Thumbnailer;
  readonly view: SceneView;
  readonly snapshots: SnapshotStore;
  dispatch(action: Action, arg?: number): void;
  isChecked(action: Action): boolean;
  isEnabled(action: Action): boolean;
  toast(message: string): void;
}

/** Shows a hint in the Bryce status area while the pointer is over `el`. */
export function hintOn(ctx: UiContext, el: HTMLElement, hint: Hint): void {
  el.addEventListener('pointerenter', () => ctx.editor.setHint(hint));
  el.addEventListener('pointerleave', () => ctx.editor.setHint({ title: 'Ready', text: '' }));
}

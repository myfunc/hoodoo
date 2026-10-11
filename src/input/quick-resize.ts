import type { SceneObject } from '../model/scene.types';
import type { EditorStore, Hint } from '../world/editor-store';
import { resized } from '../world/transform-ops';
import type { World } from '../world/world';
import { SWIPE_GAP_MS } from './input.constants';
import { dragResizeFactor } from './walk-math';

const RESIZE_LABEL = 'Resize';
const READY_HINT: Hint = { title: 'Ready', text: '' };
const RESIZE_HINT: Hint = { title: 'Resize', text: 'Drag left/right or scroll' };
const NOTHING_HINT: Hint = { title: 'Resize', text: 'Drag an object left/right' };

/**
 * Bryce's Resize tool without the palette: hold the resize key (Z) and drag left/right in the
 * scene window, or scroll, to scale the selection evenly about its centre. A drag is one undo
 * step and so is a scroll swipe; edits are auto-keyed at the playhead like every other edit.
 */
export class QuickResize {
  private held = false;
  private start: readonly SceneObject[] = [];
  private timer = 0;

  /** `idle`: no mouse gesture is open, so a scroll's timer may close the undo step. */
  constructor(private readonly world: World, private readonly editor: EditorStore, private readonly idle: () => boolean) {}

  get isHeld(): boolean {
    return this.held;
  }

  hold(inScene: boolean): void {
    if (this.held) return;
    this.held = true;
    if (inScene) this.editor.setHint(this.world.selection.size ? RESIZE_HINT : NOTHING_HINT);
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    if (this.editor.state.hint.title === RESIZE_HINT.title) this.editor.setHint(READY_HINT);
  }

  /** A press with the key held: true when there is something to resize (the press then belongs to it). */
  begin(): boolean {
    if (!this.world.selection.size) return false;
    this.start = this.world.selectedObjects();
    this.world.beginGesture(RESIZE_LABEL);
    return true;
  }

  /** `dx`: pixels from the press; sizes are taken from the press, so the drag never drifts. */
  drag(dx: number): void {
    this.apply(this.start, dragResizeFactor(dx));
  }

  /** One scroll event; a pause longer than a swipe's gap closes the undo step. */
  scroll(factor: number): void {
    if (!this.world.selection.size) return;
    this.world.beginGesture(RESIZE_LABEL);
    this.apply(this.world.selectedObjects(), factor);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { if (this.idle()) this.world.endGesture(); }, SWIPE_GAP_MS);
  }

  private apply(objects: readonly SceneObject[], factor: number): void {
    const next = resized(objects, [factor, factor, factor]);
    this.world.updateObjects(new Set(next.keys()), RESIZE_LABEL, (o) => next.get(o.id) ?? o);
  }
}

import { Action } from '../input/actions';
import { shortcutOf } from '../input/bindings';
import type { UiContext } from '../ui/context';

/** Keeps the picture in the scene window with its scene. */
export function takeSnapshot(ctx: UiContext): void {
  const image = ctx.view.capture();
  if (!image) {
    ctx.toast('Nothing to snapshot yet: render first (or turn on Live)');
    return;
  }
  const snap = ctx.snapshots.add(image, ctx.world.scene);
  ctx.toast(`Snapshot #${snap.id} kept · ${shortcutOf(Action.CompareSnapshot)} compares it with what you do next`);
}

/** Toggles A/B compare against the newest snapshot. */
export function compareLatest(ctx: UiContext): void {
  const store = ctx.snapshots;
  if (store.compared) {
    store.compare(null);
    return;
  }
  if (!store.latest) {
    ctx.toast(`No snapshot yet: press ${shortcutOf(Action.TakeSnapshot)} first`);
    return;
  }
  store.compare(store.latest);
}

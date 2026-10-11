import type { GroupId } from '../../model/scene.ids';
import { type TreeItems, reparented } from '../../world/group-tree';
import type { World } from '../../world/world';

/** Pixels the pointer travels before a press on a row becomes a drag. */
const DRAG_START_PX = 4;

/**
 * Drag and drop in the Object Tree: rows dragged onto a group move into it,
 * onto the free space below the rows to the top level. One drop is one undo
 * step; a drop that would put a group inside itself is not offered.
 */
export class OutlinerDrag {
  private items: TreeItems | null = null;
  private target: GroupId | null | undefined;
  private lit: HTMLElement | null = null;
  private dropped = false;

  constructor(
    private readonly world: World,
    private readonly body: HTMLElement,
    /** Where a drop on this element goes: a group row into itself, an object row into its group, free space to the top. */
    private readonly targetAt: (under: Element) => GroupId | null,
    private readonly groupRow: (id: GroupId) => HTMLElement | null,
    private readonly done: () => void,
  ) {}

  get active(): boolean {
    return this.items !== null;
  }

  /** True once for the click that ends a drag, so it does not also select. */
  consumeClick(): boolean {
    const was = this.dropped;
    this.dropped = false;
    return was;
  }

  /** Arms a drag from a press on a row; `items` are resolved only if the pointer really moves. */
  press(down: PointerEvent, row: HTMLElement, items: () => TreeItems): void {
    if (down.button !== 0) return;
    const move = (e: PointerEvent) => {
      if (!this.items) {
        if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_START_PX) return;
        this.items = items();
        row.classList.add('is-dragged');
        this.body.classList.add('is-dragging');
      }
      this.hover(document.elementFromPoint(e.clientX, e.clientY));
    };
    const end = (apply: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      this.finish(apply);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  private hover(under: Element | null): void {
    const items = this.items;
    if (!items) return;
    let target: GroupId | null | undefined;
    if (under && this.body.contains(under)) target = this.targetAt(under);
    const ok = target !== undefined && reparented(this.world.scene, items, target) !== null;
    this.target = ok ? target : undefined;
    this.light(ok && target ? this.groupRow(target) : null, ok && target === null);
  }

  private light(row: HTMLElement | null, root: boolean): void {
    if (this.lit !== row) {
      this.lit?.classList.remove('is-drop-target');
      row?.classList.add('is-drop-target');
      this.lit = row;
    }
    this.body.classList.toggle('is-drop-root', root);
  }

  private finish(apply: boolean): void {
    const items = this.items;
    if (!items) return;
    const target = this.target;
    this.items = null;
    this.target = undefined;
    this.dropped = true;
    setTimeout(() => { this.dropped = false; });
    this.light(null, false);
    this.body.classList.remove('is-dragging');
    for (const el of this.body.querySelectorAll('.is-dragged')) el.classList.remove('is-dragged');
    if (apply && target !== undefined) this.world.reparent(items, target);
    this.done();
  }
}

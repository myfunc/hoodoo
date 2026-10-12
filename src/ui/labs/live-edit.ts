import type { World } from '../../world/world';

/** The pointer events a LiveEdit listens to (the window in the app, a stub in tests). */
export interface PointerSource {
  addEventListener(type: 'pointerdown' | 'pointerup' | 'pointercancel', listener: () => void, capture: boolean): void;
}

/**
 * Edits made from a tool window go straight into the scene, one undo step per
 * committed change: a drag (a dial, the colour spectrum) amends one step while
 * the pointer is down; a click, a typed value or a picked preset is a step of
 * its own. The release is noticed at the window, before the control's own
 * pointerup, so the control's final value still lands in the same step.
 */
export class LiveEdit {
  private pressed = false;
  private open = false;

  constructor(private readonly world: World, source: PointerSource = window, private readonly defer: (fn: () => void) => void = (fn) => setTimeout(fn)) {
    source.addEventListener('pointerdown', () => { this.pressed = true; }, true);
    const release = () => {
      this.pressed = false;
      if (this.open) this.defer(() => this.finish());
    };
    source.addEventListener('pointerup', release, true);
    source.addEventListener('pointercancel', release, true);
  }

  /** Runs one change of the scene under `label`; while the pointer is down the next ones amend it. */
  apply(label: string, edit: () => void): void {
    this.world.beginGesture(label);
    this.open = true;
    edit();
    if (!this.pressed) this.finish();
  }

  private finish(): void {
    if (!this.open) return;
    this.open = false;
    this.world.endGesture();
  }
}

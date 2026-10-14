/** How mouse look tells a real move from a bogus jump (LookFilter). */
export const LOOK_FILTER = {
  /** A move this big is never a jump. */
  floorPx: 250,
  /** Over this many times the recent size of a move, a move is a jump. */
  factor: 6,
  /** How fast the recent size follows each move. */
  gain: 0.3,
  /** After this long without a move the recent size starts over. */
  quietMs: 120,
  /** This many jumps in a row are a real fast move after all. */
  trustAfter: 2,
} as const;

/**
 * READ ME — Chrome on Windows sometimes reports one mouse move with the pointer locked
 * hundreds of pixels long that the hand never made (the hidden cursor meeting the
 * screen's edge, the move right after the lock): in a first-person view the camera
 * turns at once. A move far bigger than the moves just before it is dropped, and so is
 * the first one after the lock; two in a row are a real flick and go through.
 */
export class LookFilter {
  private level = 0;
  private lastAt = -Infinity;
  private streak = 0;
  private fresh = true;

  /** The pointer was locked again: its first move is not trusted. */
  restart(): void {
    this.fresh = true;
    this.level = 0;
    this.streak = 0;
  }

  /** Whether the move of `dx`, `dy` pixels at `now` ms is a real one. */
  accept(dx: number, dy: number, now: number): boolean {
    const size = Math.hypot(dx, dy);
    if (now - this.lastAt > LOOK_FILTER.quietMs) this.level = 0;
    this.lastAt = now;
    if (this.fresh) {
      this.fresh = false;
      return false;
    }
    const jump = size > Math.max(LOOK_FILTER.floorPx, this.level * LOOK_FILTER.factor);
    if (jump && ++this.streak < LOOK_FILTER.trustAfter) return false;
    this.streak = 0;
    this.level = jump ? size : this.level + (size - this.level) * LOOK_FILTER.gain;
    return true;
  }
}

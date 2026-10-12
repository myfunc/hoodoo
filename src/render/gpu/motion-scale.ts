/** Resolution control for the live view's moving frames. */
export const MOTION_SCALE = {
  /** GPU time of one moving frame: leaves the browser room to show it in the same 60 Hz frame. */
  frameMs: 10,
  minScale: 0.25,
  /** Scales are multiples of this, so the picture keeps its size while the cost wobbles. */
  step: 1 / 16,
  /** Over this many times the budget, the next frame is already smaller. */
  overload: 1.2,
  /** A step up needs room for this many steps, for `upFrames` frames in a row (fewer when there is more room). */
  upMargin: 1.5,
  upFrames: 20,
  /** Without timers: how fast lateness builds up, and the level that takes a step down. */
  lateGain: 0.25,
  lateLimit: 0.4,
  /**
   * A step up taken back within `failWindow` times its wait was one too many: the next try waits
   * twice as long, up to `maxHold` frames. One that holds for `earnBack` times its wait halves it again.
   */
  failWindow: 4,
  earnBack: 8,
  maxHold: 640,
} as const;

/** The size control's numbers (MOTION_SCALE); another renderer may pace itself differently (game-frame.ts). */
export type MotionTuning = { readonly [K in keyof typeof MOTION_SCALE]: number };

/**
 * READ ME — the size of the live picture while things move. With GPU timers it
 * predicts the frame cost from the measured cost per pixel; without them it
 * watches whether the GPU finished each frame by the next animation frame.
 * Either way the scale drops at once when frames get too slow and climbs back one
 * step at a time after a calm stretch, and an up-step that fails makes the next
 * try wait longer. So the size settles instead of flipping every frame (which the
 * viewer sees as the frame rate jumping between 60 and 30).
 */
export class MotionScale {
  private current: number;
  private calm = 0;
  private late = 0;
  private hold: number;
  private sinceUp = Infinity;

  constructor(start = 1, private readonly tune: MotionTuning = MOTION_SCALE) {
    this.current = quantize(start, tune);
    this.hold = tune.upFrames;
  }

  get scale(): number {
    return this.current;
  }

  /** With timers: the smoothed GPU cost of one pixel of a moving frame, and the full picture size. */
  measured(msPerPixel: number, fullPixels: number, budgetMs: number = this.tune.frameMs): void {
    if (msPerPixel <= 0 || fullPixels <= 0) return;
    const ideal = Math.sqrt(budgetMs / (msPerPixel * fullPixels));
    const cost = msPerPixel * fullPixels * this.current * this.current;
    if (cost > budgetMs * this.tune.overload) {
      this.down(Math.min(this.current - this.tune.step, Math.floor(ideal / this.tune.step) * this.tune.step));
      return;
    }
    const room = (ideal - this.current) / this.tune.step;
    this.considerUp(room >= this.tune.upMargin, room);
  }

  /** Without timers: whether the GPU was still busy with the frame at the next animation frame. */
  paced(lateFrame: boolean): void {
    this.late += ((lateFrame ? 1 : 0) - this.late) * this.tune.lateGain;
    if (this.late > this.tune.lateLimit) {
      this.late = 0;
      this.down(this.current - this.tune.step);
      return;
    }
    this.considerUp(!lateFrame, 1);
  }

  private down(to: number): void {
    if (this.sinceUp < this.hold * this.tune.failWindow) this.hold = Math.min(this.tune.maxHold, this.hold * 2);
    this.current = quantize(to, this.tune);
    this.calm = 0;
    this.sinceUp = Infinity;
  }

  /** `steps`: how many steps of room the measurement shows; a long way to go is climbed faster. */
  private considerUp(room: boolean, steps: number): void {
    this.sinceUp++;
    if (this.sinceUp === this.hold * this.tune.earnBack) this.hold = Math.max(this.tune.upFrames, this.hold / 2);
    this.calm = room ? this.calm + 1 : 0;
    if (this.calm * Math.max(1, steps / this.tune.upMargin) < this.hold || this.current >= 1) return;
    this.current = quantize(this.current + this.tune.step, this.tune);
    this.calm = 0;
    this.sinceUp = 0;
  }
}

function quantize(scale: number, tune: MotionTuning): number {
  const stepped = Math.round(scale / tune.step) * tune.step;
  return Math.min(1, Math.max(tune.minScale, stepped));
}

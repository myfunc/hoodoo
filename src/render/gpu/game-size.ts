import { PlayResolution } from '../../world/settings';

/** The game renderer's pacing and traced size (game-renderer.ts), measured in docs/rendering.md. */
export const GAME_SIZE = {
  /** Pictures a second the game aims at: a faster display shows each picture for several refreshes. */
  rate: 60,
  /** Display refreshes a little under a multiple of `rate` (59.94 Hz, 119.88 Hz) still count as one. */
  rateSlack: 0.1,
  /** Animation-frame intervals the display's refresh is learned from; gaps outside these bounds (a paused loop, a doubled call) are ignored. */
  refreshFrames: 15,
  refreshMinMs: 4,
  refreshMaxMs: 100,
  /** Scales are multiples of this: a step adds about a tenth of the pixels at 0.6. */
  step: 1 / 32,
  /**
   * Lowest size of each choice, as traced pixels per CSS pixel per side: a retina screen (device
   * pixel ratio 2) looks as sharp at half the device pixels as a plain one at all of them. Never
   * under `minScale` of the device pixels nor over the view's own size.
   */
  density: { [PlayResolution.Sharp]: 1.7, [PlayResolution.Auto]: 0.6, [PlayResolution.Smooth]: 0 } as Readonly<Record<PlayResolution, number>>,
  minScale: 0.25,
  /** The first frames trace about this many pixels (never under the floor); then the measured frames decide. */
  startPixels: 600000,
  /**
   * A frame should leave the GPU within this share of its budget; the size grows while the
   * recent frames predict room under it: after `upFrames` frames in a row with room for `upRoom`
   * steps (fewer with more room, more with less, down to `minRoom`). A GPU that lowers its clock
   * when it has time to spare reads slower than it is, so a little room is still worth a try.
   */
  target: 0.78,
  upRoom: 1.5,
  minRoom: 0.25,
  upFrames: 20,
  /**
   * Frames over this share of the budget are slow; when slowness builds past `slowLimit` (three
   * slow frames in a row, or about every other one for a while) the size drops, by at most
   * `maxDrop` steps at once.
   */
  over: 0.95,
  slowGain: 0.25,
  slowLimit: 0.5,
  maxDrop: 4,
  /**
   * A step up taken back within `failFrames` makes the next one wait twice as long, up to
   * `maxHold` frames; `earnFrames` without a drop halve the wait again. A scene whose cost
   * changes as the view turns then settles at the size it can hold instead of flipping.
   */
  failFrames: 120,
  maxHold: 240,
  earnFrames: 600,
  /** Frame times the prediction takes the median of (one odd frame moves nothing). */
  window: 5,
} as const;

const MS_PER_S = 1000;
/** Rounding allowance when a scale is snapped to its step. */
const STEP_EPSILON = 1e-6;

/**
 * READ ME — when the game renderer draws: at most `GAME_SIZE.rate` pictures a second. On a
 * 120 or 144 Hz display it draws every second animation frame, so each picture gets the time
 * of a 60 Hz frame (its budget) instead of half of it. The display's refresh is learned from
 * the animation frames themselves.
 */
export class FramePacer {
  private readonly gaps: number[] = [];
  private last = 0;
  private since = Infinity;
  /** The display's frame interval, ms. */
  interval = MS_PER_S / GAME_SIZE.rate;
  /** Animation frames per picture. */
  every = 1;

  /** One animation frame at `now` (ms). */
  frame(now: number): void {
    const gap = now - this.last;
    this.last = now;
    this.since++;
    if (gap < GAME_SIZE.refreshMinMs || gap > GAME_SIZE.refreshMaxMs) return;
    this.gaps.push(gap);
    if (this.gaps.length > GAME_SIZE.refreshFrames) this.gaps.shift();
    this.interval = median(this.gaps);
    this.every = framesPerPicture(this.interval);
  }

  /** Whether a picture is due on this animation frame. */
  get due(): boolean {
    return this.since >= this.every;
  }

  /** A picture was drawn on this animation frame. */
  drew(): void {
    this.since = 0;
  }

  /** The time one picture has on the GPU before the next is due, ms. */
  get budget(): number {
    return this.interval * this.every;
  }
}

/** Animation frames per picture for a display refreshing every `intervalMs`: the most that keeps `rate` pictures a second. */
export function framesPerPicture(intervalMs: number): number {
  const perPicture = MS_PER_S / Math.max(intervalMs, 1) / GAME_SIZE.rate;
  return Math.max(1, Math.floor(perPicture + GAME_SIZE.rateSlack));
}

/**
 * READ ME — the traced size of the game picture, per side of the view. Each finished frame
 * reports how long the GPU took (the fence, gpu-fence.ts) against its budget (FramePacer). The
 * size grows one small step at a time while the median of the last frames predicts room under
 * `GAME_SIZE.target` of the budget, and drops only once slow frames build up (never for one),
 * toward the size the median predicts, a few steps at most. The band between the two keeps the
 * size still, so the picture does not swim or stutter from probing; a step up that is soon
 * taken back makes the next one wait longer. The floor is the user's choice
 * (PlayResolution), in traced pixels per CSS pixel: Sharp keeps the picture near the view's
 * size even when that costs frames, Smooth may go far down for 60 a second, Auto stays at
 * 0.6 traced pixels per screen pixel per side or more.
 */
export class GameSize {
  private current: number;
  private floorScale: number;
  private readonly times: number[] = [];
  private slow = 0;
  private calm = 0;
  /** Calm frames a step up waits for, and frames since the last step up and the last drop. */
  private hold: number = GAME_SIZE.upFrames;
  private sinceUp = Infinity;
  private sinceDrop = 0;

  constructor(start: number, mode: PlayResolution = PlayResolution.Auto, private readonly pixelRatio = 1) {
    this.floorScale = floorFor(mode, pixelRatio);
    this.current = this.clamp(start);
  }

  get scale(): number {
    return this.current;
  }

  get floor(): number {
    return this.floorScale;
  }

  /** The user's choice changed: the floor moves, the size follows it up at once. */
  set mode(mode: PlayResolution) {
    this.floorScale = floorFor(mode, this.pixelRatio);
    this.change(this.clamp(this.current));
  }

  /** A frame left the GPU `ms` after it was sent, with `budgetMs` to do it in. */
  frame(ms: number, budgetMs: number): void {
    this.sinceUp++;
    this.sinceDrop++;
    if (this.sinceDrop % GAME_SIZE.earnFrames === 0) this.hold = Math.max(GAME_SIZE.upFrames, this.hold / 2);
    this.times.push(ms);
    if (this.times.length > GAME_SIZE.window) this.times.shift();
    const typical = median(this.times);
    // The size at which the typical frame would take the target share (cost grows with the pixels).
    const ideal = this.current * Math.sqrt((GAME_SIZE.target * budgetMs) / Math.max(typical, Number.EPSILON));
    this.slow += ((ms > GAME_SIZE.over * budgetMs ? 1 : 0) - this.slow) * GAME_SIZE.slowGain;
    if (this.slow > GAME_SIZE.slowLimit) {
      this.slow = 0;
      const deepest = this.current - GAME_SIZE.maxDrop * GAME_SIZE.step;
      this.drop(this.clamp(Math.max(deepest, Math.min(this.current - GAME_SIZE.step, stepDown(ideal)))));
      return;
    }
    const room = (ideal - this.current) / GAME_SIZE.step;
    this.calm = room > 0 ? this.calm + 1 : 0;
    if (this.calm * Math.max(room, GAME_SIZE.minRoom) < this.hold * GAME_SIZE.upRoom || this.current >= 1) return;
    this.change(this.clamp(this.current + GAME_SIZE.step));
    this.sinceUp = 0;
  }

  private drop(to: number): void {
    if (to === this.current) return;
    if (this.sinceUp < GAME_SIZE.failFrames) this.hold = Math.min(GAME_SIZE.maxHold, this.hold * 2);
    this.sinceDrop = 0;
    this.sinceUp = Infinity;
    this.change(to);
  }

  private change(to: number): void {
    this.calm = 0;
    if (to === this.current) return;
    this.current = to;
    // Frames at the old size say nothing about the new one.
    this.times.length = 0;
  }

  private clamp(scale: number): number {
    return Math.min(1, Math.max(this.floorScale, stepDown(scale)));
  }
}

/** The lowest traced size of a choice on a screen with this device pixel ratio. */
export function floorFor(mode: PlayResolution, pixelRatio: number): number {
  return Math.min(1, Math.max(GAME_SIZE.minScale, GAME_SIZE.density[mode] / Math.max(pixelRatio, 1)));
}

/**
 * The first traced size for a `width`×`height` view: `pixels` traced pixels (what the last view
 * settled at, or about `GAME_SIZE.startPixels`), at most the view's own.
 */
export function startScale(width: number, height: number, pixels: number = GAME_SIZE.startPixels): number {
  return Math.min(1, Math.sqrt(pixels / Math.max(1, width * height)));
}

/** The largest multiple of the step at or under `scale` (a hair of rounding allowed). */
function stepDown(scale: number): number {
  return Math.floor(scale / GAME_SIZE.step + STEP_EPSILON) * GAME_SIZE.step;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

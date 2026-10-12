import { ClipMode, ClipStart } from '../../model/play.enums';
import type { Clip } from '../../model/play.types';

const mod = (a: number, b: number): number => a - b * Math.floor(a / b);

/**
 * READ ME — the clock of one clip (model/play.types Clip): a stretch of an
 * object's or a group's keys played on its own, apart from the scene's
 * playhead. Loop runs from `from` to `to` and starts over (backward: the other
 * way round); Ping-pong goes there and back; Once stops at the end it heads
 * for, which is what a door wants: forward opens, backward closes, from
 * wherever it is. Toggle turns a Once clip round and pauses or resumes the others.
 */
export class ClipPlayer {
  /** Timeline seconds of the pose shown, between `from` and `to`. */
  time: number;
  /** +1 toward `to`, −1 toward `from`. */
  dir: 1 | -1 = 1;
  running: boolean;

  constructor(readonly clip: Clip) {
    this.time = clip.from;
    this.running = clip.start === ClipStart.Auto;
  }

  get span(): number {
    return this.clip.to - this.clip.from;
  }

  /** Moves the clock on by `dt` seconds of play. */
  step(dt: number): void {
    if (!this.running || this.span <= 0) return;
    const { from, to, mode, speed } = this.clip;
    const d = speed * dt;
    if (mode === ClipMode.Loop) {
      this.time = from + mod(this.time - from + this.dir * d, this.span);
      return;
    }
    if (mode === ClipMode.PingPong) {
      // Unfolded: the way there is 0..span, the way back span..2·span.
      const u = mod((this.dir > 0 ? this.time - from : 2 * this.span - (this.time - from)) + d, 2 * this.span);
      this.dir = u < this.span ? 1 : -1;
      this.time = u < this.span ? from + u : from + 2 * this.span - u;
      return;
    }
    const next = this.time + this.dir * d;
    if (next >= to || next <= from) this.running = false;
    this.time = Math.min(to, Math.max(from, next));
  }

  /** Plays toward the end (a Once clip already there stays). */
  forward(): void {
    this.dir = 1;
    this.running = !(this.clip.mode === ClipMode.Once && this.time >= this.clip.to);
  }

  /** Plays back toward the start. */
  backward(): void {
    this.dir = -1;
    this.running = !(this.clip.mode === ClipMode.Once && this.time <= this.clip.from);
  }

  /** Once: turns round (from an end, heads for the other). Loop and Ping-pong: pause or resume. */
  toggle(): void {
    if (this.clip.mode !== ClipMode.Once) {
      this.running = !this.running;
      return;
    }
    if (this.running) {
      this.dir = this.dir > 0 ? -1 : 1;
      return;
    }
    if (this.time >= this.clip.to) this.backward();
    else this.forward();
  }
}

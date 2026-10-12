import { clampLength, keysPastEnd, lengthStep, withKeysFitted, withLength } from '../../world/animation/duration';
import type { UiContext } from '../context';
import { showOffer } from '../panels/offer-toast';

/**
 * The length of the scene, set from the timeline: typed into the clock or
 * dragged with the end marker. One undo step; keys keep their times. Keys left
 * past a shorter end are greyed on the ruler and a one-line offer scales them in.
 */

export const LENGTH_LABEL = 'Scene length';
/** Overshooting the ruler's end by this many pixels grows the scene by its whole visible span per second. */
const PUSH_PX = 80;
/** The finest snap of the end marker on screen. */
const SNAP_PX = 5;
const MS_PER_S = 1000;

/** Takes back the last offer to fit, if it is still up. */
let withdraw = (): void => undefined;

/** Offers to scale the keys past the end into the scene; withdraws the offer once none are left there. */
export function offerFit(ctx: UiContext): void {
  const n = keysPastEnd(ctx.world.scene.animation);
  withdraw();
  withdraw = () => undefined;
  if (!n) return;
  withdraw = showOffer(`${n} ${n === 1 ? 'key lies' : 'keys lie'} past the end`, 'Scale keys to fit', () => {
    const a = ctx.world.scene.animation;
    if (keysPastEnd(a)) ctx.world.setAnimation(withKeysFitted(a), 'Scale keys to fit');
  });
}

/** A new length in one undo step (`label` names it in History). */
export function setSceneLength(ctx: UiContext, seconds: number, label = LENGTH_LABEL): void {
  const a = ctx.world.scene.animation;
  const d = clampLength(seconds);
  if (d === a.duration) return;
  ctx.world.setAnimation(withLength(a, d), label);
  offerFit(ctx);
}

/**
 * Dragging the end marker: the ruler's scale holds still while the marker moves;
 * held past the ruler's end, the scene grows and the ruler shrinks to show it.
 */
export class EndDrag {
  /** The seconds the ruler shows while the drag lasts. */
  view: number;
  private push = 0;
  /** The length while it grows, between the snapped steps it shows. */
  private grown = 0;
  private pxPerS = 1;
  private frame = 0;
  private last = 0;

  constructor(private readonly ctx: UiContext, view: number, private readonly redraw: () => void) {
    this.view = view;
    ctx.world.beginGesture(LENGTH_LABEL);
  }

  /** The pointer at `t` seconds on the frozen scale, `overshoot` pixels past the ruler's end. */
  move(t: number, overshoot: number, pxPerS: number): void {
    this.push = Math.max(0, overshoot);
    this.pxPerS = pxPerS;
    if (this.push > 0) {
      this.startPush();
      return;
    }
    this.set(t);
  }

  end(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.ctx.world.endGesture();
    offerFit(this.ctx);
  }

  /** Sets the length on the snap step of the ruler's scale. */
  private set(seconds: number): void {
    const a = this.ctx.world.scene.animation;
    const step = lengthStep(this.pxPerS, SNAP_PX);
    const d = clampLength(Math.round(seconds / step) * step);
    if (d !== a.duration) this.ctx.world.setAnimation(withLength(a, d), LENGTH_LABEL);
    this.view = Math.max(this.view, d);
    this.redraw();
  }

  private startPush(): void {
    if (this.frame) return;
    this.last = performance.now();
    this.grown = this.ctx.world.scene.animation.duration;
    const step = (now: number) => {
      if (this.push <= 0) {
        this.frame = 0;
        return;
      }
      const dt = (now - this.last) / MS_PER_S;
      this.last = now;
      this.grown += this.view * (this.push / PUSH_PX) * dt;
      // The ruler shrinks as the scene grows, so the marker stays at its end.
      this.pxPerS *= this.view / Math.max(this.view, this.grown);
      this.set(this.grown);
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }
}

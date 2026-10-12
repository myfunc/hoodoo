import { Action } from '../../input/actions';
import { KEY } from '../../core/keys';
import type { Animation } from '../../model/scene.types';
import type { UiContext } from '../context';
import { hintOn } from '../context';
import { NumberField } from '../kit/controls';
import { el } from '../kit/dom';
import { setSceneLength } from './timeline-length';
import { formatClock, parseClock } from './timeline-time';

/**
 * The Time Palette's engraved readout: the playhead and the length of the scene,
 * 0:03.2 / 0:08.0. The length is a field: type 30, 1:30 or 2m and press Enter.
 * The frame line below opens Animation Setup (frame rate, looping).
 */
export class TimelineClock {
  readonly el: HTMLElement;
  private readonly now: HTMLElement;
  private readonly total: NumberField;
  private readonly frames: HTMLElement;

  constructor(ctx: UiContext) {
    this.now = el('span', { cls: 'tl-time' });
    this.total = new NumberField({
      value: ctx.world.scene.animation.duration,
      cls: 'tl-total',
      title: 'Scene length: type 30, 1:30 or 2m',
      parse: parseClock,
      format: formatClock,
      onCommit: (v) => setSceneLength(ctx, v),
    });
    const field = this.total.el;
    field.addEventListener('focus', () => field.select());
    field.addEventListener('keydown', (e) => {
      if (e.key !== KEY.Escape) return;
      field.value = formatClock(ctx.world.scene.animation.duration);
      field.blur();
    });
    hintOn(ctx, field, { title: 'Scene length', text: 'Type 30 or 1:30, then Enter' });
    this.frames = el('span', { cls: 'tl-frame', title: 'Animation Setup: frame rate and looping' });
    this.frames.addEventListener('click', () => ctx.dispatch(Action.AnimationSetup));
    hintOn(ctx, this.frames, { title: 'Animation Setup', text: 'Click: frame rate, looping' });
    this.el = el('div', { cls: 'tl-clock' }, [
      el('div', { cls: 'tl-clock-row' }, [this.now, el('span', { cls: 'tl-of', text: '/' }), field]),
      this.frames,
    ]);
  }

  show(t: number, a: Animation): void {
    this.now.textContent = formatClock(t);
    this.total.set(a.duration);
    this.frames.textContent = `frame ${Math.round(t * a.fps)} / ${Math.round(a.duration * a.fps)} · ${a.fps} fps`;
  }
}

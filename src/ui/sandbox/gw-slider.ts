import { NumberField } from '../kit/controls';
import { el } from '../kit/dom';

/**
 * READ ME — Garry's Mod's DNumSlider for the tool panels: a label, a track
 * with a notch, and the value in a box. It works with the spawn menu's own
 * cursor (the pointer locked: a click on the track sets the value there, the
 * − and + boxes step it) and with the real mouse when the context menu has
 * freed the pointer (drag along the track, type in the box).
 */

export interface SliderOptions {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Decimals shown in the box. */
  readonly digits: number;
  readonly value: number;
  readonly onChange: (v: number) => void;
}

/** The class the menus' own cursor picks (spawn-menu.ts). */
const PICK = 'sbx-pick';
const FULL = 100;

export class GwSlider {
  readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly box: NumberField;
  private value: number;

  constructor(private readonly o: SliderOptions) {
    this.value = o.value;
    this.fill = el('div', { cls: 'gw-slider-fill' });
    const track = el('div', { cls: `gw-slider-track ${PICK}`, attrs: { role: 'slider', 'aria-label': o.label } }, [this.fill]);
    this.box = new NumberField({ value: o.value, digits: o.digits, cls: 'gw-slider-box', onCommit: (v) => this.commit(v) });
    const less = el('div', { cls: `gw-slider-step ${PICK}`, text: '−', title: `Less (${o.step})` });
    const more = el('div', { cls: `gw-slider-step ${PICK}`, text: '+', title: `More (${o.step})` });
    less.addEventListener('click', () => this.commit(this.value - o.step));
    more.addEventListener('click', () => this.commit(this.value + o.step));
    // A click (the own cursor's or the mouse's) sets the value where it lands; the real mouse can drag on.
    const at = (clientX: number) => {
      const r = track.getBoundingClientRect();
      this.commit(o.min + ((clientX - r.left) / Math.max(1, r.width)) * (o.max - o.min));
    };
    track.addEventListener('click', (e) => at(e.clientX));
    track.addEventListener('pointerdown', (e) => {
      if (!e.isTrusted) return;
      track.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => at(m.clientX);
      const up = () => {
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
    });
    this.el = el('div', { cls: 'gw-slider' }, [
      el('div', { cls: 'gw-slider-label', text: o.label }),
      el('div', { cls: 'gw-slider-row' }, [less, track, more, this.box.el]),
    ]);
    this.show();
  }

  set(v: number): void {
    this.value = v;
    this.show();
  }

  private commit(raw: number): void {
    const { min, max, step } = this.o;
    const v = Math.min(max, Math.max(min, Math.round(raw / step) * step));
    this.value = Number(v.toFixed(this.o.digits));
    this.show();
    this.o.onChange(this.value);
  }

  private show(): void {
    const { min, max } = this.o;
    this.fill.style.width = `${((this.value - min) / (max - min || 1)) * FULL}%`;
    this.box.set(this.value);
  }
}

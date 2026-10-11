import type { Animation } from '../../model/scene.types';
import { ANIMATION_LIMITS } from '../../world/scene.validate';
import { NumberField, Select, Toggle } from '../kit/controls';
import { Dialog, DialogStyle } from '../kit/dialog';
import { el } from '../kit/dom';

const FRAME_RATES = [8, 12, 15, 24, 30] as const;

export interface TimelineSetup {
  readonly duration: number;
  readonly fps: number;
  readonly loop: boolean;
}

/** Animation Setup, after Bryce 3D: length of the timeline, frames per second, looping. */
export function openAnimationSetup(a: Animation, onApply: (s: TimelineSetup) => void): void {
  let setup: TimelineSetup = { duration: a.duration, fps: a.fps, loop: a.loop };
  const frames = el('span', { cls: 'props-label' });
  const show = () => { frames.textContent = `${Math.round(setup.duration * setup.fps)} frames`; };
  const limit = ANIMATION_LIMITS.duration;
  const duration = new NumberField({
    value: setup.duration, digits: 1,
    onCommit: (v) => { setup = { ...setup, duration: Math.min(limit.max, Math.max(limit.min, v)) }; show(); },
  });
  const rates = FRAME_RATES.includes(setup.fps as (typeof FRAME_RATES)[number]) ? FRAME_RATES : [...FRAME_RATES, setup.fps].sort((x, y) => x - y);
  const fps = new Select<number>({
    items: rates.map((r) => ({ value: r, label: `${r} frames / second` })),
    value: setup.fps,
    onChange: (r) => { setup = { ...setup, fps: r }; show(); },
  });
  const loop = new Toggle({ label: 'Loop playback', value: setup.loop, onChange: (v) => { setup = { ...setup, loop: v }; } });
  show();
  const body = el('div', { cls: 'form-grid', style: { gridTemplateColumns: '90px 170px' } }, [
    el('span', { text: 'Duration (s)' }), duration.el,
    el('span', { text: 'Frame rate' }), fps.el,
    el('span'), frames,
    el('span'), loop.el,
  ]);
  new Dialog({ title: 'Animation Setup', style: DialogStyle.Stone, body, onOk: () => onApply(setup), onCancel: () => undefined }).open();
}

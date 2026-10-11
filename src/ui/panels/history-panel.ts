import { Action } from '../../input/actions';
import type { UiContext } from '../context';
import { Button } from '../kit/controls';
import { clearChildren, el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { panelTitle } from './panel-title';

/**
 * Undo history (modern addition) as a timeline: one notch per step on a rail,
 * a handle at the current step, pale notches for undone steps. Click or drag
 * along the rail to travel through history; point at it to read a step in the
 * hint area. Undo and redo sit at the rail's ends.
 */

type Mark = readonly string[];

/** First matching word of a history label picks its mark. */
const MARKS: readonly (readonly [RegExp, Mark])[] = [
  [/^(Open|New scene|Surprise|Test stage)/, GLYPH.open],
  [/^Create|^Paste$|^Duplicate|^Multi-Replicate/, GLYPH.plus],
  [/^(Clear all keys|Remove key)/, GLYPH.keyRemove],
  [/^(Key|Retime key|Move key|Animation)/, GLYPH.key],
  [/^(Clear|Cut)$/, GLYPH.cross],
  [/^Rotate/, GLYPH.rotate],
  [/^(Resize|Size)/, GLYPH.resize],
  [/^(Move|Offset|Reposition|Align|Land|Randomize|Attributes)/, GLYPH.move],
  [/^(Material|Paste material|Materials Lab)/, GLYPH.ball],
  [/^(Sky|Sun|Fog|Haze|Cloud|Shadows|Stars)/, GLYPH.sun],
  [/^(Camera|Zoom|Frame|Reset camera)/, GLYPH.camera],
  [/^(Group|Ungroup|Boolean)/, GLYPH.group],
  [/^(Rename|Hide|Show|Lock|Unlock)/, GLYPH.live],
  [/^Edit terrain/, GLYPH.cube],
];

export const markOf = (label: string): Mark => MARKS.find(([re]) => re.test(label))?.[1] ?? GLYPH.dot;

/** Closest notches the rail draws, CSS pixels; denser histories draw every n-th notch. */
export const MIN_NOTCH_GAP = 4;
const PERCENT = 100;

/** Where step `i` of `count` sits along the rail, 0…1 (a lone step sits in the middle). */
export function notchAt(i: number, count: number): number {
  return count > 1 ? i / (count - 1) : 0.5;
}

/** The step nearest to a point `fraction` (0…1) along the rail. */
export function stepAt(fraction: number, count: number): number {
  if (count <= 1) return 0;
  return Math.round(Math.min(1, Math.max(0, fraction)) * (count - 1));
}

/** Draw every n-th notch so neighbours stay `MIN_NOTCH_GAP` apart on a rail `width` pixels long. */
export function notchStride(count: number, width: number): number {
  if (count <= 1 || width <= 0) return 1;
  return Math.max(1, Math.ceil((MIN_NOTCH_GAP * (count - 1)) / width));
}

/** Which steps get a notch: every `stride`-th one plus the last, so both ends always show. */
export function notchSteps(count: number, stride: number): number[] {
  const steps: number[] = [];
  for (let i = 0; i < count; i += stride) steps.push(i);
  if (count > 0 && steps[steps.length - 1] !== count - 1) steps.push(count - 1);
  return steps;
}

export class HistoryPanel {
  readonly el: HTMLElement;
  private readonly rail: HTMLElement;
  /** The inset band the steps spread over; the rail around it is the hit area. */
  private readonly track: HTMLElement;
  private readonly notches: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly handle: HTMLElement;
  private readonly label: HTMLElement;
  private readonly count: HTMLElement;
  private readonly undo: Button;
  private readonly redo: Button;
  private labels: readonly string[] = [];
  private position = 0;
  private drawn = '';

  constructor(private readonly ctx: UiContext) {
    this.notches = el('div', { cls: 'history-notches' });
    this.fill = el('div', { cls: 'history-fill' });
    this.handle = el('div', { cls: 'history-handle' });
    this.track = el('div', { cls: 'history-track' }, [this.fill, this.notches, this.handle]);
    this.rail = el('div', { cls: 'history-rail' }, [this.track]);
    this.undo = new Button({ cls: 'mark-chip', title: 'Undo', content: glyph(GLYPH.undo, GLYPH_BOX), onClick: () => ctx.dispatch(Action.Undo) });
    this.redo = new Button({ cls: 'mark-chip', title: 'Redo', content: glyph(GLYPH.redo, GLYPH_BOX), onClick: () => ctx.dispatch(Action.Redo) });
    this.label = el('span', { cls: 'history-label' });
    this.count = el('span', { cls: 'history-count' });
    this.el = el('div', { cls: 'panel' }, [
      panelTitle('History', GLYPH.undo),
      el('div', { cls: 'panel-body' }, [
        el('div', { cls: 'history-strip' }, [this.undo.el, this.rail, this.redo.el]),
        el('div', { cls: 'history-caption' }, [this.label, this.count]),
      ]),
    ]);
    this.listen();
    ctx.world.events.on('history', ({ labels, position }) => this.render(labels, position));
    // The rail's width decides how many notches fit.
    new ResizeObserver(() => this.render(this.labels, this.position)).observe(this.rail);
    const h = ctx.world.historyState();
    this.render(h.labels, h.position);
  }

  /** Click or drag along the rail jumps through history; hovering names the step under the pointer. */
  private listen(): void {
    const world = this.ctx.world;
    let dragging = false;
    const jump = (e: PointerEvent) => {
      const i = this.stepUnder(e);
      if (i !== this.position) world.jumpTo(i);
    };
    this.rail.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.labels.length < 2) return;
      e.preventDefault();
      this.rail.setPointerCapture(e.pointerId);
      dragging = true;
      jump(e);
    });
    this.rail.addEventListener('pointermove', (e) => {
      if (dragging) jump(e);
      this.hintStep(this.stepUnder(e));
    });
    const stop = () => {
      dragging = false;
    };
    this.rail.addEventListener('pointerup', stop);
    this.rail.addEventListener('pointercancel', stop);
    this.rail.addEventListener('lostpointercapture', stop);
    this.rail.addEventListener('pointerleave', () => {
      if (!dragging) this.ctx.editor.setHint({ title: 'Ready', text: '' });
    });
  }

  private stepUnder(e: PointerEvent): number {
    const r = this.track.getBoundingClientRect();
    return stepAt(r.width > 0 ? (e.clientX - r.left) / r.width : 0, this.labels.length);
  }

  private hintStep(i: number): void {
    const label = this.labels[i];
    if (label === undefined) return;
    this.ctx.editor.setHint({ title: label, text: `Step ${i + 1} of ${this.labels.length}. Click or drag to go there` });
  }

  private render(labels: readonly string[], position: number): void {
    this.labels = labels;
    this.position = position;
    const total = labels.length;
    const width = this.track.clientWidth;
    const stride = notchStride(total, width);
    // Rebuild the notches only when the step count or the spacing changed.
    const key = `${total}:${stride}`;
    if (key !== this.drawn) {
      this.drawn = key;
      clearChildren(this.notches);
      for (const i of notchSteps(total, stride)) {
        this.notches.append(el('span', { cls: 'history-notch', attrs: { 'data-step': String(i) }, style: { left: `${notchAt(i, total) * PERCENT}%` } }));
      }
    }
    for (const n of this.notches.children) n.classList.toggle('is-future', Number((n as HTMLElement).dataset.step) > position);
    const at = `${notchAt(position, total) * PERCENT}%`;
    this.handle.style.left = at;
    this.fill.style.width = at;
    this.handle.replaceChildren(glyph(markOf(labels[position] ?? ''), GLYPH_BOX));
    this.label.textContent = labels[position] ?? '';
    this.count.textContent = `${position + 1} / ${total}`;
    this.undo.disabled = !this.ctx.isEnabled(Action.Undo);
    this.redo.disabled = !this.ctx.isEnabled(Action.Redo);
  }
}

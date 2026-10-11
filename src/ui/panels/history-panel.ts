import type { UiContext } from '../context';
import { clearChildren, el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { panelTitle } from './panel-title';

/**
 * Undo history (modern addition) as a trail of pebbles, one per step, each with
 * the mark of what was done. The lit pebble is where you are; pale ones are
 * undone steps. Point at a pebble to read it in the hint area, click to go there.
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

export class HistoryPanel {
  readonly el: HTMLElement;
  private readonly trail: HTMLElement;
  private readonly caption: HTMLElement;

  constructor(private readonly ctx: UiContext) {
    this.trail = el('div', { cls: 'pebbles' });
    this.caption = el('div', { cls: 'pebble-caption' });
    this.el = el('div', { cls: 'panel' }, [panelTitle('History', GLYPH.undo), el('div', { cls: 'panel-body' }, [this.trail, this.caption])]);
    ctx.world.events.on('history', ({ labels, position }) => this.render(labels, position));
    const h = ctx.world.historyState();
    this.render(h.labels, h.position);
  }

  private render(labels: readonly string[], position: number): void {
    clearChildren(this.trail);
    labels.forEach((label, i) => {
      const state = i === position ? ' is-current' : i > position ? ' is-future' : '';
      const pebble = el('button', { cls: `pebble${state}`, attrs: { type: 'button', 'aria-label': `${i + 1}. ${label}` } }, [glyph(markOf(label), GLYPH_BOX)]);
      pebble.addEventListener('click', () => this.ctx.world.jumpTo(i));
      pebble.addEventListener('pointerenter', () => this.ctx.editor.setHint({ title: label, text: `Step ${i + 1} of ${labels.length}. Click to go back here` }));
      pebble.addEventListener('pointerleave', () => this.ctx.editor.setHint({ title: 'Ready', text: '' }));
      this.trail.append(pebble);
    });
    this.caption.textContent = `${position + 1} / ${labels.length} · ${labels[position]}`;
    this.trail.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
}

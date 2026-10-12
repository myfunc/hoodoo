import type { UiContext } from '../context';
import { Button } from '../kit/controls';
import { clearChildren, el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { formatClock } from './timeline-time';
import { keyedHere, selectRow, toggleKeyHere } from './timeline-edits';
import { type LedgerRow, RowKind, isRowSelected } from './timeline-rows';
import { type LedgerState, LedgerTip } from './timeline-state';

/** Pixels each level of a group indents its rows. */
const INDENT_PX = 12;
const ROW_GLYPH: Readonly<Record<RowKind, readonly string[] | null>> = {
  [RowKind.Camera]: GLYPH.camera,
  [RowKind.Sun]: GLYPH.sun,
  [RowKind.Group]: GLYPH.group,
  [RowKind.Object]: null,
};

interface NameRow {
  /** The latest copy of the row: rows are built again whenever keys change, the plates only when the list does. */
  row: LedgerRow;
  readonly node: HTMLElement;
  readonly key: Button;
}

/**
 * The left column of the ledger: one name plate per row, groups with a fold
 * triangle and what they hold indented under them, and on every row the Key here
 * diamond, filled while the row has a key at the playhead. A click selects the
 * row's item in the scene (Shift adds or takes it away). The column scrolls; the
 * sheet beside it follows.
 */
export class LedgerNames {
  readonly el: HTMLElement;
  private shown: NameRow[] = [];
  private rows: readonly LedgerRow[] | null = null;
  private signature = '';

  constructor(private readonly ctx: UiContext, private readonly state: LedgerState, private readonly tip: LedgerTip, private readonly changed: () => void) {
    this.el = el('div', { cls: 'tl-names' });
    this.el.addEventListener('scroll', changed);
  }

  /** Builds the plates when the rows change, then marks the selected and the keyed ones. */
  update(): void {
    const rows = this.state.rows;
    // The same rows (most frames, the playhead moving): the plates stay.
    const signature = rows === this.rows ? this.signature : rows.map((r) => `${r.id}|${r.name}|${r.depth}|${r.parent}|${r.folded}`).join('\n');
    this.rows = rows;
    if (signature !== this.signature) {
      this.signature = signature;
      clearChildren(this.el);
      this.shown = rows.map((r) => this.plate(r));
      this.el.append(...this.shown.map((n) => n.node));
      if (!rows.length) this.el.append(el('div', { cls: 'tl-names-empty', text: 'Nothing selected' }));
    } else this.shown.forEach((n, i) => { n.row = rows[i]; });
    const w = this.ctx.world;
    let first: HTMLElement | null = null;
    for (const n of this.shown) {
      const selected = isRowSelected(n.row, w.selection, w.rig);
      // A row selected now (in the scene or the scene list) is scrolled into view.
      if (selected && !n.node.classList.contains('is-selected')) first ??= n.node;
      n.node.classList.toggle('is-selected', selected);
      n.key.active = keyedHere(this.ctx, n.row);
    }
    if (first && (first.offsetTop < this.el.scrollTop || first.offsetTop + first.offsetHeight > this.el.scrollTop + this.el.clientHeight)) {
      this.el.scrollTop = first.offsetTop - (this.el.clientHeight - first.offsetHeight) / 2;
    }
  }

  private plate(first: LedgerRow): NameRow {
    const mark = ROW_GLYPH[first.kind];
    const icon = mark ? glyph(mark, GLYPH_BOX, 'glyph tl-name-glyph') : el('span', { cls: 'tl-name-ball' });
    const twisty = first.parent ? glyph(first.folded ? GLYPH.triangleRight : GLYPH.triangleDown, GLYPH_BOX, 'glyph tl-twisty') : el('span', { cls: 'tl-twisty' });
    // The handlers read n.row, so they act on the row as it is now.
    const key = new Button({ cls: 'tl-key-here', content: glyph(GLYPH.key, GLYPH_BOX), onClick: (e) => {
      e.stopPropagation();
      toggleKeyHere(this.ctx, n.row);
    } });
    const node = el('div', { cls: `tl-name kind-${first.kind}` }, [twisty as unknown as HTMLElement, icon as unknown as HTMLElement, el('span', { cls: 'tl-name-text', text: first.name }), key.el]);
    const n: NameRow = { row: first, node, key };
    node.style.paddingLeft = `${first.depth * INDENT_PX}px`;
    node.addEventListener('click', (e) => selectRow(this.ctx, n.row, e.shiftKey || e.metaKey || e.ctrlKey));
    if (first.parent) {
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        const folded = this.state.folded;
        if (folded.has(n.row.id)) folded.delete(n.row.id);
        else folded.add(n.row.id);
        this.state.invalidate();
        this.changed();
      });
    }
    node.addEventListener('pointerenter', () => this.ctx.editor.setHint({ title: n.row.name, text: 'Click to select it' }));
    key.el.addEventListener('pointerenter', (e) => {
      const at = formatClock(this.ctx.world.time);
      const keyed = keyedHere(this.ctx, n.row);
      this.tip.show(keyed ? `Remove ${n.row.name}'s key at ${at}` : `Key ${n.row.name} at the playhead`, e.clientX, e.clientY);
      this.ctx.editor.setHint({ title: 'Key here', text: keyed ? `Removes the key at ${at}` : `Keys it at ${at}` });
    });
    key.el.addEventListener('pointerleave', () => this.tip.hide());
    return n;
  }
}

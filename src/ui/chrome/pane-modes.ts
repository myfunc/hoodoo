import type { ViewKind } from '../../model/scene.enums';
import type { ViewCell } from '../../render/viewport';
import { PaneMode, paneMode } from '../../world/editor-store';
import { type UiContext, hintOn } from '../context';
import { Choice } from '../kit/controls';
import { el } from '../kit/dom';

/** Gap between a pane's top-right corner and its selector, CSS pixels. */
const INSET = 4;

const MODES = [
  { value: PaneMode.Wire, label: 'Wire', title: 'Wireframe only' },
  { value: PaneMode.Render, label: 'Render', title: 'Live ray-traced picture under the wires' },
] as const;

const HINT = { title: 'Pane mode', text: 'Wireframe or live render for this pane' };

/**
 * Four Views: a Wire | Render selector in the top-right corner of every pane.
 * The choice lives in the editor store for the session; the scene window does the rest.
 */
export class PaneModes {
  readonly el: HTMLElement;
  private readonly selectors = new Map<ViewKind, { node: HTMLElement; choice: Choice<PaneMode> }>();

  constructor(private readonly ctx: UiContext) {
    this.el = el('div', { cls: 'pane-modes' });
    ctx.view.events.on('layout', ({ cells }) => this.place(cells));
    ctx.editor.events.on('changed', ({ state, previous }) => {
      if (state.quad !== previous.quad) this.el.hidden = !state.quad;
      if (state.quadModes === previous.quadModes) return;
      for (const [kind, s] of this.selectors) s.choice.set(paneMode(state, kind));
    });
    this.el.hidden = !ctx.editor.state.quad;
    this.place(ctx.view.cells);
  }

  private place(cells: readonly ViewCell[]): void {
    if (!this.ctx.editor.state.quad) return;
    for (const cell of cells) {
      const s = this.selectors.get(cell.kind) ?? this.create(cell.kind);
      s.node.style.left = `${cell.rect.x + cell.rect.w - INSET}px`;
      s.node.style.top = `${cell.rect.y + INSET}px`;
    }
  }

  private create(kind: ViewKind): { node: HTMLElement; choice: Choice<PaneMode> } {
    const editor = this.ctx.editor;
    const choice = new Choice<PaneMode>({
      items: MODES,
      value: paneMode(editor.state, kind),
      cls: 'pane-mode',
      onChange: (mode) => editor.update({ quadModes: { ...editor.state.quadModes, [kind]: mode } }),
    });
    // Clicks here must not reach the scene window (it would select or deselect).
    choice.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    choice.el.addEventListener('dblclick', (e) => e.stopPropagation());
    hintOn(this.ctx, choice.el, HINT);
    const s = { node: choice.el, choice };
    this.selectors.set(kind, s);
    this.el.append(choice.el);
    return s;
  }
}

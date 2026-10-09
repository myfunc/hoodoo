import { ViewKind } from '../../model/scene.enums';
import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { RenderProgress } from '../../render/gpu/progressive';
import type { RealtimeStatus } from '../../render/gpu/realtime';
import { RENDER_SAMPLE_CHOICES } from '../../world/editor-store';
import type { UiContext } from '../context';
import { Button, Select } from '../kit/controls';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { VIEW_NAMES } from '../strings';

const MS_PER_S = 1000;
const PERCENT = 100;
const VIEW_ACTIONS: Readonly<Record<ViewKind, Action>> = {
  [ViewKind.Camera]: Action.ViewCamera,
  [ViewKind.Top]: Action.ViewTop,
  [ViewKind.Front]: Action.ViewFront,
  [ViewKind.Side]: Action.ViewSide,
  [ViewKind.Director]: Action.ViewDirector,
};

interface ToggleButton {
  readonly action: Action;
  readonly button: Button;
}

/** Bottom strip under the scene window: view, display toggles and render status. */
export class DisplayBar {
  readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly toggles: ToggleButton[] = [];
  private readonly viewSelect: Select<ViewKind>;
  private readonly undo: Button;
  private readonly redo: Button;

  constructor(private readonly ctx: UiContext) {
    this.viewSelect = new Select<ViewKind>({
      items: ([ViewKind.Camera, ViewKind.Director, ViewKind.Top, ViewKind.Front, ViewKind.Side] as const).map((k) => ({ value: k, label: VIEW_NAMES[k] })),
      value: ctx.editor.state.view,
      title: 'View',
      onChange: (k) => ctx.dispatch(VIEW_ACTIONS[k]),
    });
    const samples = new Select<number>({
      items: RENDER_SAMPLE_CHOICES.map((n) => ({ value: n, label: n === 1 ? 'No anti-aliasing' : `${n} rays / pixel` })),
      value: ctx.editor.state.renderSamples,
      title: 'Anti-aliasing quality of Render',
      onChange: (n) => ctx.editor.update({ renderSamples: n }),
    });
    this.undo = new Button({ cls: 'ghost', title: `Undo (${shortcutOf(Action.Undo)})`, content: glyph(GLYPH.undo, GLYPH_BOX), onClick: () => ctx.dispatch(Action.Undo) });
    this.redo = new Button({ cls: 'ghost', title: `Redo (${shortcutOf(Action.Redo)})`, content: glyph(GLYPH.redo, GLYPH_BOX), onClick: () => ctx.dispatch(Action.Redo) });
    this.status = el('span', { cls: 'status' });
    this.el = el('div', { cls: 'display-bar' }, [
      this.undo.el,
      this.redo.el,
      el('div', { cls: 'sep' }),
      this.viewSelect.el,
      this.toggle('Quad', Action.QuadView),
      el('div', { cls: 'sep' }),
      this.toggle('Live', Action.ToggleLiveRender),
      samples.el,
      el('div', { cls: 'sep' }),
      this.toggle('Grid', Action.ToggleGrid),
      this.toggle('D-Cue', Action.ToggleDepthCue),
      this.toggle('Handles', Action.ToggleGizmo),
      this.toggle('Snap', Action.ToggleSnap),
      el('div', { cls: 'sep' }),
      new Button({ cls: 'ghost', title: 'Zoom out', content: glyph(GLYPH.minus, GLYPH_BOX), onClick: () => ctx.dispatch(Action.ZoomOut) }).el,
      new Button({ cls: 'ghost', title: 'Zoom in', content: glyph(GLYPH.plus, GLYPH_BOX), onClick: () => ctx.dispatch(Action.ZoomIn) }).el,
      new Button({ label: 'Frame', cls: 'ghost', title: `Frame selection (${shortcutOf(Action.FrameSelected)})`, onClick: () => ctx.dispatch(Action.FrameSelected) }).el,
      el('div', { cls: 'grow' }),
      this.status,
      this.toggle('Panel', Action.ToggleSidePanel),
    ]);
    ctx.editor.events.on('changed', ({ state }) => {
      this.viewSelect.set(state.view);
      samples.set(state.renderSamples);
      this.sync();
    });
    ctx.world.events.on('history', () => this.sync());
    this.sync();
    this.idleStatus();
  }

  set live(s: RealtimeStatus) {
    this.status.textContent = s.moving
      ? `Live · ${s.fps} fps · ${Math.round(s.scale * PERCENT)}% res`
      : s.samples >= s.target
        ? `Live · converged ${s.samples} rays/px`
        : `Live · refining ${s.samples}/${s.target}`;
  }

  set progress(p: RenderProgress) {
    if (p.preparing) {
      this.status.textContent = 'Preparing the ray tracer…';
      return;
    }
    if (p.active) {
      this.status.textContent = p.block > 1 ? `Rendering ${p.block}×${p.block} blocks · ${Math.round(p.fraction * PERCENT)}%` : `Anti-aliasing ${p.sample}/${p.samples} · ${Math.round(p.fraction * PERCENT)}%`;
    } else if (p.elapsedMs > 0) {
      this.status.textContent = `Rendered in ${(p.elapsedMs / MS_PER_S).toFixed(2)} s`;
    } else this.idleStatus();
  }

  private idleStatus(): void {
    const d = this.ctx.world.scene.document;
    this.status.textContent = `${d.width} × ${d.height}`;
  }

  private toggle(label: string, action: Action): HTMLElement {
    const button = new Button({ label, cls: 'ghost', title: `${label} (${shortcutOf(action) || 'menu'})`, onClick: () => this.ctx.dispatch(action) });
    this.toggles.push({ action, button });
    return button.el;
  }

  private sync(): void {
    for (const t of this.toggles) t.button.active = this.ctx.isChecked(t.action);
    this.undo.disabled = !this.ctx.world.canUndo();
    this.redo.disabled = !this.ctx.world.canRedo();
  }
}

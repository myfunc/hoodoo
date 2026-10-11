import { ViewKind } from '../../model/scene.enums';
import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { RenderProgress } from '../../render/gpu/progressive';
import type { RealtimeStatus } from '../../render/gpu/realtime';
import { RENDER_SAMPLE_CHOICES } from '../../world/editor-store';
import { type UiContext, hintOn } from '../context';
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

/** What each display toggle shows: its mark and the hint. */
const TOGGLES: Partial<Record<Action, { mark: readonly string[]; title: string; text: string }>> = {
  [Action.QuadView]: { mark: GLYPH.quad, title: 'Four Views', text: 'Top, Camera, Front and Side at once' },
  [Action.ToggleLiveRender]: { mark: GLYPH.live, title: 'Live Render', text: 'Keep ray-tracing while you edit (off: Bryce renders on request)' },
  [Action.ToggleGrid]: { mark: GLYPH.grid, title: 'Ground Grid', text: 'The pink grid on the ground plane' },
  [Action.ToggleDepthCue]: { mark: GLYPH.depthCue, title: 'Depth Cue', text: 'Far wireframes fade' },
  [Action.ToggleGizmo]: { mark: GLYPH.handles, title: 'Move Handles', text: 'Drag an axis arrow to move along it' },
  [Action.ToggleSnap]: { mark: GLYPH.snap, title: 'Snap to Grid', text: 'Moves land on the grid' },
  [Action.ToggleSidePanel]: { mark: GLYPH.panel, title: 'Scene Panel', text: 'Attributes, scene list, snapshots and history' },
};

/** Bottom strip under the scene window: view, display toggles (Bryce-style marks) and render status. */
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
      items: RENDER_SAMPLE_CHOICES.map((n) => ({ value: n, label: n === 1 ? 'No anti-aliasing' : `${n} rays/px` })),
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
      this.toggle(Action.QuadView),
      el('div', { cls: 'sep' }),
      this.toggle(Action.ToggleLiveRender),
      samples.el,
      el('div', { cls: 'sep' }),
      this.toggle(Action.ToggleGrid),
      this.toggle(Action.ToggleDepthCue),
      this.toggle(Action.ToggleGizmo),
      this.toggle(Action.ToggleSnap),
      el('div', { cls: 'sep' }),
      this.tool(Action.ZoomOut, GLYPH.minus, 'Zoom Out', 'Back away from the scene'),
      this.tool(Action.ZoomIn, GLYPH.plus, 'Zoom In', 'Move closer'),
      this.tool(Action.FrameSelected, GLYPH.frame, 'Frame Selection', 'Fit the selection in the view'),
      el('div', { cls: 'grow' }),
      this.status,
      this.toggle(Action.ToggleSidePanel),
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

  private toggle(action: Action): HTMLElement {
    const t = TOGGLES[action];
    const button = this.markButton(action, t?.mark ?? GLYPH.dot, t?.title ?? action, t?.text ?? '');
    this.toggles.push({ action, button });
    return button.el;
  }

  private tool(action: Action, mark: readonly string[], title: string, text: string): HTMLElement {
    return this.markButton(action, mark, title, text).el;
  }

  /** A stone chip with a mark; the hint area names it (no slow browser tooltip). */
  private markButton(action: Action, mark: readonly string[], title: string, text: string): Button {
    const key = shortcutOf(action);
    const button = new Button({ cls: 'mark-chip', content: glyph(mark, GLYPH_BOX), onClick: () => this.ctx.dispatch(action) });
    button.el.setAttribute('aria-label', key ? `${title} (${key})` : title);
    hintOn(this.ctx, button.el, { title, text: key ? `${text}. Shortcut ${key}` : text });
    return button;
  }

  private sync(): void {
    for (const t of this.toggles) t.button.active = this.ctx.isChecked(t.action);
    this.undo.disabled = !this.ctx.world.canUndo();
    this.redo.disabled = !this.ctx.world.canRedo();
  }
}

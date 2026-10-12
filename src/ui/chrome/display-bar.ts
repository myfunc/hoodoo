import { ViewKind } from '../../model/scene.enums';
import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { RenderProgress } from '../../render/gpu/progressive';
import type { RealtimeStatus } from '../../render/gpu/realtime';
import { type UiContext, hintOn } from '../context';
import { Button, Select } from '../kit/controls';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { VIEW_NAMES } from '../strings';
import { pictureLine } from './picture-readout';
import { showWhile } from '../feature-gate';
import { Feature } from '../../world/preview-features';
import '../labs/render-options.css';
import './display-bar.css';

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
  [Action.ToggleLeftPanel]: { mark: GLYPH.panel, title: 'Left Panel', text: 'Camera controls and the Render page' },
  [Action.ToggleGrid]: { mark: GLYPH.grid, title: 'Ground Grid', text: 'The pink grid on the ground plane' },
  [Action.ToggleDepthCue]: { mark: GLYPH.depthCue, title: 'Depth Cue', text: 'Far wireframes fade' },
  [Action.ToggleGizmo]: { mark: GLYPH.handles, title: 'Move Handles', text: 'Drag an axis arrow to move along it' },
  [Action.ToggleSnap]: { mark: GLYPH.snap, title: 'Snap to Grid', text: 'Moves land on the grid' },
  [Action.ToggleSidePanel]: { mark: GLYPH.panel, title: 'Scene Panel', text: 'Attributes, scene list, snapshots and history' },
  [Action.MaximizeView]: { mark: GLYPH.maximize, title: 'Maximize View', text: 'The scene window alone; again brings the panels back' },
  [Action.ToggleAnimation]: { mark: GLYPH.film, title: 'Animation', text: 'Timeline with keys, play, movies' },
  [Action.ToggleRenderView]: { mark: GLYPH.picture, title: 'Render View', text: 'The final render in the scene window, refining in place' },
};

/**
 * Bottom strip under the scene window: the panels' toggles at its ends, undo, the
 * view, display marks, zoom, the timeline, the status with Render View and the
 * Render page beside it, and Play on its own. How the picture renders lives on the
 * left panel's Render page (ui/labs/render-options.ts).
 */
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
    this.undo = new Button({ cls: 'ghost', title: `Undo (${shortcutOf(Action.Undo)})`, content: glyph(GLYPH.undo, GLYPH_BOX), onClick: () => ctx.dispatch(Action.Undo) });
    this.redo = new Button({ cls: 'ghost', title: `Redo (${shortcutOf(Action.Redo)})`, content: glyph(GLYPH.redo, GLYPH_BOX), onClick: () => ctx.dispatch(Action.Redo) });
    this.status = el('span', { cls: 'status' });
    const left = this.toggle(Action.ToggleLeftPanel);
    left.classList.add('is-mirrored');
    this.el = el('div', { cls: 'display-bar' }, [
      left,
      el('div', { cls: 'sep' }),
      this.undo.el,
      this.redo.el,
      el('div', { cls: 'sep' }),
      this.viewSelect.el,
      this.toggle(Action.QuadView),
      el('div', { cls: 'sep' }),
      this.toggle(Action.ToggleAnimation),
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
      // The picture's two switches by the status line that reports on it; view modes such as Play stay apart.
      el('div', { cls: 'sep' }),
      this.toggle(Action.ToggleRenderView),
      this.tool(Action.RenderOptions, GLYPH.sliders, 'Render Options', 'The Render page: live preview, quality, final render'),
      ...this.playGroup(),
      el('div', { cls: 'sep' }),
      this.toggle(Action.MaximizeView),
      this.toggle(Action.ToggleSidePanel),
    ]);
    ctx.editor.events.on('changed', ({ state }) => {
      this.viewSelect.set(state.view);
      this.sync();
    });
    ctx.world.events.on('history', () => this.sync());
    this.scrollSideways();
    this.sync();
    this.idleStatus();
  }

  /** A bar wider than its column scrolls: an up-down wheel moves it sideways too. */
  private scrollSideways(): void {
    this.el.addEventListener('wheel', (e) => {
      if (this.el.scrollWidth <= this.el.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      e.preventDefault();
      this.el.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  set live(s: RealtimeStatus) {
    this.status.textContent = pictureLine(s);
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

  /** Play (preview feature) on its own, apart from the editing marks: a named chip; hidden while the feature is off. */
  private playGroup(): HTMLElement[] {
    const action = Action.Play;
    const key = shortcutOf(action);
    const button = new Button({ cls: 'mark-chip text-chip play-chip', content: el('span', { cls: 'chip-inner' }, [glyph(GLYPH.walk, GLYPH_BOX), el('span', { text: 'Play' })]), onClick: () => this.ctx.dispatch(action) });
    button.el.setAttribute('aria-label', `Play (${key})`);
    hintOn(this.ctx, button.el, { title: 'Play', text: `Walk or fly the scene in first person. Shortcut ${key}` });
    this.toggles.push({ action, button });
    const sep = el('div', { cls: 'sep' });
    for (const node of [sep, button.el]) showWhile(this.ctx.editor, Feature.Play, node);
    return [sep, button.el];
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

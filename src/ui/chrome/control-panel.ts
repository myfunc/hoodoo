import { ViewKind } from '../../model/scene.enums';
import { Action } from '../../input/actions';
import { ControlIcon, controlIcon } from '../../render/icons';
import type { RenderProgress } from '../../render/gpu/progressive';
import { look, orbit, translateFlat, translateLocal } from '../../world/camera-math';
import type { Camera } from '../../model/scene.types';
import { ChangeKind } from '../../world/world.events';
import { type UiContext, hintOn } from '../context';
import { el, onDrag } from '../kit/dom';
import { openMenu } from '../kit/controls';
import { HINTS, VIEW_NAMES } from '../strings';
import { iconCanvas } from './icon-canvas';

const NANO_W = 88;
const NANO_H = 66;
const NANO_SAMPLES = 2;
const NANO_DEBOUNCE_MS = 260;
const MAX_DPR = 2;
const ORBIT_PER_PX = 0.5;
const MOVE_PER_PX = 0.05;
const LOOK_PER_PX = 0.25;
const MS_PER_S = 1000;
const PERCENT = 100;
const SIZES = { view: 70, cross: 48, trackball: 84, ball: 22, bigBall: 36 } as const;

type CamFn = (c: Camera, dx: number, dy: number) => Camera;

/**
 * The left column of Bryce 2: nano preview, view control, three camera crosses,
 * the big trackball, the render balls and the hint text.
 */
export class ControlPanel {
  readonly el: HTMLElement;
  private readonly nano: HTMLCanvasElement;
  private readonly hintTitle: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly viewLabel: HTMLElement;
  private nanoTimer = 0;

  constructor(private readonly ctx: UiContext) {
    this.nano = el('canvas');
    const nano = el('div', { cls: 'nano' }, [this.nano]);
    nano.addEventListener('click', () => ctx.dispatch(Action.Render));
    hintOn(ctx, nano, HINTS.nano);

    const view = this.icon(ControlIcon.View, 'view', SIZES.view);
    this.viewLabel = el('div', { cls: 'ctrl-label' });
    view.addEventListener('click', () => this.viewMenu(view));
    hintOn(ctx, view, HINTS.view);

    const crossXY = this.camDrag(ControlIcon.CrossXY, 'cross', SIZES.cross, (c, dx, dy) => translateLocal(c, dx * MOVE_PER_PX, -dy * MOVE_PER_PX, 0), 'Camera move', HINTS.crossXY);
    const crossXZ = this.camDrag(ControlIcon.CrossXZ, 'cross', SIZES.cross, (c, dx, dy) => translateFlat(c, dx * MOVE_PER_PX, -dy * MOVE_PER_PX), 'Camera move', HINTS.crossXZ);
    const crossYZ = this.camDrag(ControlIcon.CrossYZ, 'cross', SIZES.cross, (c, dx, dy) => translateLocal(c, 0, -dy * MOVE_PER_PX, dx * MOVE_PER_PX), 'Camera move', HINTS.crossYZ);
    const trackball = this.camDrag(ControlIcon.Trackball, 'trackball', SIZES.trackball, (c, dx, dy) => orbit(c, -dx * ORBIT_PER_PX, dy * ORBIT_PER_PX), 'Camera trackball', HINTS.trackball);
    trackball.addEventListener('contextmenu', (e) => e.preventDefault());
    trackball.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setCamera(look(this.camera(), -e.deltaX * LOOK_PER_PX, -e.deltaY * LOOK_PER_PX), 'Camera look');
    }, { passive: false });

    const render = this.icon(ControlIcon.Render, 'render-ball big', SIZES.bigBall);
    render.addEventListener('click', () => ctx.dispatch(Action.Render));
    hintOn(ctx, render, HINTS.render);
    const stop = this.icon(ControlIcon.Stop, 'render-ball', SIZES.ball);
    stop.addEventListener('click', () => ctx.dispatch(Action.StopRender));
    hintOn(ctx, stop, HINTS.stop);
    const clear = this.icon(ControlIcon.Clear, 'render-ball', SIZES.ball);
    clear.addEventListener('click', () => ctx.dispatch(Action.ClearRender));
    hintOn(ctx, clear, HINTS.clear);

    this.hintTitle = el('span', { cls: 'hint-title' });
    this.hintText = el('span', { cls: 'hint-text' });
    this.stats = el('div', { cls: 'stats' });
    this.el = el('aside', { cls: 'controls' }, [
      nano,
      view,
      this.viewLabel,
      el('div', { cls: 'ctrl-row' }, [crossXY, crossYZ]),
      crossXZ,
      trackball,
      el('div', { cls: 'ctrl-row balls' }, [stop, render, clear]),
      el('div', { cls: 'hint' }, [this.hintTitle, this.hintText]),
      this.stats,
    ]);
    ctx.editor.events.on('changed', ({ state }) => {
      this.hintTitle.textContent = state.hint.title;
      this.hintText.textContent = state.hint.text;
      this.viewLabel.textContent = VIEW_NAMES[state.view];
    });
    ctx.world.events.on('changed', ({ kind }) => {
      if (kind !== ChangeKind.Views) this.scheduleNano();
      this.updateStats();
    });
    ctx.world.events.on('selection', () => this.updateStats());
    this.viewLabel.textContent = VIEW_NAMES[ctx.editor.state.view];
    this.hintTitle.textContent = ctx.editor.state.hint.title;
    this.hintText.textContent = ctx.editor.state.hint.text;
    this.scheduleNano();
    this.updateStats();
  }

  set progress(p: RenderProgress) {
    if (p.preparing) {
      this.hintTitle.textContent = 'Rendering';
      this.hintText.textContent = 'Preparing the ray tracer (first start can take a while)…';
      return;
    }
    if (!p.active) {
      if (this.hintTitle.textContent === 'Rendering') {
        this.hintTitle.textContent = 'Done';
        this.hintText.textContent = `Rendered in ${(p.elapsedMs / MS_PER_S).toFixed(1)} s`;
      }
      return;
    }
    this.hintTitle.textContent = 'Rendering';
    this.hintText.textContent = p.block > 1
      ? `Pass ${p.block}×${p.block} — ${Math.round(p.fraction * PERCENT)}%`
      : `Anti-alias ${p.sample}/${p.samples} — ${(p.elapsedMs / MS_PER_S).toFixed(1)} s`;
  }

  private icon(kind: ControlIcon, cls: string, size: number): HTMLElement {
    const c = iconCanvas(this.ctx.thumbs, controlIcon(kind), size);
    c.className = `ctrl-icon ${cls}`;
    return c as unknown as HTMLElement;
  }

  private camera(): Camera {
    return this.ctx.editor.state.view === ViewKind.Director ? this.ctx.editor.state.director : this.ctx.world.scene.camera;
  }

  private setCamera(c: Camera, label: string): void {
    if (this.ctx.editor.state.view === ViewKind.Director) this.ctx.editor.update({ director: c });
    else this.ctx.world.setCamera(c, label);
  }

  private camDrag(kind: ControlIcon, cls: string, size: number, fn: CamFn, label: string, hint: { title: string; text: string }): HTMLElement {
    const node = this.icon(kind, cls, size);
    let start = this.camera();
    let lastX = 0;
    let lastY = 0;
    onDrag(node, {
      start: () => {
        start = this.camera();
        lastX = 0;
        lastY = 0;
        this.ctx.world.beginGesture(label);
      },
      move: (dx, dy) => {
        start = fn(start, dx - lastX, dy - lastY);
        lastX = dx;
        lastY = dy;
        this.setCamera(start, label);
      },
      end: () => this.ctx.world.endGesture(),
    });
    hintOn(this.ctx, node, hint);
    return node;
  }

  private viewMenu(anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const items = [
      { a: Action.ViewCamera, k: ViewKind.Camera },
      { a: Action.ViewDirector, k: ViewKind.Director },
      { a: Action.ViewTop, k: ViewKind.Top },
      { a: Action.ViewFront, k: ViewKind.Front },
      { a: Action.ViewSide, k: ViewKind.Side },
    ].map((it) => ({ label: VIEW_NAMES[it.k], checked: this.ctx.editor.state.view === it.k, run: () => this.ctx.dispatch(it.a) }));
    openMenu(r.right, r.top, [...items, { label: '', separator: true }, { label: 'Four Views', checked: this.ctx.editor.state.quad, run: () => this.ctx.dispatch(Action.QuadView) }]);
  }

  private scheduleNano(): void {
    window.clearTimeout(this.nanoTimer);
    this.nanoTimer = window.setTimeout(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.round(NANO_W * dpr);
      const h = Math.round(NANO_H * dpr);
      const scene = this.ctx.world.scene;
      this.ctx.thumbs.enqueue({
        scene, basis: this.ctx.view.basisFor(ViewKind.Camera, w / h), width: w, height: h,
        samples: NANO_SAMPLES, bounces: 2, transparent: false, into: this.nano,
      });
    }, NANO_DEBOUNCE_MS);
  }

  private updateStats(): void {
    const scene = this.ctx.world.scene;
    const n = scene.objects.length;
    const sel = this.ctx.world.selection.size;
    this.stats.textContent = `${n} object${n === 1 ? '' : 's'}${sel ? ` · ${sel} selected` : ''}`;
  }
}

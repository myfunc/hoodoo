import { Bus } from '../core/bus';
import { Logger } from '../core/log';
import { ViewKind } from '../model/scene.enums';
import type { ObjectId } from '../model/scene.ids';
import type { Scene } from '../model/scene.types';
import { type ViewBasis, cameraBasis, orthoBasis, pivotOf, project } from '../world/camera-math';
import type { EditorState, EditorStore } from '../world/editor-store';
import type { World } from '../world/world';
import { ChangeKind } from '../world/world.events';
import type { RayEngine } from './gpu/engine';
import { ProgressiveRenderer, type RenderProgress } from './gpu/progressive';
import { RealtimeRenderer, type RealtimeStatus } from './gpu/realtime';
import { FINAL_BOUNCES, PREVIEW_BOUNCES, PREVIEW_SAMPLES } from './gpu/render.constants';
import { type Frame, type GizmoHandles, type SegmentIndex, WireProjector, drawWireframe } from './wire/wireframe';

/** One drawable view inside the scene window (one in single view, four in quad view). */
export interface ViewCell {
  readonly kind: ViewKind;
  /** Cell rectangle in scene-window CSS pixels. */
  readonly rect: Frame;
  /** Projected picture area (document aspect) inside the cell. */
  readonly frame: Frame;
  readonly basis: ViewBasis;
  segments: SegmentIndex;
  gizmo: GizmoHandles | null;
}

export interface ViewportEvents {
  progress: RenderProgress;
  live: RealtimeStatus;
  layout: { readonly cells: readonly ViewCell[] };
}

const QUAD_KINDS: readonly ViewKind[] = [ViewKind.Top, ViewKind.Camera, ViewKind.Front, ViewKind.Side];
const CELL_MARGIN = 6;
const MAX_DPR = 2;
/** In live mode the Render button converges to this many times the chosen rays per pixel. */
const LIVE_FINAL_FACTOR = 4;
const LABEL_FONT = 'bold 10px Geneva, Verdana, sans-serif';
const LABEL_COLOR = 'rgba(40,40,40,0.75)';
const LABEL_OFFSET = 14;
/** Focus reticle drawn at the focus distance while the camera has depth of field. */
const FOCUS = { color: '#e08a1e', radius: 9, tick: 5, width: 1.5 } as const;
const VIEW_LABELS: Readonly<Record<ViewKind, string>> = {
  [ViewKind.Camera]: 'Camera',
  [ViewKind.Director]: "Director's View",
  [ViewKind.Top]: 'Top',
  [ViewKind.Front]: 'Front',
  [ViewKind.Side]: 'Side',
};

export interface Hover {
  readonly object: ObjectId | null;
  readonly gizmoAxis: number;
}

/**
 * READ ME — the scene window. Observes World and EditorStore; draws the
 * wireframe on a 2D canvas and shows the ray-traced picture on the GL canvas
 * under it. Classic Bryce: render on request, the picture stays under the
 * wires until cleared. Live mode re-renders after every change.
 */
export class SceneView {
  readonly events = new Bus<ViewportEvents>();
  readonly root: HTMLElement;
  private readonly logger = Logger.create('SceneView');
  private readonly wire: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly renderer: ProgressiveRenderer;
  private readonly realtime: RealtimeRenderer;
  private liveLoop = false;
  private awaitingEngine = false;
  private cellsCache: ViewCell[] = [];
  private drawQueued = false;
  private renderLoop = false;
  private hoverState: Hover = { object: null, gizmoAxis: -1 };
  private rendered = false;
  private pendingRender: boolean | null = null;
  private width = 0;
  private height = 0;

  constructor(
    private readonly world: World,
    private readonly editor: EditorStore,
    readonly engine: RayEngine,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'scene-window';
    engine.canvas.className = 'gl-view';
    this.wire = document.createElement('canvas');
    this.wire.className = 'wire-view';
    const g = this.wire.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    this.root.append(engine.canvas, this.wire);
    this.renderer = new ProgressiveRenderer(engine);
    this.realtime = new RealtimeRenderer(engine);
    this.realtime.target = editor.state.renderSamples;
    new ResizeObserver(() => this.resize()).observe(this.root);
    world.events.on('changed', ({ kind }) => this.onSceneChanged(kind));
    world.events.on('selection', () => this.requestDraw());
    editor.events.on('changed', ({ state, previous }) => this.onEditorChanged(state, previous));
  }

  get cells(): readonly ViewCell[] {
    return this.cellsCache;
  }

  get hasPicture(): boolean {
    return this.rendered;
  }

  get isRendering(): boolean {
    return this.renderer.active;
  }

  set hover(h: Hover) {
    if (h.object === this.hoverState.object && h.gizmoAxis === this.hoverState.gizmoAxis) return;
    this.hoverState = h;
    this.requestDraw();
  }

  /** The cell under a scene-window point. */
  cellAt(x: number, y: number): ViewCell | null {
    return this.cellsCache.find((c) => x >= c.rect.x && x < c.rect.x + c.rect.w && y >= c.rect.y && y < c.rect.y + c.rect.h) ?? null;
  }

  mainCell(): ViewCell | null {
    return this.cellsCache.find((c) => c.kind === this.editor.state.view) ?? this.cellsCache[0] ?? null;
  }

  basisFor(kind: ViewKind, aspect: number, scene: Scene = this.world.scene): ViewBasis {
    if (kind === ViewKind.Camera) return cameraBasis(scene.camera, aspect);
    if (kind === ViewKind.Director) return cameraBasis(this.editor.state.director, aspect);
    return orthoBasis(kind, scene.views[kind], aspect);
  }

  /** Bryce's Render button: progressive render of the current view (in live mode: converge further). */
  render(final = true): void {
    if (this.editor.state.liveRender && !this.editor.state.quad) {
      this.realtime.target = this.editor.state.renderSamples * LIVE_FINAL_FACTOR;
      this.updateLive();
      return;
    }
    const cell = this.mainCell();
    if (this.editor.state.quad) return;
    if (!cell || cell.frame.w < 2) {
      this.pendingRender = final;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const scale = dpr;
    const w = Math.max(1, Math.round(cell.frame.w * scale));
    const h = Math.max(1, Math.round(cell.frame.h * scale));
    this.renderer.resize(w, h);
    this.placeGlCanvas(cell.frame);
    const s = this.editor.state;
    this.renderer.start(this.world.scene, this.basisFor(cell.kind, w / h), {
      samples: final ? s.renderSamples : PREVIEW_SAMPLES,
      bounces: final ? FINAL_BOUNCES : PREVIEW_BOUNCES,
      blocks: true,
    });
    this.rendered = true;
    this.engine.canvas.style.visibility = 'visible';
    this.requestDraw();
    this.startLoop();
  }

  /**
   * A copy of the picture in the scene window (live or rendered), or null when there
   * is none. The GL canvas does not keep its buffer, so it is redrawn and copied in one task.
   */
  capture(): HTMLCanvasElement | null {
    const s = this.editor.state;
    if (!this.rendered || s.quad) return null;
    const live = s.liveRender;
    if (live ? !this.realtime.imageReady : !this.renderer.imageReady) return null;
    if (live) this.realtime.present();
    else this.renderer.present();
    const src = this.engine.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    out.getContext('2d')?.drawImage(src, 0, 0);
    return out;
  }

  /** The scene-window rectangle the picture occupies (CSS pixels), for overlays. */
  pictureFrame(): Frame | null {
    return this.mainCell()?.frame ?? null;
  }

  stopRender(): void {
    this.renderer.stop();
    this.events.emit('progress', this.renderer.progress());
  }

  clearRender(): void {
    this.renderer.stop();
    this.rendered = false;
    this.engine.canvas.style.visibility = 'hidden';
    this.events.emit('progress', this.renderer.progress());
    this.requestDraw();
  }

  requestDraw(): void {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.draw();
    });
  }

  private onSceneChanged(kind: ChangeKind): void {
    if (kind === ChangeKind.Views || kind === ChangeKind.Camera || kind === ChangeKind.Document || kind === ChangeKind.All) this.layout();
    this.requestDraw();
    this.updateLive();
  }

  private onEditorChanged(s: EditorState, prev: EditorState): void {
    if (s.view !== prev.view || s.quad !== prev.quad || s.director !== prev.director) {
      this.layout();
      if (s.view !== prev.view || s.quad !== prev.quad) this.clearRender();
    }
    if (s.liveRender !== prev.liveRender && !s.liveRender) this.clearRender();
    if (s.showRender !== prev.showRender && !s.showRender) this.clearRender();
    if (s.renderSamples !== prev.renderSamples) this.realtime.target = s.renderSamples;
    this.root.classList.toggle('quad', s.quad);
    this.root.classList.toggle('is-picking', s.pickingFocus);
    this.updateLive();
    this.requestDraw();
  }

  /** Live mode: hand the current scene and camera to the real-time renderer and keep its loop alive. */
  private updateLive(): void {
    const s = this.editor.state;
    const cell = this.mainCell();
    if (!s.liveRender || s.quad || !cell || cell.frame.w < 2) return;
    this.renderer.stop();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(cell.frame.w * dpr));
    const h = Math.max(1, Math.round(cell.frame.h * dpr));
    this.realtime.resize(w, h);
    this.placeGlCanvas(cell.frame);
    this.realtime.update(this.world.scene, this.basisFor(cell.kind, w / h));
    // Until the trace program is ready the full wireframe stays up; resume then instead of spinning frames.
    if (!this.engine.isReady) {
      if (!this.awaitingEngine) {
        this.awaitingEngine = true;
        // A failed compile is logged by the engine and shown by the loader card.
        this.engine.ready.then(() => this.updateLive(), () => undefined).finally(() => {
          this.awaitingEngine = false;
        });
      }
      return;
    }
    if (!this.rendered) {
      this.rendered = true;
      this.engine.canvas.style.visibility = 'visible';
      this.requestDraw();
    }
    if (this.liveLoop) return;
    this.liveLoop = true;
    const step = () => {
      const more = this.editor.state.liveRender && this.realtime.tick();
      this.events.emit('live', this.realtime.status());
      if (more) requestAnimationFrame(step);
      else this.liveLoop = false;
    };
    requestAnimationFrame(step);
  }

  private startLoop(): void {
    if (this.renderLoop) return;
    this.renderLoop = true;
    const step = () => {
      const more = this.renderer.tick(false);
      this.events.emit('progress', this.renderer.progress());
      if (more) requestAnimationFrame(step);
      else {
        this.renderLoop = false;
        this.logger.info('render finished', { ms: Math.round(this.renderer.progress().elapsedMs) });
      }
    };
    requestAnimationFrame(step);
  }

  private resize(): void {
    const r = this.root.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.wire.width = Math.round(r.width * dpr);
    this.wire.height = Math.round(r.height * dpr);
    this.layout();
    if (this.rendered && !this.renderer.active && !this.editor.state.liveRender) this.clearRender();
    this.draw();
    this.updateLive();
  }

  private layout(): void {
    const s = this.editor.state;
    const doc = this.world.scene.document;
    const aspect = doc.width / doc.height;
    const rects: { kind: ViewKind; rect: Frame }[] = s.quad
      ? QUAD_KINDS.map((kind, i) => ({
          kind,
          rect: { x: (i % 2) * (this.width / 2), y: Math.floor(i / 2) * (this.height / 2), w: this.width / 2, h: this.height / 2 },
        }))
      : [{ kind: s.view, rect: { x: 0, y: 0, w: this.width, h: this.height } }];
    this.cellsCache = rects.map(({ kind, rect }) => {
      const frame = fitFrame(rect, aspect);
      return { kind, rect, frame, basis: this.basisFor(kind, aspect), segments: new Map(), gizmo: null };
    });
    const main = this.mainCell();
    if (main && !this.renderer.active) this.placeGlCanvas(main.frame);
    this.events.emit('layout', { cells: this.cellsCache });
    if (this.pendingRender !== null && main && main.frame.w >= 2) {
      const final = this.pendingRender;
      this.pendingRender = null;
      requestAnimationFrame(() => this.render(final));
    }
  }

  private placeGlCanvas(f: Frame): void {
    const st = this.engine.canvas.style;
    st.left = `${f.x}px`;
    st.top = `${f.y}px`;
    st.width = `${f.w}px`;
    st.height = `${f.h}px`;
  }

  private draw(): void {
    const g = this.g;
    const dpr = this.wire.width / Math.max(this.width, 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.wire.width, this.wire.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = this.editor.state;
    const scene = this.world.scene;
    const aspect = scene.document.width / scene.document.height;
    for (const cell of this.cellsCache) {
      const basis = this.basisFor(cell.kind, aspect);
      Object.assign(cell, { basis });
      g.save();
      g.beginPath();
      g.rect(cell.rect.x, cell.rect.y, cell.rect.w, cell.rect.h);
      g.clip();
      const overRender = this.rendered && !s.quad;
      const out = drawWireframe(g, scene, new WireProjector(basis, cell.frame), {
        selection: this.world.selection,
        hover: this.hoverState.object,
        depthCue: s.depthCue,
        grid: s.grid && !overRender,
        gizmo: s.gizmo,
        gizmoHover: this.hoverState.gizmoAxis,
        shadeOutside: true,
        overRender,
      });
      cell.segments = out.segments;
      cell.gizmo = out.gizmo;
      this.drawFocus(cell, basis);
      g.font = LABEL_FONT;
      g.fillStyle = LABEL_COLOR;
      if (s.quad) g.fillText(VIEW_LABELS[cell.kind], cell.rect.x + CELL_MARGIN, cell.rect.y + LABEL_OFFSET);
      g.restore();
      if (s.quad) {
        g.strokeStyle = LABEL_COLOR;
        g.strokeRect(cell.rect.x + 0.5, cell.rect.y + 0.5, cell.rect.w - 1, cell.rect.h - 1);
      }
    }
  }

  /** Where the lens is sharp: a reticle at the camera's focus distance (pivot) when it has depth of field. */
  private drawFocus(cell: ViewCell, basis: ViewBasis): void {
    if (cell.kind !== ViewKind.Camera && cell.kind !== ViewKind.Director) return;
    const cam = cell.kind === ViewKind.Camera ? this.world.scene.camera : this.editor.state.director;
    if (cam.aperture <= 0) return;
    const p = project(basis, pivotOf(cam));
    if (p.depth <= 0) return;
    const x = cell.frame.x + ((p.x + 1) / 2) * cell.frame.w;
    const y = cell.frame.y + ((1 - p.y) / 2) * cell.frame.h;
    const g = this.g;
    g.save();
    g.strokeStyle = FOCUS.color;
    g.lineWidth = FOCUS.width;
    g.beginPath();
    g.arc(x, y, FOCUS.radius, 0, Math.PI * 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.moveTo(x + dx * FOCUS.radius, y + dy * FOCUS.radius);
      g.lineTo(x + dx * (FOCUS.radius + FOCUS.tick), y + dy * (FOCUS.radius + FOCUS.tick));
    }
    g.stroke();
    g.restore();
  }
}

/** Largest document-aspect rectangle centred in a cell, with a small margin. */
export function fitFrame(rect: Frame, aspect: number): Frame {
  const w0 = Math.max(rect.w - CELL_MARGIN * 2, 1);
  const h0 = Math.max(rect.h - CELL_MARGIN * 2, 1);
  const w = Math.min(w0, h0 * aspect);
  const h = w / aspect;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

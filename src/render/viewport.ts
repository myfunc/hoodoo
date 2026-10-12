import { Bus } from '../core/bus';
import { Logger } from '../core/log';
import { ViewKind } from '../model/scene.enums';
import type { ObjectId } from '../model/scene.ids';
import type { Scene } from '../model/scene.types';
import { type ViewBasis, cameraBasis, orthoBasis } from '../world/camera-math';
import { type EditorState, type EditorStore, PaneMode, paneMode } from '../world/editor-store';
import type { World } from '../world/world';
import { ChangeKind } from '../world/world.events';
import type { RayEngine } from './gpu/engine';
import { ProgressiveRenderer, type RenderProgress } from './gpu/progressive';
import { QuadLive } from './gpu/quad-live';
import { RealtimeRenderer, type RealtimeStatus } from './gpu/realtime';
import { FINAL_BOUNCES, PREVIEW_BOUNCES, PREVIEW_SAMPLES } from './gpu/render.constants';
import { type Frame, type GizmoHandles, type SegmentIndex, WireProjector, drawWireframe } from './wire/wireframe';
import { type KeyHandle, drawMotionPaths } from './wire/motion-paths';
import { type RigHandles, type RigPart, drawFocusReticle, drawRig } from './wire/rig-glyphs';
import type { KeyRef } from '../world/animation/key-selection';
import { rigFlags } from '../world/rig';
import { Rig } from '../world/world.enums';
import { type GizmoPart, samePart } from './wire/gizmo';

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
  /** Key squares of the motion paths drawn in this cell. */
  keys: readonly KeyHandle[];
  /** The camera's and the sun's glyphs drawn in this cell (rig-glyphs.ts). */
  rig: RigHandles | null;
}

export interface ViewportEvents {
  progress: RenderProgress;
  live: RealtimeStatus;
  layout: { readonly cells: readonly ViewCell[] };
}

const QUAD_KINDS: readonly ViewKind[] = [ViewKind.Top, ViewKind.Camera, ViewKind.Front, ViewKind.Side];
const CELL_MARGIN = 6;
const MAX_DPR = 2;
/** Four Views pictures get one pixel per CSS pixel: a quarter of the work on a retina screen. */
const QUAD_PIXEL_RATIO = 1;
/** In live mode the Render button converges to this many times the chosen rays per pixel. */
const LIVE_FINAL_FACTOR = 4;
const LABEL_FONT = 'bold 10px Geneva, Verdana, sans-serif';
const LABEL_COLOR = 'rgba(40,40,40,0.75)';
const LABEL_OFFSET = 14;
/** Over a rendered pane the view name sits on a pale tab so it stays readable. */
const LABEL_TAB = { color: 'rgba(236,235,231,0.85)', padX: 3, top: 3, height: 15 } as const;
const VIEW_LABELS: Readonly<Record<ViewKind, string>> = {
  [ViewKind.Camera]: 'Camera',
  [ViewKind.Director]: "Director's View",
  [ViewKind.Top]: 'Top',
  [ViewKind.Front]: 'Front',
  [ViewKind.Side]: 'Side',
};

export interface Hover {
  readonly object: ObjectId | null;
  /** The selection's handle under the pointer, and whether the pointer is near enough for the rings. */
  readonly gizmo: GizmoPart | null;
  readonly near: boolean;
  /** The motion-path key under the pointer, and whether a drag holds it. */
  readonly key?: KeyRef | null;
  readonly held?: boolean;
  /** The camera's or the sun's glyph part under the pointer or held. */
  readonly rig?: RigPart | null;
}

const sameHover = (a: Hover, b: Hover): boolean =>
  a.object === b.object && a.near === b.near && samePart(a.gizmo, b.gizmo) && a.rig === b.rig && !!a.held === !!b.held
  && a.key?.track === b.key?.track && a.key?.id === b.key?.id && a.key?.time === b.key?.time;

/**
 * READ ME — the scene window. Observes World and EditorStore; draws the
 * wireframe on a 2D canvas and shows the ray-traced picture on the GL canvas
 * under it. Classic Bryce: render on request, the picture stays under the
 * wires until cleared. Live mode re-renders after every change. In Four Views
 * each pane is Wire or Render; Render panes are always live (QuadLive).
 */
export class SceneView {
  readonly events = new Bus<ViewportEvents>();
  readonly root: HTMLElement;
  private readonly logger = Logger.create('SceneView');
  private readonly wire: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly renderer: ProgressiveRenderer;
  private readonly realtime: RealtimeRenderer;
  private readonly quadLive: QuadLive<ViewKind>;
  private liveLoop = false;
  private quadLoop = false;
  private awaitingEngine = false;
  private cellsCache: ViewCell[] = [];
  private drawQueued = false;
  private renderLoop = false;
  private hoverState: Hover = { object: null, gizmo: null, near: false };
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
    this.realtime.quality = editor.state.settings.liveQuality;
    this.quadLive = new QuadLive(engine);
    this.quadLive.target = editor.state.renderSamples;
    this.quadLive.quality = editor.state.settings.liveQuality;
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
    if (sameHover(h, this.hoverState)) return;
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
    const s = this.editor.state;
    if (s.quad || s.liveRender) {
      const target = s.renderSamples * LIVE_FINAL_FACTOR;
      if (s.quad) this.quadLive.target = target;
      else this.realtime.target = target;
      this.updateLive();
      return;
    }
    const cell = this.mainCell();
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
    if (s.quad !== prev.quad && !s.quad) {
      // The panes drew on the shared canvas: the single view starts its picture over.
      this.quadLive.release();
      this.realtime.reset();
    }
    if (s.liveRender !== prev.liveRender && !s.liveRender) this.clearRender();
    if (s.showRender !== prev.showRender && !s.showRender) this.clearRender();
    if (s.renderSamples !== prev.renderSamples) {
      this.realtime.target = s.renderSamples;
      this.quadLive.target = s.renderSamples;
    }
    if (s.settings.liveQuality !== prev.settings.liveQuality) {
      this.realtime.quality = s.settings.liveQuality;
      this.quadLive.quality = s.settings.liveQuality;
    }
    this.root.classList.toggle('quad', s.quad);
    this.root.classList.toggle('is-picking', s.pickingFocus);
    this.updateLive();
    this.requestDraw();
  }

  /** Live mode: hand the current scene and camera to the real-time renderer and keep its loop alive. */
  private updateLive(): void {
    const s = this.editor.state;
    if (s.quad) {
      this.updateQuad();
      return;
    }
    const cell = this.mainCell();
    if (!s.liveRender || !cell || cell.frame.w < 2) return;
    this.renderer.stop();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(cell.frame.w * dpr));
    const h = Math.max(1, Math.round(cell.frame.h * dpr));
    this.realtime.resize(w, h);
    this.placeGlCanvas(cell.frame);
    this.realtime.update(this.world.scene, this.basisFor(cell.kind, w / h));
    if (!this.engineReady()) return;
    this.showPicture();
    if (this.liveLoop) return;
    this.liveLoop = true;
    const step = () => {
      const more = this.editor.state.liveRender && !this.editor.state.quad && this.realtime.tick();
      this.events.emit('live', this.realtime.status());
      if (more) requestAnimationFrame(step);
      else this.liveLoop = false;
    };
    requestAnimationFrame(step);
  }

  /** Four Views: hand every Render pane's view to QuadLive and keep its loop alive. */
  private updateQuad(): void {
    const s = this.editor.state;
    const panes = this.cellsCache.filter((c) => c.frame.w >= 2 && paneMode(s, c.kind) === PaneMode.Render);
    if (!panes.length) {
      this.quadLive.release();
      if (this.rendered) this.clearRender();
      return;
    }
    this.renderer.stop();
    this.quadLive.resize(this.width, this.height, QUAD_PIXEL_RATIO);
    this.placeGlCanvas({ x: 0, y: 0, w: this.width, h: this.height });
    const scene = this.world.scene;
    const aspect = scene.document.width / scene.document.height;
    this.quadLive.update(scene, panes.map((c) => ({ key: c.kind, rect: c.frame, basis: this.basisFor(c.kind, aspect, scene) })));
    if (!this.engineReady()) return;
    this.showPicture();
    if (this.quadLoop) return;
    this.quadLoop = true;
    const step = () => {
      const more = this.editor.state.quad && this.quadLive.tick();
      this.events.emit('live', this.quadLive.status());
      if (more) requestAnimationFrame(step);
      else this.quadLoop = false;
    };
    requestAnimationFrame(step);
  }

  /** Until the trace program is ready the full wireframe stays up; live views resume then instead of spinning frames. */
  private engineReady(): boolean {
    if (this.engine.isReady) return true;
    if (!this.awaitingEngine) {
      this.awaitingEngine = true;
      // A failed compile is logged by the engine and shown by the loader card.
      this.engine.ready.then(() => this.updateLive(), () => undefined).finally(() => {
        this.awaitingEngine = false;
      });
    }
    return false;
  }

  private showPicture(): void {
    if (this.rendered) return;
    this.rendered = true;
    this.engine.canvas.style.visibility = 'visible';
    this.requestDraw();
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
      return { kind, rect, frame, basis: this.basisFor(kind, aspect), segments: new Map(), gizmo: null, keys: [], rig: null };
    });
    const main = this.mainCell();
    if (main && !this.renderer.active && !s.quad) this.placeGlCanvas(main.frame);
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
      // The wires lighten over a picture: the single view's render, or a Render pane.
      const overRender = this.rendered && (!s.quad || this.quadLive.has(cell.kind));
      const out = drawWireframe(g, scene, new WireProjector(basis, cell.frame), {
        selection: this.world.selection,
        hover: this.hoverState.object,
        depthCue: s.depthCue,
        grid: s.grid && !overRender,
        gizmo: s.gizmo,
        gizmoHover: this.hoverState.gizmo,
        gizmoNear: this.hoverState.near,
        shadeOutside: true,
        overRender,
      });
      cell.segments = out.segments;
      cell.gizmo = out.gizmo;
      const proj = new WireProjector(basis, cell.frame);
      const h = this.hoverState;
      cell.rig = drawRig(g, scene, proj, cell.kind, { selected: this.world.rig, hover: h.rig ?? null });
      // Paths are for editing: hidden while the show plays.
      const paths = scene.animation.enabled && s.motionPaths && !s.playing;
      const camera = cell.kind !== ViewKind.Camera && !rigFlags(scene, Rig.Camera).hidden;
      const focus = h.key ? { ref: h.key, held: !!h.held } : null;
      cell.keys = paths ? drawMotionPaths(g, scene, proj, this.world.selection, { camera, overRender, keys: s.selectedKeys, focus, cameraSelected: this.world.rig === Rig.Camera }) : [];
      if (cell.kind === ViewKind.Camera) drawFocusReticle(g, cell.frame, basis, scene.camera);
      if (cell.kind === ViewKind.Director) drawFocusReticle(g, cell.frame, basis, s.director);
      if (s.quad) this.drawLabel(cell, overRender);
      g.restore();
      if (s.quad) {
        g.strokeStyle = LABEL_COLOR;
        g.strokeRect(cell.rect.x + 0.5, cell.rect.y + 0.5, cell.rect.w - 1, cell.rect.h - 1);
      }
    }
  }

  private drawLabel(cell: ViewCell, overRender: boolean): void {
    const g = this.g;
    const text = VIEW_LABELS[cell.kind];
    const x = cell.rect.x + CELL_MARGIN;
    g.font = LABEL_FONT;
    if (overRender) {
      g.fillStyle = LABEL_TAB.color;
      g.fillRect(x - LABEL_TAB.padX, cell.rect.y + LABEL_TAB.top, g.measureText(text).width + LABEL_TAB.padX * 2, LABEL_TAB.height);
    }
    g.fillStyle = LABEL_COLOR;
    g.fillText(text, x, cell.rect.y + LABEL_OFFSET);
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

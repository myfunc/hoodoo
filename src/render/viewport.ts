import { Bus } from '../core/bus';
import { Logger } from '../core/log';
import { ViewKind } from '../model/scene.enums';
import type { ObjectId } from '../model/scene.ids';
import type { Camera, Scene } from '../model/scene.types';
import { type ViewBasis, cameraBasis, orthoBasis } from '../world/camera-math';
import { type EditorState, type EditorStore, PaneMode, paneMode } from '../world/editor-store';
import type { World } from '../world/world';
import { ChangeKind } from '../world/world.events';
import type { RayEngine } from './gpu/engine';
import { ProgressiveRenderer, type RenderProgress } from './gpu/progressive';
import { QuadLive } from './gpu/quad-live';
import type { RealtimeRenderer, RealtimeStatus } from './gpu/realtime';
import { PREVIEW_BOUNCES, PREVIEW_SAMPLES } from './gpu/render.constants';
import { finalBounces } from '../world/render-setup';
import type { ShownFrame } from './gpu/view-renderer';
import { outsideScope } from '../world/edit-scope';
import { CONVERGE_FACTOR, ViewPictures } from './view-pictures';
import { drawCellLabel, drawCellLine, fitFrame } from './view-cells';
import { type Frame, type GizmoHandles, type SegmentIndex, WireProjector, drawWireframe } from './wire/wireframe';
import { type KeyHandle, drawMotionPaths } from './wire/motion-paths';
import { type AxisGuide, drawAxisGuide } from './wire/axis-guide';
import { type RigHandles, type RigPart, drawFocusReticle, drawRig } from './wire/rig-glyphs';
import type { KeyRef } from '../world/animation/key-selection';
import { rigFlags } from '../world/rig';
import { Rig } from '../world/world.enums';
import { type GizmoPart, samePart } from './wire/gizmo';
import type { PlayQuality } from '../world/world.enums';

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
const MAX_DPR = 2;
/** Four Views pictures get one pixel per CSS pixel: a quarter of the work on a retina screen. */
const QUAD_PIXEL_RATIO = 1;
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
 * Play mode's hook (src/play, docs/play-mode.md): while a play source is set the
 * scene window shows its frames — the simulated scene through the player's eyes —
 * with no wires; the session calls `playFrame` every animation frame. The quality
 * picks the game renderer (PictureMode.Game) or the live preview at a quality.
 */
export interface PlaySource {
  /** The scene and the camera to show now. */
  frame(): { readonly scene: Scene; readonly camera: Camera };
  /** What draws Play's frames: the game renderer, or the live preview at one of its qualities. */
  readonly quality: PlayQuality;
}

/**
 * READ ME — the scene window. Observes World and EditorStore; draws the
 * wireframe on a 2D canvas and shows the ray-traced picture on the GL canvas
 * under it. Classic Bryce: render on request, the picture stays under the
 * wires until cleared. Live mode re-renders after every change, and Render View
 * shows the final render refining in place (ViewPictures). In Four Views each
 * pane is Wire or Render; Render panes are always live (QuadLive).
 */
export class SceneView {
  readonly events = new Bus<ViewportEvents>();
  readonly root: HTMLElement;
  private readonly logger = Logger.create('SceneView');
  private readonly wire: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly renderer: ProgressiveRenderer;
  private readonly pictures: ViewPictures;
  /** The live preview (also read by tools/perf-interact.mjs). */
  private readonly realtime: RealtimeRenderer;
  private readonly quadLive: QuadLive<ViewKind>;
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
  /** Play mode's source of frames, while a session runs. */
  private play: PlaySource | null = null;
  /** The picture each cell's wires were last drawn for (`shownFor`). */
  private wiresFor = new Map<ViewKind, ShownFrame | null>();
  /** The locked axes of a keyboard Move, Rotate or Size while it runs (input/key-transform.ts). */
  private guideState: AxisGuide | null = null;

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
    this.pictures = new ViewPictures(engine, editor, (st) => {
      this.events.emit('live', st);
      this.syncWires();
    });
    this.realtime = this.pictures.realtime;
    this.quadLive = new QuadLive(engine);
    this.quadLive.target = editor.state.renderSamples;
    this.quadLive.quality = editor.state.settings.liveQuality;
    this.quadLive.bounces = editor.state.settings.liveBounces;
    new ResizeObserver(() => this.resize()).observe(this.root);
    world.events.on('changed', ({ kind }) => this.onSceneChanged(kind));
    world.events.on('selection', () => this.requestDraw());
    // Edit Group: the picture shows the group alone.
    world.events.on('scope', () => {
      this.requestDraw();
      this.updateLive();
    });
    editor.events.on('changed', ({ state, previous }) => this.onEditorChanged(state, previous));
  }

  /** Play mode: show `source`'s frames instead of the editor's scene, without wires; null goes back to the editor. */
  setPlay(source: PlaySource | null): void {
    this.play = source;
    this.pictures.setPlay(source?.quality ?? null);
    this.layout();
    this.draw();
    this.updateLive();
  }

  /** Play mode: the session calls this every animation frame to show its current frame. */
  playFrame(): void {
    if (this.play) this.updateLive();
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

  set guide(guide: AxisGuide | null) {
    if (guide === this.guideState) return;
    this.guideState = guide;
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

  /** Bryce's Render button: progressive render of the current view (in a view that draws itself: converge further). */
  render(final = true): void {
    const s = this.editor.state;
    if (s.quad || this.pictures.active()) {
      if (s.quad) this.quadLive.target = s.renderSamples * CONVERGE_FACTOR;
      else this.pictures.converge();
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
    this.renderer.start(this.world.viewScene, this.basisFor(cell.kind, w / h), {
      samples: final ? s.renderSamples : PREVIEW_SAMPLES,
      bounces: final ? finalBounces(this.world.scene) : PREVIEW_BOUNCES,
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
    const live = this.pictures.active();
    if (live ? !live.imageReady : !this.renderer.imageReady) return null;
    if (live) live.present();
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
      this.pictures.finalView.reset();
    }
    this.pictures.sync(s, prev, this.world.scene);
    // Live off, or Render View left with Live off: Bryce's empty scene window until the next render.
    if (!s.quad && this.pictures.rendererFor(prev) && !this.pictures.active()) this.clearRender();
    if (s.showRender !== prev.showRender && !s.showRender) this.clearRender();
    if (s.renderSamples !== prev.renderSamples) this.quadLive.target = s.renderSamples;
    this.quadLive.quality = s.settings.liveQuality;
    this.quadLive.bounces = s.settings.liveBounces;
    this.root.classList.toggle('quad', s.quad);
    this.root.classList.toggle('is-picking', s.pickingFocus);
    this.updateLive();
    this.requestDraw();
  }

  /** Live preview or Render View: hand the current scene and camera to the renderer that draws by itself and keep its loop alive. */
  private updateLive(): void {
    const s = this.editor.state;
    if (s.quad) {
      this.updateQuad();
      return;
    }
    const cell = this.mainCell();
    const live = this.pictures.active();
    if (!live || !cell || cell.frame.w < 2) return;
    this.renderer.stop();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(cell.frame.w * dpr));
    const h = Math.max(1, Math.round(cell.frame.h * dpr));
    // Play mode: the session's frame, through the player's eyes, at the play quality.
    const play = this.play?.frame() ?? null;
    const scene = play?.scene ?? this.world.viewScene;
    this.pictures.refresh(scene);
    live.resize(w, h);
    this.placeGlCanvas(cell.frame);
    live.update(scene, play ? cameraBasis(play.camera, w / h) : this.basisFor(cell.kind, w / h));
    if (!this.engineReady()) return;
    this.showPicture();
    this.pictures.run();
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
    const scene = this.world.viewScene;
    const aspect = scene.document.width / scene.document.height;
    this.quadLive.update(scene, panes.map((c) => ({ key: c.kind, rect: c.frame, basis: this.basisFor(c.kind, aspect, scene) })));
    if (!this.engineReady()) return;
    this.showPicture();
    if (this.quadLoop) return;
    this.quadLoop = true;
    const step = () => {
      const more = this.editor.state.quad && this.quadLive.tick();
      this.events.emit('live', this.quadLive.status());
      this.syncWires();
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
    if (this.rendered && !this.renderer.active && !this.editor.state.liveRender && !this.pictures.active()) this.clearRender();
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

  /**
   * The scene and view of the live picture under a cell's wires, or null when the wires follow the
   * editor at once. A slow GPU shows a change a few frames late; wires drawn from the same frame lag
   * with it instead of sliding over the picture.
   */
  private shownFor(kind: ViewKind): ShownFrame | null {
    if (!this.rendered || this.play) return null;
    if (this.editor.state.quad) return this.quadLive.shown(kind);
    return kind === this.mainCell()?.kind ? this.pictures.active()?.shown ?? null : null;
  }

  /** A new live frame went on screen: its wires go with it, in the same animation frame. */
  private syncWires(): void {
    if (this.cellsCache.some((c) => this.shownFor(c.kind) !== (this.wiresFor.get(c.kind) ?? null))) this.draw();
  }

  private draw(): void {
    const g = this.g;
    const dpr = this.wire.width / Math.max(this.width, 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.wire.width, this.wire.height);
    // Play mode shows the picture alone.
    if (this.play) {
      this.wiresFor.clear();
      return;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = this.editor.state;
    const editing = this.world.viewScene;
    const aspect = editing.document.width / editing.document.height;
    const members = this.world.scopeMembers();
    const ghosts = members ? outsideScope(this.world.scene, members) : undefined;
    for (const cell of this.cellsCache) {
      // Input works on the editor's view; the wires show the picture's.
      Object.assign(cell, { basis: this.basisFor(cell.kind, aspect) });
      const shown = this.shownFor(cell.kind);
      this.wiresFor.set(cell.kind, shown);
      const scene = shown?.scene ?? editing;
      const basis = shown?.basis ?? cell.basis;
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
        ghosts,
      });
      cell.segments = out.segments;
      cell.gizmo = out.gizmo;
      const proj = new WireProjector(basis, cell.frame);
      const h = this.hoverState;
      cell.rig = drawRig(g, scene, proj, cell.kind, { selected: this.world.rig, hover: h.rig ?? null });
      if (this.guideState) drawAxisGuide(g, proj, this.guideState);
      // Paths are for editing: hidden while the show plays.
      const paths = scene.animation.enabled && s.motionPaths && !s.playing;
      const camera = cell.kind !== ViewKind.Camera && !rigFlags(scene, Rig.Camera).hidden;
      const focus = h.key ? { ref: h.key, held: !!h.held } : null;
      cell.keys = paths ? drawMotionPaths(g, scene, proj, this.world.selection, { camera, overRender, keys: s.selectedKeys, focus, cameraSelected: this.world.rig === Rig.Camera }) : [];
      if (cell.kind === ViewKind.Camera) drawFocusReticle(g, cell.frame, basis, scene.camera);
      if (cell.kind === ViewKind.Director) drawFocusReticle(g, cell.frame, basis, s.director);
      drawCellLabel(g, cell, s.quad, s.picture, overRender);
      g.restore();
      if (s.quad) drawCellLine(g, cell.rect);
    }
  }
}

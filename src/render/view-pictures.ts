import type { Scene } from '../model/scene.types';
import type { EditorState, EditorStore } from '../world/editor-store';
import { finalBounces, renderViewOptions } from '../world/render-setup';
import { type LiveQuality, PictureMode, type PlayQuality } from '../world/world.enums';
import type { RayEngine } from './gpu/engine';
import { FinalView } from './gpu/final-view';
import { GameRenderer } from './gpu/game-renderer';
import { RealtimeRenderer } from './gpu/realtime';
import type { RealtimeStatus, ViewRenderer } from './gpu/view-renderer';
import type { Frame } from './wire/wireframe';

/** Render in a view that draws itself refines to this many times its rays per pixel. */
export const CONVERGE_FACTOR = 4;
const TAB = { font: 'bold 10px Geneva, Verdana, sans-serif', fill: 'rgba(43,138,138,0.9)', ink: '#fff', padX: 5, top: 4, left: 4, height: 15, baseline: 11 } as const;

/**
 * READ ME — the single view's pictures that draw themselves: the live preview
 * (RealtimeRenderer, while Live is on), Render View (FinalView) and the game
 * renderer (GameRenderer: Play's picture, or its look previewed). `active` picks
 * one for the editor state and Play, `sync` keeps them in step with the settings,
 * and `run` keeps one animation-frame loop going for whichever is active. A new
 * picture mode adds its renderer here and one case in `rendererFor`.
 */
export class ViewPictures {
  readonly realtime: RealtimeRenderer;
  readonly finalView: FinalView;
  readonly game: GameRenderer;
  private loop = false;
  /** What Play draws with while a session runs (`setPlay`), else null. */
  private play: PlayQuality | null = null;

  constructor(engine: RayEngine, private readonly editor: EditorStore, private readonly emit: (s: RealtimeStatus) => void) {
    const s = editor.state;
    this.realtime = new RealtimeRenderer(engine);
    this.realtime.target = s.renderSamples;
    this.realtime.quality = s.settings.liveQuality;
    this.realtime.bounces = s.settings.liveBounces;
    this.finalView = new FinalView(engine);
    this.game = new GameRenderer(engine);
    this.game.setResolution(s.settings.playResolution);
  }

  /** The renderer that draws the single view by itself in state `s`, or null (Four Views, or Bryce's render on request). */
  rendererFor(s: EditorState): ViewRenderer | null {
    if (s.quad) return null;
    if ((this.play === PictureMode.Game || s.picture === PictureMode.Game) && this.game.usable) return this.game;
    if (s.picture === PictureMode.Final) return this.finalView;
    return s.liveRender ? this.realtime : null;
  }

  /** Play starts (the game renderer, or the live preview at a quality) or ends (null): each picture starts over. */
  setPlay(quality: PlayQuality | null): void {
    const before = this.active();
    this.play = quality;
    this.realtime.quality = this.liveQuality(this.editor.state);
    this.realtime.reset();
    this.game.reset();
    if (before === this.game && this.active() !== this.game) this.game.release();
  }

  /** The live preview's quality: Play's while it draws Play, else the setting. */
  private liveQuality(s: EditorState): LiveQuality {
    return this.play !== null && this.play !== PictureMode.Game ? this.play : s.settings.liveQuality;
  }

  active(): ViewRenderer | null {
    return this.rendererFor(this.editor.state);
  }

  /** Render View's options for the scene: its Final preset follows the scene's own depth. */
  refresh(scene: Scene): void {
    const st = this.editor.state.settings;
    this.finalView.options = renderViewOptions(st.renderViewPreset, st.renderViewCustom, finalBounces(scene));
  }

  /** The editor changed: settings to the renderers; a renderer that stops drawing forgets its picture. */
  sync(s: EditorState, prev: EditorState, scene: Scene): void {
    if (s.renderSamples !== prev.renderSamples) this.realtime.target = s.renderSamples;
    this.realtime.quality = this.liveQuality(s);
    this.realtime.bounces = s.settings.liveBounces;
    this.game.setResolution(s.settings.playResolution);
    this.refresh(scene);
    const before = this.rendererFor(prev);
    const now = this.rendererFor(s);
    // The other renderer drew over the canvas: whichever comes back starts its picture over.
    if (before && before !== now) {
      this.realtime.reset();
      this.finalView.reset();
      this.game.reset();
    }
    // The game renderer's targets are large: given back when it stops drawing.
    if (before === this.game && now !== this.game) this.game.release();
  }

  /** Render in a view that draws itself: refine to four times the rays. */
  converge(): void {
    const r = this.active();
    if (r === this.realtime) r.target = this.editor.state.renderSamples * CONVERGE_FACTOR;
    else if (r === this.finalView) r.target = this.finalView.options.samples * CONVERGE_FACTOR;
  }

  /** Keeps the loop going while the active renderer has work; it reports every frame. */
  run(): void {
    if (this.loop) return;
    this.loop = true;
    const step = (now: number) => {
      const r = this.active();
      const more = r !== null && r.tick(now);
      if (r) this.emit(r.status());
      if (more) requestAnimationFrame(step);
      else this.loop = false;
    };
    requestAnimationFrame(step);
  }
}

/** The name of a picture mode on a teal tab in the picture's top-left corner (Render View). */
export function drawPictureTab(g: CanvasRenderingContext2D, frame: Frame, text: string): void {
  g.font = TAB.font;
  const w = g.measureText(text).width + TAB.padX * 2;
  g.fillStyle = TAB.fill;
  g.fillRect(frame.x + TAB.left, frame.y + TAB.top, w, TAB.height);
  g.fillStyle = TAB.ink;
  g.fillText(text, frame.x + TAB.left + TAB.padX, frame.y + TAB.top + TAB.baseline);
}

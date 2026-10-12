import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { Animation, Key } from '../../model/scene.types';
import { type KeyRef, KeyTrack, isKeyPicked, pickKeys, trackKeys, withTracksRetimed } from '../../world/animation/key-selection';
import { selectionTracks } from '../../world/animation/loops';
import { frameTime, retimed, sameTime } from '../../world/animation/keying';
import { lastKeyTime } from '../../world/animation/duration';
import { SelectMode } from '../../world/world.enums';
import type { UiContext } from '../context';
import { hintOn } from '../context';
import { Button } from '../kit/controls';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { TimelineClock } from './timeline-clock';
import { EndDrag } from './timeline-length';
import { COPPER, GHOST, GROOVE, PEWTER, PICKED, RULER, type Span, paintBand, paintDiamond, paintEnd, paintGroove, paintLaneGlyph, paintPastEnd, paintScrubber, paintTicks, xAt } from './timeline-paint';
import { formatClock } from './timeline-time';

/**
 * The animation controls under the scene window (shown while Animation is on), after Bryce 3D's
 * Time Palette: chrome VCR buttons with a red stop, the time readout, and a ruler engraved with
 * three grooves of copper keys — objects (the selection, or every animated object),
 * camera and sky — under a red scrubber needle. Drag the ruler to scrub, a key to retime it;
 * double-click a key to jump to it. A click picks a key (Shift toggles), Shift-drag on the
 * ruler picks the keys inside the band; picked keys show filled yellow. The teal flag
 * at the end of the ruler is the end of the scene: drag it to change the length.
 * Keys past the end wait greyed in the hatched stretch beyond it.
 */

enum Lane {
  Objects = 0,
  Camera = 1,
  Sky = 2,
}

const LANES = [Lane.Objects, Lane.Camera, Lane.Sky] as const;
const LANE_TRACKS = [KeyTrack.Object, KeyTrack.Camera, KeyTrack.Sky] as const;
/** How near the end flag a press grabs it, in pixels. */
const END_HIT = 5;
const LANE_NAMES = ['Objects', 'Camera', 'Sky'] as const;
const LANE_GLYPHS = [GLYPH.cube, GLYPH.camera, GLYPH.sun] as const;
const MAX_DPR = 2;
const DIAMOND = 4.5;
const DIAMOND_PICKED = 5.5;
/** Bryce's stop is a red square in the middle of the VCR row. */
const STOP_GLYPH = ['M6 6h12v12H6z'] as const;
/** The old-fashioned key between − and +: bow, shaft and two teeth. */
const KEY_GLYPH = ['M7 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M10.5 12H22', 'M18.5 12v3.5M21.5 12v2.5'] as const;
const HINTS = {
  ruler: { title: 'Time Scrubber', text: 'Drag to scrub · click a key to select · Shift-drag to box keys' },
  lane: 'Click to select · Shift-click to add · drag to retime',
  end: { title: 'End of the scene', text: 'Drag to change the length' },
} as const;

enum DragMode {
  Scrub = 'scrub',
  Retime = 'retime',
  Band = 'band',
  /** Shift-click on a key: it was toggled, nothing follows. */
  None = 'none',
  /** The end flag: the length of the scene. */
  End = 'end',
}

interface Drag {
  readonly mode: DragMode;
  readonly lane: Lane | null;
  readonly from: number;
  readonly startAnim: Animation;
  /** The picked keys when the drag began; a retime carries them along. */
  readonly startPicked: readonly KeyRef[];
  readonly x: number;
  readonly y: number;
}

/** One track shown in a lane. */
interface LaneTrack {
  readonly track: KeyTrack;
  readonly id: string;
  readonly keys: readonly Key<unknown>[];
}

export class Timeline {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly clock: TimelineClock;
  private readonly play: Button;
  private shownPlaying: boolean | null = null;
  private readonly loop: Button;
  private drag: Drag | null = null;
  private endDrag: EndDrag | null = null;
  private endHot = false;
  private band: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private queued = false;

  constructor(private readonly ctx: UiContext) {
    const tb = (action: Action, paths: readonly string[], title: string, cls = '') => {
      const b = new Button({ cls: `tl-button ${cls}`, title: `${title}${shortcutOf(action) ? ` (${shortcutOf(action)})` : ''}`, content: glyph(paths, GLYPH_BOX), onClick: () => ctx.dispatch(action) });
      hintOn(ctx, b.el, { title, text: shortcutOf(action) ? `Shortcut ${shortcutOf(action)}` : '' });
      return b;
    };
    this.play = tb(Action.PlayPause, GLYPH.play, 'Play / Pause', 'tl-play');
    this.loop = tb(Action.ToggleLoop, GLYPH.loop, 'Loop playback', 'tl-loop');
    this.clock = new TimelineClock(ctx);
    this.canvas = el('canvas', { cls: 'tl-ruler' });
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    hintOn(ctx, this.canvas, HINTS.ruler);
    // Stop only pauses: Bryce's red square, next to Play, which toggles.
    const stop = new Button({ cls: 'tl-button tl-stop', title: 'Stop', content: glyph(STOP_GLYPH, GLYPH_BOX), onClick: () => this.stop() });
    hintOn(ctx, stop.el, { title: 'Stop', text: 'Stop playback here' });
    const keyMark = el('span', { cls: 'tl-key-mark' }, [glyph(KEY_GLYPH, GLYPH_BOX)]);
    this.el = el('div', { cls: 'timeline' }, [
      el('div', { cls: 'tl-transport' }, [
        tb(Action.FirstFrame, GLYPH.toStart, 'Go to start').el,
        tb(Action.PrevKey, GLYPH.stepBack, 'Previous key').el,
        stop.el,
        this.play.el,
        tb(Action.NextKey, GLYPH.stepForward, 'Next key').el,
        tb(Action.LastFrame, GLYPH.toEnd, 'Go to end').el,
      ]),
      this.clock.el,
      this.canvas,
      el('div', { cls: 'tl-keys' }, [
        tb(Action.RemoveKey, GLYPH.minus, 'Remove key at the playhead', 'tl-round').el,
        keyMark,
        tb(Action.AddKey, GLYPH.plus, 'Add key: selection, or camera when nothing is selected', 'tl-round').el,
        tb(Action.KeyCamera, GLYPH.camera, 'Animate the camera: key it here', 'tl-round').el,
        this.loop.el,
      ]),
    ]);
    this.installPointer();
    new ResizeObserver(() => this.redraw()).observe(this.canvas);
    ctx.world.events.on('changed', () => this.redraw());
    ctx.world.events.on('selection', () => this.redraw());
    ctx.editor.events.on('changed', ({ state, previous }) => {
      if (state.playing !== previous.playing || state.selectedKeys !== previous.selectedKeys) this.redraw();
    });
    this.redraw();
  }

  private stop(): void {
    if (this.ctx.editor.state.playing) this.ctx.dispatch(Action.PlayPause);
  }

  private get anim(): Animation {
    return this.ctx.world.scene.animation;
  }

  private redraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  /** Keys shown in a lane: per track, so a drag can move them. */
  private laneTracks(lane: Lane): readonly LaneTrack[] {
    const a = this.anim;
    if (lane === Lane.Camera) return [{ track: KeyTrack.Camera, id: '', keys: a.camera }];
    if (lane === Lane.Sky) return [{ track: KeyTrack.Sky, id: '', keys: a.sky }];
    // Objects lane: the selection's tracks (a whole group's own track too), or every object and group track.
    return selectionTracks(this.ctx.world.scene, this.ctx.world.selection).map((r) => ({ ...r, keys: trackKeys(a, r.track, r.id) }));
  }

  /** The keys one diamond stands for: every track of the lane with a key at that time. */
  private refsAt(lane: Lane, time: number): KeyRef[] {
    const fps = this.anim.fps;
    return this.laneTracks(lane).filter((t) => t.keys.some((k) => sameTime(k.time, time, fps))).map((t) => ({ track: t.track, id: t.id, time }));
  }

  private isPicked(lane: Lane, track: LaneTrack, time: number): boolean {
    return isKeyPicked(this.ctx.editor.state.selectedKeys, { track: lane === Lane.Objects ? track.track : LANE_TRACKS[lane], id: track.id, time }, this.anim.fps);
  }

  /** The ruler's time: the whole scene and any keys past its end; held still while the end flag is dragged. */
  private get span(): Span {
    const w = this.canvas.clientWidth;
    const view = this.endDrag?.view ?? Math.max(this.anim.duration, lastKeyTime(this.anim));
    return { x0: RULER.label + RULER.pad, w: Math.max(1, w - RULER.label - RULER.pad * 2), view };
  }

  private xOf(t: number): number {
    return xAt(this.span, t);
  }

  /** The time under x, inside the scene unless `free`. */
  private timeAt(x: number, free = false): number {
    const { x0, w, view } = this.span;
    const t = Math.max(0, ((x - x0) / w) * view);
    return free ? t : Math.min(this.anim.duration, t);
  }

  private laneY(lane: Lane): number {
    return RULER.top + lane * RULER.lane + RULER.lane / 2;
  }

  private draw(): void {
    const a = this.anim;
    const t = this.ctx.world.time;
    this.clock.show(t, a);
    const playing = this.ctx.editor.state.playing;
    if (playing !== this.shownPlaying) {
      this.shownPlaying = playing;
      this.play.el.replaceChildren(glyph(playing ? GLYPH.pause : GLYPH.play, GLYPH_BOX));
      this.play.active = playing;
    }
    this.loop.active = a.loop;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const span = this.span;
    paintTicks(g, span, a.fps, cw);
    for (const lane of LANES) {
      paintGroove(g, this.laneY(lane), GROOVE.height, RULER.label, cw);
      paintLaneGlyph(g, LANE_GLYPHS[lane], this.laneY(lane));
    }
    const end = this.xOf(a.duration);
    paintPastEnd(g, end, cw, ch);
    for (const lane of LANES) this.drawKeys(lane);
    if (this.band) paintBand(g, this.band);
    paintEnd(g, end, ch, this.endHot || !!this.endDrag, this.endDrag ? formatClock(a.duration) : '');
    paintScrubber(g, this.xOf(t), ch);
  }

  private drawKeys(lane: Lane): void {
    const a = this.anim;
    const y = this.laneY(lane);
    const selected = lane !== Lane.Objects || this.ctx.world.selection.size > 0;
    const bevel = selected ? COPPER : PEWTER;
    const seen = new Set<number>();
    const picked = new Set<number>();
    for (const track of this.laneTracks(lane)) {
      for (const k of track.keys) {
        const x = Math.round(this.xOf(k.time));
        if (this.isPicked(lane, track, k.time)) picked.add(x);
        if (seen.has(x)) continue;
        seen.add(x);
        const past = k.time > a.duration && !sameTime(k.time, a.duration, a.fps);
        paintDiamond(this.g, x, y, DIAMOND, past ? GHOST : bevel);
      }
    }
    // Picked keys are drawn last, on top of their neighbours.
    for (const x of picked) paintDiamond(this.g, x, y, DIAMOND_PICKED, PICKED);
  }

  /** Keys whose diamonds sit inside the band. */
  private keysInBand(x0: number, y0: number, x1: number, y1: number): KeyRef[] {
    const [lx, hx, ly, hy] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
    return LANES.filter((l) => this.laneY(l) >= ly && this.laneY(l) <= hy).flatMap((lane) =>
      this.laneTracks(lane).flatMap((t) => t.keys
        .filter((k) => this.xOf(k.time) >= lx && this.xOf(k.time) <= hx)
        .map((k) => ({ track: t.track, id: t.id, time: k.time }))));
  }

  /** The key under a ruler point: its lane and time, or null. */
  private keyAt(x: number, y: number): { lane: Lane; time: number } | null {
    const lane = LANES.find((l) => Math.abs(y - this.laneY(l)) <= RULER.lane / 2);
    if (lane === undefined) return null;
    let best: { lane: Lane; time: number } | null = null;
    let bestD: number = RULER.keyHit;
    for (const track of this.laneTracks(lane)) {
      for (const k of track.keys) {
        const d = Math.abs(this.xOf(k.time) - x);
        if (d <= bestD) {
          bestD = d;
          best = { lane, time: k.time };
        }
      }
    }
    return best;
  }

  /** The end flag is under the point: on the tick row, or in a groove where no key is. */
  private onEnd(x: number, y: number): boolean {
    if (Math.abs(x - this.xOf(this.anim.duration)) > END_HIT) return false;
    return y < RULER.top || !this.keyAt(x, y);
  }

  private installPointer(): void {
    const c = this.canvas;
    const local = (e: PointerEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      if (this.ctx.editor.state.playing) this.ctx.dispatch(Action.PlayPause);
      const p = local(e);
      if (this.onEnd(p.x, p.y)) {
        this.endDrag = new EndDrag(this.ctx, this.span.view, () => this.redraw());
        this.drag = { mode: DragMode.End, lane: null, from: 0, startAnim: this.anim, startPicked: [], x: p.x, y: p.y };
        this.redraw();
        return;
      }
      const key = this.keyAt(p.x, p.y);
      const mode = key ? (e.shiftKey ? DragMode.None : DragMode.Retime) : e.shiftKey ? DragMode.Band : DragMode.Scrub;
      if (key) this.pickAt(key.lane, key.time, e.shiftKey);
      const picked = this.ctx.editor.state.selectedKeys;
      this.drag = { mode, lane: key?.lane ?? null, from: key?.time ?? 0, startAnim: this.anim, startPicked: picked, x: p.x, y: p.y };
      if (mode === DragMode.Retime) this.ctx.world.beginGesture('Retime key');
      if (mode === DragMode.Scrub) this.ctx.world.setTime(this.timeAt(p.x));
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      const d = this.drag;
      if (!d) {
        this.hover(p.x, p.y);
        return;
      }
      if (d.mode === DragMode.Scrub) this.ctx.world.setTime(this.timeAt(p.x));
      if (d.mode === DragMode.Band) {
        this.band = { x0: d.x, y0: d.y, x1: p.x, y1: p.y };
        this.redraw();
      }
      if (d.mode === DragMode.Retime) this.retimeTo(d, this.timeAt(p.x));
      if (d.mode === DragMode.End && this.endDrag) {
        const s = this.span;
        this.endDrag.move(this.timeAt(p.x, true), p.x - (s.x0 + s.w), s.w / s.view);
      }
    });
    const end = () => {
      const d = this.drag;
      if (d?.mode === DragMode.Retime) this.ctx.world.endGesture();
      if (d?.mode === DragMode.Band && this.band) {
        const b = this.band;
        const refs = this.keysInBand(b.x0, b.y0, b.x1, b.y1);
        this.ctx.editor.update({ selectedKeys: pickKeys(d.startPicked, refs, SelectMode.Add, this.anim.fps) });
      }
      this.endDrag?.end();
      this.endDrag = null;
      this.band = null;
      this.drag = null;
      this.redraw();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
    c.addEventListener('pointerleave', () => this.setEndHot(false));
    c.addEventListener('dblclick', (e) => {
      const p = local(e);
      const key = this.keyAt(p.x, p.y);
      if (key) this.ctx.world.setTime(key.time);
    });
  }

  /** The cursor and the status hint for what is under the pointer. */
  private hover(x: number, y: number): void {
    const c = this.canvas;
    const onEnd = this.onEnd(x, y);
    this.setEndHot(onEnd);
    c.style.cursor = onEnd ? 'col-resize' : this.keyAt(x, y) ? 'ew-resize' : 'pointer';
    if (onEnd) {
      this.ctx.editor.setHint(HINTS.end);
      return;
    }
    const lane = LANES.find((l) => Math.abs(y - this.laneY(l)) <= RULER.lane / 2);
    this.ctx.editor.setHint(lane === undefined ? HINTS.ruler : { title: `${LANE_NAMES[lane]} keys`, text: HINTS.lane });
  }

  private setEndHot(hot: boolean): void {
    if (hot === this.endHot) return;
    this.endHot = hot;
    this.redraw();
  }

  /** A click on a diamond picks its keys; Shift adds them, or takes them out when all are picked already. */
  private pickAt(lane: Lane, time: number, shift: boolean): void {
    const fps = this.anim.fps;
    const refs = this.refsAt(lane, time);
    const picked = this.ctx.editor.state.selectedKeys;
    const all = refs.every((r) => isKeyPicked(picked, r, fps));
    if (!shift && all) return;
    const next = !shift ? refs : all ? pickKeys(picked, refs, SelectMode.Toggle, fps) : pickKeys(picked, refs, SelectMode.Add, fps);
    this.ctx.editor.update({ selectedKeys: next });
  }

  /** Retimes the dragged diamond; the picked keys it carries keep their pick at the new time. */
  private retimeTo(d: Drag, to: number): void {
    const a = d.startAnim;
    const target = Math.min(a.duration, Math.max(0, frameTime(to, a.fps)));
    this.ctx.world.setAnimation(this.retime(d, to), 'Retime key');
    const moved = this.refsAt(d.lane ?? Lane.Objects, target).map((r) => ({ ...r, time: d.from }));
    const picked = d.startPicked.map((r) => (isKeyPicked(moved, r, a.fps) ? { ...r, time: target } : r));
    this.ctx.editor.update({ selectedKeys: picked });
  }

  /** The timeline with the dragged key (of every track in its lane at that time) moved to `to`. */
  private retime(d: Drag, to: number): Animation {
    const a = d.startAnim;
    const target = frameTime(to, a.fps);
    if (d.lane === Lane.Camera) return { ...a, camera: retimed(a.camera, d.from, target, a) };
    if (d.lane === Lane.Sky) return { ...a, sky: retimed(a.sky, d.from, target, a) };
    return withTracksRetimed(a, this.laneTracks(Lane.Objects), d.from, target);
  }
}

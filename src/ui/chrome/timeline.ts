import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { Animation, Key } from '../../model/scene.types';
import { type KeyRef, KeyTrack, isKeyPicked, pickKeys, trackKeys, withTracksRetimed } from '../../world/animation/key-selection';
import { selectionTracks } from '../../world/animation/loops';
import { frameTime, retimed, sameTime } from '../../world/animation/keying';
import { SelectMode } from '../../world/world.enums';
import type { UiContext } from '../context';
import { hintOn } from '../context';
import { Button } from '../kit/controls';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';

/**
 * The animation controls under the scene window (shown while Animation is on), after Bryce 3D's
 * Time Palette: chrome VCR buttons with a red stop, the time readout, and a ruler engraved with
 * three grooves of copper keys — objects (the selection, or every animated object),
 * camera and sky — under a red scrubber needle. Drag the ruler to scrub, a key to retime it;
 * double-click a key to jump to it. A click picks a key (Shift toggles), Shift-drag on the
 * ruler picks the keys inside the band; picked keys show filled yellow.
 */

enum Lane {
  Objects = 0,
  Camera = 1,
  Sky = 2,
}

const LANES = [Lane.Objects, Lane.Camera, Lane.Sky] as const;
const LANE_TRACKS = [KeyTrack.Object, KeyTrack.Camera, KeyTrack.Sky] as const;
const RULER = { top: 13, lane: 10, pad: 8, label: 18, keyHit: 6 } as const;
/** The scrubber: a red needle with a bead on top, riding the tick groove. */
const SCRUBBER = { line: 1.5, bead: 3.5, beadY: 9.5, highlight: 1.5 } as const;
/** An engraved groove: a dark upper lip and a light lower one. */
const GROOVE = { height: 6, top: 4 } as const;
const TICKS = { frame: 3, label: 7, textGap: 14, textX: 2, textY: 5, font: '9px Geneva, Verdana, sans-serif', eps: 1e-6 } as const;
const LANE_GLYPH = { x: 2, y: 6.5, scale: 0.55, stroke: 2.6 } as const;
/** Key colours: the lit facet, the shaded facet and the outline. */
interface Bevel { readonly light: string; readonly dark: string; readonly edge: string }
const COPPER: Bevel = { light: '#f3a676', dark: '#b4511f', edge: '#6a2c0e' };
const PEWTER: Bevel = { light: '#d6d6d4', dark: '#8f8e8a', edge: '#5f5e5a' };
const PICKED: Bevel = { light: '#fff08a', dark: '#f0b818', edge: '#2a2a2a' };
const COLORS = {
  tick: 'rgba(0,0,0,0.38)',
  tickText: '#55565a',
  tickTextShadow: 'rgba(255,255,255,0.9)',
  grooveFill: 'rgba(120,122,128,0.22)',
  grooveShade: 'rgba(0,0,0,0.32)',
  grooveLight: 'rgba(255,255,255,0.95)',
  band: 'rgba(200,40,45,0.9)',
  bandFill: 'rgba(200,40,45,0.1)',
  scrubber: '#d0281e',
  scrubberDark: '#7a0e08',
  scrubberLight: '#ffb0a8',
  label: '#6a6b6f',
} as const;
/** Bryce's stop is a red square in the middle of the VCR row. */
const STOP_GLYPH = ['M6 6h12v12H6z'] as const;
/** The old-fashioned key between − and +: bow, shaft and two teeth. */
const KEY_GLYPH = ['M7 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M10.5 12H22', 'M18.5 12v3.5M21.5 12v2.5'] as const;
const LANE_NAMES = ['Objects', 'Camera', 'Sky'] as const;
const LANE_GLYPHS = [GLYPH.cube, GLYPH.camera, GLYPH.sun] as const;
const MAX_DPR = 2;
const DIAMOND = 4.5;
const DIAMOND_PICKED = 5.5;
const BAND_DASH = [3, 2] as const;
const HINTS = {
  ruler: { title: 'Time Scrubber', text: 'Drag to scrub · click a key to select · Shift-drag to box keys' },
  lane: 'Click to select · Shift-click to add · drag to retime',
} as const;
const MIN_TICK_PX = 6;
const LABEL_EVERY_PX = 46;
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300] as const;
const SECONDS_PER_MINUTE = 60;
const TIME_DIGITS = 2;

/** 00:01.40 — minutes, seconds and hundredths. */
export function formatTime(t: number): string {
  const m = Math.floor(t / SECONDS_PER_MINUTE);
  const s = t - m * SECONDS_PER_MINUTE;
  return `${String(m).padStart(2, '0')}:${s.toFixed(TIME_DIGITS).padStart(TIME_DIGITS + 3, '0')}`;
}

enum DragMode {
  Scrub = 'scrub',
  Retime = 'retime',
  Band = 'band',
  /** Shift-click on a key: it was toggled, nothing follows. */
  None = 'none',
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
  private readonly readout: HTMLElement;
  private readonly frameOut: HTMLElement;
  private readonly play: Button;
  private shownPlaying: boolean | null = null;
  private readonly loop: Button;
  private drag: Drag | null = null;
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
    this.readout = el('span', { cls: 'tl-time' });
    this.frameOut = el('span', { cls: 'tl-frame' });
    const clock = el('div', { cls: 'tl-clock', title: 'Animation Setup: length and frame rate' }, [this.readout, this.frameOut]);
    clock.addEventListener('click', () => ctx.dispatch(Action.AnimationSetup));
    hintOn(ctx, clock, { title: 'Time', text: 'Click to set the length and frame rate' });
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
      clock,
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

  private get span(): { x0: number; w: number } {
    const w = this.canvas.clientWidth;
    return { x0: RULER.label + RULER.pad, w: Math.max(1, w - RULER.label - RULER.pad * 2) };
  }

  private xOf(t: number): number {
    const { x0, w } = this.span;
    return x0 + (t / this.anim.duration) * w;
  }

  private timeAt(x: number): number {
    const { x0, w } = this.span;
    return Math.min(this.anim.duration, Math.max(0, ((x - x0) / w) * this.anim.duration));
  }

  private laneY(lane: Lane): number {
    return RULER.top + lane * RULER.lane + RULER.lane / 2;
  }

  private draw(): void {
    const a = this.anim;
    const t = this.ctx.world.time;
    const fr = Math.round(t * a.fps);
    this.readout.textContent = formatTime(t);
    this.frameOut.textContent = `frame ${fr} / ${Math.round(a.duration * a.fps)}`;
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
    this.drawTicks(cw);
    for (const lane of LANES) this.drawLane(lane, cw);
    this.drawBand();
    this.drawScrubber(this.xOf(t), ch);
  }

  /** The red needle down the grooves, a bead on top of it. */
  private drawScrubber(x: number, ch: number): void {
    const g = this.g;
    g.fillStyle = COLORS.scrubber;
    g.fillRect(Math.round(x) - 0.5, SCRUBBER.beadY, SCRUBBER.line, ch - SCRUBBER.beadY);
    const bead = g.createRadialGradient(x - 1, SCRUBBER.beadY - 1, SCRUBBER.highlight / 2, x, SCRUBBER.beadY, SCRUBBER.bead);
    bead.addColorStop(0, COLORS.scrubberLight);
    bead.addColorStop(0.5, COLORS.scrubber);
    bead.addColorStop(1, COLORS.scrubberDark);
    g.fillStyle = bead;
    g.beginPath();
    g.arc(x, SCRUBBER.beadY, SCRUBBER.bead, 0, Math.PI * 2);
    g.fill();
  }

  /** A groove cut into the chrome, `h` tall and centred on y. */
  private groove(y: number, h: number, x0: number, x1: number): void {
    const g = this.g;
    const top = Math.round(y - h / 2) + 0.5;
    g.fillStyle = COLORS.grooveFill;
    g.fillRect(x0, top, x1 - x0, h);
    g.fillStyle = COLORS.grooveShade;
    g.fillRect(x0, top, x1 - x0, 1);
    g.fillStyle = COLORS.grooveLight;
    g.fillRect(x0, top + h, x1 - x0, 1);
  }

  private drawTicks(cw: number): void {
    const g = this.g;
    const a = this.anim;
    const { w } = this.span;
    const pxPerS = w / a.duration;
    const framePx = pxPerS / a.fps;
    g.strokeStyle = COLORS.tick;
    g.lineWidth = 1;
    g.beginPath();
    if (framePx >= MIN_TICK_PX) {
      for (let f = 0; f <= a.duration * a.fps; f++) {
        const x = Math.round(this.xOf(f / a.fps)) + 0.5;
        g.moveTo(x, RULER.top - TICKS.frame);
        g.lineTo(x, RULER.top);
      }
    }
    const step = TICK_STEPS.find((s) => s * pxPerS >= LABEL_EVERY_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
    g.font = TICKS.font;
    for (let s = 0; s <= a.duration + TICKS.eps; s += step) {
      const x = Math.round(this.xOf(s)) + 0.5;
      g.moveTo(x, RULER.top - TICKS.label);
      g.lineTo(x, RULER.top);
      if (x + TICKS.textGap >= cw) continue;
      // Engraved numbers: a white shadow under dark ink.
      g.fillStyle = COLORS.tickTextShadow;
      g.fillText(`${s}s`, x + TICKS.textX, RULER.top - TICKS.textY + 1);
      g.fillStyle = COLORS.tickText;
      g.fillText(`${s}s`, x + TICKS.textX, RULER.top - TICKS.textY);
    }
    g.stroke();
  }

  private drawLane(lane: Lane, cw: number): void {
    const g = this.g;
    const y = this.laneY(lane);
    this.groove(y, GROOVE.height, RULER.label, cw);
    // A tiny glyph names the lane, like the icons of Bryce's palettes.
    g.save();
    g.translate(LANE_GLYPH.x, y - LANE_GLYPH.y);
    g.scale(LANE_GLYPH.scale, LANE_GLYPH.scale);
    g.strokeStyle = COLORS.label;
    g.lineWidth = LANE_GLYPH.stroke;
    for (const d of LANE_GLYPHS[lane]) g.stroke(new Path2D(d));
    g.restore();
    const selected = lane !== Lane.Objects || this.ctx.world.selection.size > 0;
    const bevel = selected ? COPPER : PEWTER;
    g.lineWidth = 1;
    const seen = new Set<number>();
    const picked = new Set<number>();
    for (const track of this.laneTracks(lane)) {
      for (const k of track.keys) {
        const x = Math.round(this.xOf(k.time));
        if (this.isPicked(lane, track, k.time)) picked.add(x);
        if (seen.has(x)) continue;
        seen.add(x);
        this.diamond(x, y, DIAMOND, bevel);
      }
    }
    // Picked keys are drawn last, on top of their neighbours.
    for (const x of picked) this.diamond(x, y, DIAMOND_PICKED, PICKED);
  }

  /** A bevelled diamond: two facets, lit on the upper left, shaded on the lower right. */
  private diamond(x: number, y: number, r: number, b: Bevel): void {
    const g = this.g;
    const fill = g.createLinearGradient(x - r, y - r, x + r, y + r);
    fill.addColorStop(0, b.light);
    fill.addColorStop(0.5, b.light);
    fill.addColorStop(0.5, b.dark);
    g.fillStyle = fill;
    g.strokeStyle = b.edge;
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
    g.fill();
    g.stroke();
  }

  private drawBand(): void {
    const b = this.band;
    if (!b) return;
    const g = this.g;
    const x = Math.min(b.x0, b.x1);
    const y = Math.min(b.y0, b.y1);
    g.fillStyle = COLORS.bandFill;
    g.strokeStyle = COLORS.band;
    g.setLineDash(BAND_DASH as unknown as number[]);
    g.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    g.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    g.setLineDash([]);
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
        c.style.cursor = this.keyAt(p.x, p.y) ? 'ew-resize' : 'pointer';
        const lane = LANES.find((l) => Math.abs(p.y - this.laneY(l)) <= RULER.lane / 2);
        this.ctx.editor.setHint(lane === undefined ? HINTS.ruler : { title: `${LANE_NAMES[lane]} keys`, text: HINTS.lane });
        return;
      }
      if (d.mode === DragMode.Scrub) this.ctx.world.setTime(this.timeAt(p.x));
      if (d.mode === DragMode.Band) {
        this.band = { x0: d.x, y0: d.y, x1: p.x, y1: p.y };
        this.redraw();
      }
      if (d.mode === DragMode.Retime) this.retimeTo(d, this.timeAt(p.x));
    });
    const end = () => {
      const d = this.drag;
      if (d?.mode === DragMode.Retime) this.ctx.world.endGesture();
      if (d?.mode === DragMode.Band && this.band) {
        const b = this.band;
        const refs = this.keysInBand(b.x0, b.y0, b.x1, b.y1);
        this.ctx.editor.update({ selectedKeys: pickKeys(d.startPicked, refs, SelectMode.Add, this.anim.fps) });
      }
      this.band = null;
      this.drag = null;
      this.redraw();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
    c.addEventListener('dblclick', (e) => {
      const p = local(e);
      const key = this.keyAt(p.x, p.y);
      if (key) this.ctx.world.setTime(key.time);
    });
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

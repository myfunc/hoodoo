import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { Animation, Key } from '../../model/scene.types';
import { frameTime, retimed } from '../../world/animation/keying';
import type { UiContext } from '../context';
import { hintOn } from '../context';
import { Button } from '../kit/controls';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';

/**
 * The Hoodoo 3D animation controls under the scene window, after Bryce 3D:
 * transport buttons, the time readout, and a ruler with the time scrubber and
 * three lanes of keys — objects (the selection, or every animated object),
 * camera and sky. Drag the ruler to scrub, a key to retime it; double-click a
 * key to jump to it.
 */

enum Lane {
  Objects = 0,
  Camera = 1,
  Sky = 2,
}

const LANES = [Lane.Objects, Lane.Camera, Lane.Sky] as const;
const RULER = { top: 13, lane: 10, pad: 8, label: 18, keyHit: 6 } as const;
/** The scrubber: a red line under a small red triangle, Bryce 3D's time marker. */
const SCRUBBER = { line: 1.5, head: 5, rise: 2 } as const;
const TICKS = { frame: 3, label: 7, textGap: 14, textX: 2, textY: 5, font: '9px Geneva, Verdana, sans-serif', eps: 1e-6 } as const;
const LANE_GLYPH = { x: 2, y: 6.5, scale: 0.55, stroke: 2.6 } as const;
const COLORS = {
  tick: 'rgba(0,0,0,0.35)',
  tickText: '#5a5955',
  laneBg: ['rgba(200,40,45,0.12)', 'rgba(43,138,138,0.14)', 'rgba(200,150,40,0.16)'],
  laneEdge: 'rgba(0,0,0,0.12)',
  key: ['#c8282d', '#1f7a7a', '#b8801e'],
  keyIdle: '#8f8e8a',
  scrubber: '#d0362e',
  label: '#6d6d6a',
} as const;
const LANE_NAMES = ['Objects', 'Camera', 'Sky'] as const;
const LANE_GLYPHS = [GLYPH.cube, GLYPH.camera, GLYPH.sun] as const;
const MAX_DPR = 2;
const DIAMOND = 4.5;
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

interface Drag {
  readonly lane: Lane | null;
  readonly from: number;
  readonly startAnim: Animation;
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
  private queued = false;

  constructor(private readonly ctx: UiContext) {
    const tb = (action: Action, paths: readonly string[], title: string, cls = '') => {
      const b = new Button({ cls: `tl-button ${cls}`, title: `${title}${shortcutOf(action) ? ` (${shortcutOf(action)})` : ''}`, content: glyph(paths, GLYPH_BOX), onClick: () => ctx.dispatch(action) });
      hintOn(ctx, b.el, { title, text: shortcutOf(action) ? `Shortcut ${shortcutOf(action)}` : '' });
      return b;
    };
    this.play = tb(Action.PlayPause, GLYPH.play, 'Play / Pause', 'tl-play');
    this.loop = tb(Action.ToggleLoop, GLYPH.loop, 'Loop playback');
    this.readout = el('span', { cls: 'tl-time' });
    this.frameOut = el('span', { cls: 'tl-frame' });
    const clock = el('div', { cls: 'tl-clock', title: 'Animation Setup: length and frame rate' }, [this.readout, this.frameOut]);
    clock.addEventListener('click', () => ctx.dispatch(Action.AnimationSetup));
    hintOn(ctx, clock, { title: 'Time', text: 'Click to set the length and frame rate' });
    this.canvas = el('canvas', { cls: 'tl-ruler' });
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    hintOn(ctx, this.canvas, { title: 'Time Scrubber', text: 'Drag to scrub. Drag a key to retime it' });
    this.el = el('div', { cls: 'timeline' }, [
      el('div', { cls: 'tl-transport' }, [
        tb(Action.FirstFrame, GLYPH.toStart, 'Go to start').el,
        tb(Action.PrevKey, GLYPH.stepBack, 'Previous key').el,
        this.play.el,
        tb(Action.NextKey, GLYPH.stepForward, 'Next key').el,
        tb(Action.LastFrame, GLYPH.toEnd, 'Go to end').el,
      ]),
      clock,
      this.canvas,
      el('div', { cls: 'tl-keys' }, [
        tb(Action.AddKey, GLYPH.keyAdd, 'Add key: selection, or camera when nothing is selected').el,
        tb(Action.RemoveKey, GLYPH.keyRemove, 'Remove key at the playhead').el,
        tb(Action.KeyCamera, GLYPH.camera, 'Animate the camera: key it here').el,
        this.loop.el,
      ]),
    ]);
    this.installPointer();
    new ResizeObserver(() => this.redraw()).observe(this.canvas);
    ctx.world.events.on('changed', () => this.redraw());
    ctx.world.events.on('selection', () => this.redraw());
    ctx.editor.events.on('changed', ({ state, previous }) => {
      if (state.playing !== previous.playing) this.redraw();
    });
    this.redraw();
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
  private laneTracks(lane: Lane): readonly (readonly Key<unknown>[])[] {
    const a = this.anim;
    if (lane === Lane.Camera) return [a.camera];
    if (lane === Lane.Sky) return [a.sky];
    const sel = this.ctx.world.selection;
    const ids = sel.size ? [...sel].filter((id) => a.objects[id]) : Object.keys(a.objects);
    return ids.map((id) => a.objects[id]);
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
    const x = this.xOf(t);
    g.fillStyle = COLORS.scrubber;
    g.fillRect(Math.round(x) - 0.5, RULER.top - SCRUBBER.rise, SCRUBBER.line, ch - RULER.top + SCRUBBER.rise);
    g.beginPath();
    g.moveTo(x - SCRUBBER.head, 1);
    g.lineTo(x + SCRUBBER.head, 1);
    g.lineTo(x, RULER.top - 1);
    g.closePath();
    g.fill();
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
    g.fillStyle = COLORS.tickText;
    for (let s = 0; s <= a.duration + TICKS.eps; s += step) {
      const x = Math.round(this.xOf(s)) + 0.5;
      g.moveTo(x, RULER.top - TICKS.label);
      g.lineTo(x, RULER.top);
      if (x + TICKS.textGap < cw) g.fillText(`${s}s`, x + TICKS.textX, RULER.top - TICKS.textY);
    }
    g.stroke();
  }

  private drawLane(lane: Lane, cw: number): void {
    const g = this.g;
    const y = this.laneY(lane);
    g.fillStyle = COLORS.laneBg[lane];
    g.fillRect(RULER.label, y - RULER.lane / 2 + 0.5, cw - RULER.label, RULER.lane - 1);
    // An engraved trough: dark top edge, like Bryce's sunken slots.
    g.fillStyle = COLORS.laneEdge;
    g.fillRect(RULER.label, y - RULER.lane / 2 + 0.5, cw - RULER.label, 1);
    // A tiny glyph names the lane, like the icons of Bryce's palettes.
    g.save();
    g.translate(LANE_GLYPH.x, y - LANE_GLYPH.y);
    g.scale(LANE_GLYPH.scale, LANE_GLYPH.scale);
    g.strokeStyle = COLORS.label;
    g.lineWidth = LANE_GLYPH.stroke;
    for (const d of LANE_GLYPHS[lane]) g.stroke(new Path2D(d));
    g.restore();
    const selected = lane !== Lane.Objects || this.ctx.world.selection.size > 0;
    g.fillStyle = selected ? COLORS.key[lane] : COLORS.keyIdle;
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 1;
    const seen = new Set<number>();
    for (const track of this.laneTracks(lane)) {
      for (const k of track) {
        const x = Math.round(this.xOf(k.time));
        if (seen.has(x)) continue;
        seen.add(x);
        g.beginPath();
        g.moveTo(x, y - DIAMOND);
        g.lineTo(x + DIAMOND, y);
        g.lineTo(x, y + DIAMOND);
        g.lineTo(x - DIAMOND, y);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
  }

  /** The key under a ruler point: its lane and time, or null. */
  private keyAt(x: number, y: number): { lane: Lane; time: number } | null {
    const lane = LANES.find((l) => Math.abs(y - this.laneY(l)) <= RULER.lane / 2);
    if (lane === undefined) return null;
    let best: { lane: Lane; time: number } | null = null;
    let bestD: number = RULER.keyHit;
    for (const track of this.laneTracks(lane)) {
      for (const k of track) {
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
      this.drag = { lane: key?.lane ?? null, from: key?.time ?? 0, startAnim: this.anim };
      if (key) this.ctx.world.beginGesture('Retime key');
      else this.ctx.world.setTime(this.timeAt(p.x));
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      const d = this.drag;
      if (!d) {
        c.style.cursor = this.keyAt(p.x, p.y) ? 'ew-resize' : 'pointer';
        const lane = LANES.find((l) => Math.abs(p.y - this.laneY(l)) <= RULER.lane / 2);
        this.ctx.editor.setHint(lane === undefined
          ? { title: 'Time Scrubber', text: 'Drag to scrub. Drag a key to retime it' }
          : { title: `${LANE_NAMES[lane]} keys`, text: 'Drag a key to retime it, double-click to go there' });
        return;
      }
      if (d.lane === null) {
        this.ctx.world.setTime(this.timeAt(p.x));
        return;
      }
      this.ctx.world.setAnimation(this.retime(d, this.timeAt(p.x)), 'Retime key');
    });
    const end = () => {
      if (this.drag?.lane !== null) this.ctx.world.endGesture();
      this.drag = null;
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

  /** The timeline with the dragged key (of every track in its lane at that time) moved to `to`. */
  private retime(d: Drag, to: number): Animation {
    const a = d.startAnim;
    const target = frameTime(to, a.fps);
    if (d.lane === Lane.Camera) return { ...a, camera: retimed(a.camera, d.from, target, a) };
    if (d.lane === Lane.Sky) return { ...a, sky: retimed(a.sky, d.from, target, a) };
    const sel = this.ctx.world.selection;
    const objects = Object.fromEntries(Object.entries(a.objects).map(([id, keys]) =>
      [id, sel.size && !sel.has(id as never) ? keys : retimed(keys, d.from, target, a)]));
    return { ...a, objects };
  }
}

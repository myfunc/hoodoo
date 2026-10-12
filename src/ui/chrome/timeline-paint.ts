import { Ease } from '../../model/scene.enums';
import { rulerSteps } from './timeline-window';
import { tickLabel } from './timeline-time';

/**
 * The ledger, painted: the ruler with seconds and frame numbers, the ruled sheet
 * of rows with copper rivets for keys, the red needle, the teal end of the scene
 * with the hatched time past it, and the overview strip of the whole scene with
 * its teal window (ui/chrome/timeline.ts lays them out).
 */

/** Pixels: the sheet's rows, the ruler, and the margin that keeps a key at either end whole. */
export const SHEET = { row: 18, ruler: 18, pad: 7, keyHit: 6 } as const;
const RIVET = { r: 4.5, picked: 5.5, summary: 2.5, ring: 7.5, ringLine: 1.5, shelf: 4, highlight: 0.35 } as const;
/** The narrowest stretch of time a scale may show, in seconds. */
const MIN_SCALE_S = 1e-3;
const NEEDLE = { line: 2, bead: 4, beadY: 6 } as const;
const END = { flagW: 7, flagH: 9, flagY: 1, notch: 2, line: 2, hatch: 5, labelGap: 4 } as const;
const TICK = { frame: 3, label: 6, textX: 2, textY: 11, font: '9px Geneva, Verdana, sans-serif', bold: 'bold 9px Geneva, Verdana, sans-serif' } as const;
/** Grid columns: every frame while frames are this far apart, labelled steps always. */
const FRAME_COLUMN_PX = 6;
const WINDOW = { border: 2, grip: 4, gripInset: 4, mark: 2 } as const;
const BAND_DASH = [3, 2];

/** Rivet colours: the highlight, the body and the rim. */
interface Metal { readonly light: string; readonly body: string; readonly rim: string }
const COPPER: Metal = { light: '#f8c29c', body: '#c8622c', rim: '#6a2c0e' };
const PICKED: Metal = { light: '#fffbd0', body: '#f0b818', rim: '#2a2a2a' };
/** Keys past the end: faded, waiting for the scene to grow back. */
const GHOST: Metal = { light: '#f4f3f0', body: '#c4c3bf', rim: '#9a9994' };
const PEWTER: Metal = { light: '#e6e6e4', body: '#9a9995', rim: '#5f5e5a' };
/** The sheet's paper, rules and inks: read from the stylesheet's --tl-* variables (the dark theme sets its own), these where it sets none. */
const SURFACE_DEFAULTS = {
  rulerTop: '#ecebe4',
  rulerBottom: '#dedcd3',
  rule: '#b9b5a8',
  rowRule: '#ddd9cc',
  paper: '#f3f1ea',
  frameColumn: 'rgba(0,0,0,0.05)',
  labelColumn: 'rgba(0,0,0,0.16)',
  tick: 'rgba(0,0,0,0.38)',
  seconds: '#55565a',
  frames: '#9a978d',
  textShadow: 'rgba(255,255,255,0.9)',
  past: 'rgba(90,92,98,0.10)',
  pastHatch: 'rgba(90,92,98,0.2)',
  overviewTop: '#e8e7e1',
  overviewBottom: '#f6f5f0',
} as const;
type Surfaces = Record<keyof typeof SURFACE_DEFAULTS, string>;
/** The CSS variable of each surface: --tl-ruler-top for rulerTop. */
const cssName = (key: string): string => `--tl-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
let S: Surfaces = { ...SURFACE_DEFAULTS };

/** Reads the surfaces the stylesheet gives the timeline (once it shows, and again when the theme changes). */
export function readSurfaces(read: (name: string, fallback: string) => string): void {
  S = Object.fromEntries(Object.entries(SURFACE_DEFAULTS).map(([k, v]) => [k, read(cssName(k), v)])) as Surfaces;
}

/** Colours that read the same on light and dark chrome. */
const C = {
  selected: 'rgba(200,40,45,0.09)',
  needle: '#d0281e',
  needleDark: '#7a0e08',
  needleLight: '#ffb0a8',
  end: '#2b8a8a',
  endDark: '#1b5e5e',
  endLight: '#8fd0cc',
  endHot: '#3fb0aa',
  band: 'rgba(200,40,45,0.9)',
  bandFill: 'rgba(200,40,45,0.1)',
  ring: 'rgba(43,138,138,0.85)',
  shelf: '#6a2c0e',
  windowFill: 'rgba(43,138,138,0.1)',
  mark: '#b4511f',
} as const;

/** Where time runs on a canvas: `t0`..`t1` across `w` pixels from `x0`. */
export interface Scale {
  readonly x0: number;
  readonly w: number;
  readonly t0: number;
  readonly t1: number;
}

export const scaleOf = (cw: number, t0: number, t1: number): Scale => ({ x0: SHEET.pad, w: Math.max(1, cw - SHEET.pad * 2), t0, t1: Math.max(t1, t0 + MIN_SCALE_S) });
export const xOf = (s: Scale, t: number): number => s.x0 + ((t - s.t0) / (s.t1 - s.t0)) * s.w;
export const timeOf = (s: Scale, x: number): number => s.t0 + ((x - s.x0) / s.w) * (s.t1 - s.t0);
export const pxPerSecond = (s: Scale): number => s.w / (s.t1 - s.t0);

/** Prepares a canvas for its CSS size at the device's pixel ratio (at most 2); returns that size. */
export function fitCanvas(c: HTMLCanvasElement, g: CanvasRenderingContext2D): { cw: number; ch: number } {
  const cw = c.clientWidth;
  const ch = c.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
    c.width = Math.round(cw * dpr);
    c.height = Math.round(ch * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  return { cw, ch };
}

/** The red needle down a canvas; `bead` puts the ball on top (the ruler). */
export function paintNeedle(g: CanvasRenderingContext2D, x: number, ch: number, bead = false): void {
  g.fillStyle = C.needle;
  g.fillRect(Math.round(x) - NEEDLE.line / 2, bead ? NEEDLE.beadY : 0, NEEDLE.line, ch);
  if (!bead) return;
  const ball = g.createRadialGradient(x - 1, NEEDLE.beadY - 1, 1, x, NEEDLE.beadY, NEEDLE.bead);
  ball.addColorStop(0, C.needleLight);
  ball.addColorStop(0.5, C.needle);
  ball.addColorStop(1, C.needleDark);
  g.fillStyle = ball;
  g.beginPath();
  g.arc(x, NEEDLE.beadY, NEEDLE.bead, 0, Math.PI * 2);
  g.fill();
}

/** The time past the end of the scene: a dimmed, hatched stretch. */
export function paintPastEnd(g: CanvasRenderingContext2D, x: number, cw: number, top: number, ch: number): void {
  if (x >= cw) return;
  const from = Math.max(0, x);
  g.fillStyle = S.past;
  g.fillRect(from, top, cw - from, ch - top);
  g.save();
  g.beginPath();
  g.rect(from, top, cw - from, ch - top);
  g.clip();
  g.strokeStyle = S.pastHatch;
  g.lineWidth = 1;
  g.beginPath();
  for (let hx = from - ch; hx < cw; hx += END.hatch) {
    g.moveTo(hx, ch);
    g.lineTo(hx + ch, top);
  }
  g.stroke();
  g.restore();
}

/** The end of the scene: a line, and on the ruler a teal flag; `label` (while dragged) names the new length. */
export function paintEnd(g: CanvasRenderingContext2D, x: number, ch: number, flag: boolean, hot = false, label = ''): void {
  const lx = Math.round(x);
  g.fillStyle = C.endDark;
  g.fillRect(lx - END.line / 2, flag ? END.flagY : 0, END.line, ch);
  if (!flag) return;
  const top = END.flagY;
  const grad = g.createLinearGradient(lx, top, lx + END.flagW, top + END.flagH);
  grad.addColorStop(0, C.endLight);
  grad.addColorStop(0.5, hot ? C.endHot : C.end);
  grad.addColorStop(1, C.endDark);
  g.fillStyle = grad;
  g.strokeStyle = C.endDark;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(lx, top);
  g.lineTo(lx + END.flagW, top);
  g.lineTo(lx + END.flagW - END.notch, top + END.flagH / 2);
  g.lineTo(lx + END.flagW, top + END.flagH);
  g.lineTo(lx, top + END.flagH);
  g.closePath();
  g.fill();
  g.stroke();
  if (!label) return;
  g.font = TICK.bold;
  const w = g.measureText(label).width;
  engrave(g, label, lx - END.labelGap - w, TICK.textY, C.endDark);
}

/** Text cut into the chrome: a white shadow under the ink. */
function engrave(g: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string): void {
  g.fillStyle = S.textShadow;
  g.fillText(text, x, y + 1);
  g.fillStyle = ink;
  g.fillText(text, x, y);
}

export interface RulerFrame {
  readonly scale: Scale;
  readonly fps: number;
  readonly duration: number;
  readonly now: number;
  readonly endHot: boolean;
  /** The new length beside the end flag while it is dragged. */
  readonly endLabel: string;
}

/** The ruler: ticks on frames when there is room, seconds in ink and frame numbers in grey between them. */
export function paintRuler(g: CanvasRenderingContext2D, cw: number, ch: number, f: RulerFrame): void {
  const s = f.scale;
  const bg = g.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, S.rulerTop);
  bg.addColorStop(1, S.rulerBottom);
  g.fillStyle = bg;
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = S.rule;
  g.fillRect(0, ch - 1, cw, 1);
  const steps = rulerSteps(pxPerSecond(s), f.fps);
  const first = Math.max(0, Math.floor(s.t0 * f.fps));
  const last = Math.ceil(s.t1 * f.fps);
  g.strokeStyle = S.tick;
  g.lineWidth = 1;
  g.beginPath();
  for (let fr = Math.ceil(first / steps.tick) * steps.tick; fr <= last; fr += steps.tick) {
    const x = Math.round(xOf(s, fr / f.fps)) + 0.5;
    g.moveTo(x, ch - TICK.frame);
    g.lineTo(x, ch);
  }
  g.font = TICK.font;
  for (let fr = Math.ceil(first / steps.label) * steps.label; fr <= last; fr += steps.label) {
    const x = Math.round(xOf(s, fr / f.fps)) + 0.5;
    g.moveTo(x, ch - TICK.label);
    g.lineTo(x, ch);
    const second = fr % f.fps === 0;
    engrave(g, second ? tickLabel(fr / f.fps) : String(fr), x + TICK.textX, TICK.textY, second ? S.seconds : S.frames);
  }
  g.stroke();
  const end = xOf(s, f.duration);
  paintPastEnd(g, end, cw, 0, ch);
  paintEnd(g, end, ch, true, f.endHot, f.endLabel);
  paintNeedle(g, xOf(s, f.now), ch, true);
}

/** One key on a row. */
export interface RowKey {
  readonly time: number;
  readonly picked: boolean;
  /** Past the end of the scene. */
  readonly ghost: boolean;
  readonly ease: Ease;
  readonly hot: boolean;
}

export interface LaneRow {
  /** The row's top on the canvas. */
  readonly y: number;
  readonly keys: readonly RowKey[];
  /** Folded group: the times of the keys inside it. */
  readonly summary: readonly number[];
  readonly selected: boolean;
}

export interface LanesFrame {
  readonly scale: Scale;
  readonly fps: number;
  readonly duration: number;
  readonly now: number;
  readonly rows: readonly LaneRow[];
  readonly band: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** A copper rivet; Linear keys are diamonds, eased keys carry a flat shelf on the side that slows. */
export function paintRivet(g: CanvasRenderingContext2D, x: number, y: number, r: number, m: Metal, ease: Ease): void {
  const fill = g.createRadialGradient(x - r * RIVET.highlight, y - r * RIVET.highlight, r / 4, x, y, r);
  fill.addColorStop(0, m.light);
  fill.addColorStop(0.5, m.body);
  fill.addColorStop(1, m.rim);
  g.fillStyle = fill;
  g.strokeStyle = m.rim;
  g.lineWidth = 1;
  g.beginPath();
  if (ease === Ease.Linear) {
    g.moveTo(x, y - r - 1);
    g.lineTo(x + r + 1, y);
    g.lineTo(x, y + r + 1);
    g.lineTo(x - r - 1, y);
    g.closePath();
  } else {
    g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.fill();
  if (m === PICKED) g.stroke();
  if (ease !== Ease.In && ease !== Ease.Out) return;
  const side = ease === Ease.In ? -1 : 1;
  g.strokeStyle = C.shelf;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x + side * r, y);
  g.lineTo(x + side * (r + RIVET.shelf), y);
  g.stroke();
}

/** The ruled sheet: rows, frame and label columns, the hatched time past the end, the keys and the needle. */
export function paintLanes(g: CanvasRenderingContext2D, cw: number, ch: number, f: LanesFrame): void {
  const s = f.scale;
  g.fillStyle = S.paper;
  g.fillRect(0, 0, cw, ch);
  for (const row of f.rows) {
    if (row.selected) {
      g.fillStyle = C.selected;
      g.fillRect(0, row.y, cw, SHEET.row);
    }
    g.fillStyle = S.rowRule;
    g.fillRect(0, row.y + SHEET.row - 1, cw, 1);
  }
  const steps = rulerSteps(pxPerSecond(s), f.fps);
  const frameCols = pxPerSecond(s) / f.fps >= FRAME_COLUMN_PX;
  const first = Math.max(0, Math.floor(s.t0 * f.fps));
  for (let fr = first; fr <= Math.ceil(s.t1 * f.fps); fr += frameCols ? 1 : steps.label) {
    if (!frameCols && fr % steps.label) continue;
    g.fillStyle = fr % steps.label === 0 && fr % f.fps === 0 ? S.labelColumn : S.frameColumn;
    g.fillRect(Math.round(xOf(s, fr / f.fps)), 0, 1, ch);
  }
  const end = xOf(s, f.duration);
  paintPastEnd(g, end, cw, 0, ch);
  paintEnd(g, end, ch, false);
  for (const row of f.rows) {
    const y = row.y + SHEET.row / 2;
    for (const t of row.summary) paintRivet(g, xOf(s, t), y, RIVET.summary, PEWTER, Ease.Smooth);
    for (const k of row.keys) {
      const x = xOf(s, k.time);
      if (x < -SHEET.pad || x > cw + SHEET.pad) continue;
      if (k.hot) {
        g.strokeStyle = C.ring;
        g.lineWidth = RIVET.ringLine;
        g.beginPath();
        g.arc(x, y, RIVET.ring, 0, Math.PI * 2);
        g.stroke();
      }
      paintRivet(g, x, y, k.picked ? RIVET.picked : RIVET.r, k.picked ? PICKED : k.ghost ? GHOST : COPPER, k.ease);
    }
  }
  if (f.band) paintBand(g, f.band);
  paintNeedle(g, xOf(s, f.now), ch);
}

/** The drag box that picks keys. */
function paintBand(g: CanvasRenderingContext2D, b: { x0: number; y0: number; x1: number; y1: number }): void {
  const x = Math.min(b.x0, b.x1);
  const y = Math.min(b.y0, b.y1);
  g.fillStyle = C.bandFill;
  g.strokeStyle = C.band;
  g.lineWidth = 1;
  g.setLineDash(BAND_DASH);
  g.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
  g.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
  g.setLineDash([]);
}

export interface OverviewFrame {
  /** The whole scene: 0..total across the strip. */
  readonly scale: Scale;
  readonly duration: number;
  readonly now: number;
  readonly t0: number;
  readonly t1: number;
  /** Key marks: time and row index. */
  readonly marks: readonly { readonly time: number; readonly row: number }[];
  readonly rows: number;
}

/** The overview: every key as a tick, the time past the end, the teal window of the sheet with its grips, the needle. */
export function paintOverview(g: CanvasRenderingContext2D, cw: number, ch: number, f: OverviewFrame): void {
  const s = f.scale;
  const bg = g.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, S.overviewTop);
  bg.addColorStop(1, S.overviewBottom);
  g.fillStyle = bg;
  g.fillRect(0, 0, cw, ch);
  const lane = Math.max(1, (ch - WINDOW.border * 2) / Math.max(1, f.rows));
  g.fillStyle = C.mark;
  for (const m of f.marks) {
    const x = Math.round(xOf(s, m.time));
    g.fillRect(x, WINDOW.border + m.row * lane, WINDOW.mark, Math.max(1, lane - 1));
  }
  const end = xOf(s, f.duration);
  paintPastEnd(g, end, cw, 0, ch);
  paintEnd(g, end, ch, false);
  const x0 = xOf(s, f.t0);
  const x1 = xOf(s, f.t1);
  g.fillStyle = C.windowFill;
  g.fillRect(x0, 0, x1 - x0, ch);
  g.strokeStyle = C.end;
  g.lineWidth = WINDOW.border;
  g.strokeRect(x0 + 1, 1, Math.max(WINDOW.border, x1 - x0 - WINDOW.border), ch - WINDOW.border);
  g.fillStyle = C.end;
  g.fillRect(x0 - WINDOW.grip + 1, WINDOW.gripInset, WINDOW.grip, ch - WINDOW.gripInset * 2);
  g.fillRect(x1 - 1, WINDOW.gripInset, WINDOW.grip, ch - WINDOW.gripInset * 2);
  paintNeedle(g, xOf(s, f.now), ch);
}

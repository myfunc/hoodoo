import { tickLabel } from './timeline-time';

/**
 * The Time Palette's ruler, painted: engraved grooves, bevelled copper keys, the
 * red scrubber needle, the tick scale and the teal end marker with the hatched
 * time past the end of the scene (ui/chrome/timeline.ts lays them out).
 */

/** Rows of the ruler: the tick scale on top, then one groove per lane. */
export const RULER = { top: 13, lane: 10, pad: 8, label: 18, keyHit: 6 } as const;
/** The scrubber: a red needle with a bead on top, riding the tick groove. */
const SCRUBBER = { line: 1.5, bead: 3.5, beadY: 9.5, highlight: 1.5 } as const;
/** An engraved groove: a dark upper lip and a light lower one. */
export const GROOVE = { height: 6, top: 4 } as const;
const TICKS = { frame: 3, label: 7, textGap: 14, textX: 2, textY: 5, font: '9px Geneva, Verdana, sans-serif', eps: 1e-6 } as const;
const LANE_GLYPH = { x: 2, y: 6.5, scale: 0.55, stroke: 2.6 } as const;
/** The end marker: a teal flag on the tick row and a line down the grooves. */
const END = { flagW: 6, flagH: 8, flagY: 1, notch: 2, line: 2, hatch: 5, labelGap: 4, font: 'bold 9px Geneva, Verdana, sans-serif' } as const;
/** Key colours: the lit facet, the shaded facet and the outline. */
export interface Bevel { readonly light: string; readonly dark: string; readonly edge: string }
export const COPPER: Bevel = { light: '#f3a676', dark: '#b4511f', edge: '#6a2c0e' };
export const PEWTER: Bevel = { light: '#d6d6d4', dark: '#8f8e8a', edge: '#5f5e5a' };
export const PICKED: Bevel = { light: '#fff08a', dark: '#f0b818', edge: '#2a2a2a' };
/** Keys past the end: faded, waiting for the scene to grow back. */
export const GHOST: Bevel = { light: '#ecebe8', dark: '#c4c3bf', edge: '#9a9994' };
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
  past: 'rgba(90,92,98,0.13)',
  pastHatch: 'rgba(90,92,98,0.22)',
  end: '#2b8a8a',
  endDark: '#1b5e5e',
  endLight: '#8fd0cc',
  endHot: '#3fb0aa',
} as const;
const MIN_TICK_PX = 6;
const LABEL_EVERY_PX = 46;
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300] as const;
const BAND_DASH = [3, 2] as const;

/** Where the ruler's time runs: from x0, w pixels for `view` seconds. */
export interface Span {
  readonly x0: number;
  readonly w: number;
  readonly view: number;
}

export const xAt = (s: Span, t: number): number => s.x0 + (t / s.view) * s.w;

/** The red needle down the grooves, a bead on top of it. */
export function paintScrubber(g: CanvasRenderingContext2D, x: number, ch: number): void {
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
export function paintGroove(g: CanvasRenderingContext2D, y: number, h: number, x0: number, x1: number): void {
  const top = Math.round(y - h / 2) + 0.5;
  g.fillStyle = COLORS.grooveFill;
  g.fillRect(x0, top, x1 - x0, h);
  g.fillStyle = COLORS.grooveShade;
  g.fillRect(x0, top, x1 - x0, 1);
  g.fillStyle = COLORS.grooveLight;
  g.fillRect(x0, top + h, x1 - x0, 1);
}

/** A tiny glyph naming a lane, like the icons of Bryce's palettes. */
export function paintLaneGlyph(g: CanvasRenderingContext2D, paths: readonly string[], y: number): void {
  g.save();
  g.translate(LANE_GLYPH.x, y - LANE_GLYPH.y);
  g.scale(LANE_GLYPH.scale, LANE_GLYPH.scale);
  g.strokeStyle = COLORS.label;
  g.lineWidth = LANE_GLYPH.stroke;
  for (const d of paths) g.stroke(new Path2D(d));
  g.restore();
}

/** The time scale: frame ticks when there is room, labelled seconds every few dozen pixels. */
export function paintTicks(g: CanvasRenderingContext2D, s: Span, fps: number, cw: number): void {
  const pxPerS = s.w / s.view;
  g.strokeStyle = COLORS.tick;
  g.lineWidth = 1;
  g.beginPath();
  if (pxPerS / fps >= MIN_TICK_PX) {
    for (let f = 0; f <= s.view * fps; f++) {
      const x = Math.round(xAt(s, f / fps)) + 0.5;
      g.moveTo(x, RULER.top - TICKS.frame);
      g.lineTo(x, RULER.top);
    }
  }
  const step = TICK_STEPS.find((t) => t * pxPerS >= LABEL_EVERY_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
  g.font = TICKS.font;
  for (let t = 0; t <= s.view + TICKS.eps; t += step) {
    const x = Math.round(xAt(s, t)) + 0.5;
    g.moveTo(x, RULER.top - TICKS.label);
    g.lineTo(x, RULER.top);
    if (x + TICKS.textGap >= cw) continue;
    // Engraved numbers: a white shadow under dark ink.
    g.fillStyle = COLORS.tickTextShadow;
    g.fillText(tickLabel(t), x + TICKS.textX, RULER.top - TICKS.textY + 1);
    g.fillStyle = COLORS.tickText;
    g.fillText(tickLabel(t), x + TICKS.textX, RULER.top - TICKS.textY);
  }
  g.stroke();
}

/** A bevelled diamond: two facets, lit on the upper left, shaded on the lower right. */
export function paintDiamond(g: CanvasRenderingContext2D, x: number, y: number, r: number, b: Bevel): void {
  const fill = g.createLinearGradient(x - r, y - r, x + r, y + r);
  fill.addColorStop(0, b.light);
  fill.addColorStop(0.5, b.light);
  fill.addColorStop(0.5, b.dark);
  g.fillStyle = fill;
  g.strokeStyle = b.edge;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fill();
  g.stroke();
}

/** The time past the end of the scene: a hatched, dimmed stretch of the grooves. */
export function paintPastEnd(g: CanvasRenderingContext2D, x: number, cw: number, ch: number): void {
  if (x >= cw) return;
  g.fillStyle = COLORS.past;
  g.fillRect(x, RULER.top, cw - x, ch - RULER.top);
  g.save();
  g.beginPath();
  g.rect(x, RULER.top, cw - x, ch - RULER.top);
  g.clip();
  g.strokeStyle = COLORS.pastHatch;
  g.lineWidth = 1;
  g.beginPath();
  for (let hx = x - ch; hx < cw; hx += END.hatch) {
    g.moveTo(hx, ch);
    g.lineTo(hx + ch, 0);
  }
  g.stroke();
  g.restore();
}

/**
 * The end of the scene: a teal flag on the tick row with a line down the grooves.
 * `label` (while it is dragged) shows the new length beside the flag.
 */
export function paintEnd(g: CanvasRenderingContext2D, x: number, ch: number, hot: boolean, label = ''): void {
  const lx = Math.round(x);
  g.fillStyle = COLORS.endDark;
  g.fillRect(lx - END.line / 2, END.flagY, END.line, ch - END.flagY);
  const top = END.flagY;
  const flag = g.createLinearGradient(lx, top, lx + END.flagW, top + END.flagH);
  flag.addColorStop(0, COLORS.endLight);
  flag.addColorStop(0.5, hot ? COLORS.endHot : COLORS.end);
  flag.addColorStop(1, COLORS.endDark);
  g.fillStyle = flag;
  g.strokeStyle = COLORS.endDark;
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
  g.font = END.font;
  const w = g.measureText(label).width;
  g.fillStyle = COLORS.tickTextShadow;
  g.fillText(label, lx - END.labelGap - w, RULER.top - TICKS.textY + 1);
  g.fillStyle = COLORS.endDark;
  g.fillText(label, lx - END.labelGap - w, RULER.top - TICKS.textY);
}

/** The Shift-drag box that picks keys. */
export function paintBand(g: CanvasRenderingContext2D, b: { x0: number; y0: number; x1: number; y1: number }): void {
  const x = Math.min(b.x0, b.x1);
  const y = Math.min(b.y0, b.y1);
  g.fillStyle = COLORS.bandFill;
  g.strokeStyle = COLORS.band;
  g.setLineDash(BAND_DASH as unknown as number[]);
  g.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
  g.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
  g.setLineDash([]);
}

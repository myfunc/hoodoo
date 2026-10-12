/**
 * The stretch of time the ledger shows: zoomed and scrolled with the overview
 * strip under it, fitted to the whole scene by default. Seconds throughout.
 */

export interface TimeWindow {
  readonly t0: number;
  readonly t1: number;
}

/** The narrowest window, in frames across. */
export const MIN_FRAMES = 8;
/** Frame steps that divide a second evenly, by frame rate; whole seconds above them. */
const SECOND_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300] as const;
/** Labels at least this far apart, in pixels. */
const LABEL_PX = 30;
/** Ticks at least this far apart: every frame when there is room, else every few. */
const TICK_PX = 5;

export const fitWindow = (total: number): TimeWindow => ({ t0: 0, t1: total });

export const span = (w: TimeWindow): number => w.t1 - w.t0;

/** The window inside 0..total, no narrower than `min` seconds (nor wider than the scene). */
export function clampWindow(w: TimeWindow, total: number, min: number): TimeWindow {
  const width = Math.min(total, Math.max(min, span(w)));
  const t0 = Math.min(total - width, Math.max(0, w.t0));
  return { t0, t1: t0 + width };
}

/** Zoomed by `factor` (below 1 zooms in) about the time `at`, which stays where it is. */
export function zoomWindow(w: TimeWindow, factor: number, at: number, total: number, min: number): TimeWindow {
  const width = Math.min(total, Math.max(min, span(w) * factor));
  const k = span(w) > 0 ? (at - w.t0) / span(w) : 0.5;
  return clampWindow({ t0: at - k * width, t1: at - k * width + width }, total, min);
}

/** Scrolled by `dt` seconds, its width kept. */
export const panWindow = (w: TimeWindow, dt: number, total: number, min: number): TimeWindow =>
  clampWindow({ t0: w.t0 + dt, t1: w.t1 + dt }, total, min);

/** The window paged so `t` is inside it (playback follows the playhead); the same window when it already is. */
export function followWindow(w: TimeWindow, t: number, total: number, min: number): TimeWindow {
  if (t >= w.t0 && t <= w.t1) return w;
  return clampWindow({ t0: t, t1: t + span(w) }, total, min);
}

/** True when the window shows the whole scene. */
export const isFitted = (w: TimeWindow, total: number, fps: number): boolean => w.t0 <= 0.5 / fps && w.t1 >= total - 0.5 / fps;

/** Frame steps worth labelling at this frame rate: the divisors of a second, then whole seconds. */
function frameSteps(fps: number): number[] {
  const divisors = Array.from({ length: fps }, (_, i) => i + 1).filter((f) => fps % f === 0 && f < fps);
  return [...divisors, ...SECOND_STEPS.map((s) => s * fps)];
}

export interface RulerSteps {
  /** Frames between labels. */
  readonly label: number;
  /** Frames between ticks. */
  readonly tick: number;
}

/** How often the ruler labels and ticks at `pxPerS` pixels a second. */
export function rulerSteps(pxPerS: number, fps: number): RulerSteps {
  const pxPerFrame = pxPerS / fps;
  const steps = frameSteps(fps);
  const label = steps.find((f) => f * pxPerFrame >= LABEL_PX) ?? steps[steps.length - 1];
  // Ticks divide the labelled step evenly.
  const tick = steps.find((f) => f * pxPerFrame >= TICK_PX && label % f === 0) ?? label;
  return { label, tick };
}

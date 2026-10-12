import type { RealtimeStatus } from '../../render/gpu/view-renderer';

const MS_PER_S = 1000;
const S_PER_MIN = 60;
const PERCENT = 100;
/** Below this many seconds a time shows tenths. */
const TENTHS_BELOW_S = 10;
const PAD = 2;

/** A duration in a few characters: 0.4 s, 12 s, 2:05. */
export function formatTime(ms: number): string {
  const s = Math.max(0, ms) / MS_PER_S;
  if (s < TENTHS_BELOW_S) return `${s.toFixed(1)} s`;
  if (s < S_PER_MIN) return `${Math.round(s)} s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / S_PER_MIN)}:${String(whole % S_PER_MIN).padStart(PAD, '0')}`;
}

/** One pass of rays over the picture: 0.8 ms, 41 ms, 1.2 s. */
export function formatPass(ms: number): string {
  if (ms >= MS_PER_S) return formatTime(ms);
  return ms < 1 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

/** The display bar's line for a picture that draws itself: the live preview, or Render View (kept short: the bar is narrow). */
export function pictureLine(s: RealtimeStatus): string {
  const f = s.final;
  if (!f) {
    if (s.moving) return `Live · ${s.fps} fps · ${Math.round(s.scale * PERCENT)}% res`;
    return s.samples >= s.target ? `Live · converged ${s.samples} rays/px` : `Live · refining ${s.samples}/${s.target}`;
  }
  if (s.moving) return `Render View · ${s.fps} fps`;
  if (s.samples >= s.target) return `Render View · ${s.samples} rays in ${formatTime(f.elapsedMs)}`;
  return `Render View · ${s.samples}/${s.target} · ${formatTime(f.remainingMs)} left`;
}

/** Render Options' speed line: pictures a second and time a pass while things move, then the way to the target. */
export function speedLine(s: RealtimeStatus): string {
  const f = s.final;
  if (!f || f.passMs <= 0) return 'Measuring…';
  const pass = `${formatPass(f.passMs)} a pass`;
  if (s.moving) return `${s.fps} fps · ${pass} · ${s.samples}/${s.target} rays`;
  if (s.samples >= s.target) return `${s.samples} rays in ${formatTime(f.elapsedMs)} · ${pass}`;
  return `${s.samples}/${s.target} rays · ${formatTime(f.remainingMs)} left · ${pass}`;
}

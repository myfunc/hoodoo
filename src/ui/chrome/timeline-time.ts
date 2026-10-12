/** Times on the timeline as people read and type them: 0:03.2, 1:30, 45s, 2m. */

const SECONDS_PER_MINUTE = 60;
const SECONDS_WIDTH = 4;
const TENTHS = 10;
/** 1:30.5 · 90 · 90.5s · 2m · 2m30s, spaces allowed. */
const CLOCK = /^(?:(\d+(?:\.\d*)?)\s*m\s*(?:(\d+(?:\.\d*)?)\s*s?)?|(?:(\d+):)?(\d+(?:\.\d*)?|\.\d+)\s*s?)$/i;

/** 0:03.2 — minutes, seconds and tenths. */
export function formatClock(t: number): string {
  const tenths = Math.round(Math.max(0, t) * TENTHS);
  const m = Math.floor(tenths / (SECONDS_PER_MINUTE * TENTHS));
  const s = (tenths - m * SECONDS_PER_MINUTE * TENTHS) / TENTHS;
  return `${m}:${s.toFixed(1).padStart(SECONDS_WIDTH, '0')}`;
}

/** Seconds from typed text, or null when it is not a time. */
export function parseClock(text: string): number | null {
  const r = CLOCK.exec(text.trim());
  if (!r) return null;
  const [, minutesM, secondsM, minutes, seconds] = r;
  const v = minutesM !== undefined
    ? Number(minutesM) * SECONDS_PER_MINUTE + Number(secondsM ?? 0)
    : Number(minutes ?? 0) * SECONDS_PER_MINUTE + Number(seconds);
  return Number.isFinite(v) ? v : null;
}

/** A ruler label: 5s below a minute, 1:30 above. */
export function tickLabel(s: number): string {
  if (s < SECONDS_PER_MINUTE) return `${s}s`;
  const m = Math.floor(s / SECONDS_PER_MINUTE);
  return `${m}:${String(s - m * SECONDS_PER_MINUTE).padStart(2, '0')}`;
}

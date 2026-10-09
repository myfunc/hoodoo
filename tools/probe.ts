// Dev tool: does the first launch freeze the page? Runs the app and records frame gaps
// and long tasks until the renderer is ready, then posts them to `?report=<url>`.
// Open as tools/probe.html?cold&report=http://<host>:<port>/ on the machine under test.
import '../src/main';

const params = new URLSearchParams(location.search);
const report = params.get('report');
const LIMIT_MS = 180000;
const GAP_MS = 100;
const t0 = performance.now();
const gaps: [number, number][] = [];
const long: [number, number][] = [];
let last = t0;
let frames = 0;
const marks: Record<string, number> = {};
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) long.push([Math.round(e.startTime), Math.round(e.duration)]);
}).observe({ type: 'longtask', buffered: true });
const origInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const text = args.map(String).join(' ');
  for (const key of ['trace program linked', 'trace program compiled', 'started']) if (text.includes(key) && !(key in marks)) marks[key] = Math.round(performance.now() - t0);
  origInfo(...args);
};
const tick = (now: number) => {
  if (now - last > GAP_MS) gaps.push([Math.round(last - t0), Math.round(now - last)]);
  last = now;
  frames++;
  const w = window as unknown as { __hoodooReady?: boolean };
  if (w.__hoodooReady || now - t0 > LIMIT_MS) void send(Math.round(now - t0));
  else requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

/** `?twice`: reload once in the same tab and report both visits (is the compiled shader cached?). */
const FIRST_KEY = 'probe.first';

async function send(ms: number): Promise<void> {
  const result = { readyMs: ms, frames, marks, gaps, long };
  if (params.has('twice') && !sessionStorage.getItem(FIRST_KEY)) {
    sessionStorage.setItem(FIRST_KEY, JSON.stringify(result));
    location.reload();
    return;
  }
  const first = sessionStorage.getItem(FIRST_KEY);
  const body = JSON.stringify(first ? { first: JSON.parse(first), second: result } : { ...result, ua: navigator.userAgent });
  (document.title = 'done');
  if (report) await fetch(report, { method: 'POST', mode: 'no-cors', body });
}

// Interaction profile: drags an object or orbits the camera in the live view and reports frame times.
// Usage: node tools/perf-interact.mjs <url> [demo|waltz] [drag|orbit] [ms]
//   DPR=2 for a retina screen; W=2560 H=1440 for a bigger window (a stand-in for a slower GPU);
//   SHOTS=<prefix> saves <prefix>-moving.png and <prefix>-settled.png of the picture.
// Prints median / p95 / p99 / max of the requestAnimationFrame deltas while the gesture runs, the
// frames over 33 ms, the long main-thread tasks, and how often the live resolution changed.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const [base, scene = 'demo', gesture = 'drag', ms = '10000'] = process.argv.slice(2);
const DPR = Number(process.env.DPR ?? 1);
const W = Number(process.env.W ?? 1440);
const H = Number(process.env.H ?? 900);
const SLOW_MS = 33;
const MOVE_HZ = 125;
const RADIUS = 70;
const PERIOD_MS = 2500;
const SETTLE_MS = 2000;

const browser = await puppeteer.launch(launchOptions([`--window-size=${W},${H}`]));
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  localStorage.clear();
  const w = window;
  w.__rec = null;
  let last = 0;
  const tick = (now) => {
    if (w.__rec && last) w.__rec.frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (w.__rec) w.__rec.long.push(Math.round(e.duration));
  }).observe({ type: 'longtask', buffered: false });
});
const url = new URL(base);
url.searchParams.set('start', scene === 'demo' ? '0' : '1');
await page.goto(url.href, { waitUntil: 'load' });
if (scene !== 'demo') {
  await page.waitForSelector('.start-card');
  await page.evaluate((name) => {
    const card = [...document.querySelectorAll('.start-card')].find((c) => c.textContent.includes(name));
    card.click();
  }, scene === 'waltz' ? 'Moon Waltz' : scene);
}
await page.waitForFunction('window.__hoodooReady === true', { timeout: 60000 });
// Let the picture converge and the thumbnails settle before measuring.
await page.evaluate(() => new Promise((resolve) => {
  const view = window.__hoodoo.view;
  window.__live = [];
  view.events.on('live', (s) => { if (window.__rec) window.__live.push([s.scale, s.fps, s.moving]); });
  window.__changes = 0;
  window.__hoodoo.world.events.on('changed', () => { window.__changes++; });
  // A picture reaches the screen when the engine presents to the canvas itself (into: null).
  const engine = view.engine;
  const present = engine.present.bind(engine);
  engine.present = (b) => {
    if (window.__rec && !b.into) window.__rec.pictures.push(performance.now());
    present(b);
  };
  const off = view.events.on('live', (s) => { if (!s.moving && s.samples >= s.target) { off?.(); resolve(); } });
  setTimeout(resolve, 8000);
}));
await new Promise((r) => setTimeout(r, 1000));

// Where to press: an object near the middle of the picture (drag), or the picture's middle (orbit).
const at = await page.evaluate((g) => {
  const { world, view } = window.__hoodoo;
  const cell = view.mainCell();
  const box = view.root.getBoundingClientRect();
  const cx = cell.frame.x + cell.frame.w / 2;
  const cy = cell.frame.y + cell.frame.h / 2;
  if (g !== 'drag') return { x: box.left + cx, y: box.top + cy, name: '' };
  let best = null;
  for (const o of world.scene.objects) {
    world.select([o.id], 'replace');
    view.requestDraw();
    view['draw']();
    const s = view.mainCell().segments.get(o.id);
    if (!s || s.length < 4) continue;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < s.length; i += 2) { sx += s[i]; sy += s[i + 1]; }
    const mx = sx / (s.length / 2);
    const my = sy / (s.length / 2);
    const span = Math.hypot(s[0] - mx, s[1] - my);
    const d = Math.hypot(mx - cx, my - cy);
    // Skip infinite planes and anything bigger than half the picture.
    if (span > cell.frame.w / 2 || mx < cell.frame.x || mx > cell.frame.x + cell.frame.w) continue;
    if (!best || d < best.d) best = { d, id: o.id, name: o.name, x: s[0], y: s[1] };
  }
  world.select([], 'replace');
  if (!best) return null;
  world.select([best.id], 'replace');
  return { x: box.left + best.x, y: box.top + best.y, name: best.name };
}, gesture);
if (!at) throw new Error('nothing to drag');
await new Promise((r) => setTimeout(r, 1500));

const button = gesture === 'orbit' ? 'right' : 'left';
await page.mouse.move(at.x, at.y);
await page.mouse.down({ button });
await page.evaluate(() => { window.__rec = { frames: [], long: [], pictures: [] }; window.__live = []; window.__changes = 0; });
const t0 = Date.now();
// A real mouse reports faster than the screen refreshes and the browser hands the page one move
// per frame; moves are sent without waiting for each round trip so the page sees that rate.
const cdp = await page.createCDPSession();
const buttons = button === 'right' ? 2 : 1;
await new Promise((resolve) => {
  const timer = setInterval(() => {
    const t = Date.now() - t0;
    if (t >= Number(ms)) {
      clearInterval(timer);
      resolve();
      return;
    }
    const a = (t / PERIOD_MS) * Math.PI * 2;
    const x = at.x + Math.sin(a) * RADIUS;
    const y = at.y + (1 - Math.cos(a)) * RADIUS * 0.5;
    cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button, buttons }).catch(() => undefined);
  }, 1000 / MOVE_HZ);
});
await page.mouse.move(at.x, at.y);
const moving = await page.evaluate(() => { const r = { ...window.__rec, live: window.__live, changes: window.__changes }; window.__rec = { frames: [], long: [], pictures: [] }; window.__live = []; return r; });
await page.mouse.up({ button });
await new Promise((r) => setTimeout(r, SETTLE_MS));
const settle = await page.evaluate(() => { const r = { ...window.__rec, live: window.__live }; window.__rec = null; return r; });
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
// SHOTS=<prefix>: the picture as it looks while moving (held in that state), then settled.
if (process.env.SHOTS) {
  const clip = await page.evaluate(() => {
    const { view } = window.__hoodoo;
    const box = view.root.getBoundingClientRect();
    const f = view.mainCell().frame;
    return { x: box.left + f.x, y: box.top + f.y, width: f.w, height: f.h };
  });
  await page.evaluate(() => {
    const r = window.__hoodoo.view.realtime;
    r.lastChange = performance.now() + 1e9;
    r.previewDue = true;
    window.__hoodoo.view.updateLive();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `${process.env.SHOTS}-moving.png`, clip });
  // Release it and keep the first settled frames, which dissolve from the moving one.
  await page.evaluate(() => {
    const { view } = window.__hoodoo;
    window.__fade = [];
    const kept = new Set();
    view.events.on('live', (st) => {
      if (st.moving || st.samples < 1 || st.samples > 4 || kept.has(st.samples)) return;
      kept.add(st.samples);
      window.__fade.push([st.samples, view.capture()?.toDataURL('image/png')]);
    });
    view.realtime.lastChange = 0;
  });
  await new Promise((r) => setTimeout(r, 4000));
  for (const [n, url] of await page.evaluate(() => window.__fade)) {
    if (url) fs.writeFileSync(`${process.env.SHOTS}-settle${n}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  await page.screenshot({ path: `${process.env.SHOTS}-settled.png`, clip });
}
await browser.close();

function stats(frames) {
  const s = [...frames].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r = (v) => Math.round(v * 10) / 10;
  return { n: s.length, median: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s.at(-1) ?? 0), over33: s.filter((f) => f > SLOW_MS).length };
}
const gaps = (t) => t.slice(1).map((v, i) => v - t[i]);
function scales(live) {
  let changes = 0;
  for (let i = 1; i < live.length; i++) if (live[i][0] !== live[i - 1][0]) changes++;
  const used = [...new Set(live.map((l) => l[0].toFixed(2)))];
  return { changes, used: used.slice(0, 12), readoutFps: live.at(-1)?.[1] ?? 0 };
}
const label = `${scene} ${gesture} ${W}×${H} DPR ${DPR}`;
console.log(JSON.stringify({
  label, target: at.name, changesPerS: Math.round(moving.changes / (Number(ms) / 1000)),
  picture: stats(gaps(moving.pictures)),
  moving: { ...stats(moving.frames), long: moving.long.length, longMax: Math.max(0, ...moving.long), ...scales(moving.live) },
  settle: { ...stats(settle.frames), long: settle.long.length, longMax: Math.max(0, ...settle.long) },
  errors,
}));

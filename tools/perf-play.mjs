// Play profile: enters Play on an example, walks or flies for a while and reports how often the
// game renderer showed a picture and at what traced size.
// Usage: node tools/perf-play.mjs <url> [demo|<example name>] [walk|fly] [ms]
//   DPR=2 for a retina screen; W=2560 H=1440 for a bigger window;
//   LOOK=<name> picks a look (?look=, render/gpu/game-looks.ts); QUALITY=fast|full|detailed draws Play
//   with the live preview instead, to compare; SHOT=<file.png> saves the picture at the end.
// Prints median / p95 / max of the time between pictures, the pictures over 20 ms (a missed 60 Hz
// refresh), the animation-frame deltas, the long tasks, and the traced sizes used.
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const [base, scene = 'demo', motion = 'walk', ms = '8000'] = process.argv.slice(2);
const DPR = Number(process.env.DPR ?? 1);
const W = Number(process.env.W ?? 1440);
const H = Number(process.env.H ?? 900);
const MISSED_MS = 20;
const WARMUP_MS = 2500;
const TURN_EVERY_MS = 16;
const TURN_PX = 3;
const PITCH_PX = 1.2;
const PERIOD_MS = 3000;

const browser = await puppeteer.launch(launchOptions([`--window-size=${W},${H}`]));
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.evaluateOnNewDocument((actor) => {
  localStorage.clear();
  localStorage.setItem('hoodoo.prefs.v1', JSON.stringify({ features: ['play'], playActor: actor }));
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
}, motion === 'fly' ? 'plane' : 'walker');
const url = new URL(base);
url.searchParams.set('start', scene === 'demo' ? '0' : '1');
if (process.env.LOOK) url.searchParams.set('look', process.env.LOOK);
await page.goto(url.href, { waitUntil: 'load' });
if (scene !== 'demo') {
  await page.waitForSelector('.start-card');
  await page.evaluate((name) => [...document.querySelectorAll('.start-card')].find((c) => c.textContent.includes(name)).click(), scene);
}
await page.waitForFunction('window.__hoodooReady === true', { timeout: 90000 });
await page.keyboard.down('Shift');
await page.keyboard.press('KeyP');
await page.keyboard.up('Shift');
await page.waitForFunction('window.__hoodooPlay?.sim?.() != null', { timeout: 60000 });
// Every picture the game renderer (or, with QUALITY, the live preview) puts on the canvas.
await page.evaluate((quality) => {
  const { view } = window.__hoodoo;
  const pictures = view.pictures;
  if (quality) {
    view.play = { ...view.play, quality };
    pictures.setPlay(quality);
  }
  const game = pictures.game;
  const draw = game.draw.bind(game);
  game.draw = () => {
    draw();
    if (window.__rec) window.__rec.pictures.push(performance.now());
  };
  const present = view.engine.present.bind(view.engine);
  view.engine.present = (b) => {
    if (window.__rec && !b.into) window.__rec.pictures.push(performance.now());
    present(b);
  };
  window.__scales = [];
  view.events.on('live', (s) => { if (window.__rec) window.__scales.push(s.scale); });
  window.__hoodooPlay.run();
}, process.env.QUALITY ?? '');
await new Promise((r) => setTimeout(r, WARMUP_MS));
// Forward (W) and a slow weave of the mouse: the walker turns, the plane banks and climbs.
await page.evaluate(() => { window.__rec = { frames: [], long: [], pictures: [] }; window.__scales = []; window.__hoodooPlay.key('KeyW', true); });
const t0 = Date.now();
await new Promise((resolve) => {
  const timer = setInterval(() => {
    const t = Date.now() - t0;
    if (t >= Number(ms)) {
      clearInterval(timer);
      resolve();
      return;
    }
    const a = (t / PERIOD_MS) * Math.PI * 2;
    page.evaluate((dx, dy) => window.__hoodooPlay?.look(dx, dy), Math.sin(a) * TURN_PX, Math.cos(a) * PITCH_PX).catch(() => undefined);
  }, TURN_EVERY_MS);
});
const rec = await page.evaluate(() => {
  window.__hoodooPlay.key('KeyW', false);
  const r = { ...window.__rec, scales: window.__scales, info: window.__hoodooPlay.sim().driver.readout?.() ?? '' };
  window.__rec = null;
  return r;
});
if (process.env.SHOT) {
  const clip = await page.evaluate(() => {
    const { view } = window.__hoodoo;
    const box = view.root.getBoundingClientRect();
    const f = view.mainCell().frame;
    return { x: box.left + f.x, y: box.top + f.y, width: f.w, height: f.h };
  });
  await page.screenshot({ path: process.env.SHOT, clip });
}
await browser.close();

function stats(frames) {
  const s = [...frames].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r = (v) => Math.round(v * 10) / 10;
  return { n: s.length, median: r(q(0.5)), p95: r(q(0.95)), max: r(s.at(-1) ?? 0), over20: s.filter((f) => f > MISSED_MS).length };
}
const gaps = (t) => t.slice(1).map((v, i) => v - t[i]);
const used = [...new Set(rec.scales.map((s) => s.toFixed(2)))].sort();
console.log(JSON.stringify({
  label: `${scene} ${motion} ${W}×${H} DPR ${DPR}${process.env.LOOK ? ` ${process.env.LOOK}` : ''}${process.env.QUALITY ? ` live ${process.env.QUALITY}` : ''}`,
  picture: stats(gaps(rec.pictures)),
  frames: { ...stats(rec.frames), long: rec.long.length, longMax: Math.max(0, ...rec.long) },
  scales: used,
  readout: rec.info,
  errors,
}));

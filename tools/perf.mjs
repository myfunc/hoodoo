// First-launch profile: long main-thread tasks, worst frame, time to the first finished render.
// Usage: node tools/perf.mjs <url> [waitMs]   (append ?cold to the URL to force a cold shader compile)
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const [url, wait = '40000'] = process.argv.slice(2);
const browser = await puppeteer.launch(launchOptions(['--window-size=1440,900', ...(process.env.COLD ? ['--disable-gpu-shader-disk-cache', '--disable-gpu-program-cache'] : [])]));
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => {
  const w = window;
  w.__long = [];
  w.__t0 = performance.now();
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
  let frames = 0;
  let worst = 0;
  let last = performance.now();
  const tick = (now) => { worst = Math.max(worst, now - last); last = now; frames++; w.__frames = { frames, worst: Math.round(worst) }; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
page.on('console', (m) => { const t = m.text(); if (t.includes('[')) console.log('[page]', Math.round(performance.now()), t.slice(0, 120)); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
console.log('[load]', Date.now() - t0, 'ms');
try { await page.waitForFunction('window.__hoodooReady === true', { timeout: Number(wait), polling: 200 }); } catch { console.log('[ready] timeout'); }
console.log('[ready]', Date.now() - t0, 'ms');
const r = await page.evaluate(() => ({ long: window.__long, frames: window.__frames, info: window.__hoodooInfo }));
console.log('[longtasks >50ms]', JSON.stringify(r.long));
console.log('[frames]', JSON.stringify(r.frames), '[info]', JSON.stringify(r.info));
await browser.close();

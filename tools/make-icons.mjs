// Renders the app icons with the app's own ray tracer: the opening scene, cropped square.
// Usage: node tools/make-icons.mjs <url>   (writes public/icons/*.png)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const [url = 'http://localhost:5640/'] = process.argv.slice(2);
const SIZES = { 'icon-512.png': 512, 'maskable-512.png': 512, 'icon-192.png': 192, 'apple-touch-icon.png': 180 };
const browser = await puppeteer.launch(launchOptions(['--window-size=1600,1000']));
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => localStorage.clear());
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__hoodooReady === true', { timeout: 120000 });
// Closer on the pedestal egg and the towers behind it, then a converged render.
await page.evaluate(() => {
  const w = window.__hoodoo.world;
  w.setCamera({ ...w.scene.camera, position: [1.2, 3.4, 11], pitch: -3, fov: 46 }, 'Icon camera');
  window.__hoodooReady = false;
  window.__hoodoo.view.render(true);
});
await page.waitForFunction('window.__hoodooReady === true', { timeout: 120000 });
const box = await (await page.$('.gl-view')).boundingBox();
const side = Math.min(box.width, box.height);
const png = await page.screenshot({ encoding: 'base64', clip: { x: box.x + (box.width - side) / 2, y: box.y + (box.height - side) / 2, width: side, height: side } });
const out = await page.evaluate(async (src, sizes) => {
  const img = new Image();
  img.src = `data:image/png;base64,${src}`;
  await img.decode();
  const result = {};
  for (const [name, n] of Object.entries(sizes)) {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, n, n);
    result[name] = c.toDataURL('image/png').split(',')[1];
  }
  return result;
}, png, SIZES);
fs.mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const [name, data] of Object.entries(out)) fs.writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), Buffer.from(data, 'base64'));
console.log('icons written:', Object.keys(out).join(', '));
await browser.close();

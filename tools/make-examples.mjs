// Renders the start window's example thumbnails with the app's own ray tracer
// (src/world/examples.ts): one 480 x 300 JPEG per example, the animated ones
// posed at the time below. Needs the dev server: it imports the modules from /src.
// Usage: node tools/make-examples.mjs [url] [id ...]   (writes src/ui/art/examples/<id>.jpg)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const [url = 'http://localhost:5640/', ...only] = process.argv.slice(2);
const OUT = new URL('../src/ui/art/examples/', import.meta.url);
const THUMB = { width: 480, height: 300, samples: 36, quality: 0.86 };
/** Seconds into each animation where the thumbnail is taken. */
const POSE_AT = { flight: 2.2, waltz: 1.4, 'dunes-morning': 6.5, 'arch-night': 6 };

const browser = await puppeteer.launch(launchOptions(['--window-size=1280,900']));
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(`${url}?start=0`, { waitUntil: 'load' });
  await page.waitForFunction('window.__hoodooReady === true', { timeout: 120000 });
  const ids = await page.evaluate(async () => {
    const { EXAMPLES } = await import('/src/world/examples.ts');
    return EXAMPLES.map((e) => e.id);
  });
  const files = new Map();
  for (const id of ids.filter((i) => !only.length || only.includes(i))) {
    const data = await page.evaluate(async (exampleId, o, at) => {
      const { EXAMPLES } = await import('/src/world/examples.ts');
      const { Thumbnailer } = await import('/src/render/thumbs.ts');
      const { renderImage } = await import('/src/render/tiled-render.ts');
      const { cameraBasis } = await import('/src/world/camera-math.ts');
      const { poseAt } = await import('/src/world/animation/pose.ts');
      window.__thumbs ??= new Thumbnailer();
      const scene = poseAt(EXAMPLES.find((e) => e.id === exampleId).build(), at ?? 0);
      const c = await renderImage(window.__thumbs, {
        scene, basis: cameraBasis(scene.camera, o.width / o.height), width: o.width, height: o.height, samples: o.samples,
        onProgress: () => {}, isCancelled: () => false,
      });
      return c.toDataURL('image/jpeg', o.quality).split(',')[1];
    }, id, THUMB, POSE_AT[id]);
    files.set(`${id}.jpg`, data);
    console.log('rendered', id);
  }
  // Written at the end: the dev server reloads the page when an imported file changes.
  for (const [name, data] of files) fs.writeFileSync(new URL(name, OUT), Buffer.from(data, 'base64'));
  console.log('wrote', [...files.keys()].join(', '));
} finally {
  await browser.close();
}

// Renders the splash art with the app's own ray tracer (src/world/splash-scene.ts):
// for each scene a still JPEG, a welcome clip and a seamless loop as WebM (encoded
// in the browser by the app's own movie encoder). Needs the dev server: it imports
// the scene module from /src.
// Usage: node tools/make-splash.mjs [url]   (writes src/ui/art/<scene>.jpg, -intro.webm, -loop.webm)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const [url = 'http://localhost:5640/'] = process.argv.slice(2);
const ART = new URL('../src/ui/art/', import.meta.url);
const STILL = { width: 1280, height: 800, samples: 64, quality: 0.86 };
const CLIP = { width: 960, height: 600, samples: 16, bitsPerPixel: 0.07 };

const browser = await puppeteer.launch(launchOptions(['--window-size=1280,900']));
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__hoodooReady === true', { timeout: 120000 });
  await page.evaluate(async () => {
    const m = await import('/src/world/splash-scene.ts');
    const { Thumbnailer } = await import('/src/render/thumbs.ts');
    const { renderImage } = await import('/src/render/tiled-render.ts');
    const { MovieEncoder } = await import('/src/io/movie-encoder.ts');
    const { cameraBasis } = await import('/src/world/camera-math.ts');
    const thumbs = new Thumbnailer();
    const render = (scene, w, h, samples) => renderImage(thumbs, {
      scene, basis: cameraBasis(scene.camera, w / h), width: w, height: h, samples, onProgress: () => {}, isCancelled: () => false,
    });
    const base64 = async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    window.__splash = {
      kinds: Object.values(m.SplashKind),
      async still(kind, o) {
        const c = await render(m.splashScene(kind), o.width, o.height, o.samples);
        return c.toDataURL('image/jpeg', o.quality).split(',')[1];
      },
      async clip(kind, clip, o) {
        const base = m.splashBase(kind);
        const frame = (t) => render(m.splashFrame(base, kind, clip, t), o.width, o.height, o.samples);
        const encoder = await MovieEncoder.create(o.width, o.height, m.SPLASH_FPS, o.bitsPerPixel);
        const mix = document.createElement('canvas');
        mix.width = o.width;
        mix.height = o.height;
        const g = mix.getContext('2d');
        for (const f of m.splashFramePlan(kind, clip)) {
          const c = await frame(f.t);
          if (!f.blend) {
            await encoder.add(c);
            continue;
          }
          g.globalAlpha = 1;
          g.drawImage(c, 0, 0);
          g.globalAlpha = f.blend.weight;
          g.drawImage(await frame(f.blend.t), 0, 0);
          await encoder.add(mix);
        }
        return base64(await encoder.finish());
      },
    };
  });
  const kinds = await page.evaluate(() => window.__splash.kinds);
  // Written only after everything is rendered: the app imports these files, and
  // the dev server reloads the page as soon as one of them changes.
  const files = new Map();
  for (const kind of kinds) {
    files.set(`${kind}.jpg`, await page.evaluate((k, o) => window.__splash.still(k, o), kind, STILL));
    for (const clip of ['intro', 'loop']) {
      files.set(`${kind}-${clip}.webm`, await page.evaluate((k, c, o) => window.__splash.clip(k, c, o), kind, clip, CLIP));
    }
    console.log('rendered', kind);
  }
  for (const [name, data] of files) fs.writeFileSync(new URL(name, ART), Buffer.from(data, 'base64'));
  console.log('wrote', [...files.keys()].join(', '));
} finally {
  await browser.close();
}

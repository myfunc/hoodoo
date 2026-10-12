// Renders the animated examples (src/world/examples.ts) with the app's own ray
// tracer, frame by frame along their timeline, for the README:
//   clips   docs/images/demo-<id>.webm (the app's own WebM encoder) and a small
//           looping animated WebP, demo-<id>.webp, that GitHub shows inline
//   frames  a contact sheet of the loop at 0, 2, 4, 6 and 8 s, <out>/<id>-frames.jpg,
//           to check composition and motion while a scene is being made
// Needs the dev server: it imports the modules from /src.
// Usage: node tools/make-demos.mjs <clips|frames> [url] [--out dir] [--at 0,1.5,3] [id ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const args = process.argv.slice(2);
const mode = args.shift();
const outFlag = args.indexOf('--out');
const outDir = outFlag >= 0 ? args.splice(outFlag, 2)[1] : null;
const atFlag = args.indexOf('--at');
const times = atFlag >= 0 ? args.splice(atFlag, 2)[1].split(',').map(Number) : null;
const url = args[0]?.startsWith('http') ? args.shift() : 'http://localhost:5640/';
const only = args;
if (mode !== 'clips' && mode !== 'frames') {
  console.log('usage: node tools/make-demos.mjs <clips|frames> [url] [--out dir] [--at 0,1.5,3] [id ...]');
  process.exit(1);
}

const IMAGES = fileURLToPath(new URL('../docs/images/', import.meta.url));
/** The WebM: full document size; the WebP: half, at a lower rate, small enough for a README. */
const CLIP = { width: 960, height: 600, fps: 24, samples: 20, bitsPerPixel: 0.05 };
const PREVIEW = { width: 640, height: 400, every: 2, quality: 0.74 };
const SHEET = { width: 640, height: 400, samples: 24, times: [0, 2, 4, 6, 8], columns: 3, quality: 0.86 };

/** An animated WebP (RIFF: VP8X, ANIM, one ANMF per frame) from lossy still WebPs of one size. */
function animatedWebp(frames, width, height, durationMs) {
  const chunk = (fourcc, payload) => {
    const head = Buffer.alloc(8);
    head.write(fourcc, 0, 'ascii');
    head.writeUInt32LE(payload.length, 4);
    return Buffer.concat([head, payload, Buffer.alloc(payload.length % 2)]);
  };
  const u24 = (v) => Buffer.from([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]);
  /** The image chunks of a still WebP (ALPH, VP8, VP8L), as they are. */
  const imageChunks = (webp) => {
    const parts = [];
    for (let p = 12; p + 8 <= webp.length;) {
      const fourcc = webp.toString('ascii', p, p + 4);
      const size = webp.readUInt32LE(p + 4);
      if (fourcc === 'ALPH' || fourcc === 'VP8 ' || fourcc === 'VP8L') parts.push(webp.subarray(p, p + 8 + size + (size % 2)));
      p += 8 + size + (size % 2);
    }
    return Buffer.concat(parts);
  };
  const vp8x = Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(width - 1), u24(height - 1)]);
  const anim = Buffer.from([0, 0, 0, 0, 0, 0]);
  let elapsed = 0;
  const anmf = frames.map((f, i) => {
    // Whole milliseconds that add up to the exact loop length.
    const end = Math.round(((i + 1) * durationMs) / frames.length);
    const ms = end - elapsed;
    elapsed = end;
    const head = Buffer.concat([u24(0), u24(0), u24(width - 1), u24(height - 1), u24(ms), Buffer.from([0x02])]);
    return chunk('ANMF', Buffer.concat([head, imageChunks(f)]));
  });
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), chunk('VP8X', vp8x), chunk('ANIM', anim), ...anmf]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

const browser = await puppeteer.launch(launchOptions(['--window-size=1280,900']));
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(`${url}?start=0`, { waitUntil: 'load' });
  await page.waitForFunction('window.__hoodooReady === true', { timeout: 120000 });
  await page.evaluate(async () => {
    const { EXAMPLES } = await import('/src/world/examples.ts');
    const { Thumbnailer } = await import('/src/render/thumbs.ts');
    const { renderImage } = await import('/src/render/tiled-render.ts');
    const { cameraBasis } = await import('/src/world/camera-math.ts');
    const { poseAt } = await import('/src/world/animation/pose.ts');
    const { MovieEncoder } = await import('/src/io/movie-encoder.ts');
    const thumbs = new Thumbnailer();
    const render = (scene, t, w, h, samples) => {
      const posed = poseAt(scene, t);
      return renderImage(thumbs, { scene: posed, basis: cameraBasis(posed.camera, w / h), width: w, height: h, samples, onProgress: () => {}, isCancelled: () => false });
    };
    const base64 = async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const blob = (canvas, type, quality) => new Promise((done) => canvas.toBlob(done, type, quality));
    const scenes = new Map();
    const sceneOf = (id) => {
      if (!scenes.has(id)) scenes.set(id, EXAMPLES.find((e) => e.id === id).build());
      return scenes.get(id);
    };
    window.__demos = {
      ids: EXAMPLES.filter((e) => e.animated).map((e) => e.id),
      duration: (id) => sceneOf(id).animation.duration,
      async sheet(id, o) {
        const out = document.createElement('canvas');
        out.width = o.width * o.columns;
        out.height = o.height * Math.ceil(o.times.length / o.columns);
        const g = out.getContext('2d');
        for (const [i, t] of o.times.entries()) {
          g.drawImage(await render(sceneOf(id), t, o.width, o.height, o.samples), (i % o.columns) * o.width, Math.floor(i / o.columns) * o.height);
        }
        return out.toDataURL('image/jpeg', o.quality).split(',')[1];
      },
      async clip(id, c, p) {
        const scene = sceneOf(id);
        const frames = Math.round(scene.animation.duration * c.fps);
        const encoder = await MovieEncoder.create(c.width, c.height, c.fps, c.bitsPerPixel);
        const small = document.createElement('canvas');
        small.width = p.width;
        small.height = p.height;
        const g = small.getContext('2d', { alpha: false });
        g.imageSmoothingQuality = 'high';
        const previews = [];
        // The loop's last frame is its first again: render 0 .. duration minus one frame.
        for (let f = 0; f < frames; f++) {
          const c1 = await render(scene, f / c.fps, c.width, c.height, c.samples);
          await encoder.add(c1);
          if (f % p.every) continue;
          g.drawImage(c1, 0, 0, p.width, p.height);
          previews.push(await base64(await blob(small, 'image/webp', p.quality)));
        }
        return { webm: await base64(await encoder.finish()), previews };
      },
    };
  });
  const ids = (await page.evaluate(() => window.__demos.ids)).filter((i) => !only.length || only.includes(i));
  for (const id of ids) {
    const started = Date.now();
    if (mode === 'frames') {
      const dir = outDir ?? '.';
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${id}-frames.jpg`);
      fs.writeFileSync(file, Buffer.from(await page.evaluate((i, o) => window.__demos.sheet(i, o), id, times ? { ...SHEET, times } : SHEET), 'base64'));
      console.log('wrote', file, `${((Date.now() - started) / 1000).toFixed(1)} s`);
      continue;
    }
    const { webm, previews } = await page.evaluate((i, c, p) => window.__demos.clip(i, c, p), id, CLIP, PREVIEW);
    const duration = await page.evaluate((i) => window.__demos.duration(i), id);
    const webp = animatedWebp(previews.map((b) => Buffer.from(b, 'base64')), PREVIEW.width, PREVIEW.height, duration * 1000);
    const dir = outDir ?? IMAGES;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `demo-${id}.webm`), Buffer.from(webm, 'base64'));
    fs.writeFileSync(path.join(dir, `demo-${id}.webp`), webp);
    const kb = (n) => `${Math.round(n / 1024)} KB`;
    console.log(`rendered ${id}: webm ${kb(Buffer.from(webm, 'base64').length)}, webp ${kb(webp.length)} (${previews.length} frames), ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
} finally {
  await browser.close();
}

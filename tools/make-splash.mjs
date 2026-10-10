// Renders the splash art with the app's own ray tracer: the "Planet Meadows" scene
// (src/world/splash-scene.ts) through File → Render to Image, saved as a JPEG.
// Needs the dev server (it imports the scene module from /src).
// Usage: node tools/make-splash.mjs [url]   (writes src/ui/art/splash.jpg)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const [url = 'http://localhost:5640/'] = process.argv.slice(2);
const OUT = new URL('../src/ui/art/splash.jpg', import.meta.url);
const JPEG_QUALITY = 0.86;
const EXPORT_TIMEOUT_MS = 300000;
const POLL_MS = 500;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'hoodoo-splash-'));
const browser = await puppeteer.launch(launchOptions(['--window-size=1440,900']));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__hoodooReady === true', { timeout: 120000 });
  await page.evaluate(async () => {
    const { splashScene } = await import('/src/world/splash-scene.ts');
    window.__hoodooReady = false;
    window.__hoodoo.world.replaceScene(splashScene(), 'Planet Meadows');
  });
  await page.waitForFunction('window.__hoodooReady === true', { timeout: 120000 });

  // Render to Image, accepting the dialog's defaults (the document size, full anti-aliasing).
  await page.keyboard.down(MOD);
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyE');
  await page.keyboard.up('Shift');
  await page.keyboard.up(MOD);
  await new Promise((r) => setTimeout(r, POLL_MS));
  await page.keyboard.press('Enter');
  let png = '';
  for (let waited = 0; !png && waited < EXPORT_TIMEOUT_MS; waited += POLL_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    png = fs.readdirSync(downloads).find((f) => f.endsWith('.png')) ?? '';
  }
  if (!png) throw new Error('Render to Image produced no file');

  const jpeg = await page.evaluate(async (src, quality) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', quality).split(',')[1];
  }, fs.readFileSync(path.join(downloads, png)).toString('base64'), JPEG_QUALITY);
  fs.mkdirSync(new URL('.', OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(jpeg, 'base64'));
  console.log('wrote', OUT.pathname);
} finally {
  await browser.close();
  fs.rmSync(downloads, { recursive: true, force: true });
}

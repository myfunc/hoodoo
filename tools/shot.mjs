// Dev screenshot: opens a page in headless Chrome (real GPU, see tools/browser.mjs),
// waits for window.__hoodooReady (or a timeout) and writes a PNG.
// Usage: node tools/shot.mjs <url> <out.png> [width] [height] [waitMs]
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const [url, out, w = '1280', h = '800', wait = '20000'] = process.argv.slice(2);
const browser = await puppeteer.launch(launchOptions([`--window-size=${w},${h}`]));
const page = await browser.newPage();
await page.setViewport({ width: Number(w), height: Number(h) });
page.on('console', (m) => console.log('[page]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction('window.__hoodooReady === true', { timeout: Number(wait), polling: 250 });
} catch {
  console.log('[shot] not ready before timeout');
}
const info = await page.evaluate(() => window.__hoodooInfo ?? null);
if (info) console.log('[shot] info', JSON.stringify(info));
await page.screenshot({ path: out });
await browser.close();

// Dev interaction check: runs a scripted sequence against the app and saves screenshots.
// Usage: node tools/interact.mjs <url> <outPrefix>
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const [url, prefix] = process.argv.slice(2);
const browser = await puppeteer.launch(launchOptions(['--window-size=1440,900']));
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: Number(process.env.DPR ?? 1) });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
await page.evaluateOnNewDocument(() => localStorage.clear());
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__hoodooReady === true', { timeout: 60000 });
const shot = async (name) => page.screenshot({ path: `${prefix}-${name}.png` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = JSON.parse(process.argv[4] ?? '[]');
for (const s of steps) {
  if (s.click) await page.mouse.click(s.click[0], s.click[1], s.button ? { button: s.button } : {});
  if (s.dbl) await page.mouse.click(s.dbl[0], s.dbl[1], { clickCount: 2 });
  if (s.drag) {
    await page.mouse.move(s.drag[0], s.drag[1]);
    await page.mouse.down(s.button ? { button: s.button } : {});
    await page.mouse.move(s.drag[2], s.drag[3], { steps: 12 });
    await page.mouse.up(s.button ? { button: s.button } : {});
  }
  if (s.hold) {
    await page.mouse.move(s.hold.at[0], s.hold.at[1]);
    await page.mouse.down({ button: s.hold.button });
    for (const k of s.hold.keys) await page.keyboard.down(k);
    await wait(s.hold.ms);
    for (const k of s.hold.keys) await page.keyboard.up(k);
    await page.mouse.up({ button: s.hold.button });
  }
  if (s.key) await page.keyboard.press(s.key);
  if (s.combo) {
    for (const k of s.combo) await page.keyboard.down(k);
    for (const k of [...s.combo].reverse()) await page.keyboard.up(k);
  }
  if (s.eval) console.log('[eval]', JSON.stringify(await page.evaluate(s.eval)));
  await wait(s.wait ?? 400);
  if (s.shot) await shot(s.shot);
}
console.log('[errors]', JSON.stringify(errors));
await browser.close();

// Contrast check of the rendered interface, in either theme: every visible text against
// the pixels behind it, the edges of controls against what surrounds them, glyphs and
// rendered icons against their panel. The background comes from a second screenshot with
// text, glyphs and icons hidden, so stone grain, gradients and pictures count as they look.
// Usage: node tools/contrast.mjs [url] [--theme light|dark] [--variant <name>] [--json out.json]
// Prints the lowest ratios per kind; exits 1 when one is below its threshold
// (text 4.5:1, controls, glyphs and icons 3:1). Needs the dev server.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5640/?start=1';
const theme = opt('theme', 'dark');
const variant = opt('variant', '');
const jsonOut = opt('json', '');
const LIMIT = { text: 4.5, control: 3, glyph: 3, icon: 3 };
const SHOW = 8;

const browser = await puppeteer.launch(launchOptions(['--window-size=1440,900']));
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument((t) => {
  localStorage.clear();
  localStorage.setItem('hoodoo.prefs.v1', JSON.stringify({ theme: t, splash: false }));
}, theme);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(url, { waitUntil: 'load' });

/** Collects what to measure, in page coordinates, with the colours CSS gives it. */
const collect = () => page.evaluate(() => {
  const parse = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  // On screen, not hidden, and not under a dialog's veil or scrolled out of its list: the top element at its middle is it or its kin.
  const clipped = (el, x, y) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      if (getComputedStyle(a).overflow === 'visible') continue;
      const c = a.getBoundingClientRect();
      if (x < c.left || x > c.right || y < c.top || y > c.bottom) return true;
    }
    return false;
  };
  const onTop = (el, r) => {
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    const top = document.elementsFromPoint(x, y)[0];
    return !!top && (top === el || el.contains(top) || top.contains(el)) && !clipped(el, x, y);
  };
  const visible = (el, r) => r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
    && getComputedStyle(el).visibility === 'visible' && opacityOf(el) > 0.05 && onTop(el, r);
  const name = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].join('.') : ''}`;
  const where = (el) => { const p = el.closest('[class]:not(span):not(div.ui-toggle)')?.parentElement; return p ? name(p) : ''; };
  const box = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  const texts = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('canvas, svg, script, style')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    const isInput = el.tagName === 'INPUT' && el.value;
    if (!own.length && !isInput) continue;
    // A field's text sits inside its border: measure the inside only.
    const inner = (r) => new DOMRect(r.left + 3, r.top + 3, Math.max(1, r.width - 6), Math.max(1, r.height - 6));
    const rects = isInput ? [inner(el.getBoundingClientRect())] : own.flatMap((n) => { const rg = document.createRange(); rg.selectNodeContents(n); return [...rg.getClientRects()]; });
    const shown = rects.filter((r) => visible(el, r));
    if (!shown.length) continue;
    const cs = getComputedStyle(el);
    texts.push({
      what: `${name(el)} "${(isInput ? el.value : own.map((n) => n.textContent).join(' ')).trim().slice(0, 28)}"`, where: where(el),
      rects: shown.map(box), fg: parse(cs.color), opacity: opacityOf(el), size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight),
      disabled: !!el.closest(':disabled, .is-disabled, [aria-disabled="true"]'),
    });
  }
  const controls = [...document.querySelectorAll('.ui-button:not(.ghost):not(.start-card), .ui-number, .ui-select, .ui-choice.segmented, .ui-dot, .ui-inline-input, .tray-thumb')]
    .filter((el) => visible(el, el.getBoundingClientRect()) && !el.closest('.ui-dialog-lab, .ui-picker, .progress-card, .shader-loader') && !el.closest(':disabled, .is-disabled'))
    .map((el) => ({ what: name(el), where: where(el), rect: box(el.getBoundingClientRect()), round: parseFloat(getComputedStyle(el).borderTopLeftRadius) >= el.getBoundingClientRect().width * 0.4 }));
  const glyphs = [...document.querySelectorAll('svg')]
    .filter((el) => visible(el, el.getBoundingClientRect()) && !el.closest('.ui-dialog-lab, .ui-picker') && !el.closest(':disabled, .is-disabled'))
    .map((el) => { const cs = getComputedStyle(el); const paint = cs.stroke !== 'none' ? cs.stroke : cs.fill; return { what: name(el), where: where(el), rect: box(el.getBoundingClientRect()), fg: parse(paint.startsWith('rgb') ? paint : cs.color), opacity: opacityOf(el) }; });
  // The icon's own pixels (rendered on a transparent canvas), to set against the panel behind it.
  const icons = [...document.querySelectorAll('.ctrl-icon, .tray-icon canvas, .tray-tool canvas, .outliner-icon, .props-icon')]
    .filter((el) => visible(el, el.getBoundingClientRect()))
    .map((el) => {
      const r = el.getBoundingClientRect();
      const g = el.getContext('2d');
      const px = g ? [...g.getImageData(0, 0, el.width, el.height).data] : [];
      return { what: name(el), where: where(el), rect: box(r), w: el.width, h: el.height, px };
    });
  return { texts, controls, glyphs, icons };
});

const HIDE_ID = 'contrast-hide';
async function screenshots() {
  const full = await page.screenshot({ encoding: 'base64' });
  await page.addStyleTag({ content: `* { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }
    svg, .ctrl-icon, .tray-icon canvas, .tray-tool canvas, .outliner-icon, .props-icon { visibility: hidden !important; }` }).then((h) => h.evaluate((s, id) => { s.id = id; }, HIDE_ID));
  await wait(120);
  const bare = await page.screenshot({ encoding: 'base64' });
  await page.evaluate((id) => document.getElementById(id)?.remove(), HIDE_ID);
  return { full, bare };
}

/** Decodes the PNGs in the page (no image library here) into RGBA arrays. */
async function pixels(b64) {
  const raw = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const bytes = g.getImageData(0, 0, img.width, img.height).data;
    let text = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return { w: img.width, h: img.height, b64: btoa(text) };
  }, b64);
  return { w: raw.w, h: raw.h, data: Buffer.from(raw.b64, 'base64') };
}

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const over = (fg, alpha, bg) => [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha));
const at = (img, x, y) => { const i = (Math.min(img.h - 1, Math.max(0, y)) * img.w + Math.min(img.w - 1, Math.max(0, x))) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const area = (img, [x, y, w, h], step = 1) => { const out = []; for (let j = y; j < y + h; j += step) for (let i = x; i < x + w; i += step) out.push(at(img, i, j)); return out; };
const circle = (img, [x, y, w, h], d) => Array.from({ length: 48 }, (_, i) => {
  const a = (i / 48) * Math.PI * 2;
  return at(img, Math.round(x + w / 2 + Math.cos(a) * (w / 2 - 1 + d)), Math.round(y + h / 2 + Math.sin(a) * (h / 2 - 1 + d)));
});
const ring = (img, [x, y, w, h], d) => [
  ...Array.from({ length: w }, (_, i) => at(img, x + i, y - d)), ...Array.from({ length: w }, (_, i) => at(img, x + i, y + h - 1 + d)),
  ...Array.from({ length: h }, (_, j) => at(img, x - d, y + j)), ...Array.from({ length: h }, (_, j) => at(img, x + w - 1 + d, y + j)),
];
/** The low end of a set of ratios, ignoring the worst 10% (a scrollbar, a neighbour's edge). */
const low = (values) => { const v = [...values].sort((a, b) => a - b); return v[Math.floor(v.length * 0.1)] ?? Infinity; };
const median = (cols) => [0, 1, 2].map((i) => [...cols.map((c) => c[i])].sort((a, b) => a - b)[cols.length >> 1]);

async function measure(state) {
  const items = await collect();
  const shots = await screenshots();
  const [full, bare] = [await pixels(shots.full), await pixels(shots.bare)];
  const rows = [];
  for (const t of items.texts) {
    const alpha = t.fg[3] * t.opacity;
    const r = low(t.rects.flatMap((rc) => area(bare, rc)).map((bg) => ratio(over(t.fg, alpha, bg), bg)));
    rows.push({ kind: t.disabled ? 'text (disabled)' : 'text', state, what: t.what, where: t.where, rect: String(t.rects[0]), ratio: r, size: t.size });
  }
  for (const c of items.controls) {
    // The control's own rim (its border or face) against the surface just outside it.
    // A round control's 1px rim is antialiased: take the better of the two rings it falls on.
    const edge = c.round ? circle : ring;
    const outside = median(edge(bare, c.rect, c.round ? 3 : 2));
    const rims = (c.round ? [1, 0, -1] : [0]).map((d) => median(edge(bare, c.rect, d)));
    const rim = rims.reduce((best, r) => (ratio(r, outside) > ratio(best, outside) ? r : best));
    const face = median(area(bare, [c.rect[0] + 2, c.rect[1] + 2, Math.max(1, c.rect[2] - 4), Math.max(1, c.rect[3] - 4)], 2));
    rows.push({ kind: 'control', state, what: c.what, where: c.where, rect: String(c.rect), ratio: Math.max(ratio(rim, outside), ratio(face, outside)) });
  }
  for (const gl of items.glyphs) {
    const alpha = gl.fg[3] * gl.opacity;
    rows.push({ kind: 'glyph', state, what: gl.what, where: gl.where, rect: String(gl.rect), ratio: low(area(bare, gl.rect).map((bg) => ratio(over(gl.fg, alpha, bg), bg))) });
  }
  for (const ic of items.icons) {
    // A rendered icon reads by its shape: how its best-lit quarter stands against the panel
    // behind it (each solid pixel of the icon over the pixel of the panel it covers).
    const [x, y, w, h] = ic.rect;
    const ratios = [];
    for (let j = 0; j < ic.h; j++) for (let i = 0; i < ic.w; i++) {
      const k = (j * ic.w + i) * 4;
      if (ic.px[k + 3] < 200) continue;
      const bg = at(bare, Math.round(x + ((i + 0.5) * w) / ic.w), Math.round(y + ((j + 0.5) * h) / ic.h));
      ratios.push(ratio([ic.px[k], ic.px[k + 1], ic.px[k + 2]], bg));
    }
    if (ratios.length < 8) continue;
    ratios.sort((a, b) => a - b);
    rows.push({ kind: 'icon', state, what: ic.what, where: ic.where, rect: String(ic.rect), ratio: ratios[Math.floor(ratios.length * 0.75)] });
  }
  return rows;
}

async function open(state) {
  const key = async (k, mods = []) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(k); for (const m of mods.reverse()) await page.keyboard.up(m); };
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  if (state === 'menu') await page.evaluate(() => [...document.querySelectorAll('.menubar-item')].find((m) => m.textContent === 'Objects')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  if (state === 'settings') { await key(',', [mod]); await wait(300); await page.evaluate(() => [...document.querySelectorAll('.settings-tab')].find((t) => t.textContent === 'Interface')?.click()); }
  if (state === 'materials') await key('m');
  if (state === 'palette') await key('k', [mod]);
  if (state === 'material-menu') await page.evaluate(() => document.querySelector('.props-ball')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await wait(1200);
}
const close = async () => { await page.keyboard.press('Escape'); await wait(300); await page.mouse.click(700, 880); await wait(200); };

const rows = [];
/** The same thing seen again in a later state (the editor behind a menu) is counted once. */
const key = (r) => `${r.kind}|${r.what}|${r.where}|${r.rect ?? ''}`;
await page.waitForSelector('.start-card.is-featured', { timeout: 60000 });
await wait(800);
rows.push(...await measure('start window'));
await page.click('.start-card.is-featured');
await page.waitForFunction('window.__hoodooReady === true', { timeout: 90000 });
if (variant) await page.evaluate((v) => window.__hoodoo.darkVariant(v), variant);
await page.evaluate(() => {
  const w = window.__hoodoo.world;
  const o = w.scene.objects.find((x) => /mirror/i.test(x.name)) ?? w.scene.objects[0];
  w.select([o.id], 'replace');
});
await wait(2500);
rows.push(...await measure('editor'));
for (const state of ['menu', 'settings', 'materials', 'palette', 'material-menu']) {
  await open(state);
  const seen = new Set(rows.map(key));
  rows.push(...(await measure(state)).filter((r) => !seen.has(key(r))));
  await close();
}
await browser.close();

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
let failed = 0;
for (const kind of ['text', 'control', 'glyph', 'icon', 'text (disabled)']) {
  const list = rows.filter((r) => r.kind === kind).sort((a, b) => a.ratio - b.ratio);
  if (!list.length) continue;
  const limit = LIMIT[kind] ?? 0;
  const below = list.filter((r) => r.ratio < limit);
  failed += kind.startsWith('text (') ? 0 : below.length;
  console.log(`\n${kind}: ${list.length} measured, lowest ${list[0].ratio.toFixed(2)}:1${limit ? `, ${below.length} below ${limit}:1` : ' (exempt)'}`);
  for (const r of list.slice(0, SHOW)) console.log(`  ${r.ratio.toFixed(2)}  [${r.state}] ${r.what}  in ${r.where}`);
}
process.exitCode = failed ? 1 : 0;

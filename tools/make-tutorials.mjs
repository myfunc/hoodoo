// Takes the Tutorial Book (Help › Tutorial Book…, src/ui/labs/tutorial-book.ts) from the
// running app. For every recipe it opens the book, presses Try it, then does each step
// with real clicks, drags and keys, photographing the app before each one together with
// the box of what it is about to click. A check after the last step proves the recipe
// works (the script stops with the reason when it does not), and the result picture is
// the scene rendered by Hoodoo's own ray tracer. Redo it after UI changes.
// Needs the dev server: the result render imports the modules from /src.
// Writes public/tutorials/<id>/<step>.webp and result.webp, and src/ui/labs/tutorial-recipes.ts.
// Usage: node tools/make-tutorials.mjs [url] [id ...]   (ids: only those recipes are taken again)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const args = process.argv.slice(2);
const url = args[0]?.startsWith('http') ? args.shift() : 'http://localhost:5640/';
const only = args;
const PICTURES = fileURLToPath(new URL('../public/tutorials/', import.meta.url));
const DATA = fileURLToPath(new URL('../src/ui/labs/tutorial-recipes.ts', import.meta.url));

/** The app as the pictures show it, and how hard they are squeezed (WebP quality, 0–100). */
const SHOT = { width: 1280, height: 800, quality: 50 };
/** The result: the scene through its camera, at the document's 4:3. */
const RESULT = { width: 960, height: 720, samples: 48, quality: 0.7 };
/** An animation's result: four moments of it, two by two. */
const FRAMES = 4;
const FRAME_COLUMNS = 2;
/** A dark line between the moments, CSS px. */
const FRAME_GAP = { px: 4, colour: '#141416' };
/** Room around a marked control, CSS px. */
const PAD = 5;
/** The smallest mark, CSS px: a tiny triangle still gets a box you can see. */
const MIN_MARK = 22;
/** How long a step may take to settle (the live picture converging), and a pause for menus and fades. */
const SETTLE_MS = 6000;
const PAUSE_MS = 350;
/** A spot that hovers nothing: the empty end of the menu bar. */
const REST = { x: 900, y: 10 };
/** Dials move their whole range over this many pixels (src/ui/kit/controls.ts DIAL_PIXELS). */
const DIAL_PIXELS = 160;
const LIMIT_TOTAL_BYTES = 3 * 1024 * 1024;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Finding things on the page ---------------------------------------------------------

/**
 * A control on the page: the `nth` visible match of a CSS selector, optionally the one whose
 * text is exactly `text`, then its ancestor `up` (a selector) or `parent` levels up.
 */
const T = (css, more = {}) => ({ css, ...more });
const icon = (label) => T(`.tray-icon[aria-label="${label}"]`);
const menuTitle = (name) => T('.menubar-item', { text: name });
const menuItem = (label) => T('.ui-menu-label', { text: label, up: '.ui-menu-item' });
/** The small triangle beside a palette title: 1 Create, 2 Edit, 3 Sky&Fog. */
const presetsOf = (n) => T(`.palette-title:nth-child(${n}) .glyph`);
const materialBox = T('.props-material-name');
const material = (name) => T('.mm-name', { text: name, up: '.mm-cell' });
const libraryTab = (name) => T('.ui-dialog .ui-toggle', { text: name });
const libraryCell = (name) => T('.ui-dialog canvas + div', { text: name, parent: 1 });
const sceneRow = (name) => T('.outliner-name', { text: name, up: '.outliner-row' });
const selectionTag = (n) => T('.sel-tag .ui-button', { nth: n });
const boolean = (title) => T(`.props-booleans [aria-label="${title}"]`);
const dial = (label) => T('.ui-dial-label', { text: label, up: '.ui-dial' });
const labDial = (label) => T('.lab-channels > span', { text: label, next: true });
const labPresets = T('.lab-side .ui-select');
const renderBall = T('.render-ball.big');
const trackball = T('.ctrl-icon.trackball');
/** The Z box of the Offset row in Attributes. */
const offsetZ = T('.props-grid .ui-number', { nth: 2 });

/** Something drawn in the scene: the screen box of an object, by name. */
const object = (name, inset = 0) => async (page) => {
  const r = await page.evaluate((n) => window.__hoodoo.screenBox(n), name);
  if (!r) throw new Error(`${name} is not in view`);
  return { x: r.x + r.w * inset, y: r.y + r.h * inset, w: r.w * (1 - 2 * inset), h: r.h * (1 - 2 * inset) };
};
/** A move arrow of the selection: 0 X, 1 Y, 2 Z. */
const arrow = (axis) => async (page) => {
  const g = await page.evaluate(() => window.__hoodoo.gizmo());
  const tip = g?.tips[axis];
  if (!tip) throw new Error(`arrow ${axis} is not on screen`);
  return { x: tip[0] - MIN_MARK / 2, y: tip[1] - MIN_MARK / 2, w: MIN_MARK, h: MIN_MARK };
};

async function box(page, t) {
  if (typeof t === 'function') return t(page);
  const r = await page.evaluate(({ css, text, nth = 0, up, parent = 0, next }) => {
    const seen = [...document.querySelectorAll(css)].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && (text === undefined || e.textContent.trim() === text);
    });
    let e = seen[nth];
    if (!e) return null;
    if (up) e = e.closest(up) ?? e;
    for (let i = 0; i < parent; i++) e = e.parentElement;
    if (next) e = e.nextElementSibling;
    const b = e.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }, t);
  if (!r) throw new Error(`not on the page: ${JSON.stringify(t)}`);
  return r;
}

const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];

/** A mark in fractions of the picture, padded and never smaller than MIN_MARK. */
function markOf(r) {
  const w = Math.max(MIN_MARK, r.w + 2 * PAD);
  const h = Math.max(MIN_MARK, r.h + 2 * PAD);
  const x = Math.max(0, r.x + r.w / 2 - w / 2);
  const y = Math.max(0, r.y + r.h / 2 - h / 2);
  const round = (v) => Math.round(v * 10000) / 10000;
  return { x: round(x / SHOT.width), y: round(y / SHOT.height), w: round(Math.min(w, SHOT.width - x) / SHOT.width), h: round(Math.min(h, SHOT.height - y) / SHOT.height) };
}

// ---- Doing things ----------------------------------------------------------------------

const click = (t, opts = {}) => async (page, r) => {
  const [x, y] = centre(r ?? (await box(page, t)));
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.click(x, y, { count: opts.count ?? 1 });
  if (opts.shift) await page.keyboard.up('Shift');
};
const dblclick = (t) => click(t, { count: 2 });
/** Drags from the middle of `t` by dx, dy in small moves, as a hand would. */
const drag = (t, dx, dy = 0) => async (page) => {
  const [x, y] = centre(await box(page, t));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 16 });
  await page.mouse.up();
};
/** A dial from its current value to `value` (range lo..hi). */
const dialTo = (t, value, lo = 0, hi = 100) => async (page) => {
  const now = Number(await page.evaluate(({ css, text, next, up }) => {
    let e = [...document.querySelectorAll(css)].find((x) => x.textContent.trim() === text);
    if (up) e = e.closest(up);
    if (next) e = e.nextElementSibling;
    return e.querySelector('.ui-dial-value').textContent.replace(/[^\d.-]/g, '');
  }, t));
  await drag(t, ((value - now) / (hi - lo)) * DIAL_PIXELS)(page);
};
const typeInto = (t, text) => async (page) => {
  await click(t, { count: 3 })(page);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
};
const openMenu = (name) => click(menuTitle(name));

/** Waits for the live picture to settle after a change (or a little while when nothing changed). */
async function settle(page) {
  await page.waitForFunction('window.__hoodooReady === true', { timeout: SETTLE_MS }).catch(() => undefined);
  await wait(PAUSE_MS);
}

const scene = (page) => page.evaluate(() => {
  const s = window.__hoodoo.world.scene;
  return { objects: s.objects.map((o) => ({ name: o.name, kind: o.kind, groupId: o.groupId, boolean: o.boolean, position: o.transform.position, material: o.material.name, values: o.material.values })), camera: s.camera, sky: s.sky, animation: s.animation };
});
function expect(ok, why) {
  if (!ok) throw new Error(`check failed: ${why}`);
}

// ---- The recipes ------------------------------------------------------------------------
// Each step: one line, what is ready before the picture (`prepare`), the marks (done in
// order), and what is done after it (`act`, by default a click on the last mark).

const RECIPES = [
  {
    id: 'first-steps', title: 'First steps', goal: 'Orbit, select, move, gild and render an egg', start: 'Demo',
    steps: [
      { text: 'Drag the trackball right: the camera circles', marks: [trackball], act: drag(trackball, 70) },
      { text: 'Click the big purple egg to select it', marks: [object('Pedestal Egg', 0.15)] },
      { text: 'Drag the green arrow up: the egg rises', marks: [arrow(1)], act: drag(arrow(1), 0, -45) },
      { text: 'Material list in Attributes: pick Gold Mirror', prepare: click(materialBox), marks: [materialBox, material('Gold Mirror')] },
      { text: 'Click the big Render ball', marks: [renderBall] },
    ],
    check: (s) => {
      const egg = s.objects.find((o) => o.name === 'Pedestal Egg');
      expect(egg?.material === 'Gold Mirror', 'the egg is Gold Mirror');
    },
    result: 'It worked if a gold egg floats above its cup',
  },
  {
    id: 'sunset-water', title: 'Sunset over water', goal: 'A low sun over a calm mirror sea', start: 'Empty',
    steps: [
      { text: 'Click the Water Plane icon', marks: [icon('Water Plane')] },
      { text: 'Material list in Attributes: pick Mirror Lake', prepare: click(materialBox), marks: [materialBox, material('Mirror Lake')] },
      { text: 'Click the triangle beside Sky&Fog: presets', marks: [presetsOf(3)] },
      { text: 'Double-click Vapor Sunset', marks: [libraryCell('Vapor Sunset')], act: dblclick(libraryCell('Vapor Sunset')) },
      { text: 'Click Sun in the Scene list, drag Azimuth right', prepare: click(sceneRow('Sun')), marks: [sceneRow('Sun'), dial('Azimuth')], act: drag(dial('Azimuth'), DIAL_PIXELS * 2) },
    ],
    check: (s) => {
      expect(s.objects[0]?.material === 'Mirror Lake', 'the water is Mirror Lake');
      expect(Math.abs(Math.abs(s.sky.sunAzimuth) - 180) < 1, 'the sun stands in front of the camera');
    },
    result: 'It worked if the sun glitters on the water ahead',
  },
  {
    id: 'rock-on-hill', title: 'Rock on a hill', goal: 'A granite stone resting on a grassy hill', start: 'Empty',
    steps: [
      { text: 'Click the Terrain icon', marks: [icon('Terrain')] },
      { text: 'Material list: pick Alpine Meadow', prepare: click(materialBox), marks: [materialBox, material('Alpine Meadow')] },
      { text: 'Click the Stone icon: it sits inside the hill', marks: [icon('Stone')] },
      { text: 'Material list: pick Granite', prepare: click(materialBox), marks: [materialBox, material('Granite')] },
      { text: 'Click the down arrow: Land sets it on the slope', marks: [selectionTag(3)] },
    ],
    check: (s) => {
      const [hill, stone] = s.objects;
      expect(hill?.material === 'Alpine Meadow' && stone?.material === 'Granite', 'the materials are on');
      expect(stone.position[1] > 2, 'the stone was lifted onto the surface');
    },
    result: 'It worked if the stone sits on the grass',
  },
  {
    id: 'chess-focus', title: 'Chess in soft focus', goal: 'One sharp king, the rest of the board melts away', start: 'Empty',
    steps: [
      { text: 'Click the triangle beside Create: the library', marks: [presetsOf(1)] },
      { text: 'Chess & Billiards, then double-click Chess Set', prepare: click(libraryTab('Chess & Billiards')), marks: [libraryTab('Chess & Billiards'), libraryCell('Chess Set')], act: dblclick(libraryCell('Chess Set')) },
      { text: 'Click Camera in the Scene list', marks: [sceneRow('Camera')] },
      { text: 'Drag Depth of field to about 70', marks: [dial('Depth of field')], act: dialTo(dial('Depth of field'), 70) },
      { text: 'Click Pick focus point, then the white king', prepare: click(T('.ui-button', { text: 'Pick focus point' })), marks: [T('.ui-button', { text: 'Pick focus point' }), object('White King e1', 0.25)] },
      { text: 'Click the big Render ball', marks: [renderBall] },
    ],
    check: (s) => {
      expect(s.objects.length > 30, 'the chess set is in');
      expect(s.camera.aperture >= 60, 'the lens is open');
      expect(s.camera.focus > 8 && s.camera.focus < 14, 'the focus is on the king');
    },
    result: 'It worked if the king is sharp and the rest soft',
  },
  {
    id: 'glass-ball', title: 'Glass ball on checkers', goal: 'A glass ball on a chrome checker floor', start: 'Close',
    steps: [
      { text: 'Click the Ground Plane icon', marks: [icon('Ground Plane')] },
      { text: 'Material list: pick Chrome Checkers', prepare: click(materialBox), marks: [materialBox, material('Chrome Checkers')] },
      { text: 'Click the Sphere icon', marks: [icon('Sphere')] },
      { text: 'Click M beside the ball: the Materials Lab', marks: [selectionTag(1)] },
      {
        text: 'Presets: switch to Glass, click Clear Glass', prepare: async (page) => { await click(labPresets)(page); await wait(PAUSE_MS); await click(menuItem('Glass'))(page); },
        marks: [labPresets, T('.lab-preset[title="Clear Glass"]')],
      },
      { text: 'Drag Reflection to about 40', marks: [labDial('Reflection')], act: dialTo(labDial('Reflection'), 40) },
    ],
    check: (s) => {
      const ball = s.objects.find((o) => o.name === 'Sphere');
      expect(s.objects[0]?.material === 'Chrome Checkers', 'the floor is Chrome Checkers');
      expect(ball?.values.transparency >= 90 && ball.values.refraction > 100 && ball.values.reflection >= 30, 'the ball is glass with a reflection');
    },
    result: 'It worked if the checkers bend through the ball',
  },
  {
    id: 'camera-flyby', title: 'Camera fly-by', goal: 'Eight seconds of the camera swinging round', start: 'Demo',
    steps: [
      { text: 'Animation menu: click Animation', prepare: openMenu('Animation'), marks: [menuItem('Animation')] },
      { text: 'Click the scene length, type 8, press Enter', marks: [T('.tl-total')], act: typeInto(T('.tl-total'), '8') },
      { text: 'Click the key on the Camera row', marks: [T('.tl-name .tl-key-here', { nth: 0 })] },
      { text: 'Click Go to end: the playhead jumps to 8 s', marks: [T('button[title^="Go to end"]')] },
      { text: 'Drag the trackball right: the end pose is keyed', marks: [trackball], act: drag(trackball, 120) },
      { text: 'Click Play: the camera flies for 8 s', marks: [T('.tl-play')] },
    ],
    check: (s) => {
      expect(s.animation.duration === 8, 'the scene is 8 s long');
      expect(s.animation.camera.length === 2 && s.animation.camera[1].time === 8, 'the camera has keys at 0 and 8 s');
    },
    result: 'It worked if the view swings round the spires',
    frames: true,
  },
  {
    id: 'boolean-cut', title: 'Cut a hole', goal: 'A cube with a round bite taken out by a sphere', start: 'Close',
    steps: [
      { text: 'Click the Cube icon', marks: [icon('Cube')] },
      { text: 'Click Positive in Attributes: the solid', marks: [boolean('Positive')] },
      { text: 'Click the Sphere icon', marks: [icon('Sphere')] },
      { text: 'Click Negative: the sphere becomes a cutter', marks: [boolean('Negative')] },
      { text: 'Type 1 in the Z box, press Enter', marks: [offsetZ], act: typeInto(offsetZ, '1') },
      {
        text: 'Shift-click Cube in the Scene list, then + Group', prepare: click(sceneRow('Cube'), { shift: true }), marks: [sceneRow('Cube'), T('.panel-add', { text: '+ Group' })],
        act: async (page, r) => { await click(null)(page, r); await wait(PAUSE_MS); await page.keyboard.press('Enter'); },
      },
    ],
    check: (s) => {
      const [cube, ball] = s.objects;
      expect(cube?.boolean === 1 && ball?.boolean === 2, 'the cube is positive and the sphere negative');
      expect(cube.groupId && cube.groupId === ball.groupId, 'both are in one group');
    },
    result: 'It worked if a round bite is cut from the cube',
  },
  {
    id: 'render-export', title: 'Render and save', goal: 'The finished render as a PNG, twice the size', start: 'Demo',
    steps: [
      { text: 'Render menu: click Render View', prepare: openMenu('Render'), marks: [menuItem('Render View')] },
      { text: 'File menu: click Render to Image…', prepare: openMenu('File'), marks: [menuItem('Render to Image…')] },
      { text: 'Open Size, pick 2× document', prepare: click(T('.ui-dialog .ui-select', { nth: 0 })), marks: [T('.ui-dialog .ui-select', { nth: 0 }), menuItem('2× document')] },
      { text: 'Click the check mark: the PNG is saved', marks: [T('.ui-dialog .ui-round.ok')] },
    ],
    check: () => undefined,
    result: 'It worked if a 1280 × 960 PNG is in Downloads',
    download: true,
  },
];

// ---- Taking them ------------------------------------------------------------------------

/** Opens the book through the Help menu, picks the recipe, presses Try it and closes the book again. */
async function tryIt(page, recipe) {
  await click(menuTitle('Help'))(page);
  await wait(PAUSE_MS);
  await click(menuItem('Tutorial Book…'))(page);
  await wait(PAUSE_MS);
  await click(T('.tb-nav-name', { text: recipe.title, up: '.tb-nav-row' }))(page);
  await click(T('.tb-try'))(page);
  await wait(PAUSE_MS);
  await click(T('.tutorial-book .tool-bar [aria-label="Close"]'))(page);
  await settle(page);
}

/** The scene as its camera sees it, by the app's own tracer: a still, or four moments of the animation. */
const renderResult = (page, frames) => page.evaluate(async (o, frames, columns, gap) => {
  const { renderImage } = await import('/src/render/tiled-render.ts');
  const { cameraBasis } = await import('/src/world/camera-math.ts');
  const { Thumbnailer } = await import('/src/render/thumbs.ts');
  const { poseAt } = await import('/src/world/animation/pose.ts');
  window.__tutorialThumbs ??= new Thumbnailer();
  const base = window.__hoodoo.world.scene;
  const times = frames ? Array.from({ length: frames }, (_, i) => (i * base.animation.duration) / (frames - 1)) : [null];
  const cols = frames ? columns : 1;
  const rows = Math.ceil(times.length / cols);
  const out = document.createElement('canvas');
  out.width = o.width;
  out.height = o.height;
  const g = out.getContext('2d');
  g.fillStyle = gap.colour;
  g.fillRect(0, 0, o.width, o.height);
  const inset = frames ? gap.px / 2 : 0;
  const w = o.width / cols;
  const h = o.height / rows;
  for (const [i, t] of times.entries()) {
    const scene = t === null ? base : poseAt(base, t);
    const c = await renderImage(window.__tutorialThumbs, {
      scene, basis: cameraBasis(scene.camera, w / h), width: Math.round(w), height: Math.round(h), samples: o.samples,
      onProgress: () => {}, isCancelled: () => false,
    });
    g.drawImage(c, (i % cols) * w + inset, Math.floor(i / cols) * h + inset, w - 2 * inset, h - 2 * inset);
  }
  return out.toDataURL('image/webp', o.quality).split(',')[1];
}, RESULT, frames ? FRAMES : 0, FRAME_COLUMNS, FRAME_GAP);

/** A downloaded PNG, scaled to the result size. */
const shrink = (page, png) => page.evaluate(async (b64, o) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = o.width;
  c.height = o.height;
  c.getContext('2d').drawImage(img, 0, 0, o.width, o.height);
  return [c.toDataURL('image/webp', o.quality).split(',')[1], img.naturalWidth, img.naturalHeight];
}, png.toString('base64'), RESULT);

async function take(browser, recipe) {
  const page = await browser.newPage();
  await page.setViewport({ width: SHOT.width, height: SHOT.height, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => localStorage.clear());
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'hoodoo-tutorial-'));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await page.goto(`${url}?start=0`, { waitUntil: 'load' });
  await page.waitForFunction('window.__hoodooReady === true', { timeout: 120000 });
  await tryIt(page, recipe);

  const files = new Map();
  const steps = [];
  for (const [i, step] of recipe.steps.entries()) {
    await page.mouse.move(REST.x, REST.y);
    // A message left by the step before would sit on this step's picture (it fades out).
    const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast.is-visible')].map((t) => t.classList.remove('is-visible')).length);
    if (toasts) await wait(PAUSE_MS);
    if (step.prepare) {
      await step.prepare(page);
      await wait(PAUSE_MS);
    }
    const rects = [];
    for (const m of step.marks) rects.push(await box(page, m));
    files.set(`${i + 1}.webp`, await page.screenshot({ type: 'webp', quality: SHOT.quality }));
    steps.push({ text: step.text, marks: rects.map(markOf) });
    await page.evaluate(() => { window.__hoodooReady = false; });
    await (step.act ?? click(step.marks.at(-1)))(page, rects.at(-1));
    await settle(page);
  }
  recipe.check(await scene(page));
  if (recipe.download) {
    const png = await waitForFile(downloads, '.png');
    const [data, width, height] = await shrink(page, png);
    expect(width === 1280 && height === 960, `the PNG is 1280 × 960 (got ${width} × ${height})`);
    files.set('result.webp', Buffer.from(data, 'base64'));
  } else {
    if (recipe.frames) await click(T('.tl-stop'))(page);
    files.set('result.webp', Buffer.from(await renderResult(page, recipe.frames), 'base64'));
  }
  fs.rmSync(downloads, { recursive: true, force: true });
  if (errors.length) throw new Error(`${recipe.id}: page errors\n${errors.join('\n')}`);
  await page.close();
  return { files, steps };
}

async function waitForFile(dir, ext) {
  for (let i = 0; i < SETTLE_MS * 10 / PAUSE_MS; i++) {
    const done = fs.readdirSync(dir).find((f) => f.endsWith(ext));
    if (done) return fs.readFileSync(path.join(dir, done));
    await wait(PAUSE_MS);
  }
  throw new Error(`check failed: no ${ext} was saved`);
}

// ---- The data file ----------------------------------------------------------------------

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const markText = (m) => `{ x: ${m.x}, y: ${m.y}, w: ${m.w}, h: ${m.h} }`;
const stepLines = (steps) => steps.map((s) => `      { text: ${q(s.text)}, marks: [${s.marks.map(markText).join(', ')}] },`);
const recipeText = (r, lines) => [
  `  {`,
  `    id: ${q(r.id)}, title: ${q(r.title)}, goal: ${q(r.goal)}, start: TutorialStart.${r.start},`,
  `    steps: [`,
  ...lines,
  `    ],`,
  `    result: ${q(r.result)},`,
  `  },`,
].join('\n');

/** The step lines already in the file, by recipe id: kept for the recipes not taken this time. */
function writtenSteps() {
  if (!fs.existsSync(DATA)) return new Map();
  const blocks = fs.readFileSync(DATA, 'utf8').split(/\n(?= {2}\{\n)/).slice(1);
  return new Map(blocks.map((b) => [b.match(/id: '([^']+)'/)?.[1], b.split('\n').filter((l) => l.startsWith('      { text:'))]));
}

/** Every recipe of this script, with the steps just taken or those written before; false when the file already says so. */
function writeData(taken) {
  const kept = writtenSteps();
  const recipes = RECIPES.map((r) => recipeText(r, taken.has(r.id) ? stepLines(taken.get(r.id)) : (kept.get(r.id) ?? [])));
  const text = `// Written by tools/make-tutorials.mjs with the pictures in public/tutorials/: change the recipes there and run it again.
import { type TutorialRecipe, TutorialStart } from './tutorial-book-recipe';

/** The size of every step picture, CSS px of the app it was taken from. */
export const TUTORIAL_SHOT = { width: ${SHOT.width}, height: ${SHOT.height} } as const;
/** The size of every result picture. */
export const TUTORIAL_RESULT = { width: ${RESULT.width}, height: ${RESULT.height} } as const;

export const TUTORIAL_RECIPES: readonly TutorialRecipe[] = [
${recipes.join('\n')}
];
`;
  if (fs.existsSync(DATA) && fs.readFileSync(DATA, 'utf8') === text) return false;
  fs.writeFileSync(DATA, text);
  return true;
}

// The book has to list every recipe before Try it can be pressed in it; a changed file is
// written before any page opens (a dev server with hot reload would reload one under test).
if (writeData(new Map())) console.log('listed the recipes in src/ui/labs/tutorial-recipes.ts');

const browser = await puppeteer.launch(launchOptions([`--window-size=${SHOT.width},${SHOT.height}`]));
const taken = new Map();
try {
  for (const recipe of RECIPES.filter((r) => !only.length || only.includes(r.id))) {
    const { files, steps } = await take(browser, recipe);
    const dir = path.join(PICTURES, recipe.id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, data] of files) fs.writeFileSync(path.join(dir, name), data);
    taken.set(recipe.id, steps);
    const bytes = [...files.values()].reduce((n, b) => n + b.length, 0);
    console.log(`${recipe.id}: ${steps.length} steps, ${Math.round(bytes / 1024)} KB`);
  }
} finally {
  await browser.close();
}
writeData(taken);
const total = fs.readdirSync(PICTURES, { recursive: true }).map((f) => path.join(PICTURES, f)).filter((f) => fs.statSync(f).isFile()).reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`public/tutorials: ${Math.round(total / 1024)} KB${total > LIMIT_TOTAL_BYTES ? ' — over the 3 MB budget, lower SHOT.quality' : ''}`);

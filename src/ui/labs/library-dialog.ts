import { OBJECT_LIBRARY, type LibraryObject } from '../../assets/object.library';
import { SKY_LIBRARY, type SkyPreset } from '../../assets/sky.presets';
import { libraryPreview, objectsPreview, skyPreview } from '../../render/icons';
import { GAME_ROWS, type GameItem, GameItemKind } from '../../assets/games.library';
import { buildGameItem } from '../../world/game-sets';
import { Button, Choice } from '../kit/controls';
import { MySkies, SKY_NAME_MAX, freeSkyName } from '../../io/sky-presets-store';
import type { Sky } from '../../model/scene.types';
import { KEY } from '../../core/keys';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import type { Vec3 } from '../../core/vec3';
import type { Thumbnailer } from '../../render/thumbs';
import { createEntry } from '../../assets/object.catalog';
import { createObject } from '../../world/objects.factory';
import { el, glyph } from '../kit/dom';
import './library-dialog.css';
import { Dialog, DialogStyle } from '../kit/dialog';

const CELL_W = 96;
const CELL_H = 72;
const SAMPLES = 3;
const PREVIEW_SEED = 9;
const CELL_BG = '#222';

function grid<T>(items: readonly T[], label: (t: T) => string, sub: (t: T) => string, draw: (t: T, c: HTMLCanvasElement) => void, onPick: (t: T) => void, close: () => void): HTMLElement {
  const g = el('div', { style: { display: 'grid', gridTemplateColumns: `repeat(4, ${CELL_W}px)`, gap: '10px' } });
  for (const it of items) {
    const c = el('canvas', { style: { width: `${CELL_W}px`, height: `${CELL_H}px`, border: '1px solid #000', background: CELL_BG } });
    const cell = el('div', { style: { cursor: 'pointer' }, title: sub(it) }, [c, el('div', { text: label(it), style: { fontSize: '10px', marginTop: '2px' } })]);
    cell.addEventListener('dblclick', () => { onPick(it); close(); });
    cell.addEventListener('click', () => {
      for (const x of g.children) (x as HTMLElement).style.outline = 'none';
      cell.style.outline = '2px solid #e0a84a';
      onPick(it);
    });
    draw(it, c);
    g.append(cell);
  }
  return g;
}

/** The object library's categories, chosen with a strip at the top; the last one is kept for next time. */
enum LibraryCategory {
  Landforms = 'Terrains & Landforms',
  Games = 'Chess & Billiards',
}
const CATEGORY_LABELS: readonly { value: LibraryCategory; label: string }[] = [
  { value: LibraryCategory.Landforms, label: 'Landforms' },
  { value: LibraryCategory.Games, label: 'Chess & Billiards' },
];
let lastCategory = LibraryCategory.Landforms;

export interface LibraryPick {
  readonly terrain: (o: LibraryObject) => void;
  readonly game: (item: GameItem) => void;
}

type Picked = { readonly terrain: LibraryObject } | { readonly game: GameItem };

/** Ready-made pieces are smaller cells, a row per kind: sets, white, black, solids, stripes. */
const GAME_CELL_W = 76;
const GAME_CELL_H = 60;
const GAME_SAMPLES = 4;
/** Where a library item is built for its picture; the preview frames it. */
const ORIGIN = 0;
/** Turns a ball's +Z number disc toward the preview camera (render/icons.ts PIECE_FROM). */
const BALL_FACING: Vec3 = [-16, 36, 0];

function gameRows(thumbs: Thumbnailer, onPick: (t: GameItem) => void, close: () => void): HTMLElement {
  const host = el('div', { cls: 'library-games' });
  const cells: HTMLElement[] = [];
  for (const row of GAME_ROWS) {
    const line = el('div', { cls: 'library-games-row' });
    for (const item of row) {
      const c = el('canvas', { style: { width: `${GAME_CELL_W}px`, height: `${GAME_CELL_H}px` } });
      const cell = el('div', { cls: 'library-games-cell', title: item.description }, [c, el('div', { cls: 'library-games-name', text: item.name })]);
      cell.addEventListener('dblclick', () => { onPick(item); close(); });
      cell.addEventListener('click', () => {
        for (const x of cells) x.classList.remove('is-picked');
        cell.classList.add('is-picked');
        onPick(item);
      });
      // The rack's picture leaves the cue ball out: it waits far in front and would shrink the triangle.
      const built = buildGameItem(item, ORIGIN, ORIGIN);
      // A lone ball turns its number to the camera.
      const shown = item.kind === GameItemKind.Rack ? built.objects.slice(0, -1)
        : item.kind === GameItemKind.Ball ? built.objects.map((o) => ({ ...o, transform: { ...o.transform, rotation: BALL_FACING } }))
        : built.objects;
      const high = item.kind === GameItemKind.ChessSet || item.kind === GameItemKind.Board || item.kind === GameItemKind.Rack;
      const spec = objectsPreview(shown, high);
      thumbs.enqueue({ ...spec, basis: { ...spec.basis, aspect: GAME_CELL_W / GAME_CELL_H }, width: GAME_CELL_W * 2, height: GAME_CELL_H * 2, samples: GAME_SAMPLES, bounces: 2, transparent: false, into: c });
      cells.push(cell);
      line.append(cell);
    }
    host.append(line);
  }
  return host;
}

/** Bryce's preset library for objects: rendered landforms, or the chess and billiards pieces. */
export function openObjectLibrary(thumbs: Thumbnailer, pick: LibraryPick): void {
  let picked: Picked | null = null;
  const dialog: { d?: Dialog } = {};
  const accept = () => {
    if (!picked) return;
    if ('terrain' in picked) pick.terrain(picked.terrain);
    else pick.game(picked.game);
  };
  const close = () => { dialog.d?.close(); accept(); };
  const pages = new Map<LibraryCategory, HTMLElement>();
  const page = (c: LibraryCategory): HTMLElement => {
    let p = pages.get(c);
    if (!p) {
      p = c === LibraryCategory.Landforms
        ? grid(OBJECT_LIBRARY, (o) => o.name, (o) => o.description, (o, cv) => {
          const terrain = createObject(createEntry('terrain'), { seed: PREVIEW_SEED, recipe: o.recipe, material: o.material });
          const spec = libraryPreview(o, terrain);
          thumbs.enqueue({ ...spec, basis: { ...spec.basis, aspect: CELL_W / CELL_H }, width: CELL_W * 2, height: CELL_H * 2, samples: SAMPLES, bounces: 2, transparent: false, into: cv });
        }, (o) => { picked = { terrain: o }; }, close)
        : gameRows(thumbs, (item) => { picked = { game: item }; }, close);
      pages.set(c, p);
    }
    return p;
  };
  const holder = el('div');
  const show = (c: LibraryCategory) => {
    lastCategory = c;
    picked = null;
    holder.replaceChildren(page(c));
    const title = dialog.d?.el.querySelector('.ui-dialog-title');
    if (title) title.textContent = `Objects — ${c}`;
  };
  const strip = new Choice({ cls: 'segmented library-categories', items: CATEGORY_LABELS, value: lastCategory, onChange: show });
  dialog.d = new Dialog({ title: `Objects — ${lastCategory}`, style: DialogStyle.Lab, body: el('div', {}, [strip.el, holder]), onOk: accept, onCancel: () => undefined });
  show(lastCategory);
  dialog.d.open();
}

/** Sky & Fog presets: Hoodoo's own or the ones you saved; pick one to replace the atmosphere. */
enum SkyShelf {
  Presets = 'presets',
  Mine = 'mine',
}
const SKY_SHELVES: readonly { value: SkyShelf; label: string }[] = [
  { value: SkyShelf.Presets, label: 'Presets' },
  { value: SkyShelf.Mine, label: 'My skies' },
];
let lastSkyShelf = SkyShelf.Presets;

export function openSkyLibrary(thumbs: Thumbnailer, current: Sky, onPick: (s: SkyPreset) => void, onPreview: (s: SkyPreset | null) => void): void {
  let picked: SkyPreset | null = null;
  const dialog: { d?: Dialog } = {};
  const mine = new MySkies();
  const close = () => { dialog.d?.close(); if (picked) onPick(picked); };
  const choose = (s: SkyPreset) => { picked = s; onPreview(s); };
  const draw = (s: SkyPreset, c: HTMLCanvasElement) => {
    const spec = skyPreview(s.sky);
    thumbs.enqueue({ ...spec, basis: { ...spec.basis, aspect: CELL_W / CELL_H }, width: CELL_W * 2, height: CELL_H * 2, samples: SAMPLES, bounces: 2, transparent: false, into: c });
  };
  const holder = el('div');
  const minePage = (): HTMLElement => {
    const name = el('input', { cls: 'ui-number sky-save-name', attrs: { value: freeSkyName(mine.all), spellcheck: 'false', maxlength: String(SKY_NAME_MAX), 'aria-label': 'Name' } }) as HTMLInputElement;
    const save = () => { mine.save(name.value, current); show(SkyShelf.Mine); };
    name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === KEY.Enter) save(); });
    const head = el('div', { cls: 'sky-save-row' }, [name, new Button({ label: 'Save current sky', onClick: save }).el]);
    if (!mine.all.length) return el('div', {}, [head, el('div', { cls: 'sky-save-empty', text: 'Nothing saved yet. Name the sky you have now and save it.' })]);
    const cells = grid(mine.all, (s) => s.name, (s) => `${s.name} · double-click to use`, draw, choose, close);
    mine.all.forEach((s, i) => {
      const remove = new Button({ cls: 'sky-remove', title: `Delete ${s.name}`, content: glyph(GLYPH.cross, GLYPH_BOX), onClick: (e) => { e.stopPropagation(); mine.remove(s.name); show(SkyShelf.Mine); } });
      (cells.children[i] as HTMLElement).classList.add('sky-cell');
      cells.children[i].append(remove.el);
    });
    return el('div', {}, [head, cells]);
  };
  const show = (shelf: SkyShelf) => {
    lastSkyShelf = shelf;
    picked = null;
    holder.replaceChildren(shelf === SkyShelf.Mine ? minePage() : grid(SKY_LIBRARY, (s) => s.name, (s) => s.name, draw, choose, close));
  };
  const strip = new Choice({ cls: 'segmented library-categories', items: SKY_SHELVES, value: lastSkyShelf, onChange: show });
  dialog.d = new Dialog({
    title: 'Sky & Fog Presets',
    style: DialogStyle.Lab,
    body: el('div', {}, [strip.el, holder]),
    onOk: () => { if (picked) onPick(picked); },
    onCancel: () => onPreview(null),
  });
  show(lastSkyShelf);
  dialog.d.open();
}

import { OBJECT_LIBRARY, type LibraryObject } from '../../assets/object.library';
import { SKY_LIBRARY, type SkyPreset } from '../../assets/sky.presets';
import { libraryPreview, skyPreview } from '../../render/icons';
import type { Thumbnailer } from '../../render/thumbs';
import { createEntry } from '../../assets/object.catalog';
import { createObject } from '../../world/objects.factory';
import { el } from '../kit/dom';
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

/** Bryce's preset library for objects: a grid of rendered landforms. */
export function openObjectLibrary(thumbs: Thumbnailer, onPick: (o: LibraryObject) => void): void {
  let picked: LibraryObject | null = null;
  const dialog: { d?: Dialog } = {};
  const body = grid(OBJECT_LIBRARY, (o) => o.name, (o) => o.description, (o, c) => {
    const terrain = createObject(createEntry('terrain'), { seed: PREVIEW_SEED, recipe: o.recipe, material: o.material });
    const spec = libraryPreview(o, terrain);
    thumbs.enqueue({ ...spec, basis: { ...spec.basis, aspect: CELL_W / CELL_H }, width: CELL_W * 2, height: CELL_H * 2, samples: SAMPLES, bounces: 2, transparent: false, into: c });
  }, (o) => { picked = o; }, () => { dialog.d?.close(); if (picked) onPick(picked); });
  dialog.d = new Dialog({ title: 'Objects — Terrains & Landforms', style: DialogStyle.Lab, body, onOk: () => { if (picked) onPick(picked); }, onCancel: () => undefined });
  dialog.d.open();
}

/** Sky & Fog presets: pick one to replace the atmosphere. */
export function openSkyLibrary(thumbs: Thumbnailer, onPick: (s: SkyPreset) => void, onPreview: (s: SkyPreset | null) => void): void {
  let picked: SkyPreset | null = null;
  const dialog: { d?: Dialog } = {};
  const body = grid(SKY_LIBRARY, (s) => s.name, (s) => s.name, (s, c) => {
    const spec = skyPreview(s.sky);
    thumbs.enqueue({ ...spec, basis: { ...spec.basis, aspect: CELL_W / CELL_H }, width: CELL_W * 2, height: CELL_H * 2, samples: SAMPLES, bounces: 2, transparent: false, into: c });
  }, (s) => { picked = s; onPreview(s); }, () => { dialog.d?.close(); if (picked) onPick(picked); });
  dialog.d = new Dialog({
    title: 'Sky & Fog Presets',
    style: DialogStyle.Lab,
    body,
    onOk: () => { if (picked) onPick(picked); },
    onCancel: () => onPreview(null),
  });
  dialog.d.open();
}

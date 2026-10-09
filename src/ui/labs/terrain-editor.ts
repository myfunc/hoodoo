import { randomSeed } from '../../core/rng';
import { TerrainOp } from '../../model/scene.enums';
import type { SceneObject, TerrainData } from '../../model/scene.types';
import { type IconSpec, libraryPreview } from '../../render/icons';
import type { Thumbnailer } from '../../render/thumbs';
import { type Field, field, resample } from '../../world/terrain/heightfield';
import { BrushMode, brushDab } from '../../world/terrain/terrain-brush';
import { applyTerrainOp } from '../../world/terrain/terrain-ops';
import { fromField, toField } from '../../world/terrain/terrain-recipe';
import { Button, Choice, Dial, Select } from '../kit/controls';
import { el, onDrag } from '../kit/dom';
import { Dialog, DialogStyle } from '../kit/dialog';
import { Logger } from '../../core/log';

const logger = Logger.create('TerrainEditor');

const MAP_PX = 300;
const PREVIEW_W = 300;
const PREVIEW_H = 200;
const PREVIEW_SAMPLES = 3;
const PREVIEW_DEBOUNCE_MS = 150;
const RESOLUTIONS = [32, 64, 128, 256, 512] as const;
const UNDO_LIMIT = 40;
const CHANNEL = 255;
const DEFAULT_AMOUNT = 50;
const BRUSH = { size: 12, strength: 25, sizeMax: 50, strengthMax: 100 } as const;
const PERCENT = 100;
const STAGE = 'radial-gradient(ellipse at 50% 70%, #6a6a70 0%, #3a3a40 45%, #1e1e22 75%)';

/** Tool buttons by tab, like Bryce 2's Elevation / Filtering / Pictures groups. */
const TOOLS: readonly { group: string; ops: readonly { op: TerrainOp; label: string }[] }[] = [
  {
    group: 'Elevation',
    ops: [
      { op: TerrainOp.Fractal, label: 'Fractal' }, { op: TerrainOp.Ridges, label: 'Ridges' },
      { op: TerrainOp.Spikes, label: 'Spikes' }, { op: TerrainOp.Mounds, label: 'Mounds' },
      { op: TerrainOp.Cone, label: 'Peak' }, { op: TerrainOp.Crater, label: 'Crater' },
      { op: TerrainOp.Canyon, label: 'Canyon' }, { op: TerrainOp.Island, label: 'Island' },
      { op: TerrainOp.Raise, label: 'Raise' }, { op: TerrainOp.Lower, label: 'Lower' },
    ],
  },
  {
    group: 'Filtering',
    ops: [
      { op: TerrainOp.Erode, label: 'Erode' }, { op: TerrainOp.Smooth, label: 'Smooth' },
      { op: TerrainOp.Sharpen, label: 'Sharpen' }, { op: TerrainOp.Plateaus, label: 'Subplateaus' },
      { op: TerrainOp.Mesa, label: 'Mesa' }, { op: TerrainOp.Clip, label: 'Clip Peaks' },
      { op: TerrainOp.Flatten, label: 'Flatten' }, { op: TerrainOp.Invert, label: 'Invert' },
      { op: TerrainOp.Normalize, label: 'Equalize' },
    ],
  },
];

/**
 * READ ME — the Terrain Editor. Works on a local copy of the heightfield with its
 * own undo; the grey map is paintable; the stage below shows a live render.
 */
export class TerrainEditor {
  private f: Field;
  private readonly undo: Field[] = [];
  private amount = DEFAULT_AMOUNT;
  private brush: { mode: BrushMode; size: number; strength: number } = { mode: BrushMode.Raise, size: BRUSH.size, strength: BRUSH.strength };
  private readonly map: HTMLCanvasElement;
  private readonly preview: HTMLCanvasElement;
  private timer = 0;

  constructor(private readonly obj: SceneObject, private readonly thumbs: Thumbnailer, private readonly onApply: (t: TerrainData) => void) {
    this.f = obj.terrain ? toField(obj.terrain) : field(RESOLUTIONS[2]);
    this.map = el('canvas', { attrs: { width: String(MAP_PX), height: String(MAP_PX) }, style: { width: `${MAP_PX}px`, height: `${MAP_PX}px`, border: '1px solid #000', cursor: 'crosshair', imageRendering: 'pixelated' } });
    this.preview = el('canvas', { style: { width: `${PREVIEW_W}px`, height: `${PREVIEW_H}px`, borderRadius: '50% / 30%', background: STAGE } });
  }

  open(): void {
    const tools = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', width: '210px' } });
    for (const g of TOOLS) {
      tools.append(el('div', { cls: 'lab-section-title', text: g.group }));
      const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' } });
      for (const t of g.ops) grid.append(new Button({ label: t.label, onClick: () => this.apply(t.op) }).el);
      tools.append(grid);
    }
    tools.append(
      new Dial({ label: 'Amount', min: 0, max: PERCENT, value: this.amount, onInput: (v) => { this.amount = v; } }).el,
      el('div', { cls: 'lab-section-title', text: 'Pictures' }),
      el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, [
        new Button({ label: 'Import image…', title: 'Load any picture as a height map (bright = high)', onClick: () => this.importImage() }).el,
        new Button({ label: 'Export PNG', onClick: () => this.exportPng() }).el,
        new Button({ label: 'New', title: 'Flat terrain', onClick: () => this.commit(field(this.f.res)) }).el,
      ]),
    );
    const res = new Select<number>({
      items: RESOLUTIONS.map((r) => ({ value: r, label: `Grid ${r} × ${r}` })),
      value: this.f.res,
      onChange: (r) => this.commit(resample(this.f, r)),
    });
    const brushMode = new Choice<BrushMode>({
      items: [
        { value: BrushMode.Raise, label: 'Raise' }, { value: BrushMode.Lower, label: 'Lower' },
        { value: BrushMode.Smooth, label: 'Smooth' }, { value: BrushMode.Flatten, label: 'Flatten' },
      ],
      value: this.brush.mode,
      onChange: (m) => { this.brush.mode = m; },
    });
    const center = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
      el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [res.el, new Button({ label: 'Undo', onClick: () => this.stepBack() }).el]),
      this.map,
      el('div', { cls: 'lab-section-title', text: 'Paint brush (drag on the map)' }),
      brushMode.el,
      new Dial({ label: 'Size', min: 1, max: BRUSH.sizeMax, value: this.brush.size, onInput: (v) => { this.brush.size = v; } }).el,
      new Dial({ label: 'Strength', min: 1, max: BRUSH.strengthMax, value: this.brush.strength, onInput: (v) => { this.brush.strength = v; } }).el,
    ]);
    const right = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
      this.preview,
      el('div', { cls: 'lab-note', text: 'Black is clipped away; white is the summit. Drag on the map to paint.' }),
    ]);
    this.installBrush();
    new Dialog({
      title: 'Terrain Editor',
      style: DialogStyle.Lab,
      body: el('div', { style: { display: 'flex', gap: '16px' } }, [tools, center, right]),
      onOk: () => this.onApply(fromField(this.f)),
      onCancel: () => undefined,
    }).open();
    this.draw();
  }

  private commit(next: Field): void {
    this.undo.push(this.f);
    if (this.undo.length > UNDO_LIMIT) this.undo.shift();
    this.f = next;
    this.draw();
  }

  private stepBack(): void {
    const prev = this.undo.pop();
    if (prev) {
      this.f = prev;
      this.draw();
    }
  }

  private apply(op: TerrainOp): void {
    this.commit(applyTerrainOp(this.f, op, this.amount, randomSeed()));
  }

  private installBrush(): void {
    let started = false;
    onDrag(this.map, {
      start: (e) => {
        started = true;
        this.undo.push(this.f);
        this.dab(e);
      },
      move: (_dx, _dy, e) => { if (started) this.dab(e); },
      end: () => { started = false; },
    });
  }

  private dab(e: PointerEvent): void {
    const r = this.map.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    const level = this.f.h[Math.round(v * (this.f.res - 1)) * this.f.res + Math.round(u * (this.f.res - 1))] ?? 0;
    this.f = brushDab(this.f, { mode: this.brush.mode, u, v, radius: this.brush.size / PERCENT, strength: this.brush.strength / PERCENT / (2 * 2 * 2), level });
    this.draw();
  }

  private draw(): void {
    const g = this.map.getContext('2d');
    if (!g) return;
    const n = this.f.res;
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = this.f.h[i] * CHANNEL;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = CHANNEL;
    }
    const tmp = el('canvas', { attrs: { width: String(n), height: String(n) } });
    tmp.getContext('2d')?.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, 0, 0, MAP_PX, MAP_PX);
    this.schedulePreview();
  }

  private schedulePreview(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const terrain = { ...this.obj, terrain: fromField(this.f) };
      const spec: IconSpec = libraryPreview({ name: '', description: '', kind: this.obj.kind, size: this.obj.transform.size, material: '', recipe: { steps: [] } }, terrain);
      const w = PREVIEW_W * 2;
      const h = PREVIEW_H * 2;
      this.thumbs.enqueue({ ...spec, basis: { ...spec.basis, aspect: w / h }, width: w, height: h, samples: PREVIEW_SAMPLES, bounces: 2, transparent: true, into: this.preview });
    }, PREVIEW_DEBOUNCE_MS);
  }

  private importImage(): void {
    const input = el('input', { attrs: { type: 'file', accept: 'image/*' } });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this.loadImage(file).catch((error: unknown) => logger.error('height map import failed', { name: file.name }, error));
    });
    input.click();
  }

  private async loadImage(file: File): Promise<void> {
    const bitmap = await createImageBitmap(file);
    const n = this.f.res;
    const c = el('canvas', { attrs: { width: String(n), height: String(n) } });
    const g = c.getContext('2d');
    if (!g) return;
    g.drawImage(bitmap, 0, 0, n, n);
    const data = g.getImageData(0, 0, n, n).data;
    const next = field(n);
    for (let i = 0; i < n * n; i++) next.h[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / (3 * CHANNEL);
    this.commit(next);
  }

  private exportPng(): void {
    const n = this.f.res;
    const c = el('canvas', { attrs: { width: String(n), height: String(n) } });
    const g = c.getContext('2d');
    if (!g) return;
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = this.f.h[i] * CHANNEL;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = CHANNEL;
    }
    g.putImageData(img, 0, 0);
    const a = el('a', { attrs: { href: c.toDataURL('image/png'), download: `${this.obj.name.replace(/\W+/g, '-')}-heightmap.png` } });
    a.click();
  }
}

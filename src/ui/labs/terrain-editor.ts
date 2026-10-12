import { randomSeed } from '../../core/rng';
import { Action } from '../../input/actions';
import { TerrainOp } from '../../model/scene.enums';
import type { SceneObject, TerrainData } from '../../model/scene.types';
import { type IconSpec, libraryPreview } from '../../render/icons';
import { type Field, field, resample } from '../../world/terrain/heightfield';
import { BrushMode, brushDab } from '../../world/terrain/terrain-brush';
import { applyTerrainOp } from '../../world/terrain/terrain-ops';
import { fromField, toField } from '../../world/terrain/terrain-recipe';
import { terrainTarget } from '../../world/tool-places';
import type { UiContext } from '../context';
import { Button, Choice, Dial, Select } from '../kit/controls';
import { el, onDrag } from '../kit/dom';
import { DialogStyle } from '../kit/dialog';
import type { ToolContent } from '../kit/tool-window';
import { LiveEdit } from './live-edit';
import { Logger } from '../../core/log';
import './tool-content.css';

const logger = Logger.create('TerrainEditor');

const MAP_PX = 300;
const PREVIEW_W = 300;
const PREVIEW_H = 200;
const PREVIEW_SAMPLES = 3;
const PREVIEW_DEBOUNCE_MS = 150;
const RESOLUTIONS = [32, 64, 128, 256, 512] as const;
const LABEL = 'Edit terrain';
const NO_TARGET = 'Select a terrain or a lattice.';
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
 * READ ME — the Terrain Editor as a tool window (Edit Object on a terrain). It
 * shapes the selected terrain or lattice and follows the selection. Each tool
 * press and each brush stroke goes into the scene as one undo step (Undo here
 * is the scene's); the grey map is paintable and the stage shows a live render.
 */
export class TerrainEditor implements ToolContent {
  readonly title = 'Terrain Editor';
  readonly tab = 'Terrain';
  readonly style = DialogStyle.Lab;
  readonly cls = 'terrain-tool';
  readonly body: HTMLElement;
  private f: Field = field(RESOLUTIONS[2]);
  private obj: SceneObject | null = null;
  /** The heightfield last read from or written to the scene: anything else there is an undo or another edit. */
  private shownTerrain: TerrainData | null = null;
  private amount = DEFAULT_AMOUNT;
  private brush: { mode: BrushMode; size: number; strength: number } = { mode: BrushMode.Raise, size: BRUSH.size, strength: BRUSH.strength };
  private readonly map: HTMLCanvasElement;
  private readonly preview: HTMLCanvasElement;
  private readonly res: Select<number>;
  private readonly columns: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly live: LiveEdit;
  private stops: (() => void)[] = [];
  private subject: (text: string) => void = () => undefined;
  private timer = 0;

  constructor(private readonly ctx: UiContext) {
    this.live = new LiveEdit(ctx.world);
    this.map = el('canvas', { cls: 'terrain-map', attrs: { width: String(MAP_PX), height: String(MAP_PX) }, style: { width: `${MAP_PX}px`, height: `${MAP_PX}px` } });
    this.preview = el('canvas', { style: { width: `${PREVIEW_W}px`, height: `${PREVIEW_H}px`, borderRadius: '50% / 30%', background: STAGE } });
    const tools = el('div', { cls: 'terrain-tools' });
    for (const g of TOOLS) {
      tools.append(el('div', { cls: 'lab-section-title', text: g.group }));
      const grid = el('div', { cls: 'terrain-ops' });
      for (const t of g.ops) grid.append(new Button({ label: t.label, onClick: () => this.apply(t.op) }).el);
      tools.append(grid);
    }
    tools.append(
      new Dial({ label: 'Amount', min: 0, max: PERCENT, value: this.amount, onInput: (v) => { this.amount = v; } }).el,
      el('div', { cls: 'lab-section-title', text: 'Pictures' }),
      el('div', { cls: 'lab-buttons' }, [
        new Button({ label: 'Import image…', title: 'Load any picture as a height map (bright = high)', onClick: () => this.importImage() }).el,
        new Button({ label: 'Export PNG', onClick: () => this.exportPng() }).el,
        new Button({ label: 'New', title: 'Flat terrain', onClick: () => this.commit(field(this.f.res)) }).el,
      ]),
    );
    this.res = new Select<number>({
      items: RESOLUTIONS.map((r) => ({ value: r, label: `Grid ${r} × ${r}` })),
      value: this.f.res,
      onChange: (r) => this.commit(resample(this.f, r)),
    });
    const brushMode = new Choice<BrushMode>({
      cls: 'segmented',
      items: [
        { value: BrushMode.Raise, label: 'Raise' }, { value: BrushMode.Lower, label: 'Lower' },
        { value: BrushMode.Smooth, label: 'Smooth' }, { value: BrushMode.Flatten, label: 'Flatten' },
      ],
      value: this.brush.mode,
      onChange: (m) => { this.brush.mode = m; },
    });
    const center = el('div', { cls: 'terrain-center' }, [
      el('div', { cls: 'lab-buttons' }, [this.res.el, new Button({ label: 'Undo', title: 'Undo the last change to the scene', onClick: () => ctx.dispatch(Action.Undo) }).el]),
      this.map,
      el('div', { cls: 'lab-section-title', text: 'Paint brush (drag on the map)' }),
      brushMode.el,
      new Dial({ label: 'Size', min: 1, max: BRUSH.sizeMax, value: this.brush.size, onInput: (v) => { this.brush.size = v; } }).el,
      new Dial({ label: 'Strength', min: 1, max: BRUSH.strengthMax, value: this.brush.strength, onInput: (v) => { this.brush.strength = v; } }).el,
    ]);
    const right = el('div', { cls: 'terrain-stage' }, [
      this.preview,
      el('div', { cls: 'lab-note', text: 'Black is clipped away; white is the summit.' }),
    ]);
    this.columns = el('div', { cls: 'terrain-columns' }, [tools, center, right]);
    this.empty = el('div', { cls: 'tool-empty', text: NO_TARGET });
    this.body = el('div', {}, [this.empty, this.columns]);
    this.installBrush();
  }

  start(subject: (text: string) => void): void {
    this.subject = subject;
    const follow = () => this.follow();
    this.stops = [this.ctx.world.events.on('selection', follow), this.ctx.world.events.on('changed', follow)];
    this.obj = null;
    this.follow();
  }

  stop(): void {
    for (const s of this.stops) s();
    this.stops = [];
  }

  /** Another terrain picked: its heightfield comes up; the same one changed in the scene (undo): reread it. */
  private follow(): void {
    const target = terrainTarget(this.ctx.world.selectedObjects());
    const moved = (target?.id ?? null) !== (this.obj?.id ?? null);
    this.obj = target;
    this.subject(target?.name ?? '');
    this.empty.hidden = !!target;
    this.columns.hidden = !target;
    if (!target) return;
    if (moved || target.terrain !== this.shownTerrain) {
      this.shownTerrain = target.terrain;
      this.f = target.terrain ? toField(target.terrain) : field(RESOLUTIONS[2]);
      this.res.set(this.f.res);
      this.draw();
    }
  }

  /** A finished change goes into the scene as one undo step. */
  private commit(next: Field): void {
    this.f = next;
    this.res.set(next.res);
    this.draw();
    const id = this.obj?.id;
    if (!id) return;
    const terrain = fromField(next);
    this.shownTerrain = terrain;
    this.live.apply(LABEL, () => this.ctx.world.updateObjects(new Set([id]), LABEL, (x) => ({ ...x, terrain })));
  }

  private apply(op: TerrainOp): void {
    this.commit(applyTerrainOp(this.f, op, this.amount, randomSeed()));
  }

  /** A stroke paints the map as you drag and lands in the scene when you let go. */
  private installBrush(): void {
    let started = false;
    onDrag(this.map, {
      start: (e) => {
        started = !!this.obj;
        if (started) this.dab(e);
      },
      move: (_dx, _dy, e) => { if (started) this.dab(e); },
      end: () => {
        if (started) this.commit(this.f);
        started = false;
      },
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
      const obj = this.obj;
      if (!obj) return;
      const terrain = { ...obj, terrain: fromField(this.f) };
      const spec: IconSpec = libraryPreview({ name: '', description: '', kind: obj.kind, size: obj.transform.size, material: '', recipe: { steps: [] } }, terrain);
      const w = PREVIEW_W * 2;
      const h = PREVIEW_H * 2;
      this.ctx.thumbs.enqueue({ ...spec, basis: { ...spec.basis, aspect: w / h }, width: w, height: h, samples: PREVIEW_SAMPLES, bounces: 2, transparent: true, into: this.preview });
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
    const a = el('a', { attrs: { href: c.toDataURL('image/png'), download: `${(this.obj?.name ?? 'terrain').replace(/\W+/g, '-')}-heightmap.png` } });
    a.click();
  }
}

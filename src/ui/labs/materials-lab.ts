import type { Rgb } from '../../core/color';
import { randomSeed } from '../../core/rng';
import { MATERIAL_LIBRARY } from '../../assets/materials.presets';
import { COLOR_CHANNELS, VALUE_CHANNELS, VALUE_LIMITS } from '../../model/material.factory';
import { ChannelSource, ColorChannel, ValueChannel } from '../../model/scene.enums';
import type { ObjectId } from '../../model/scene.ids';
import type { Material, ProceduralTexture } from '../../model/scene.types';
import { materialPreview } from '../../render/icons';
import { materialTargets } from '../../world/tool-places';
import type { UiContext } from '../context';
import { ColorSwatch } from '../kit/color-picker';
import { Button, Dial, Select } from '../kit/controls';
import { DialogStyle } from '../kit/dialog';
import { clearChildren, el } from '../kit/dom';
import type { ToolContent } from '../kit/tool-window';
import { LiveEdit } from './live-edit';
import { randomMaterial } from './material-randomizer';
import { TexturePanel } from './texture-panel';
import './tool-content.css';

const PREVIEW_W = 240;
const PREVIEW_H = 180;
const PREVIEW_SAMPLES = 6;
const PREVIEW_BOUNCES = 5;
const PRESET_PX = 44;
const PRESET_SAMPLES = 3;
const PREVIEW_DEBOUNCE_MS = 90;
const MAX_DPR = 2;
const SOURCES = [ChannelSource.TexA, ChannelSource.TexB, ChannelSource.TexC] as const;
const SOURCE_NAMES = ['A', 'B', 'C'] as const;
const LABEL = 'Materials Lab';
const NO_TARGET = 'Select an object to dress it';

const COLOR_LABELS: Readonly<Record<ColorChannel, string>> = {
  [ColorChannel.Diffuse]: 'Diffuse Color',
  [ColorChannel.Ambient]: 'Ambient Color',
  [ColorChannel.Specular]: 'Specular Color',
  [ColorChannel.Transparent]: 'Transparent Color',
};
const VALUE_LABELS: Readonly<Record<ValueChannel, string>> = {
  [ValueChannel.Diffusion]: 'Diffusion',
  [ValueChannel.Ambience]: 'Ambience',
  [ValueChannel.Specularity]: 'Specularity',
  [ValueChannel.Metallicity]: 'Metallicity',
  [ValueChannel.Transparency]: 'Transparency',
  [ValueChannel.Reflection]: 'Reflection',
  [ValueChannel.Refraction]: 'Refraction',
  [ValueChannel.Bump]: 'Bump Height',
};

/** A, B, C option dots of one channel row; clicking the lit dot returns the channel to its flat value. */
function sourceDots(current: ChannelSource, onPick: (s: ChannelSource) => void): HTMLElement {
  const row = el('div', { cls: 'lab-dots' });
  const dots = SOURCES.map((src, i) => {
    const d = el('div', { cls: `ui-toggle${current === src ? ' is-on' : ''}`, title: `Drive from texture ${SOURCE_NAMES[i]}` }, [el('span', { cls: 'ui-dot' })]);
    d.addEventListener('click', () => {
      const next = current === src ? ChannelSource.Flat : src;
      current = next;
      dots.forEach((x, j) => x.classList.toggle('is-on', SOURCES[j] === next));
      onPick(next);
    });
    return d;
  });
  row.append(...dots);
  return row;
}

/**
 * READ ME — the Materials Lab as a tool window. It dresses the selected objects
 * (lights have no material) and follows the selection: picking another object
 * shows its material. Every change applies at once, one undo step each (a dial
 * drag is one); Reset goes back to the material the object had when you picked it.
 */
export class MaterialsLab implements ToolContent {
  readonly title = LABEL;
  readonly tab = 'Materials';
  readonly style = DialogStyle.Lab;
  readonly cls = 'materials-tool';
  readonly body: HTMLElement;
  private draft: Material = MATERIAL_LIBRARY[0].materials[0];
  /** The material of the object when it was picked, for Reset. */
  private initial: Material = this.draft;
  private targets: ObjectId[] = [];
  private readonly live: LiveEdit;
  private readonly preview: HTMLCanvasElement;
  private readonly grid: HTMLElement;
  private readonly textures: HTMLElement;
  private readonly presetGrid: HTMLElement;
  private readonly name: HTMLElement;
  private readonly note: HTMLElement;
  private stops: (() => void)[] = [];
  private subject: (text: string) => void = () => undefined;
  private timer = 0;

  constructor(private readonly ctx: UiContext) {
    this.live = new LiveEdit(ctx.world);
    this.preview = el('canvas', { cls: 'lab-preview', style: { width: `${PREVIEW_W}px`, height: `${PREVIEW_H}px` } });
    this.grid = el('div', { cls: 'lab-channels' });
    this.textures = el('div');
    this.presetGrid = el('div', { cls: 'lab-presets', style: { gridTemplateColumns: `repeat(auto-fill, ${PRESET_PX}px)` } });
    this.name = el('div', { cls: 'lab-name' });
    this.note = el('div', { cls: 'lab-note lab-target' });
    const category = new Select<number>({
      items: MATERIAL_LIBRARY.map((c, i) => ({ value: i, label: c.name })),
      value: 0,
      onChange: (i) => this.showPresets(i),
    });
    const left = el('div', { cls: 'lab-side' }, [
      this.preview,
      this.name,
      this.note,
      el('div', { cls: 'lab-buttons' }, [
        new Button({ label: 'Randomize', title: 'Roll a random material', onClick: () => this.replace(randomMaterial(randomSeed())) }).el,
        new Button({ label: 'Reset', title: 'Back to the material the object had when you picked it', onClick: () => this.replace(this.initial) }).el,
      ]),
      el('div', { cls: 'lab-section-title', text: 'Presets' }),
      category.el,
      this.presetGrid,
    ]);
    const right = el('div', { cls: 'lab-main' }, [
      el('div', { cls: 'lab-channels lab-dots-head' }, [el('span'), el('span'), el('span', { cls: 'lab-note', text: '  A    B    C' })]),
      this.grid,
      this.textures,
    ]);
    this.body = el('div', { cls: 'lab-columns' }, [left, right]);
    this.showPresets(0);
  }

  start(subject: (text: string) => void): void {
    this.subject = subject;
    const follow = () => this.follow();
    this.stops = [this.ctx.world.events.on('selection', follow), this.ctx.world.events.on('changed', follow)];
    this.follow(true);
  }

  stop(): void {
    for (const s of this.stops) s();
    this.stops = [];
  }

  /** Another object picked: its material comes up; the same one changed by undo: the lab shows what it wears now. */
  private follow(force = false): void {
    const targets = materialTargets(this.ctx.world.selectedObjects());
    const first = targets[0];
    const moved = (first?.id ?? null) !== (this.targets[0] ?? null);
    this.targets = targets.map((o) => o.id);
    this.subject(first ? (targets.length > 1 ? `${targets.length} objects` : first.name) : '');
    this.note.textContent = first ? '' : NO_TARGET;
    if (!first) {
      if (force) this.build();
      return;
    }
    if (moved || force) this.initial = first.material;
    if (moved || force || first.material !== this.draft) {
      this.draft = first.material;
      this.build();
    }
  }

  /** A whole new material (preset, Randomize, Reset): the controls are rebuilt. */
  private replace(m: Material): void {
    this.draft = m;
    this.build();
    this.apply();
  }

  /** One channel changed. */
  private update(m: Material): void {
    this.draft = m;
    this.name.textContent = m.name;
    this.schedulePreview();
    this.apply();
  }

  private apply(): void {
    const ids = new Set(this.targets);
    const m = this.draft;
    if (ids.size) this.live.apply(LABEL, () => this.ctx.world.setMaterial(ids, m, LABEL));
  }

  private build(): void {
    const m = this.draft;
    this.name.textContent = m.name;
    clearChildren(this.grid);
    for (const ch of COLOR_CHANNELS) {
      const sw = new ColorSwatch({
        value: m.colors[ch],
        onInput: (v) => this.setColor(ch, v),
        onCommit: (v) => this.setColor(ch, v),
      });
      this.grid.append(el('span', { text: COLOR_LABELS[ch] }), sw.el, sourceDots(m.colorSources[ch], (s) => this.update({ ...this.draft, colorSources: { ...this.draft.colorSources, [ch]: s } })));
    }
    for (const ch of VALUE_CHANNELS) {
      const dial = new Dial({
        label: '',
        min: 0,
        max: VALUE_LIMITS[ch],
        value: m.values[ch],
        title: ch === ValueChannel.Refraction ? '100 = no bending, 133 water, 152 glass, 240 diamond' : VALUE_LABELS[ch],
        onInput: (v) => { if (v !== this.draft.values[ch]) this.update({ ...this.draft, values: { ...this.draft.values, [ch]: v } }); },
      });
      this.grid.append(el('span', { text: VALUE_LABELS[ch] }), dial.el, sourceDots(m.valueSources[ch], (s) => this.update({ ...this.draft, valueSources: { ...this.draft.valueSources, [ch]: s } })));
    }
    clearChildren(this.textures);
    m.textures.forEach((t, slot) => this.textures.append(new TexturePanel(slot, t, this.ctx.thumbs, (next) => this.setTexture(slot, next)).el));
    this.schedulePreview();
  }

  private setColor(ch: ColorChannel, v: Rgb): void {
    const was = this.draft.colors[ch];
    if (v[0] !== was[0] || v[1] !== was[1] || v[2] !== was[2]) this.update({ ...this.draft, colors: { ...this.draft.colors, [ch]: v } });
  }

  private setTexture(slot: number, t: ProceduralTexture | null): void {
    const textures = [...this.draft.textures] as [ProceduralTexture | null, ProceduralTexture | null, ProceduralTexture | null];
    textures[slot] = t;
    this.update({ ...this.draft, textures });
  }

  private schedulePreview(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.round(PREVIEW_W * dpr);
      const h = Math.round(PREVIEW_H * dpr);
      const spec = materialPreview(this.draft);
      this.ctx.thumbs.enqueue({ ...spec, basis: { ...spec.basis, aspect: w / h }, width: w, height: h, samples: PREVIEW_SAMPLES, bounces: PREVIEW_BOUNCES, transparent: false, into: this.preview });
    }, PREVIEW_DEBOUNCE_MS);
  }

  private showPresets(category: number): void {
    clearChildren(this.presetGrid);
    const px = PRESET_PX * 2;
    for (const m of MATERIAL_LIBRARY[category].materials) {
      const c = el('canvas', { cls: 'lab-preset', title: m.name, style: { width: `${PRESET_PX}px`, height: `${PRESET_PX}px` } });
      c.addEventListener('click', () => this.replace(m));
      this.ctx.thumbs.enqueue({ ...materialPreview(m, false), width: px, height: px, samples: PRESET_SAMPLES, bounces: 3, transparent: true, into: c });
      this.presetGrid.append(c);
    }
  }
}

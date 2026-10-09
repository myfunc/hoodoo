import type { Rgb } from '../../core/color';
import { randomSeed } from '../../core/rng';
import { MATERIAL_LIBRARY } from '../../assets/materials.presets';
import { COLOR_CHANNELS, VALUE_CHANNELS, VALUE_LIMITS } from '../../model/material.factory';
import { ChannelSource, ColorChannel, ValueChannel } from '../../model/scene.enums';
import type { Material, ProceduralTexture } from '../../model/scene.types';
import { materialPreview } from '../../render/icons';
import type { Thumbnailer } from '../../render/thumbs';
import { ColorSwatch } from '../kit/color-picker';
import { Button, Dial, Select } from '../kit/controls';
import { clearChildren, el } from '../kit/dom';
import { Dialog, DialogStyle } from '../kit/dialog';
import { randomMaterial } from './material-randomizer';
import { TexturePanel } from './texture-panel';

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
const TITLE_COLOR = '#e0c890';

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
  const row = el('div', { style: { display: 'flex', gap: '6px' } });
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
 * READ ME — the Materials Lab. Edits a draft copy of the material; the preview
 * sphere re-renders as you go; OK applies the draft to the selection.
 */
export class MaterialsLab {
  private draft: Material;
  private readonly initial: Material;
  private readonly preview: HTMLCanvasElement;
  private readonly grid: HTMLElement;
  private readonly textures: HTMLElement;
  private readonly presetGrid: HTMLElement;
  private readonly title: HTMLElement;
  private timer = 0;

  constructor(initial: Material, private readonly thumbs: Thumbnailer, private readonly onApply: (m: Material) => void) {
    this.draft = initial;
    this.initial = initial;
    this.preview = el('canvas', { style: { width: `${PREVIEW_W}px`, height: `${PREVIEW_H}px`, border: '1px solid #000', display: 'block' } });
    this.grid = el('div', { style: { display: 'grid', gridTemplateColumns: '120px 1fr 64px', gap: '4px 10px', alignItems: 'center' } });
    this.textures = el('div');
    this.presetGrid = el('div', { style: { display: 'grid', gridTemplateColumns: `repeat(5, ${PRESET_PX}px)`, gap: '4px', maxHeight: '196px', overflowY: 'auto' } });
    this.title = el('div', { cls: 'lab-note', style: { fontSize: '12px', color: TITLE_COLOR } });
  }

  open(): void {
    const category = new Select<number>({
      items: MATERIAL_LIBRARY.map((c, i) => ({ value: i, label: c.name })),
      value: 0,
      onChange: (i) => this.showPresets(i),
    });
    const left = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', width: `${PREVIEW_W}px` } }, [
      this.preview,
      this.title,
      el('div', { style: { display: 'flex', gap: '6px' } }, [
        new Button({ label: 'Randomize', title: 'Roll a random material', onClick: () => this.replace(randomMaterial(randomSeed())) }).el,
        new Button({ label: 'Reset', title: 'Back to the material you opened', onClick: () => this.replace(this.initial) }).el,
      ]),
      el('div', { cls: 'lab-section-title', text: 'Presets' }),
      category.el,
      this.presetGrid,
    ]);
    const right = el('div', { style: { display: 'flex', flexDirection: 'column', minWidth: '520px' } }, [
      el('div', { style: { display: 'grid', gridTemplateColumns: '120px 1fr 64px', gap: '0 10px' } }, [
        el('span'), el('span'), el('span', { cls: 'lab-note', text: '  A    B    C' }),
      ]),
      this.grid,
      this.textures,
    ]);
    const body = el('div', { style: { display: 'flex', gap: '18px' } }, [left, right]);
    new Dialog({
      title: 'Materials Lab',
      style: DialogStyle.Lab,
      body,
      onOk: () => this.onApply(this.draft),
      onCancel: () => undefined,
    }).open();
    this.showPresets(0);
    this.build();
  }

  private replace(m: Material): void {
    this.draft = m;
    this.build();
  }

  private update(m: Material): void {
    this.draft = m;
    this.title.textContent = m.name;
    this.schedulePreview();
  }

  private build(): void {
    const m = this.draft;
    this.title.textContent = m.name;
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
        onInput: (v) => this.update({ ...this.draft, name: this.draft.name, values: { ...this.draft.values, [ch]: v } }),
      });
      this.grid.append(el('span', { text: VALUE_LABELS[ch] }), dial.el, sourceDots(m.valueSources[ch], (s) => this.update({ ...this.draft, valueSources: { ...this.draft.valueSources, [ch]: s } })));
    }
    clearChildren(this.textures);
    m.textures.forEach((t, slot) => this.textures.append(new TexturePanel(slot, t, this.thumbs, (next) => this.setTexture(slot, next)).el));
    this.schedulePreview();
  }

  private setColor(ch: ColorChannel, v: Rgb): void {
    this.update({ ...this.draft, colors: { ...this.draft.colors, [ch]: v } });
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
      this.thumbs.enqueue({ ...spec, basis: { ...spec.basis, aspect: w / h }, width: w, height: h, samples: PREVIEW_SAMPLES, bounces: PREVIEW_BOUNCES, transparent: false, into: this.preview });
    }, PREVIEW_DEBOUNCE_MS);
  }

  private showPresets(category: number): void {
    clearChildren(this.presetGrid);
    const px = PRESET_PX * 2;
    for (const m of MATERIAL_LIBRARY[category].materials) {
      const c = el('canvas', { title: m.name, style: { width: `${PRESET_PX}px`, height: `${PRESET_PX}px`, cursor: 'pointer', borderRadius: '2px' } });
      c.addEventListener('click', () => this.replace(m));
      this.thumbs.enqueue({ ...materialPreview(m, false), width: px, height: px, samples: PRESET_SAMPLES, bounces: 3, transparent: true, into: c });
      this.presetGrid.append(c);
    }
  }
}

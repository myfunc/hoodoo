import type { Rgb } from '../../core/color';
import { randomSeed } from '../../core/rng';
import { MATERIAL_LIBRARY } from '../../assets/materials.presets';
import { COLOR_CHANNELS, VALUE_CHANNELS, VALUE_LIMITS } from '../../model/material.factory';
import { ChannelSource, ColorChannel, ValueChannel } from '../../model/scene.enums';
import type { ObjectId } from '../../model/scene.ids';
import type { Material, ProceduralTexture } from '../../model/scene.types';
import { materialPreview } from '../../render/icons';
import { materialTargets } from '../../world/tool-places';
import { type UiContext, hintOn } from '../context';
import { ColorSwatch } from '../kit/color-picker';
import { Button, Dial, type MenuItem, Select, openMenu } from '../kit/controls';
import { DialogStyle } from '../kit/dialog';
import { clearChildren, el } from '../kit/dom';
import type { ToolContent } from '../kit/tool-window';
import { LiveEdit } from './live-edit';
import { randomMaterial } from './material-randomizer';
import { TexturePanel, newTexture } from './texture-panel';
import { CHANNEL_SHORT, type Channel, SLOT_NAMES, SLOT_SOURCES, channelsFrom, sourceOf, withSource, withoutSource } from './texture-labels';
import './tool-content.css';

const PREVIEW_W = 240;
const PREVIEW_H = 180;
const PREVIEW_SAMPLES = 6;
const PREVIEW_BOUNCES = 5;
const PRESET_PX = 44;
const PRESET_SAMPLES = 3;
const PREVIEW_DEBOUNCE_MS = 90;
const MAX_DPR = 2;
const SLOT_HINT = { title: 'Texture A, B, C', text: 'Which texture drives each channel; click the lit dot again for the flat value' } as const;
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

const CHANNEL_LABELS: Readonly<Record<Channel, string>> = { ...COLOR_LABELS, ...VALUE_LABELS };

/** Which texture slots hold a texture. */
type Filled = readonly [boolean, boolean, boolean];

/** One dot's line: what a click does there. */
function dotTitle(label: string, slot: number, lit: boolean, filled: boolean): string {
  const name = `Texture ${SLOT_NAMES[slot]}`;
  if (lit) return `${label} from ${name}: click for the flat value`;
  return filled ? `Drive ${label} from ${name}` : `${name} is empty: click adds one and drives ${label} from it`;
}

/**
 * A, B, C option dots of one channel row: the lit one is the texture that drives it;
 * clicking it again returns the channel to its flat value. An empty slot's dot is hollow.
 */
function sourceDots(label: string, current: ChannelSource, filled: Filled, onPick: (s: ChannelSource) => void): HTMLElement {
  const dots = SLOT_SOURCES.map((src, i) => {
    const lit = current === src;
    const d = el('div', { cls: `ui-toggle${lit ? ' is-on' : ''}${filled[i] ? '' : ' is-empty'}`, title: dotTitle(label, i, lit, filled[i]) }, [el('span', { cls: 'ui-dot' })]);
    d.addEventListener('click', () => onPick(lit ? ChannelSource.Flat : src));
    return d;
  });
  return el('div', { cls: 'lab-dots' }, dots);
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
  private panels: TexturePanel[] = [];
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
      this.slotHeads(),
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
    const filled = m.textures.map((t) => t !== null) as unknown as Filled;
    this.name.textContent = m.name;
    clearChildren(this.grid);
    for (const ch of COLOR_CHANNELS) {
      const sw = new ColorSwatch({
        value: m.colors[ch],
        onInput: (v) => this.setColor(ch, v),
        onCommit: (v) => this.setColor(ch, v),
      });
      this.grid.append(el('span', { text: COLOR_LABELS[ch] }), sw.el, sourceDots(COLOR_LABELS[ch], m.colorSources[ch], filled, (s) => this.setSource(ch, s)));
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
      this.grid.append(el('span', { text: VALUE_LABELS[ch] }), dial.el, sourceDots(VALUE_LABELS[ch], m.valueSources[ch], filled, (s) => this.setSource(ch, s)));
    }
    clearChildren(this.textures);
    this.panels = m.textures.map((t, slot) => new TexturePanel(slot, t, this.ctx.thumbs, (next) => this.setTexture(slot, next), {
      channels: this.slotChannels(slot),
      pick: (anchor) => this.useMenu(slot, anchor),
    }));
    this.textures.append(...this.panels.map((p) => p.el));
    this.schedulePreview();
  }

  private setColor(ch: ColorChannel, v: Rgb): void {
    const was = this.draft.colors[ch];
    if (v[0] !== was[0] || v[1] !== was[1] || v[2] !== was[2]) this.update({ ...this.draft, colors: { ...this.draft.colors, [ch]: v } });
  }

  /**
   * A slot's texture changed. Added or removed, the dots and headings are built again;
   * removed, the channels it drove go back to their flat values.
   */
  private setTexture(slot: number, t: ProceduralTexture | null): void {
    const was = this.draft.textures[slot];
    const textures = [...this.draft.textures] as [ProceduralTexture | null, ProceduralTexture | null, ProceduralTexture | null];
    textures[slot] = t;
    const next = { ...this.draft, textures };
    if ((was === null) === (t === null)) {
      this.update(next);
      return;
    }
    this.replace(t ? next : withoutSource(next, SLOT_SOURCES[slot]));
  }

  /** A channel picks its source; picking an empty slot puts a new texture there first. */
  private setSource(ch: Channel, source: ChannelSource): void {
    const slot = SLOT_SOURCES.indexOf(source as (typeof SLOT_SOURCES)[number]);
    if (slot >= 0 && !this.draft.textures[slot]) {
      const textures = [...this.draft.textures] as [ProceduralTexture | null, ProceduralTexture | null, ProceduralTexture | null];
      textures[slot] = newTexture();
      this.replace(withSource({ ...this.draft, textures }, ch, source));
      return;
    }
    this.replace(withSource(this.draft, ch, source));
  }

  /** The channels a slot drives, by their short names. */
  private slotChannels(slot: number): string[] {
    return channelsFrom(this.draft, SLOT_SOURCES[slot]).map((ch) => CHANNEL_SHORT[ch]);
  }

  /** Use for…: every channel, the ones this slot drives checked; a pick drives it from here, or back to flat. */
  private useMenu(slot: number, anchor: HTMLElement): void {
    const source = SLOT_SOURCES[slot];
    const item = (ch: Channel): MenuItem => {
      const on = sourceOf(this.draft, ch) === source;
      return { label: CHANNEL_LABELS[ch], checked: on, run: () => this.setSource(ch, on ? ChannelSource.Flat : source) };
    };
    const r = anchor.getBoundingClientRect();
    openMenu(r.left, r.bottom, [...COLOR_CHANNELS.map(item), { label: '', separator: true }, ...VALUE_CHANNELS.map(item)]);
  }

  /** The heading over the dot columns: they read as texture slots A, B, C. */
  private slotHeads(): HTMLElement {
    const letters = el('div', { cls: 'lab-dots lab-slot-letters' }, SLOT_NAMES.map((n) => el('span', { text: n, title: `Texture ${n}` })));
    const head = el('div', { cls: 'lab-channels lab-dots-head' }, [el('span'), el('span', { cls: 'lab-note lab-dots-caption', text: 'Texture' }), letters]);
    hintOn(this.ctx, head, SLOT_HINT);
    head.title = `${SLOT_HINT.title}: ${SLOT_HINT.text}`;
    return head;
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

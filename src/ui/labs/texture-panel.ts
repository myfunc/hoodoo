import type { Rgb } from '../../core/color';
import { randomSeed } from '../../core/rng';
import { TEXTURE_DEFAULTS, material, texture } from '../../model/material.factory';
import { ChannelSource, TextureKind } from '../../model/scene.enums';
import type { ProceduralTexture } from '../../model/scene.types';
import { materialPreview } from '../../render/icons';
import type { Thumbnailer } from '../../render/thumbs';
import { ColorSwatch } from '../kit/color-picker';
import { Button, Dial, Select } from '../kit/controls';
import { clearChildren, el } from '../kit/dom';
import { MAPPINGS, MAPPING_LABELS, TEXTURE_KINDS, TEXTURE_KIND_LABELS } from './texture-labels';

const PREVIEW_PX = 72;
const PREVIEW_SAMPLES = 2;
const FREQ = { min: 0.02, max: 40, step: 0.01 } as const;
const DETAIL = { min: 1, max: 8 } as const;
const CONTRAST = { min: -20, max: 100 } as const;
const DEFAULT_RAMP: readonly [Rgb, Rgb, Rgb] = [[0.1, 0.1, 0.1], [0.5, 0.5, 0.5], [0.95, 0.95, 0.95]];
const DEFAULT_FREQ = 1;
const SLOT_NAMES = ['A', 'B', 'C'] as const;
const PREVIEW_BG = '#222';
const LABEL_GUTTER = 16;
const FLAT_LIGHT = { diffusion: 30, ambience: 100, specularity: 0 } as const;

/** Editor for one of the three procedural textures (A, B, C) of a material. */
export class TexturePanel {
  readonly el: HTMLElement;
  private readonly preview: HTMLCanvasElement;
  private readonly body: HTMLElement;

  constructor(
    slot: number,
    private value: ProceduralTexture | null,
    private readonly thumbs: Thumbnailer,
    private readonly onChange: (t: ProceduralTexture | null) => void,
  ) {
    this.preview = el('canvas', { style: { width: `${PREVIEW_PX}px`, height: `${PREVIEW_PX}px`, border: '1px solid #000', background: PREVIEW_BG } });
    this.body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '0' } });
    this.el = el('div', { cls: 'lab-texture', style: { display: 'grid', gridTemplateColumns: `${PREVIEW_PX + LABEL_GUTTER}px 1fr`, gap: '8px', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.06)' } }, [
      el('div', {}, [el('div', { cls: 'lab-section-title', text: `Texture ${SLOT_NAMES[slot]}`, style: { margin: '0 0 4px' } }), this.preview]),
      this.body,
    ]);
    this.build();
  }

  private set(t: ProceduralTexture | null): void {
    this.value = t;
    this.onChange(t);
    this.renderPreview();
  }

  private patch(p: Partial<ProceduralTexture>): void {
    if (this.value) this.set({ ...this.value, ...p });
  }

  private build(): void {
    clearChildren(this.body);
    const t = this.value;
    if (!t) {
      this.body.append(
        el('span', { cls: 'lab-note', text: 'Empty slot.' }),
        new Button({ label: 'Add texture', onClick: () => { this.set(texture(TextureKind.Fbm, DEFAULT_FREQ, DEFAULT_RAMP)); this.build(); } }).el,
      );
      this.renderPreview();
      return;
    }
    const kind = new Select<TextureKind>({
      items: TEXTURE_KINDS.map((k) => ({ value: k, label: TEXTURE_KIND_LABELS[k] })),
      value: t.kind,
      onChange: (k) => this.patch({ kind: k }),
    });
    const mapping = new Select({ items: MAPPINGS.map((m) => ({ value: m, label: MAPPING_LABELS[m] })), value: t.mapping, onChange: (m) => this.patch({ mapping: m }) });
    const freq = new Dial({ label: 'Scale', ...FREQ, value: t.frequency, onInput: (v) => this.patch({ frequency: v }) });
    const detail = new Dial({ label: 'Detail', ...DETAIL, value: t.detail, onInput: (v) => this.patch({ detail: v }) });
    const contrast = new Dial({ label: 'Contrast', ...CONTRAST, value: t.contrast, onInput: (v) => this.patch({ contrast: v }) });
    const swatches = t.colors.map((c, i) => new ColorSwatch({
      value: c,
      onInput: (v) => this.setColor(i, v),
      onCommit: (v) => this.setColor(i, v),
    }).el);
    this.body.append(
      el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [kind.el, mapping.el]),
      freq.el,
      detail.el,
      contrast.el,
      el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, [
        el('span', { cls: 'lab-note', text: 'Ramp' }),
        ...swatches,
        new Button({ label: 'Seed', title: 'New random seed', onClick: () => this.patch({ seed: randomSeed() % TEXTURE_SEEDS }) }).el,
        new Button({ label: 'Remove', onClick: () => { this.set(null); this.build(); } }).el,
      ]),
    );
    this.renderPreview();
  }

  private setColor(i: number, v: Rgb): void {
    if (!this.value) return;
    const colors = [...this.value.colors] as [Rgb, Rgb, Rgb];
    colors[i] = v;
    this.patch({ colors });
  }

  /** Flat-lit square showing the texture's colour ramp. */
  private renderPreview(): void {
    const px = PREVIEW_PX * 2;
    const t = this.value;
    if (!t) {
      this.preview.getContext('2d')?.clearRect(0, 0, this.preview.width, this.preview.height);
      return;
    }
    const m = material({
      name: 'Texture preview',
      textures: [t],
      colorSources: { diffuse: ChannelSource.TexA, ambient: ChannelSource.TexA },
      values: FLAT_LIGHT,
    });
    const spec = materialPreview(m, false);
    this.thumbs.enqueue({ ...spec, width: px, height: px, samples: PREVIEW_SAMPLES, bounces: 1, transparent: true, into: this.preview });
  }
}

const TEXTURE_SEEDS = 1000;
export const EMPTY_SLOT_SEED = TEXTURE_DEFAULTS.seed;

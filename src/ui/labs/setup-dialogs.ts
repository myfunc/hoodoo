import type { Vec3 } from '../../core/vec3';
import type { DocumentSetup } from '../../model/scene.types';
import type { ReplicateSpec } from '../../world/transform-ops';
import { Button, Dial, NumberField, Select } from '../kit/controls';
import { el } from '../kit/dom';
import { Dialog, DialogStyle } from '../kit/dialog';

const DOC_PRESETS: readonly { label: string; w: number; h: number }[] = [
  { label: '640 × 480 (Bryce default, 4:3)', w: 640, h: 480 },
  { label: '800 × 600 (4:3)', w: 800, h: 600 },
  { label: '1280 × 720 (16:9)', w: 1280, h: 720 },
  { label: '1920 × 1080 (16:9)', w: 1920, h: 1080 },
  { label: '1080 × 1080 (square)', w: 1080, h: 1080 },
  { label: '1080 × 1350 (portrait 4:5)', w: 1080, h: 1350 },
  { label: '2048 × 858 (cinema 2.39)', w: 2048, h: 858 },
];
const DIM = { min: 32, max: 8192 } as const;

/** Document Setup: the picture size and aspect of the scene window and renders. */
export function openDocumentSetup(doc: DocumentSetup, onApply: (d: DocumentSetup) => void): void {
  let w = doc.width;
  let h = doc.height;
  const wf = new NumberField({ value: w, digits: 0, onCommit: (v) => { w = v; } });
  const hf = new NumberField({ value: h, digits: 0, onCommit: (v) => { h = v; } });
  const preset = new Select<number>({
    items: DOC_PRESETS.map((p, i) => ({ value: i, label: p.label })),
    value: Math.max(0, DOC_PRESETS.findIndex((p) => p.w === w && p.h === h)),
    onChange: (i) => {
      w = DOC_PRESETS[i].w;
      h = DOC_PRESETS[i].h;
      wf.set(w);
      hf.set(h);
    },
  });
  const body = el('div', { style: { display: 'grid', gridTemplateColumns: '80px 120px', gap: '6px 10px', alignItems: 'center' } }, [
    el('span', { text: 'Preset' }), preset.el,
    el('span', { text: 'Width' }), wf.el,
    el('span', { text: 'Height' }), hf.el,
  ]);
  const clamp = (v: number) => Math.round(Math.min(DIM.max, Math.max(DIM.min, v)));
  new Dialog({ title: 'Document Setup', style: DialogStyle.Stone, body, onOk: () => onApply({ width: clamp(w), height: clamp(h) }), onCancel: () => undefined }).open();
}

export interface ExportSpec {
  readonly scale: number;
  readonly samples: number;
}

const SCALES = [0.5, 1, 2, 3, 4] as const;
const EXPORT_SAMPLES = [4, 16, 36, 64, 128] as const;
const DEFAULT_EXPORT: ExportSpec = { scale: 1, samples: 36 };

/** Render to Image: size multiplier and anti-aliasing for the tiled export. */
export function openExport(doc: DocumentSetup, onApply: (s: ExportSpec) => void): void {
  let spec = DEFAULT_EXPORT;
  const size = el('span', { cls: 'props-label' });
  const show = () => { size.textContent = `${Math.round(doc.width * spec.scale)} × ${Math.round(doc.height * spec.scale)} px`; };
  const scale = new Select<number>({ items: SCALES.map((s) => ({ value: s, label: `${s}× document` })), value: spec.scale, onChange: (s) => { spec = { ...spec, scale: s }; show(); } });
  const samples = new Select<number>({ items: EXPORT_SAMPLES.map((n) => ({ value: n, label: `${n} rays / pixel` })), value: spec.samples, onChange: (n) => { spec = { ...spec, samples: n }; } });
  show();
  const body = el('div', { style: { display: 'grid', gridTemplateColumns: '90px 170px', gap: '6px 10px', alignItems: 'center' } }, [
    el('span', { text: 'Size' }), scale.el,
    el('span'), size,
    el('span', { text: 'Anti-aliasing' }), samples.el,
  ]);
  new Dialog({ title: 'Render to Image', style: DialogStyle.Stone, body, onOk: () => onApply(spec), onCancel: () => undefined }).open();
}

const REPLICATE_DEFAULT: ReplicateSpec = { count: 5, offset: [2, 0, 0], rotation: [0, 15, 0], scale: [1, 1, 1] };
const MAX_COPIES = 60;

/** Multi-Replicate: n copies, each stepping by an offset, rotation and scale. */
export function openReplicate(onApply: (s: ReplicateSpec) => void): void {
  let spec = REPLICATE_DEFAULT;
  const vecRow = (label: string, v: Vec3, set: (v: Vec3) => void) => {
    const cur: [number, number, number] = [v[0], v[1], v[2]];
    return [
      el('span', { text: label }),
      ...[0, 1, 2].map((i) => new NumberField({ value: cur[i], onCommit: (x) => { cur[i] = x; set([cur[0], cur[1], cur[2]]); } }).el),
    ];
  };
  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '360px' } }, [
    new Dial({ label: 'Copies', min: 1, max: MAX_COPIES, value: spec.count, onInput: (n) => { spec = { ...spec, count: n }; } }).el,
    el('div', { cls: 'props-grid', style: { gridTemplateColumns: '60px repeat(3, 1fr)' } }, [
      el('span'), ...['X', 'Y', 'Z'].map((a) => el('span', { cls: 'axis-head', text: a })),
      ...vecRow('Offset', spec.offset, (v) => { spec = { ...spec, offset: v }; }),
      ...vecRow('Rotate', spec.rotation, (v) => { spec = { ...spec, rotation: v }; }),
      ...vecRow('Scale', spec.scale, (v) => { spec = { ...spec, scale: v }; }),
    ]),
  ]);
  new Dialog({ title: 'Multi-Replicate', style: DialogStyle.Stone, body, onOk: () => onApply(spec), onCancel: () => undefined }).open();
}

/** A plain information window with one OK. */
export function openInfo(title: string, content: HTMLElement): void {
  new Dialog({ title, style: DialogStyle.Stone, body: content, onOk: () => undefined, onCancel: () => undefined }).open();
}

export const linkButton = (label: string, run: () => void): HTMLElement => new Button({ label, onClick: run }).el;

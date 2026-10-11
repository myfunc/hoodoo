import { type Rgb, hexToRgb, hsvToRgb, rgbToHex } from '../../core/color';
import { KEY } from '../../core/keys';
import { el, onDrag } from './dom';

const SPECTRUM_W = 216;
const SPECTRUM_H = 120;
const STRIP_H = 14;
const GREYS = 12;
const HEX_LENGTH = 7;
const CHANNEL_MAX = 255;
const HUE_SECTORS = 6;
/** Below this saturation a colour is a grey: the marker moves to the grey strip. */
const GREY_SATURATION = 0.02;
const PERCENT = 100;

const pickerState: { node: HTMLElement | null; away: ((e: Event) => void) | null } = { node: null, away: null };

function closePicker(): void {
  pickerState.node?.remove();
  pickerState.node = null;
  if (pickerState.away) document.removeEventListener('pointerdown', pickerState.away, true);
  pickerState.away = null;
}

function paintSpectrum(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const img = g.createImageData(SPECTRUM_W, SPECTRUM_H);
  for (let y = 0; y < SPECTRUM_H; y++) {
    for (let x = 0; x < SPECTRUM_W; x++) {
      const c = spectrumColor(x / SPECTRUM_W, y / SPECTRUM_H);
      const i = (y * SPECTRUM_W + x) * 4;
      img.data[i] = c[0] * CHANNEL_MAX;
      img.data[i + 1] = c[1] * CHANNEL_MAX;
      img.data[i + 2] = c[2] * CHANNEL_MAX;
      img.data[i + 3] = CHANNEL_MAX;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Top half fades from white to full hue, bottom half from full hue to black, like the Bryce picker. */
function spectrumColor(u: number, v: number): Rgb {
  return v < 0.5 ? hsvToRgb(u, v * 2, 1) : hsvToRgb(u, 1, 2 - v * 2);
}

/** Hue, saturation and value, each 0..1. */
export function rgbToHsv(c: Rgb): [number, number, number] {
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d <= 0) return [0, 0, max];
  const sector = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(((sector / HUE_SECTORS) % 1) + 1) % 1, d / max, max];
}

/**
 * Where a colour sits on the spectrum, as 0..1 across and down; null for a grey.
 * A colour off the spectrum (neither full value nor full saturation) goes to the nearer half.
 */
export function spectrumSpot(c: Rgb): { u: number; v: number } | null {
  const [h, s, v] = rgbToHsv(c);
  if (s < GREY_SATURATION) return null;
  return { u: h, v: 1 - v <= 1 - s ? s / 2 : 1 - v / 2 };
}

const greyIndex = (c: Rgb): number => Math.round(Math.max(...c) * (GREYS - 1));

function greyStrip(onPick: (c: Rgb) => void): { node: HTMLElement; cells: HTMLElement[] } {
  const node = el('div', { cls: 'ui-picker-greys' });
  const cells: HTMLElement[] = [];
  for (let i = 0; i < GREYS; i++) {
    const v = i / (GREYS - 1);
    const cell = el('div', { cls: 'ui-picker-grey', style: { background: rgbToHex([v, v, v]), height: `${STRIP_H}px` } });
    cell.addEventListener('click', () => onPick([v, v, v]));
    cells.push(cell);
    node.append(cell);
  }
  return { node, cells };
}

/** Spectrum pop-up; reports live picks and closes on outside click. A ring marks the current colour. */
export function openColorPicker(anchor: HTMLElement, value: Rgb, onPick: (c: Rgb, final: boolean) => void): void {
  closePicker();
  const canvas = el('canvas', { cls: 'ui-picker-spectrum', attrs: { width: String(SPECTRUM_W), height: String(SPECTRUM_H) } });
  paintSpectrum(canvas);
  const ring = el('div', { cls: 'ui-picker-ring' });
  const hex = el('input', { cls: 'ui-picker-hex', attrs: { value: rgbToHex(value), maxlength: String(HEX_LENGTH), spellcheck: 'false' } });
  const swatch = el('div', { cls: 'ui-picker-preview', style: { background: rgbToHex(value) } });
  /** `spot`: where the pointer is on the spectrum, so the ring stays under it even where hue wraps. */
  const mark = (c: Rgb, spot = spectrumSpot(c)) => {
    ring.hidden = !spot;
    if (spot) Object.assign(ring.style, { left: `${spot.u * PERCENT}%`, top: `${spot.v * PERCENT}%` });
    greys.cells.forEach((cell, i) => cell.classList.toggle('is-picked', !spot && i === greyIndex(c)));
  };
  const pick = (c: Rgb, final: boolean, spot?: { u: number; v: number }) => {
    swatch.style.background = rgbToHex(c);
    hex.value = rgbToHex(c);
    mark(c, spot ?? spectrumSpot(c));
    onPick(c, final);
  };
  const greys = greyStrip((c) => pick(c, true));
  const fromEvent = (e: PointerEvent): { u: number; v: number } => {
    const r = canvas.getBoundingClientRect();
    return { u: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), v: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const spectrumPick = (e: PointerEvent, final: boolean) => {
    const spot = fromEvent(e);
    pick(spectrumColor(spot.u, spot.v), final, spot);
  };
  onDrag(canvas, {
    start: (e) => spectrumPick(e, false),
    move: (_dx, _dy, e) => spectrumPick(e, false),
    end: (e) => spectrumPick(e, true),
  });
  hex.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === KEY.Enter && /^#[0-9a-f]{6}$/i.test(hex.value)) pick(hexToRgb(hex.value), true);
    if (e.key === KEY.Escape) closePicker();
  });
  mark(value);
  const field = el('div', { cls: 'ui-picker-field' }, [canvas, ring]);
  const pop = el('div', { cls: 'ui-picker' }, [field, greys.node, el('div', { cls: 'ui-picker-row' }, [swatch, hex])]);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - pr.width - 4))}px`;
  pop.style.top = `${Math.max(4, Math.min(r.bottom + 4, window.innerHeight - pr.height - 4))}px`;
  pickerState.node = pop;
  const away = (e: Event) => {
    if (pickerState.node && !pickerState.node.contains(e.target as Node) && e.target !== anchor) closePicker();
  };
  pickerState.away = away;
  setTimeout(() => {
    if (pickerState.away === away) document.addEventListener('pointerdown', away, true);
  });
}

export interface SwatchOptions {
  readonly value: Rgb;
  readonly title?: string;
  readonly label?: string;
  readonly onInput: (c: Rgb) => void;
  readonly onCommit: (c: Rgb) => void;
}

export class ColorSwatch {
  readonly el: HTMLElement;
  private readonly chip: HTMLElement;

  constructor(o: SwatchOptions) {
    this.chip = el('div', { cls: 'ui-swatch-chip' });
    this.el = el('div', { cls: 'ui-swatch', title: o.title ?? 'Click to pick a colour', attrs: { tabindex: '0' } }, [
      this.chip,
      o.label ? el('span', { cls: 'ui-swatch-label', text: o.label }) : null,
    ]);
    let current = o.value;
    this.el.addEventListener('click', () =>
      openColorPicker(this.el, current, (c, final) => {
        current = c;
        this.set(c);
        if (final) o.onCommit(c);
        else o.onInput(c);
      }),
    );
    this.set(o.value);
  }

  set(c: Rgb): void {
    this.chip.style.background = rgbToHex(c);
  }
}

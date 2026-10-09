import { type Rgb, hexToRgb, hsvToRgb, rgbToHex } from '../../core/color';
import { KEY } from '../../core/keys';
import { el, onDrag } from './dom';

const SPECTRUM_W = 216;
const SPECTRUM_H = 120;
const STRIP_H = 14;
const GREYS = 12;
const HEX_LENGTH = 7;
const CHANNEL_MAX = 255;

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

function greyStrip(onPick: (c: Rgb) => void): HTMLElement {
  const strip = el('div', { cls: 'ui-picker-greys' });
  for (let i = 0; i < GREYS; i++) {
    const v = i / (GREYS - 1);
    const cell = el('div', { cls: 'ui-picker-grey', style: { background: rgbToHex([v, v, v]), height: `${STRIP_H}px` } });
    cell.addEventListener('click', () => onPick([v, v, v]));
    strip.append(cell);
  }
  return strip;
}

/** Spectrum pop-up; reports live picks and closes on outside click. */
export function openColorPicker(anchor: HTMLElement, value: Rgb, onPick: (c: Rgb, final: boolean) => void): void {
  closePicker();
  const canvas = el('canvas', { cls: 'ui-picker-spectrum', attrs: { width: String(SPECTRUM_W), height: String(SPECTRUM_H) } });
  paintSpectrum(canvas);
  const hex = el('input', { cls: 'ui-picker-hex', attrs: { value: rgbToHex(value), maxlength: String(HEX_LENGTH), spellcheck: 'false' } });
  const swatch = el('div', { cls: 'ui-picker-preview', style: { background: rgbToHex(value) } });
  const pick = (c: Rgb, final: boolean) => {
    swatch.style.background = rgbToHex(c);
    hex.value = rgbToHex(c);
    onPick(c, final);
  };
  const fromEvent = (e: PointerEvent): Rgb => {
    const r = canvas.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return spectrumColor(u, v);
  };
  onDrag(canvas, {
    start: (e) => pick(fromEvent(e), false),
    move: (_dx, _dy, e) => pick(fromEvent(e), false),
    end: (e) => pick(fromEvent(e), true),
  });
  hex.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === KEY.Enter && /^#[0-9a-f]{6}$/i.test(hex.value)) pick(hexToRgb(hex.value), true);
    if (e.key === KEY.Escape) closePicker();
  });
  const pop = el('div', { cls: 'ui-picker' }, [canvas, greyStrip((c) => pick(c, true)), el('div', { cls: 'ui-picker-row' }, [swatch, hex])]);
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

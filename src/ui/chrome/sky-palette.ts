import { type Rgb, rgbToHex } from '../../core/color';
import type { Sky } from '../../model/scene.types';
import { matchHazeToHorizon } from '../../world/horizon-match';
import { ChangeKind } from '../../world/world.events';
import { MOODS, SKY_SLOTS, type SkyMood, type SkySlot, nudgeColor, rgbToLch, skyColorOf, skyColorsFrom, withSkyColors } from '../../world/sky-harmony';
import { type UiContext, hintOn } from '../context';
import { openColorPicker } from '../kit/color-picker';
import { Toggle } from '../kit/controls';
import { el } from '../kit/dom';
import './sky-palette.css';

/**
 * The Sky & Fog colours as a toy: one Base tile spins the whole sky's hue and light,
 * mood chips show a ready sky from the base on hover and set it on click, and the
 * colour chips trade colours by dragging one onto another.
 */

const LABELS: Record<SkySlot, string> = {
  skyColor: 'Sky', horizonColor: 'Horiz', sunColor: 'Sun', ambientColor: 'Amb', hazeColor: 'Haze', fogColor: 'Fog', cloud: 'Cloud',
};
const HINT = {
  base: { title: 'Base Colour', text: 'Drag: turn hue and light' },
  mood: { title: 'Sky Mood' },
  chip: { title: 'Sky Colours', text: 'Drag onto a chip: copy' },
  link: { title: 'Haze = Horizon', text: 'Haze and fog follow it' },
} as const;
/** Pixels of pointer travel before a press on a chip or the base becomes a drag. */
const DRAG_START_PX = 4;
const TURN_PER_PX = 1.5;
const LIGHT_PER_PX = 0.004;
/** One wheel notch: hue degrees, or lightness with Shift. */
const WHEEL_TURN = 6;
const WHEEL_LIGHT = 0.03;
/** Wheel nudges closer together than this are one undo step. */
const WHEEL_GESTURE_MS = 600;
const LINK_KEY = 'hoodoo.sky.hazeLink.v1';
const GESTURE = 'Sky colours';
/** Where the horizon sits on a mood chip and the base tile, from the top. */
const HORIZON_STOP = 72;

/** Every sky colour turned by `turn` degrees and lifted by `light`. */
function nudgeSky(s: Sky, turn: number, light: number): Sky {
  const out: Partial<Record<SkySlot, Rgb>> = {};
  for (const slot of SKY_SLOTS) out[slot] = nudgeColor(skyColorOf(s, slot), turn, light);
  return withSkyColors(s, out);
}

const skyGradient = (c: Pick<Record<SkySlot, Rgb>, 'skyColor' | 'horizonColor' | 'fogColor'>): string =>
  `linear-gradient(${rgbToHex(c.skyColor)} 0%, ${rgbToHex(c.horizonColor)} ${HORIZON_STOP}%, ${rgbToHex(c.fogColor)} 100%)`;

export class SkyPalette {
  readonly el: HTMLElement;
  private readonly base: HTMLElement;
  private readonly moods: { mood: SkyMood; node: HTMLElement; sun: HTMLElement }[] = [];
  private readonly chips = new Map<SkySlot, HTMLElement>();
  private readonly link: Toggle;
  private linked: boolean;
  private lastMood: SkyMood | null = null;
  private wheelTimer = 0;

  constructor(private readonly ctx: UiContext) {
    this.linked = localStorage.getItem(LINK_KEY) === '1';
    this.base = el('div', { cls: 'sky-base' });
    this.baseGestures();
    hintOn(ctx, this.base, HINT.base);
    this.link = new Toggle({ label: 'Haze = Horiz', value: this.linked, onChange: (v) => this.setLinked(v) });
    hintOn(ctx, this.link.el, HINT.link);
    this.el = el('div', { cls: 'sky-palette' }, [
      el('div', { cls: 'tray-group' }, [this.base, el('span', { cls: 'tray-group-label', text: 'Base' })]),
      el('div', { cls: 'tray-group' }, [this.moodRow(), el('span', { cls: 'tray-group-label', text: 'Moods' })]),
      el('div', { cls: 'sky-chip-col' }, [this.chipGrid(), this.link.el]),
    ]);
    ctx.world.events.on('changed', ({ kind }) => {
      if (kind === ChangeKind.Sky || kind === ChangeKind.Time || kind === ChangeKind.All) this.sync();
    });
    this.sync();
  }

  private get sky(): Sky {
    return this.ctx.world.scene.sky;
  }

  /** A recorded sky edit, amending the open palette gesture; Haze = Horiz keeps haze and fog on the horizon. */
  private apply(next: Sky): void {
    this.ctx.world.beginGesture(GESTURE);
    this.ctx.world.setSky(this.linked ? matchHazeToHorizon(next) : next, GESTURE);
  }

  private done(): void {
    this.ctx.world.endGesture();
  }

  private setLinked(v: boolean): void {
    this.linked = v;
    localStorage.setItem(LINK_KEY, v ? '1' : '0');
    if (v) {
      this.apply(this.sky);
      this.done();
    }
  }

  private sync(): void {
    const s = this.sky;
    this.base.style.background = skyGradient({ skyColor: s.skyColor, horizonColor: s.horizonColor, fogColor: s.fogAmount > 0 ? s.fogColor : s.horizonColor });
    for (const m of this.moods) {
      const c = skyColorsFrom(s.skyColor, m.mood);
      m.node.style.background = skyGradient(c);
      m.sun.style.background = rgbToHex(c.sunColor);
      m.node.classList.toggle('is-picked', m.mood === this.lastMood);
    }
    for (const [slot, chip] of this.chips) chip.style.background = rgbToHex(skyColorOf(s, slot));
  }

  /** Click opens the picker for a new base; a drag turns and lights the whole sky. */
  private baseGestures(): void {
    this.base.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      this.base.setPointerCapture(down.pointerId);
      const start = this.sky;
      let dragging = false;
      const move = (e: PointerEvent) => {
        const dx = e.clientX - down.clientX;
        const dy = e.clientY - down.clientY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_START_PX) return;
        dragging = true;
        this.apply(nudgeSky(start, dx * TURN_PER_PX, -dy * LIGHT_PER_PX));
      };
      const up = () => {
        this.base.removeEventListener('pointermove', move);
        this.base.removeEventListener('pointerup', up);
        this.base.removeEventListener('pointercancel', up);
        if (dragging) this.done();
        else this.pickBase();
      };
      this.base.addEventListener('pointermove', move);
      this.base.addEventListener('pointerup', up);
      this.base.addEventListener('pointercancel', up);
    });
    this.base.addEventListener('wheel', (e) => this.wheel(e, (s, turn, light) => nudgeSky(s, turn, light)), { passive: false });
  }

  /** A new base rebuilds the sky in the last mood used, or keeps the other colours' places if none was picked yet. */
  private pickBase(): void {
    openColorPicker(this.base, this.sky.skyColor, (c, final) => {
      const s = this.sky;
      this.apply(this.lastMood ? withSkyColors(s, skyColorsFrom(c, this.lastMood)) : nudgeToBase(s, c));
      if (final) this.done();
    });
  }

  private moodRow(): HTMLElement {
    const row = el('div', { cls: 'sky-moods' });
    for (const m of MOODS) {
      const sun = el('span', { cls: 'sky-mood-sun' });
      const node = el('div', { cls: 'sky-mood', title: m.label }, [sun]);
      node.addEventListener('pointerenter', () => this.ctx.world.previewSky(this.moodSky(m.mood)));
      node.addEventListener('pointerleave', () => this.ctx.world.endPreview());
      node.addEventListener('click', () => {
        this.ctx.world.endPreview();
        this.lastMood = m.mood;
        this.apply(this.moodSky(m.mood));
        this.done();
      });
      hintOn(this.ctx, node, { title: `${HINT.mood.title}: ${m.label}`, text: m.hint });
      this.moods.push({ mood: m.mood, node, sun });
      row.append(node);
    }
    return row;
  }

  private moodSky(mood: SkyMood): Sky {
    const s = withSkyColors(this.sky, skyColorsFrom(this.sky.skyColor, mood));
    return this.linked ? matchHazeToHorizon(s) : s;
  }

  private chipGrid(): HTMLElement {
    const grid = el('div', { cls: 'sky-chips' });
    for (const slot of SKY_SLOTS) {
      const chip = el('div', { cls: 'sky-chip', attrs: { 'data-slot': slot } });
      const cell = el('div', { cls: 'sky-chip-cell' }, [chip, el('span', { cls: 'sky-chip-label', text: LABELS[slot] })]);
      this.chipGestures(chip, slot);
      this.chips.set(slot, chip);
      grid.append(cell);
    }
    hintOn(this.ctx, grid, HINT.chip);
    return grid;
  }

  /** Click picks a colour; dragging carries the colour to the chip it is dropped on; the wheel nudges it. */
  private chipGestures(chip: HTMLElement, slot: SkySlot): void {
    chip.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      chip.setPointerCapture(down.pointerId);
      const color = skyColorOf(this.sky, slot);
      let ghost: HTMLElement | null = null;
      let target: HTMLElement | null = null;
      const move = (e: PointerEvent) => {
        if (!ghost && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_START_PX) return;
        ghost ??= document.body.appendChild(el('div', { cls: 'sky-chip-ghost', style: { background: rgbToHex(color) } }));
        Object.assign(ghost.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
        const over = this.chipAt(e.clientX, e.clientY);
        if (over !== target) {
          target?.classList.remove('is-drop');
          target = over && over !== chip ? over : null;
          target?.classList.add('is-drop');
        }
      };
      const up = () => {
        chip.removeEventListener('pointermove', move);
        chip.removeEventListener('pointerup', up);
        chip.removeEventListener('pointercancel', up);
        target?.classList.remove('is-drop');
        if (!ghost) {
          this.pickChip(chip, slot);
          return;
        }
        ghost.remove();
        const to = target?.dataset.slot as SkySlot | undefined;
        if (to) {
          this.apply(withSkyColors(this.sky, { [to]: color }));
          this.done();
          this.ctx.toast(`${LABELS[slot]} colour copied to ${LABELS[to]}`);
        }
      };
      chip.addEventListener('pointermove', move);
      chip.addEventListener('pointerup', up);
      chip.addEventListener('pointercancel', up);
    });
    chip.addEventListener('wheel', (e) => this.wheel(e, (s, turn, light) => withSkyColors(s, { [slot]: nudgeColor(skyColorOf(s, slot), turn, light) })), { passive: false });
  }

  private chipAt(x: number, y: number): HTMLElement | null {
    for (const c of this.chips.values()) {
      const r = c.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return c;
    }
    return null;
  }

  private pickChip(chip: HTMLElement, slot: SkySlot): void {
    openColorPicker(chip, skyColorOf(this.sky, slot), (c, final) => {
      this.apply(withSkyColors(this.sky, { [slot]: c }));
      if (final) this.done();
    });
  }

  /** One notch turns the hue, with Shift lightens or darkens; quick notches are one undo step. */
  private wheel(e: WheelEvent, nudge: (s: Sky, turn: number, light: number) => Sky): void {
    e.preventDefault();
    const sign = Math.sign(e.deltaY || e.deltaX);
    if (!sign) return;
    this.apply(e.shiftKey ? nudge(this.sky, 0, -sign * WHEEL_LIGHT) : nudge(this.sky, -sign * WHEEL_TURN, 0));
    window.clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => this.done(), WHEEL_GESTURE_MS);
  }
}

/** Without a mood, a new base moves every colour by the hue turn and light change from the old base to the new one. */
function nudgeToBase(s: Sky, base: Rgb): Sky {
  const from = rgbToLch(s.skyColor);
  const to = rgbToLch(base);
  return { ...nudgeSky(s, to.h - from.h, to.l - from.l), skyColor: base };
}

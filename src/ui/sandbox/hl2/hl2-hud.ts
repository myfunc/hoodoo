import type { SourceFiles } from '../../../io/source/source.types';
import { HUD_UNITS_TALL, type HudFont, Hl2Scheme, type Rgba } from './hl2-scheme';
import { NoticeFlight } from './notice-flight';

/**
 * READ ME — Half-Life 2's HUD as Garry's Mod shows it, drawn from the player's
 * game files on a canvas over the picture: the weapon's crosshair, the health
 * box at the bottom left, the weapon selection at the top (six slot boxes, the
 * open one large with the weapon's glowing icon and name) and Garry's Mod's
 * notices flying in at the right. Sizes and places come from hudlayout.res in
 * 480-unit-tall screens, fonts and colours from clientscheme.res, the timing of
 * the selection from hudanimations.txt, the notices from notification.lua.
 */

export interface Hl2Weapon {
  readonly id: string;
  readonly name: string;
}

export interface Hl2HudState {
  readonly health: number;
  /** The slots (1–6) and their weapons, the weapon out, and seconds since the last switch (null: none yet). */
  readonly selection: { readonly slots: ReadonlyMap<number, readonly Hl2Weapon[]>; readonly current: string; readonly since: number | null };
  readonly notices: readonly { readonly id: number; readonly text: string; readonly kind: string; readonly age: number; readonly life: number }[];
}

export interface PictureRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Hoodoo's weapons by the Garry's Mod weapon script whose icons they wear. */
const WEAPON_SCRIPTS: Readonly<Record<string, string>> = { physgun: 'weapons/weapon_physgun' };
/** Scripted weapons' selection pictures (SWEP.WepSelectIcon): the Tool Gun's from its cl_init.lua. */
const WEAPON_PICTURES: Readonly<Record<string, string>> = { toolgun: 'vgui/gmod_tool' };
/** weapon_base's DrawWeaponSelection: the picture inset this far (480-unit pixels as drawn: screen pixels), half as tall as wide. */
const PICTURE_INSET = 10;
/** Notice kinds as Garry's Mod's NOTIFY_ types, and their icons. */
const NOTICE_ICONS: Readonly<Record<string, string>> = {
  info: 'vgui/notices/generic', undo: 'vgui/notices/undo', spawn: 'vgui/notices/generic', limit: 'vgui/notices/error', hint: 'vgui/notices/hint', cleanup: 'vgui/notices/cleanup',
};
const SLOTS = 6;
const MS_PER_S = 1000;
/** Source dims the rows between a glow font's scanlines to this much. */
const SCANLINE_DIM = 0.7;
/** hud_fastswitch: the selection shows this long after a switch, then FadeOutWeaponSelectionMenu runs. */
const SELECTION = { show: 1.5, fadeDelay: 0.5, fade: 1 } as const;
const COLORS = {
  fg: ['FgColorHud', [255, 220, 0, 220]],
  bg: ['BgColorHud', [0, 0, 0, 90]],
  number: ['SelectionNumberFg', [255, 220, 0, 255]],
  text: ['SelectionTextFg', [255, 220, 0, 220]],
  empty: ['SelectionEmptyBoxBg', [0, 0, 0, 70]],
  box: ['SelectionBoxBg', [0, 0, 0, 90]],
  selected: ['SelectionSelectedBoxBg', [0, 0, 0, 150]],
  normal: ['Normal', [255, 208, 64, 255]],
} as const satisfies Record<string, readonly [string, Rgba]>;
type ColorKey = keyof typeof COLORS;
/** Source's HUD box corners: 8-pixel textures, whatever the resolution. */
const CORNER_PX = 8;
const BYTE = 255;
/** A hard-edged font keeps the pixels its glyph covers at least this much (alpha byte). */
const HARD_EDGE = 96;
const HEALTH_LABEL = 'HEALTH';
/** HL2's crosshair glyph when a weapon names none. */
const DEFAULT_CROSSHAIR = { font: 'Crosshairs', char: 'Q' } as const;

/** Layout defaults (hudlayout.res, Garry's Mod's) for a file that lacks a field. */
const LAYOUT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  HudHealth: { xpos: '16', ypos: '432', wide: '102', tall: '36', text_xpos: '8', text_ypos: '20', digit_xpos: '50', digit_ypos: '2' },
  HudWeaponSelection: { ypos: '16', SmallBoxSize: '32', LargeBoxWide: '112', LargeBoxTall: '80', LargeBoxUnselectedTall: '19', BoxGap: '6', SelectionNumberXPos: '4', SelectionNumberYPos: '4', TextYPos: '64' },
};

interface WeaponLook {
  readonly icon: { font: string; char: string } | null;
  readonly glow: { font: string; char: string } | null;
  readonly picture?: HTMLCanvasElement | null;
}

export class Hl2Hud {
  readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  private readonly scratch = document.createElement('canvas');
  /** The crosshair as last drawn, kept while its font and colour stay. */
  private readonly cross = document.createElement('canvas');
  private readonly flight = new NoticeFlight();
  private s = 1;
  private last = 0;

  private constructor(
    private readonly scheme: Hl2Scheme,
    private readonly weapons: ReadonlyMap<string, WeaponLook>,
    private readonly crosshair: { font: string; char: string },
    private readonly icons: ReadonlyMap<string, HTMLCanvasElement>,
  ) {
    this.canvas.className = 'sandbox-hl2hud';
  }

  static async create(files: SourceFiles): Promise<Hl2Hud | null> {
    const scheme = await Hl2Scheme.load(files);
    if (!scheme) return null;
    const weapons = new Map<string, WeaponLook>();
    for (const [id, script] of Object.entries(WEAPON_SCRIPTS)) {
      weapons.set(id, { icon: await scheme.weaponIcon(script, 'weapon'), glow: await scheme.weaponIcon(script, 'weapon_s') });
    }
    for (const [id, material] of Object.entries(WEAPON_PICTURES)) weapons.set(id, { icon: null, glow: null, picture: await scheme.image(material) });
    const crosshair = (await scheme.weaponIcon(WEAPON_SCRIPTS.physgun, 'crosshair')) ?? DEFAULT_CROSSHAIR;
    const icons = new Map<string, HTMLCanvasElement>();
    for (const [kind, material] of Object.entries(NOTICE_ICONS)) {
      const img = await scheme.image(material);
      if (img) icons.set(kind, img);
    }
    return new Hl2Hud(scheme, weapons, crosshair, icons);
  }

  draw(rect: PictureRect, state: Hl2HudState): void {
    const now = performance.now() / MS_PER_S;
    const dt = this.last ? Math.min(now - this.last, 1) : 0;
    this.last = now;
    this.place(rect);
    const { g, canvas } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    this.s = canvas.height / HUD_UNITS_TALL;
    this.drawCrosshair();
    this.drawHealth(state.health);
    this.drawSelection(state.selection);
    this.flight.draw(g, canvas.width, canvas.height, state.notices, this.icons, dt);
  }

  dispose(): void {
    this.canvas.remove();
  }

  /** The canvas covers the picture, in device pixels. */
  private place(r: PictureRect): void {
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = [Math.round(r.w * dpr), Math.round(r.h * dpr)];
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const st = this.canvas.style;
    const px = (v: number) => `${Math.round(v)}px`;
    if (st.left !== px(r.x) || st.top !== px(r.y) || st.width !== px(r.w) || st.height !== px(r.h)) Object.assign(st, { left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) });
  }

  private font(name: string): HudFont | null {
    return this.scheme.font(name, this.canvas.height);
  }

  private color(key: ColorKey, alpha = 1): string {
    const [name, fallback] = COLORS[key];
    const c = this.scheme.color(name, fallback);
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] / BYTE) * alpha})`;
  }

  /** A hudlayout.res number in pixels; "r16" counts from the right edge, "c-20" from the centre. */
  private unit(element: string, key: string, along = this.canvas.width): number {
    const raw = this.scheme.field(element, key) ?? LAYOUT[element]?.[key] ?? '0';
    const n = Number(raw.replace(/^[rc]/, '')) * this.s;
    if (raw.startsWith('r')) return along - n;
    if (raw.startsWith('c')) return along / 2 + n;
    return n;
  }

  /** The crosshair glyph centred on the screen, in Source's "Normal" colour; hard-edged when the font is. */
  private drawCrosshair(): void {
    const f = this.font(this.crosshair.font);
    if (!f) return;
    const color = this.color('normal');
    const key = `${f.css}|${color}`;
    const c = this.cross;
    if (c.dataset.key !== key) {
      c.dataset.key = key;
      const s = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      s.font = f.css;
      c.width = Math.ceil(s.measureText(this.crosshair.char).width);
      c.height = Math.ceil(f.tall);
      s.font = f.css;
      s.fillStyle = color;
      s.fillText(this.crosshair.char, 0, f.ascent);
      if (f.hard && c.width && c.height) {
        const img = s.getImageData(0, 0, c.width, c.height);
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= HARD_EDGE ? BYTE : 0;
        s.putImageData(img, 0, 0);
      }
    }
    if (c.width && c.height) this.g.drawImage(c, Math.round(this.canvas.width / 2 - c.width / 2), Math.round(this.canvas.height / 2 - c.height / 2));
  }

  /** CHudHealth: a rounded box, the label at text_xpos and the number at digit_xpos in HudNumbers. */
  private drawHealth(health: number): void {
    const e = 'HudHealth';
    const [x, y] = [this.unit(e, 'xpos'), this.unit(e, 'ypos', this.canvas.height)];
    this.box(x, y, this.unit(e, 'wide'), this.unit(e, 'tall', this.canvas.height), this.color('bg'));
    this.text('Default', HEALTH_LABEL, x + this.unit(e, 'text_xpos'), y + this.unit(e, 'text_ypos'), this.color('fg'));
    this.text('HudNumbers', String(Math.max(0, Math.round(health))), x + this.unit(e, 'digit_xpos'), y + this.unit(e, 'digit_ypos'), this.color('fg'));
  }

  /** CHudWeaponSelection: six boxes across the top centre; the open slot is large, its weapons stacked. */
  private drawSelection(sel: Hl2HudState['selection']): void {
    if (sel.since === null) return;
    const alpha = selectionAlpha(sel.since);
    if (alpha <= 0) return;
    const e = 'HudWeaponSelection';
    const u = (k: string) => this.unit(e, k);
    const [small, largeW, largeH, unselH, gap] = [u('SmallBoxSize'), u('LargeBoxWide'), u('LargeBoxTall'), u('LargeBoxUnselectedTall'), u('BoxGap')];
    const open = [...sel.slots].find(([, ws]) => ws.some((w) => w.id === sel.current))?.[0] ?? 0;
    let x = (this.canvas.width - ((SLOTS - 1) * (small + gap) + largeW)) / 2;
    const top = this.unit(e, 'ypos', this.canvas.height);
    for (let slot = 1; slot <= SLOTS; slot++) {
      const weapons = sel.slots.get(slot) ?? [];
      if (slot === open) {
        let y = top;
        weapons.forEach((w, i) => {
          const on = w.id === sel.current;
          const h = on ? largeH : unselH;
          this.weaponBox(w, on, x, y, largeW, h, alpha, i ? -1 : slot);
          y += h + gap;
        });
        x += largeW;
      } else {
        this.box(x, top, small, small, this.color(weapons.length ? 'box' : 'empty', alpha));
        if (weapons.length) this.slotNumber(slot, x, top, alpha);
        x += small;
      }
      x += gap;
    }
  }

  private weaponBox(w: Hl2Weapon, selected: boolean, x: number, y: number, wide: number, tall: number, alpha: number, slot: number): void {
    this.box(x, y, wide, tall, this.color(selected ? 'selected' : 'box', alpha));
    if (slot >= 0) this.slotNumber(slot, x, y, alpha);
    const look = this.weapons.get(w.id);
    // The open weapon glows (its weapon_s glyph in the blurred, scanlined font) under its plain icon.
    for (const glyph of selected ? [look?.glow, look?.icon] : [look?.icon]) if (glyph) this.centred(glyph, x, y, wide, tall, this.color('fg', alpha));
    if (!selected) return;
    if (look?.picture) {
      const w = wide - PICTURE_INSET * 2;
      this.g.globalAlpha = alpha;
      this.g.drawImage(look.picture, Math.round(x + PICTURE_INSET), Math.round(y + PICTURE_INSET), Math.round(w), Math.round(w / 2));
      this.g.globalAlpha = 1;
    }
    const f = this.font('HudSelectionText');
    if (!f) return;
    this.g.font = f.css;
    const tw = this.g.measureText(w.name).width;
    this.text('HudSelectionText', w.name, x + (wide - tw) / 2, y + this.unit('HudWeaponSelection', 'TextYPos'), this.color('text', alpha));
  }

  private slotNumber(slot: number, x: number, y: number, alpha: number): void {
    const u = (k: string) => this.unit('HudWeaponSelection', k);
    this.text('HudSelectionNumbers', String(slot), x + u('SelectionNumberXPos'), y + u('SelectionNumberYPos'), this.color('number', alpha));
  }

  /** A glyph centred in a box, glowing (blurred, with scanlines) when its font says so. */
  private centred(glyph: { font: string; char: string }, x: number, y: number, wide: number, tall: number, color: string): void {
    const f = this.font(glyph.font);
    if (!f) return;
    this.g.font = f.css;
    const w = this.g.measureText(glyph.char).width;
    this.text(glyph.font, glyph.char, x + (wide - w) / 2, y + (tall - f.tall) / 2, color);
  }

  /** Text with its cell's top-left at (x, y), as Source places it; glow fonts blur and take scanlines. */
  private text(fontName: string, text: string, x: number, y: number, color: string): void {
    const f = this.font(fontName);
    if (!f) return;
    const { g } = this;
    if (!f.blur && !f.scanlines) {
      g.font = f.css;
      g.fillStyle = color;
      g.fillText(text, Math.round(x), Math.round(y + f.ascent));
      return;
    }
    const sc = this.scratch;
    const s = sc.getContext('2d') as CanvasRenderingContext2D;
    s.font = f.css;
    const pad = Math.ceil(f.blur * 2);
    sc.width = Math.ceil(s.measureText(text).width) + pad * 2;
    sc.height = Math.ceil(f.tall) + pad * 2;
    s.font = f.css;
    s.filter = f.blur ? `blur(${f.blur}px)` : 'none';
    s.fillStyle = color;
    s.fillText(text, pad, pad + f.ascent);
    s.filter = 'none';
    if (f.scanlines > 1) {
      // Every scanlines-th row stays bright, the rows between are dimmed.
      s.globalCompositeOperation = 'destination-out';
      s.globalAlpha = 1 - SCANLINE_DIM;
      for (let row = 0; row < sc.height; row++) if (row % f.scanlines) s.fillRect(0, row, sc.width, 1);
      s.globalAlpha = 1;
      s.globalCompositeOperation = 'source-over';
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.drawImage(sc, Math.round(x - pad), Math.round(y - pad));
    g.restore();
  }

  /** Source's DrawBox: a filled box with 8-pixel rounded corners. */
  private box(x: number, y: number, w: number, h: number, color: string): void {
    const { g } = this;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), CORNER_PX);
    g.fill();
  }
}

/** The selection's opacity this many seconds after a switch: shown, then FadeOutWeaponSelectionMenu's linear fade. */
export function selectionAlpha(since: number): number {
  const t = since - SELECTION.show - SELECTION.fadeDelay;
  if (since < SELECTION.show || t <= 0) return 1;
  return Math.max(0, 1 - t / SELECTION.fade);
}

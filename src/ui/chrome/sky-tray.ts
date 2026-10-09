import type { Rgb } from '../../core/color';
import { randomSeed } from '../../core/rng';
import { rollSky } from './sky-roll';
import { SkyMode } from '../../model/scene.enums';
import type { CloudSettings, Sky } from '../../model/scene.types';
import { skyPreview } from '../../render/icons';
import { ChangeKind } from '../../world/world.events';
import { type UiContext, hintOn } from '../context';
import { ColorSwatch } from '../kit/color-picker';
import { Toggle } from '../kit/controls';
import { el, onDrag } from '../kit/dom';
import { HINTS } from '../strings';

const THUMB_W = 54;
const THUMB_H = 40;
const MAX_DPR = 2;
const THUMB_SAMPLES = 1;
const DIAL = 100;
const PX_PER_DIAL = 1.2;
const FOG_HEIGHT_MAX = 12;
const FOG_HEIGHT_PER_PX = 0.05;
const SUN_SIZE = 46;
const SUN_DEG_PER_PX = 2;
const ALT_LIMIT = 90;
const ALT_MIN = -60;
const REFRESH_MS = 120;
const SUN_BALL = { lit: '#ffe9b0', mid: '#c98a3a', dark: '#3a2410', dot: '#fff6c0' } as const;
const SUN_DOT_RADIUS = 4;
const DEG = Math.PI / 180;
const SUN_GLOW_CORE = 0.05;
const SUN_DOT_ORBIT = 0.85;

type Patch = (s: Sky, dx: number, dy: number, start: Sky) => Sky;

const clampDial = (v: number) => Math.round(Math.min(DIAL, Math.max(0, v)));
const withClouds = (s: Sky, c: Partial<CloudSettings>): Sky => ({ ...s, clouds: { ...s.clouds, ...c } });

interface DragThumb {
  readonly label: string;
  readonly hint: { title: string; text: string };
  readonly patch: Patch;
  readonly value: (s: Sky) => string;
}

const THUMBS: readonly DragThumb[] = [
  { label: 'Shadows', hint: HINTS.shadows, patch: (_s, dx, _dy, a) => ({ ...a, shadows: clampDial(a.shadows + dx / PX_PER_DIAL) }), value: (s) => `${s.shadows}` },
  {
    label: 'Fog', hint: HINTS.fog,
    patch: (_s, dx, dy, a) => ({ ...a, fogAmount: clampDial(a.fogAmount + dx / PX_PER_DIAL), fogHeight: Math.min(FOG_HEIGHT_MAX, Math.max(0, a.fogHeight - dy * FOG_HEIGHT_PER_PX)) }),
    value: (s) => `${s.fogAmount}`,
  },
  { label: 'Haze', hint: HINTS.haze, patch: (_s, dx, _dy, a) => ({ ...a, hazeAmount: clampDial(a.hazeAmount + dx / PX_PER_DIAL) }), value: (s) => `${s.hazeAmount}` },
  {
    label: 'Clouds', hint: HINTS.clouds,
    patch: (_s, dx, dy, a) => withClouds(a, { cover: clampDial(a.clouds.cover + dx / PX_PER_DIAL), height: clampDial(a.clouds.height - dy / PX_PER_DIAL) }),
    value: (s) => `${s.clouds.cover}`,
  },
  {
    label: 'Shape', hint: HINTS.cloudShape,
    patch: (_s, dx, dy, a) => withClouds(a, { frequency: clampDial(a.clouds.frequency + dx / PX_PER_DIAL), amplitude: clampDial(a.clouds.amplitude - dy / PX_PER_DIAL) }),
    value: (s) => `${s.clouds.frequency}`,
  },
];

const MODES: readonly { mode: SkyMode; label: string }[] = [
  { mode: SkyMode.SoftSky, label: 'Soft' },
  { mode: SkyMode.DarkerSky, label: 'Darker' },
  { mode: SkyMode.CustomSky, label: 'Custom' },
  { mode: SkyMode.AtmosphereOff, label: 'Off' },
];

const COLORS: readonly { key: keyof Sky | 'cloud'; label: string }[] = [
  { key: 'skyColor', label: 'Sky' },
  { key: 'horizonColor', label: 'Horiz' },
  { key: 'sunColor', label: 'Sun' },
  { key: 'ambientColor', label: 'Amb' },
  { key: 'hazeColor', label: 'Haze' },
  { key: 'fogColor', label: 'Fog' },
  { key: 'cloud', label: 'Cloud' },
];

/** The Sky & Fog palette: Bryce's draggable atmosphere thumbnails, colour swatches and the sun ball. */
export class SkyTray {
  readonly el: HTMLElement;
  private readonly thumbCanvases: { canvas: HTMLCanvasElement; value: HTMLElement; thumb: DragThumb }[] = [];
  private readonly modeCanvases: { canvas: HTMLCanvasElement; mode: SkyMode; node: HTMLElement }[] = [];
  private readonly swatches: { key: string; swatch: ColorSwatch }[] = [];
  private readonly toggles: { get: (s: Sky) => boolean; t: Toggle }[] = [];
  private readonly sun: HTMLCanvasElement;
  private timer = 0;

  constructor(private readonly ctx: UiContext) {
    this.sun = el('canvas', { cls: 'ctrl-icon', attrs: { width: String(SUN_SIZE * MAX_DPR), height: String(SUN_SIZE * MAX_DPR) }, style: { width: `${SUN_SIZE}px`, height: `${SUN_SIZE}px`, cursor: 'move' } });
    this.el = el('div', { cls: 'tray' }, [
      this.modeGroup(),
      el('div', { cls: 'tray-gap' }),
      ...THUMBS.map((t) => this.dragThumb(t)),
      el('div', { cls: 'tray-gap' }),
      this.colorGroup(),
      el('div', { cls: 'tray-gap' }),
      this.sunGroup(),
      this.toggleGroup(),
      this.diceGroup(),
    ]);
    ctx.world.events.on('changed', ({ kind }) => {
      if (kind === ChangeKind.Sky || kind === ChangeKind.All) this.schedule();
    });
    this.refresh();
  }

  private get sky(): Sky {
    return this.ctx.world.scene.sky;
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.refresh(), REFRESH_MS);
    this.syncControls();
  }

  private renderThumb(canvas: HTMLCanvasElement, sky: Sky): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.round(THUMB_W * dpr);
    const h = Math.round(THUMB_H * dpr);
    this.ctx.thumbs.enqueue({ ...skyPreview(sky), width: w, height: h, samples: THUMB_SAMPLES, bounces: 1, transparent: false, into: canvas });
  }

  private refresh(): void {
    const s = this.sky;
    for (const t of this.thumbCanvases) this.renderThumb(t.canvas, s);
    for (const m of this.modeCanvases) this.renderThumb(m.canvas, { ...s, mode: m.mode });
    this.syncControls();
  }

  private syncControls(): void {
    const s = this.sky;
    for (const t of this.thumbCanvases) t.value.textContent = t.thumb.value(s);
    for (const m of this.modeCanvases) m.node.style.outline = m.mode === s.mode ? '2px solid #c8282d' : 'none';
    for (const sw of this.swatches) sw.swatch.set(sw.key === 'cloud' ? s.clouds.color : (s[sw.key as keyof Sky] as Rgb));
    for (const t of this.toggles) t.t.set(t.get(s));
    this.drawSun();
  }

  private modeGroup(): HTMLElement {
    const row = el('div', { cls: 'ctrl-row', style: { gap: '4px' } });
    for (const m of MODES) {
      const canvas = el('canvas');
      const node = el('div', { cls: 'tray-thumb', style: { cursor: 'pointer', width: '40px' } }, [canvas, el('span', { cls: 'tray-thumb-label', text: m.label })]);
      node.addEventListener('click', () => this.ctx.world.setSky({ ...this.sky, mode: m.mode }, 'Sky mode'));
      hintOn(this.ctx, node, HINTS.skyMode);
      this.modeCanvases.push({ canvas, mode: m.mode, node });
      row.append(node);
    }
    return row;
  }

  private dragThumb(t: DragThumb): HTMLElement {
    const canvas = el('canvas');
    const value = el('span', { cls: 'tray-thumb-value' });
    const node = el('div', { cls: 'tray-thumb', style: { cursor: 'move' } }, [canvas, value, el('span', { cls: 'tray-thumb-label', text: t.label })]);
    let start = this.sky;
    onDrag(node, {
      start: () => {
        start = this.sky;
        this.ctx.world.beginGesture(t.label);
      },
      move: (dx, dy) => this.ctx.world.setSky(t.patch(this.sky, dx, dy, start), t.label),
      end: () => this.ctx.world.endGesture(),
    });
    hintOn(this.ctx, node, t.hint);
    this.thumbCanvases.push({ canvas, value, thumb: t });
    return el('div', { cls: 'tray-group', style: { paddingBottom: '10px' } }, [node]);
  }

  private colorGroup(): HTMLElement {
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '3px 6px' } });
    for (const c of COLORS) {
      const swatch = new ColorSwatch({
        value: c.key === 'cloud' ? this.sky.clouds.color : (this.sky[c.key] as Rgb),
        label: c.label,
        onInput: (v) => this.setColor(c.key, v, false),
        onCommit: (v) => this.setColor(c.key, v, true),
      });
      this.swatches.push({ key: c.key, swatch });
      grid.append(swatch.el);
    }
    hintOn(this.ctx, grid, HINTS.skyColors);
    return grid;
  }

  private setColor(key: string, v: Rgb, final: boolean): void {
    const s = this.sky;
    const next = key === 'cloud' ? withClouds(s, { color: v }) : { ...s, [key]: v };
    this.ctx.world.beginGesture('Sky colour');
    this.ctx.world.setSky(next, 'Sky colour');
    if (final) this.ctx.world.endGesture();
    // beginGesture is idempotent for the same label, so a picker drag stays one undo step.
  }

  private sunGroup(): HTMLElement {
    let start = this.sky;
    onDrag(this.sun, {
      start: () => {
        start = this.sky;
        this.ctx.world.beginGesture('Sun');
      },
      move: (dx, dy) => {
        const alt = Math.max(ALT_MIN, Math.min(ALT_LIMIT, start.sunAltitude - dy * SUN_DEG_PER_PX));
        this.ctx.world.setSky({ ...this.sky, sunAzimuth: start.sunAzimuth + dx * SUN_DEG_PER_PX, sunAltitude: alt }, 'Sun');
      },
      end: () => this.ctx.world.endGesture(),
    });
    hintOn(this.ctx, this.sun, HINTS.sun);
    return el('div', { cls: 'tray-group' }, [this.sun, el('span', { cls: 'tray-group-label', text: 'Sun' })]);
  }

  /** The sun ball: lit from the sun's direction; the dot marks where the sun sits. */
  private drawSun(): void {
    const g = this.sun.getContext('2d');
    if (!g) return;
    const s = this.sky;
    const size = this.sun.width;
    const r = size / 2 - 2;
    const az = s.sunAzimuth * DEG;
    const alt = s.sunAltitude * DEG;
    const sx = Math.sin(az) * Math.cos(alt);
    const sy = Math.sin(alt);
    const cx = size / 2 + sx * r * (1 / 2);
    const cy = size / 2 - sy * r * (1 / 2);
    g.clearRect(0, 0, size, size);
    const grad = g.createRadialGradient(cx, cy, r * SUN_GLOW_CORE, size / 2, size / 2, r);
    grad.addColorStop(0, SUN_BALL.lit);
    grad.addColorStop(1 / 2, SUN_BALL.mid);
    grad.addColorStop(1, SUN_BALL.dark);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = SUN_BALL.dot;
    g.beginPath();
    g.arc(size / 2 + sx * r * SUN_DOT_ORBIT, size / 2 - sy * r * SUN_DOT_ORBIT, SUN_DOT_RADIUS * (size / SUN_SIZE), 0, Math.PI * 2);
    g.fill();
  }

  private toggleGroup(): HTMLElement {
    const col = el('div', { style: { display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 8px', padding: '0 6px' } });
    const add = (label: string, get: (s: Sky) => boolean, set: (s: Sky, v: boolean) => Sky) => {
      const t = new Toggle({ label, value: get(this.sky), onChange: (v) => this.ctx.world.setSky(set(this.sky, v), label) });
      this.toggles.push({ get, t });
      col.append(t.el);
    };
    add('Cumulus', (s) => s.clouds.cumulus, (s, v) => withClouds(s, { cumulus: v }));
    add('Stratus', (s) => s.clouds.stratus, (s, v) => withClouds(s, { stratus: v }));
    add('Stars', (s) => s.stars, (s, v) => ({ ...s, stars: v }));
    add('Sun disc', (s) => s.sunVisible, (s, v) => ({ ...s, sunVisible: v }));
    return col;
  }

  private diceGroup(): HTMLElement {
    const node = el('div', { cls: 'tray-tool', style: { cursor: 'pointer' } }, [el('span', { cls: 'tray-tool-label', text: 'Roll sky' })]);
    const canvas = el('canvas', { attrs: { width: '80', height: '80' } });
    node.prepend(canvas);
    this.renderThumb(canvas, this.sky);
    node.addEventListener('click', () => this.ctx.world.setSky(rollSky(this.sky, randomSeed()), 'Randomize sky'));
    hintOn(this.ctx, node, HINTS.dice);
    return node;
  }
}

import type { Rgb } from '../../core/color';
import { withAxis } from '../../core/vec3';
import type { Camera, Sky } from '../../model/scene.types';
import { RIG_NAMES, SUN_ALTITUDE, rigFlags, wrapDegrees } from '../../world/rig';
import { Rig } from '../../world/world';
import { ChangeKind } from '../../world/world.events';
import type { UiContext } from '../context';
import { ColorSwatch } from '../kit/color-picker';
import { Dial, NumberField } from '../kit/controls';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import type { CameraLens } from './camera-lens';

const AXIS_NAMES = ['X', 'Y', 'Z'] as const;
const AIM: readonly { key: 'yaw' | 'pitch' | 'bank'; label: string; title: string }[] = [
  { key: 'yaw', label: 'Heading', title: 'Degrees round the vertical: 0 looks toward -Z' },
  { key: 'pitch', label: 'Tilt', title: 'Degrees up (+) or down (-)' },
  { key: 'bank', label: 'Bank', title: 'Degrees the picture leans' },
];
const PITCH_LIMIT = 89;
const POSITION_DIGITS = 2;
const ANGLE_DIGITS = 1;
const AZIMUTH = { min: -180, max: 180 } as const;
const DIAL = { min: 0, max: 100 } as const;
const LOCKED_TITLE = 'Locked: unlock it in the scene list';

/** The lock beside the title (in the title line, so the panel keeps its height). */
function lockedMark(): HTMLElement {
  return el('span', { cls: 'rig-locked', title: LOCKED_TITLE }, [glyph(GLYPH.lock, GLYPH_BOX), 'locked']);
}

/** The camera selected (scene list or its glyph): where it is, where it looks and its lens. */
export class CameraAttributes {
  readonly el: HTMLElement;
  private readonly position: NumberField[];
  private readonly aim: NumberField[];
  private readonly locked: HTMLElement;

  constructor(private readonly ctx: UiContext, lens: CameraLens) {
    const cam = () => ctx.world.scene.camera;
    const set = (next: Camera, label: string) => ctx.world.setCamera(next, label);
    this.position = AXIS_NAMES.map((_, axis) => new NumberField({
      value: cam().position[axis], digits: POSITION_DIGITS,
      onCommit: (v) => set({ ...cam(), position: withAxis(cam().position, axis, v) }, 'Camera position'),
    }));
    this.aim = AIM.map((a) => new NumberField({
      value: cam()[a.key], digits: ANGLE_DIGITS, title: a.title,
      onCommit: (v) => set({ ...cam(), [a.key]: a.key === 'pitch' ? Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, v)) : v }, 'Camera aim'),
    }));
    this.locked = lockedMark();
    const grid = el('div', { cls: 'rig-grid' }, [
      el('span'), ...AXIS_NAMES.map((a) => el('span', { cls: 'axis-head', text: a })),
      el('span', { cls: 'props-label', text: 'Position' }), ...this.position.map((f) => f.el),
      el('span'), ...AIM.map((a) => el('span', { cls: 'axis-head', text: a.label })),
      el('span', { cls: 'props-label', text: 'Aim' }), ...this.aim.map((f) => f.el),
    ]);
    this.el = el('div', { cls: 'rig-attributes' }, [
      el('div', { cls: 'stone-section-title lens-title' }, [glyph(GLYPH.camera, GLYPH_BOX), RIG_NAMES[Rig.Camera], this.locked]),
      grid,
      lens.el,
    ]);
    ctx.world.events.on('changed', ({ kind }) => {
      if (kind === ChangeKind.Camera || kind === ChangeKind.Time || kind === ChangeKind.All) this.sync();
    });
    this.sync();
  }

  private sync(): void {
    const c = this.ctx.world.scene.camera;
    const locked = rigFlags(this.ctx.world.scene, Rig.Camera).locked;
    this.position.forEach((f, axis) => {
      f.set(c.position[axis]);
      f.el.disabled = locked;
    });
    this.aim.forEach((f, i) => {
      f.set(AIM[i].key === 'yaw' ? wrapDegrees(c.yaw) : c[AIM[i].key]);
      f.el.disabled = locked;
    });
    this.locked.style.display = locked ? 'inline-flex' : 'none';
  }
}

/** Brightness of a colour, 0..100: its strongest channel. */
export const intensityOf = (c: Rgb): number => Math.round(Math.max(c[0], c[1], c[2]) * DIAL.max);

/** The colour at a new brightness, its hue kept; a black colour turns grey. */
export function withIntensity(c: Rgb, intensity: number): Rgb {
  const v = Math.max(0, Math.min(DIAL.max, intensity)) / DIAL.max;
  const top = Math.max(c[0], c[1], c[2]);
  if (top <= 0) return [v, v, v];
  return [c[0] * (v / top), c[1] * (v / top), c[2] * (v / top)];
}

/** The sun selected: its direction, colour and brightness, and how soft its shadows are. All of it is the sky's (Sky & Fog). */
export class SunAttributes {
  readonly el: HTMLElement;
  private readonly azimuth: Dial;
  private readonly altitude: Dial;
  private readonly intensity: Dial;
  private readonly soft: Dial;
  private readonly color: ColorSwatch;
  private readonly locked: HTMLElement;

  constructor(private readonly ctx: UiContext) {
    const sky = () => ctx.world.scene.sky;
    const end = () => ctx.world.endGesture();
    const edit = (label: string, patch: (s: Sky) => Partial<Sky>) => {
      ctx.world.beginGesture(label);
      ctx.world.setSky({ ...sky(), ...patch(sky()) }, label);
    };
    const s = sky();
    this.azimuth = new Dial({
      label: 'Azimuth', ...AZIMUTH, value: wrapDegrees(s.sunAzimuth), unit: '°', title: 'Where the sun stands round the horizon: 0 is from +Z',
      onInput: (v) => edit('Sun', () => ({ sunAzimuth: v })), onCommit: end,
    });
    this.altitude = new Dial({
      label: 'Altitude', ...SUN_ALTITUDE, value: s.sunAltitude, unit: '°', title: 'How high the sun is: below 0 is night',
      onInput: (v) => edit('Sun', () => ({ sunAltitude: v })), onCommit: end,
    });
    this.color = new ColorSwatch({
      value: s.sunColor, label: 'Colour', title: 'The colour of sunlight',
      onInput: (c) => edit('Sun colour', () => ({ sunColor: c })),
      onCommit: (c) => { edit('Sun colour', () => ({ sunColor: c })); end(); },
    });
    this.intensity = new Dial({
      label: 'Intensity', ...DIAL, value: intensityOf(s.sunColor), title: 'How bright the sunlight is (its colour kept)',
      onInput: (v) => edit('Sun intensity', (x) => ({ sunColor: withIntensity(x.sunColor, v) })), onCommit: end,
    });
    this.soft = new Dial({
      label: 'Soft shadows', ...DIAL, value: s.softShadows, title: 'The size of the sun: 0 crisp shadows, 100 soft ones',
      onInput: (v) => edit('Soft shadows', () => ({ softShadows: v })), onCommit: end,
    });
    this.locked = lockedMark();
    this.el = el('div', { cls: 'rig-attributes' }, [
      el('div', { cls: 'stone-section-title lens-title' }, [glyph(GLYPH.sun, GLYPH_BOX), RIG_NAMES[Rig.Sun], this.locked]),
      this.azimuth.el,
      this.altitude.el,
      el('div', { cls: 'rig-color' }, [this.color.el]),
      this.intensity.el,
      this.soft.el,
    ]);
    ctx.world.events.on('changed', ({ kind }) => {
      if (kind === ChangeKind.Sky || kind === ChangeKind.Time || kind === ChangeKind.All) this.sync();
    });
    this.sync();
  }

  private sync(): void {
    const s = this.ctx.world.scene.sky;
    this.azimuth.set(wrapDegrees(s.sunAzimuth));
    this.altitude.set(s.sunAltitude);
    this.color.set(s.sunColor);
    this.intensity.set(intensityOf(s.sunColor));
    this.soft.set(s.softShadows);
    this.locked.style.display = rigFlags(this.ctx.world.scene, Rig.Sun).locked ? 'inline-flex' : 'none';
  }
}

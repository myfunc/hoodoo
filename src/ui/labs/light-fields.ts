import { createEntry } from '../../assets/object.catalog';
import { DEFAULT_SKY } from '../../assets/sky.presets';
import { type Rgb, hexToRgb } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import { material } from '../../model/material.factory';
import { ShapeKind, SkyMode } from '../../model/scene.enums';
import type { ObjectId } from '../../model/scene.ids';
import type { LightData, SceneObject, Sky } from '../../model/scene.types';
import { LIGHT_FALLOFF_SCALE } from '../../render/gpu/render.constants';
import type { Thumbnailer } from '../../render/thumbs';
import { cameraBasis, lookAt } from '../../world/camera-math';
import { createObject } from '../../world/objects.factory';
import { DEFAULT_CAMERA, emptyScene } from '../../world/scene.defaults';
import type { UiContext } from '../context';
import { ColorSwatch } from '../kit/color-picker';
import { Dial } from '../kit/controls';
import { el } from '../kit/dom';
import type { LiveEdit } from './live-edit';

/** The dials of a light: intensity and falloff 0..100, a spot's cone half-angle in degrees. */
export const LIGHT_DIALS = {
  intensity: { min: 0, max: 100 },
  falloff: { min: 0, max: 100 },
  cone: { min: 1, max: 80 },
} as const;
const DIAL_MAX = 100;
const REACH_DIGITS = 1;

const PREVIEW_W = 280;
const PREVIEW_H = 120;
const PREVIEW_SAMPLES = 6;
const PREVIEW_BOUNCES = 3;
const PREVIEW_DEBOUNCE_MS = 120;
const MAX_DPR = 2;
/** The preview stage: a ball on a floor at night, the light above it, seen from the front. */
const BALL_AT: Vec3 = [0, 1, 0];
const SPOT_AT: Vec3 = [0, 4.5, 0];
const RADIAL_AT: Vec3 = [1.6, 2.8, 1.6];
const EYE: Vec3 = [0, 4.4, 7.4];
const LOOK_AT: Vec3 = [0, 0.6, 0];
const EYE_FOV = 42;
const NIGHT = hexToRgb('#07080b');
const STARLIGHT = hexToRgb('#101216');
/** A pale matte ball and floor, so the light's colour reads true. */
const CHALK = material({ name: 'Preview Chalk', colors: { diffuse: hexToRgb('#d8d6d0'), ambient: hexToRgb('#d8d6d0') }, values: { specularity: 10 } });
const NIGHT_SKY: Sky = {
  ...DEFAULT_SKY,
  mode: SkyMode.AtmosphereOff,
  skyColor: NIGHT,
  horizonColor: NIGHT,
  ambientColor: STARLIGHT,
  // No moon: a dark sun leaves only the light being set.
  sunColor: NIGHT,
  sunAltitude: -30,
  sunVisible: false,
  hazeAmount: 0,
  fogAmount: 0,
  clouds: { ...DEFAULT_SKY.clouds, cumulus: false, stratus: false, cover: 0 },
  stars: false,
};

/**
 * How far from its bulb a light is half as bright, under the tracer's fade
 * 1 / (1 + k d²) (render/gpu/scene-packer.ts); null when it never fades.
 */
export function halfDistance(falloff: number): number | null {
  const k = (falloff / DIAL_MAX) ** 2 * LIGHT_FALLOFF_SCALE;
  return k > 0 ? 1 / Math.sqrt(k) : null;
}

/** The falloff in words, one line. */
export function reachText(falloff: number): string {
  const d = halfDistance(falloff);
  return d === null ? 'Never fades with distance' : `Half as bright ${d.toFixed(REACH_DIGITS)} away`;
}

const sameColor = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const sameLight = (a: LightData, b: LightData): boolean =>
  sameColor(a.color, b.color) && a.intensity === b.intensity && a.cone === b.cone && a.falloff === b.falloff;

/** Changes the light of one object at once, as a live edit: a drag is one undo step, an unchanged value none. */
export function editLight(ctx: UiContext, live: LiveEdit, id: ObjectId, label: string, patch: Partial<LightData>): void {
  const o = ctx.world.object(id);
  if (!o?.light || sameLight(o.light, { ...o.light, ...patch })) return;
  live.apply(label, () => ctx.world.updateObjects(new Set([id]), label, (x) => (x.light ? { ...x, light: { ...x.light, ...patch } } : x), true));
}

/** A small night stage lit by `o` alone: a ball on a floor, the light above it (a spot aims straight down). */
export function lightStage(o: SceneObject, aspect: number) {
  const floor = { ...createObject(createEntry('ground'), { seed: 1, position: [0, 0, 0] }), material: CHALK };
  const ball = { ...createObject(createEntry('sphere'), { seed: 1, position: BALL_AT }), material: CHALK };
  const lamp: SceneObject = {
    ...o, hidden: false, groupId: null, local: undefined,
    transform: { position: o.kind === ShapeKind.SpotLight ? SPOT_AT : RADIAL_AT, rotation: [0, 0, 0], size: o.transform.size },
  };
  const eye = lookAt({ ...DEFAULT_CAMERA, position: EYE, fov: EYE_FOV, focus: Math.hypot(EYE[0], EYE[1], EYE[2]) }, LOOK_AT);
  return { scene: { ...emptyScene(), objects: [floor, ball, lamp], sky: NIGHT_SKY }, basis: cameraBasis(eye, aspect) };
}

/** The live preview: the stage re-rendered a moment after each change. */
class LightPreview {
  readonly el: HTMLCanvasElement;
  private timer = 0;

  constructor(private readonly thumbs: Thumbnailer) {
    this.el = el('canvas', { cls: 'light-preview', title: 'This light alone, on a ball at night' });
  }

  schedule(o: SceneObject): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.round(PREVIEW_W * dpr);
      const h = Math.round(PREVIEW_H * dpr);
      this.thumbs.enqueue({ ...lightStage(o, w / h), width: w, height: h, samples: PREVIEW_SAMPLES, bounces: PREVIEW_BOUNCES, transparent: false, into: this.el });
    }, PREVIEW_DEBOUNCE_MS);
  }
}

/**
 * The settings of a light, applied live. Full (Object Attributes): a preview,
 * colour, intensity, falloff with its reach, and a spot's cone. Compact (the
 * Attributes panel): colour and intensity in one line, and a spot's cone.
 */
export class LightFields {
  readonly el: HTMLElement;
  private readonly color: ColorSwatch;
  private readonly intensity: Dial;
  private readonly cone: Dial | null;
  private readonly falloff: Dial | null;
  private readonly reach: HTMLElement | null;
  private readonly preview: LightPreview | null;

  constructor(ctx: UiContext, live: LiveEdit, o: SceneObject, full: boolean) {
    const l = o.light as LightData;
    const set = (label: string, patch: Partial<LightData>) => editLight(ctx, live, o.id, label, patch);
    this.color = new ColorSwatch({ value: l.color, title: 'The colour of the light', onInput: (color) => set('Light colour', { color }), onCommit: (color) => set('Light colour', { color }) });
    this.intensity = new Dial({ label: '', ...LIGHT_DIALS.intensity, value: l.intensity, title: 'Intensity: how bright the light is', onInput: (intensity) => set('Light intensity', { intensity }) });
    this.cone = o.kind === ShapeKind.SpotLight
      ? new Dial({ label: '', ...LIGHT_DIALS.cone, value: l.cone, unit: '°', title: 'Cone: how wide the spot opens, edge to middle', onInput: (cone) => set('Spot cone', { cone }) })
      : null;
    const row = (label: string, ...nodes: HTMLElement[]) => [el('span', { cls: 'light-label', text: label }), el('div', { cls: 'light-control' }, nodes)];
    const coneRow = this.cone ? row('Cone', this.cone.el) : [];
    if (!full) {
      this.falloff = null;
      this.reach = null;
      this.preview = null;
      this.el = el('div', { cls: 'light-fields is-compact' }, [...row('Light', this.color.el, this.intensity.el), ...coneRow]);
      return;
    }
    this.falloff = new Dial({ label: '', ...LIGHT_DIALS.falloff, value: l.falloff, title: 'Falloff: how fast the light fades with distance', onInput: (falloff) => set('Light falloff', { falloff }) });
    this.reach = el('span', { cls: 'light-reach' });
    this.preview = new LightPreview(ctx.thumbs);
    this.el = el('div', { cls: 'light-fields' }, [
      this.preview.el,
      el('div', { cls: 'light-grid' }, [
        ...row('Colour', this.color.el),
        ...row('Intensity', this.intensity.el),
        ...row('Falloff', this.falloff.el),
        el('span'), this.reach,
        ...coneRow,
      ]),
    ]);
    this.refresh(o);
  }

  /** The light changed (an edit here or elsewhere, undo): the controls and the preview follow. */
  refresh(o: SceneObject): void {
    const l = o.light;
    if (!l) return;
    this.color.set(l.color);
    this.intensity.set(l.intensity);
    this.cone?.set(l.cone);
    this.falloff?.set(l.falloff);
    if (this.reach) this.reach.textContent = reachText(l.falloff);
    this.preview?.schedule(o);
  }
}

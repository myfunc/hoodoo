import type { Rgb } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import { COLOR_CHANNELS, VALUE_CHANNELS, VALUE_LIMITS } from '../../model/material.factory';
import { ColorChannel, Ease, ShapeKind, SkyMode, ValueChannel } from '../../model/scene.enums';
import type { Animation, Camera, CloudSettings, Key, MaterialLook, ObjectKey, Scene, SceneObject, Sky, Transform } from '../../model/scene.types';
import { isCyclic } from '../../world/animation/key-selection';
import { sameTime } from '../../world/animation/keying';
import { cameraAt, skyAt, transformAt } from '../../world/animation/pose';
import { LIGHT_CHANNELS, MATERIAL_COLORS, MATERIAL_LOOK, MATERIAL_VALUES, type PropChannel, PropGroup, VISIBILITY, sameProp, withPropsAt } from '../../world/animation/prop-channels';
import { localOf } from '../../world/group-pose';
import { groupIndex } from '../../world/group-tree';
import { IDENTITY } from '../../world/group-transform';
import { camera as validCamera, groupTransform, sky as validSky, transform as validTransform } from '../../world/scene.validate';
import { LIGHT_DIALS } from '../labs/light-fields';
import { type LedgerRow, RowKind, rowKeys } from './timeline-rows';

/**
 * What a key holds, property by property, for the key inspector: the values of a
 * key (or of a row at the playhead) beside those of the key before it, which of
 * them changed, and the value with one property typed in. Objects key their
 * place, turn and size, and their material, light and visibility (world/animation/
 * prop-channels), each property under its heading; groups their place, turn and
 * size; the camera its place, aim and lens; the Sun row every sky value.
 */

export enum PropKind {
  Number = 'number',
  Color = 'color',
  Flag = 'flag',
  Choice = 'choice',
  /** Read only: a material's preset, which switches rather than blends. */
  Name = 'name',
}

export type PropValue = number | Rgb | boolean | string;

export interface KeyProp {
  readonly id: string;
  readonly label: string;
  readonly kind: PropKind;
  readonly unit: string;
  readonly digits: number;
  /** Choice: the values and their names. */
  readonly choices?: readonly { readonly value: number; readonly label: string }[];
  readonly read: (v: unknown) => PropValue;
  readonly write: (v: unknown, x: PropValue) => unknown;
  /** An object's heading in the inspector; absent on the camera, the sun and groups. */
  readonly group?: PropGroup;
  /** A material, light or visibility value: the channel a typed value keys (world/animation/prop-channels). */
  readonly channel?: PropChannel;
  /** Whether two values differ, where reading one field is not enough (the preset's textures). */
  readonly differs?: (from: unknown, to: unknown) => boolean;
}

/** An object row's value at a time: the pose its keys give, and the object with their material, light and visibility. */
export interface ObjectState extends Transform {
  readonly item: SceneObject;
}

const DEG = '°';
const AXES = ['X', 'Y', 'Z'] as const;
const DIGITS = { place: 2, angle: 1, dial: 0 } as const;
/** Two values closer than this read the same; numbers also when they round alike to the shown digits. */
const SAME_EPS = 1e-6;
const DECIMAL = 10;

function prop<V, X extends PropValue>(id: string, label: string, kind: PropKind, get: (v: V) => X, set: (v: V, x: X) => V, digits: number = DIGITS.place, unit = ''): KeyProp {
  return { id, label, kind, unit, digits, read: (v) => get(v as V), write: (v, x) => set(v as V, x as X) };
}

const num = <V>(id: string, label: string, get: (v: V) => number, set: (v: V, x: number) => V, digits?: number, unit?: string): KeyProp =>
  prop(id, label, PropKind.Number, get, set, digits, unit);

const withAxis = (v: Vec3, axis: number, x: number): Vec3 => v.map((c, i) => (i === axis ? x : c)) as unknown as Vec3;

/** X, Y and Z of a vector property. */
function axes<V>(id: string, label: string, get: (v: V) => Vec3, set: (v: V, x: Vec3) => V, digits: number, unit = ''): KeyProp[] {
  return AXES.map((name, axis) => num<V>(`${id}.${axis}`, `${label} ${name}`, (v) => get(v)[axis], (v, x) => set(v, withAxis(get(v), axis, x)), digits, unit));
}

const transformProps = (sizeLabel: string): KeyProp[] => [
  ...axes<Transform>('position', 'Position', (t) => t.position, (t, position) => ({ ...t, position }), DIGITS.place),
  ...axes<Transform>('rotation', 'Rotation', (t) => t.rotation, (t, rotation) => ({ ...t, rotation }), DIGITS.angle, DEG),
  ...axes<Transform>('size', sizeLabel, (t) => t.size, (t, size) => ({ ...t, size }), DIGITS.place),
];

const cameraNum = (key: 'yaw' | 'pitch' | 'bank' | 'fov' | 'focus' | 'aperture', label: string, digits: number, unit = ''): KeyProp =>
  num<Camera>(key, label, (c) => c[key], (c, x) => ({ ...c, [key]: x }), digits, unit);

const CAMERA_PROPS: readonly KeyProp[] = [
  ...axes<Camera>('position', 'Position', (c) => c.position, (c, position) => ({ ...c, position }), DIGITS.place),
  cameraNum('yaw', 'Heading', DIGITS.angle, DEG),
  cameraNum('pitch', 'Tilt', DIGITS.angle, DEG),
  cameraNum('bank', 'Bank', DIGITS.angle, DEG),
  cameraNum('fov', 'Field of view', DIGITS.angle, DEG),
  cameraNum('focus', 'Focus', DIGITS.place),
  cameraNum('aperture', 'Depth of field', DIGITS.dial),
];

type SkyNumber = 'sunAzimuth' | 'sunAltitude' | 'shadows' | 'softShadows' | 'fogAmount' | 'fogHeight' | 'hazeAmount';
type SkyColor = 'sunColor' | 'skyColor' | 'horizonColor' | 'ambientColor' | 'fogColor' | 'hazeColor';
const skyNum = (key: SkyNumber, label: string, digits: number = DIGITS.dial, unit = ''): KeyProp =>
  num<Sky>(key, label, (s) => s[key], (s, x) => ({ ...s, [key]: x }), digits, unit);
const skyColor = (key: SkyColor, label: string): KeyProp => prop<Sky, Rgb>(key, label, PropKind.Color, (s) => s[key], (s, x) => ({ ...s, [key]: x }));
const skyFlag = (key: 'sunVisible' | 'stars', label: string): KeyProp => prop<Sky, boolean>(key, label, PropKind.Flag, (s) => s[key], (s, x) => ({ ...s, [key]: x }));
const withClouds = (s: Sky, patch: Partial<CloudSettings>): Sky => ({ ...s, clouds: { ...s.clouds, ...patch } });
const cloudNum = (key: 'cover' | 'height' | 'frequency' | 'amplitude', label: string): KeyProp =>
  num<Sky>(`clouds.${key}`, label, (s) => s.clouds[key], (s, x) => withClouds(s, { [key]: x }), DIGITS.dial);
const cloudFlag = (key: 'cumulus' | 'stratus', label: string): KeyProp =>
  prop<Sky, boolean>(`clouds.${key}`, label, PropKind.Flag, (s) => s.clouds[key], (s, x) => withClouds(s, { [key]: x }));

export const SKY_MODE_NAMES: readonly { readonly value: number; readonly label: string }[] = [
  { value: SkyMode.SoftSky, label: 'Soft' },
  { value: SkyMode.DarkerSky, label: 'Darker' },
  { value: SkyMode.CustomSky, label: 'Custom' },
  { value: SkyMode.AtmosphereOff, label: 'Off' },
];

const SKY_PROPS: readonly KeyProp[] = [
  skyNum('sunAzimuth', 'Sun azimuth', DIGITS.angle, DEG),
  skyNum('sunAltitude', 'Sun altitude', DIGITS.angle, DEG),
  skyColor('sunColor', 'Sun colour'),
  skyFlag('sunVisible', 'Sun disc'),
  { ...prop<Sky, number>('mode', 'Sky mode', PropKind.Choice, (s) => s.mode, (s, x) => ({ ...s, mode: x as SkyMode })), choices: SKY_MODE_NAMES },
  skyColor('skyColor', 'Sky colour'),
  skyColor('horizonColor', 'Horizon colour'),
  skyColor('ambientColor', 'Ambient colour'),
  skyNum('shadows', 'Shadows'),
  skyNum('softShadows', 'Soft shadows'),
  skyNum('fogAmount', 'Fog'),
  skyNum('fogHeight', 'Fog height'),
  skyColor('fogColor', 'Fog colour'),
  skyNum('hazeAmount', 'Haze'),
  skyColor('hazeColor', 'Haze colour'),
  cloudNum('cover', 'Cloud cover'),
  cloudNum('height', 'Cloud height'),
  cloudNum('frequency', 'Cloud frequency'),
  cloudNum('amplitude', 'Cloud amplitude'),
  prop<Sky, Rgb>('clouds.color', 'Cloud colour', PropKind.Color, (s) => s.clouds.color, (s, x) => withClouds(s, { color: x })),
  cloudFlag('cumulus', 'Cumulus'),
  cloudFlag('stratus', 'Stratus'),
  skyFlag('stars', 'Stars'),
];

const COLOR_NAMES: Readonly<Record<ColorChannel, string>> = {
  [ColorChannel.Diffuse]: 'Diffuse colour',
  [ColorChannel.Ambient]: 'Ambient colour',
  [ColorChannel.Specular]: 'Specular colour',
  [ColorChannel.Transparent]: 'Clear colour',
};
const VALUE_NAMES: Readonly<Record<ValueChannel, string>> = {
  [ValueChannel.Diffusion]: 'Diffusion',
  [ValueChannel.Ambience]: 'Ambience',
  [ValueChannel.Specularity]: 'Specularity',
  [ValueChannel.Metallicity]: 'Metallicity',
  [ValueChannel.Transparency]: 'Transparency',
  [ValueChannel.Reflection]: 'Reflection',
  [ValueChannel.Refraction]: 'Refraction',
  [ValueChannel.Bump]: 'Bump',
};

const itemOf = (v: unknown): SceneObject => (v as ObjectState).item;
const withItem = (v: unknown, item: SceneObject): ObjectState => ({ ...(v as ObjectState), item });
const clamped = (x: number, r: { readonly min: number; readonly max: number }): number => Math.min(r.max, Math.max(r.min, x));

/** A channel's row: what it reads from an object row's value, and the value with it set. */
function channelProp(ch: PropChannel, label: string, kind: PropKind, digits: number = DIGITS.dial, unit = ''): KeyProp {
  return {
    id: ch.id, label, kind, unit, digits, group: ch.group, channel: ch,
    read: (v) => ch.ofObject(itemOf(v)) as PropValue,
    write: (v, x) => withItem(v, ch.onObject(itemOf(v), x)),
  };
}

/** A dial: a typed number is kept inside its range. */
function dialProp(ch: PropChannel, label: string, range: { readonly min: number; readonly max: number }, unit = ''): KeyProp {
  const p = channelProp(ch, label, PropKind.Number, DIGITS.dial, unit);
  return { ...p, write: (v, x) => p.write(v, clamped(x as number, range)) };
}

const lookOfValue = (v: unknown): MaterialLook => MATERIAL_LOOK.ofObject(itemOf(v)) as MaterialLook;

/** The preset, by name; it changes when its sources or textures do too. Typed values cannot set it. */
const PRESET_PROP: KeyProp = {
  ...channelProp(MATERIAL_LOOK, 'Preset', PropKind.Name),
  read: (v) => lookOfValue(v).name,
  write: (v) => v,
  differs: (a, b) => !sameProp(lookOfValue(a), lookOfValue(b)),
};

const MATERIAL_PROPS: readonly KeyProp[] = [
  PRESET_PROP,
  ...COLOR_CHANNELS.map((c) => channelProp(MATERIAL_COLORS[c], COLOR_NAMES[c], PropKind.Color)),
  ...VALUE_CHANNELS.map((c) => dialProp(MATERIAL_VALUES[c], VALUE_NAMES[c], { min: 0, max: VALUE_LIMITS[c] })),
];

const LIGHT_PROPS: readonly KeyProp[] = [
  channelProp(LIGHT_CHANNELS.color, 'Colour', PropKind.Color),
  dialProp(LIGHT_CHANNELS.intensity, 'Intensity', LIGHT_DIALS.intensity),
  dialProp(LIGHT_CHANNELS.falloff, 'Falloff', LIGHT_DIALS.falloff),
];
const CONE_PROP = dialProp(LIGHT_CHANNELS.cone, 'Cone', LIGHT_DIALS.cone, DEG);

/** Shown rather than hidden reads better: Visible On → Off. */
const VISIBLE_PROP: KeyProp = {
  ...channelProp(VISIBILITY, 'Visible', PropKind.Flag),
  read: (v) => !itemOf(v).hidden,
  write: (v, x) => withItem(v, VISIBILITY.onObject(itemOf(v), !x)),
};

const OBJECT_POSE_PROPS = transformProps('Size').map((p) => ({ ...p, group: PropGroup.Transform }));
/** A group's size is a scale factor: 1 is as built. */
const GROUP_PROPS = transformProps('Scale');

export function propsOf(kind: RowKind, item?: SceneObject): readonly KeyProp[] {
  if (kind === RowKind.Camera) return CAMERA_PROPS;
  if (kind === RowKind.Sun) return SKY_PROPS;
  if (kind === RowKind.Group) return GROUP_PROPS;
  if (!item) return OBJECT_POSE_PROPS;
  const light = item.light ? [...LIGHT_PROPS, ...(item.kind === ShapeKind.SpotLight ? [CONE_PROP] : [])] : [];
  return [...OBJECT_POSE_PROPS, ...MATERIAL_PROPS, ...light, VISIBLE_PROP];
}

/** The properties of a row: an object's light only on lights, the cone only on spots. */
export const rowProps = (scene: Scene, row: LedgerRow): readonly KeyProp[] =>
  propsOf(row.kind, row.kind === RowKind.Object ? scene.objects.find((o) => o.id === row.trackId) : undefined);

export function sameValue(a: PropValue, b: PropValue, digits: number = DIGITS.place): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < Math.max(SAME_EPS, 0.5 * DECIMAL ** -digits);
  if (Array.isArray(a) && Array.isArray(b)) return a.every((c, i) => Math.abs(c - b[i]) < SAME_EPS);
  return a === b;
}

export interface PropChange {
  readonly prop: KeyProp;
  /** Null for the first key: nothing came before it. */
  readonly from: PropValue | null;
  readonly to: PropValue;
  readonly changed: boolean;
}

/** Each property from the value before to this one; `from` null: the first key, nothing changed. */
export function keyDiff(props: readonly KeyProp[], from: unknown, to: unknown): PropChange[] {
  return props.map((prop) => {
    const b = prop.read(to);
    const a = from === null ? null : prop.read(from);
    const changed = a !== null && (prop.differs ? prop.differs(from, to) : !sameValue(a, b, prop.digits));
    return { prop, from: a, to: b, changed };
  });
}

/**
 * A row's value at `t`: from its keys, or (no keys) what the item is now. An
 * object's is an ObjectState: the pose, and the object as its keys show it then.
 */
export function rowValueAt(scene: Scene, row: LedgerRow, t: number): unknown {
  const a = scene.animation;
  const keys = rowKeys(a, row);
  const loop = a.loop || isCyclic(a, row.track, row.trackId);
  if (row.kind === RowKind.Camera) return keys.length ? cameraAt(keys as readonly Key<Camera>[], t, loop) : scene.camera;
  if (row.kind === RowKind.Sun) return keys.length ? skyAt(keys as readonly Key<Sky>[], t, loop) : scene.sky;
  const o = row.kind === RowKind.Object ? scene.objects.find((x) => x.id === row.trackId) : undefined;
  if (o) {
    const track = keys as readonly Key<ObjectKey>[];
    const state: ObjectState = { ...(track.length ? transformAt(track, t, loop) : localOf(o)), item: withPropsAt(o, track, t, loop) };
    return state;
  }
  if (keys.length) return transformAt(keys as readonly Key<Transform>[], t, loop);
  return row.kind === RowKind.Group ? (groupIndex(scene).get(row.trackId as never)?.transform ?? IDENTITY) : IDENTITY;
}

/** The pose of an object row's value. */
export const poseOf = (v: unknown): Transform => {
  const t = v as Transform;
  return { position: t.position, rotation: t.rotation, size: t.size };
};

/** One row at one time, as the inspector shows it. */
export interface KeyView {
  /** A key sits at the time. */
  readonly isKey: boolean;
  /** The key's index, or the index of the key before the time (-1: none). */
  readonly index: number;
  readonly count: number;
  /** The previous key's value; null when there is none. */
  readonly from: unknown;
  readonly to: unknown;
  readonly ease: Ease;
}

export function keyView(scene: Scene, row: LedgerRow, time: number): KeyView {
  const a: Animation = scene.animation;
  const keys = rowKeys(a, row);
  const at = keys.findIndex((k) => sameTime(k.time, time, a.fps));
  const before = keys.filter((k) => k.time < time && !sameTime(k.time, time, a.fps)).length - 1;
  const prev = at >= 0 ? at - 1 : before;
  // An object key holds only what changes there: its values are read across its track.
  const whole = row.kind === RowKind.Object;
  return {
    isKey: at >= 0,
    index: at >= 0 ? at : before,
    count: keys.length,
    from: prev < 0 ? null : whole ? rowValueAt(scene, row, keys[prev].time) : keys[prev].value,
    to: at >= 0 && !whole ? keys[at].value : rowValueAt(scene, row, time),
    ease: at >= 0 ? (keys[at].ease ?? Ease.Smooth) : Ease.Smooth,
  };
}

/** The value with one property set, kept inside what the scene accepts. */
export function editedValue(row: LedgerRow, value: unknown, prop: KeyProp, x: PropValue): unknown {
  const next = prop.write(value, x);
  if (row.kind === RowKind.Camera) return validCamera(next, value as Camera);
  if (row.kind === RowKind.Sun) return validSky(next, value as Sky);
  if (row.kind === RowKind.Group) return groupTransform(next);
  const item = (next as Partial<ObjectState>).item;
  return item ? { ...validTransform(next), item } : validTransform(next);
}

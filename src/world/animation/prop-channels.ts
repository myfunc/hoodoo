import type { Rgb } from '../../core/color';
import { COLOR_CHANNELS, VALUE_CHANNELS } from '../../model/material.factory';
import type { ColorChannel, ValueChannel } from '../../model/scene.enums';
import type { Key, LightData, Material, MaterialLook, ObjectKey, SceneObject } from '../../model/scene.types';
import { channelAt, midStepAt, oklabAt, stepAt } from './interpolate';

/**
 * READ ME — what an object key holds besides its pose. Every key holds the pose
 * (place, turn, size); a key also holds a material colour or dial, a light value
 * or the visibility only where that value changes, so keys stay small. Each such
 * value is a channel of its own, read across the keys that hold it: numbers by
 * the keys' eases (held between their two keys, never past them), colours in
 * OKLab, visibility stepped at the key. A material's look — its name, sources
 * and textures, which cannot blend — switches halfway between two keys, so a
 * preset change crossfades its numbers and swaps its textures at the midpoint.
 * Before a channel's first key and after its last, the value holds; an object
 * without keys on a channel keeps its own value.
 */

/** The headings of the key inspector: what part of an object a channel changes. */
export enum PropGroup {
  Transform = 'transform',
  Material = 'material',
  Light = 'light',
  Visibility = 'visibility',
}

enum Blend {
  Number = 'number',
  Color = 'color',
  /** At the key: the value of the last key at or before the time. */
  Step = 'step',
  /** Halfway between two keys. */
  Midpoint = 'midpoint',
}

/** One keyable value of an object, other than its pose. */
export interface PropChannel {
  /** Unique, and stable: the inspector's row ids. */
  readonly id: string;
  readonly group: PropGroup;
  readonly blend: Blend;
  /** The value a key holds; undefined when the key leaves this channel alone. */
  readonly inKey: (k: ObjectKey) => unknown;
  /** The key holding `v` on this channel; its other values untouched. */
  readonly toKey: (k: ObjectKey, v: unknown) => ObjectKey;
  /** The object's own value; undefined when it has none (the light of a solid). */
  readonly ofObject: (o: SceneObject) => unknown;
  readonly onObject: (o: SceneObject, v: unknown) => SceneObject;
}

export const lookOf = (m: Material): MaterialLook => ({ name: m.name, colorSources: m.colorSources, valueSources: m.valueSources, textures: m.textures });

const withMaterial = (o: SceneObject, patch: Partial<Material>): SceneObject => ({ ...o, material: { ...o.material, ...patch } });

const colorChannel = (c: ColorChannel): PropChannel => ({
  id: `material.colors.${c}`,
  group: PropGroup.Material,
  blend: Blend.Color,
  inKey: (k) => k.material?.colors?.[c],
  toKey: (k, v) => ({ ...k, material: { ...k.material, colors: { ...k.material?.colors, [c]: v as Rgb } } }),
  ofObject: (o) => o.material.colors[c],
  onObject: (o, v) => withMaterial(o, { colors: { ...o.material.colors, [c]: v as Rgb } }),
});

const valueChannel = (c: ValueChannel): PropChannel => ({
  id: `material.values.${c}`,
  group: PropGroup.Material,
  blend: Blend.Number,
  inKey: (k) => k.material?.values?.[c],
  toKey: (k, v) => ({ ...k, material: { ...k.material, values: { ...k.material?.values, [c]: v as number } } }),
  ofObject: (o) => o.material.values[c],
  onObject: (o, v) => withMaterial(o, { values: { ...o.material.values, [c]: v as number } }),
});

const LOOK: PropChannel = {
  id: 'material.look',
  group: PropGroup.Material,
  blend: Blend.Midpoint,
  inKey: (k) => k.material?.look,
  toKey: (k, v) => ({ ...k, material: { ...k.material, look: v as MaterialLook } }),
  ofObject: (o) => lookOf(o.material),
  onObject: (o, v) => withMaterial(o, v as MaterialLook),
};

const lightChannel = (key: keyof LightData, blend: Blend): PropChannel => ({
  id: `light.${key}`,
  group: PropGroup.Light,
  blend,
  inKey: (k) => k.light?.[key],
  toKey: (k, v) => ({ ...k, light: { ...k.light, [key]: v } }),
  ofObject: (o) => o.light?.[key],
  onObject: (o, v) => (o.light ? { ...o, light: { ...o.light, [key]: v } } : o),
});

const HIDDEN: PropChannel = {
  id: 'hidden',
  group: PropGroup.Visibility,
  blend: Blend.Step,
  inKey: (k) => k.hidden,
  toKey: (k, v) => ({ ...k, hidden: v as boolean }),
  ofObject: (o) => o.hidden,
  onObject: (o, v) => ({ ...o, hidden: v as boolean }),
};

export const MATERIAL_COLORS = Object.fromEntries(COLOR_CHANNELS.map((c) => [c, colorChannel(c)])) as Readonly<Record<ColorChannel, PropChannel>>;
export const MATERIAL_VALUES = Object.fromEntries(VALUE_CHANNELS.map((c) => [c, valueChannel(c)])) as Readonly<Record<ValueChannel, PropChannel>>;
export const MATERIAL_LOOK = LOOK;
export const LIGHT_CHANNELS: Readonly<Record<keyof LightData, PropChannel>> = {
  color: lightChannel('color', Blend.Color),
  intensity: lightChannel('intensity', Blend.Number),
  falloff: lightChannel('falloff', Blend.Number),
  cone: lightChannel('cone', Blend.Number),
};
export const VISIBILITY = HIDDEN;

/** Every channel. */
export const PROP_CHANNELS: readonly PropChannel[] = [
  LOOK,
  ...Object.values(MATERIAL_COLORS),
  ...Object.values(MATERIAL_VALUES),
  ...Object.values(LIGHT_CHANNELS),
  HIDDEN,
];

export const sameProp = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The keys that hold this channel, as a track of its own (times and eases kept). */
function held(ch: PropChannel, keys: readonly Key<ObjectKey>[]): Key<unknown>[] {
  const out: Key<unknown>[] = [];
  for (const k of keys) {
    const value = ch.inKey(k.value);
    if (value !== undefined) out.push(k.ease ? { time: k.time, value, ease: k.ease } : { time: k.time, value });
  }
  return out;
}

export const holdsChannel = (ch: PropChannel, keys: readonly Key<ObjectKey>[]): boolean => keys.some((k) => ch.inKey(k.value) !== undefined);

/** The channel's value at `t`; undefined when no key holds it. */
export function channelValueAt(ch: PropChannel, keys: readonly Key<ObjectKey>[], t: number, loop = false): unknown {
  const track = held(ch, keys);
  if (!track.length) return undefined;
  if (ch.blend === Blend.Number) return channelAt(track, t, (v) => v as number, { bounded: true, loop });
  if (ch.blend === Blend.Color) return oklabAt(track, t, (v) => v as Rgb, loop);
  if (ch.blend === Blend.Step) return stepAt(track, t, (v) => v);
  return midStepAt(track, t, (v) => v);
}

/** Some key holds more than a pose. */
const holdsProps = (keys: readonly Key<ObjectKey>[]): boolean => keys.some((k) => k.value.material || k.value.light || k.value.hidden !== undefined);

/** The object with the values its keys give at `t` (its own where no key holds a channel). */
export function withPropsAt(o: SceneObject, keys: readonly Key<ObjectKey>[], t: number, loop = false): SceneObject {
  if (!holdsProps(keys)) return o;
  let out = o;
  for (const ch of PROP_CHANNELS) {
    const v = channelValueAt(ch, keys, t, loop);
    if (v !== undefined && ch.ofObject(out) !== undefined) out = ch.onObject(out, v);
  }
  return out;
}

/** The groups a key holds values of: always Transform, then what else it carries. */
export function keyGroups(k: ObjectKey): Set<PropGroup> {
  const out = new Set([PropGroup.Transform]);
  for (const ch of PROP_CHANNELS) if (ch.inKey(k) !== undefined) out.add(ch.group);
  return out;
}

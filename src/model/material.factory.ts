import type { Rgb } from '../core/color';
import { ChannelSource, ColorChannel, TextureKind, TextureMapping, ValueChannel } from './scene.enums';
import type { Material, ProceduralTexture } from './scene.types';

export interface MaterialSpec {
  readonly name: string;
  readonly colors?: Partial<Record<ColorChannel, Rgb>>;
  readonly values?: Partial<Record<ValueChannel, number>>;
  readonly colorSources?: Partial<Record<ColorChannel, ChannelSource>>;
  readonly valueSources?: Partial<Record<ValueChannel, ChannelSource>>;
  readonly textures?: readonly (ProceduralTexture | null)[];
}

export interface TextureSpec {
  readonly mapping?: TextureMapping;
  readonly detail?: number;
  readonly contrast?: number;
  readonly seed?: number;
}

/** Bryce's "Default" surface: matte light grey with a little ambient and shine. */
export const DEFAULT_COLORS: Readonly<Record<ColorChannel, Rgb>> = {
  [ColorChannel.Diffuse]: [0.78, 0.78, 0.76],
  [ColorChannel.Ambient]: [0.78, 0.78, 0.76],
  [ColorChannel.Specular]: [1, 1, 1],
  [ColorChannel.Transparent]: [1, 1, 1],
};

export const DEFAULT_VALUES: Readonly<Record<ValueChannel, number>> = {
  [ValueChannel.Diffusion]: 80,
  [ValueChannel.Ambience]: 12,
  [ValueChannel.Specularity]: 25,
  [ValueChannel.Metallicity]: 0,
  [ValueChannel.Transparency]: 0,
  [ValueChannel.Reflection]: 0,
  [ValueChannel.Refraction]: 100,
  [ValueChannel.Bump]: 0,
};

export const VALUE_LIMITS: Readonly<Record<ValueChannel, number>> = {
  [ValueChannel.Diffusion]: 100,
  [ValueChannel.Ambience]: 100,
  [ValueChannel.Specularity]: 100,
  [ValueChannel.Metallicity]: 100,
  [ValueChannel.Transparency]: 100,
  [ValueChannel.Reflection]: 100,
  [ValueChannel.Refraction]: 300,
  [ValueChannel.Bump]: 100,
};

export const TEXTURE_DEFAULTS = { detail: 5, contrast: 0, mapping: TextureMapping.World, seed: 1 } as const;
export const TEXTURE_SLOTS = 3;

const allSources = <K extends string>(keys: readonly K[]): Record<K, ChannelSource> =>
  Object.fromEntries(keys.map((k) => [k, ChannelSource.Flat])) as Record<K, ChannelSource>;

export const COLOR_CHANNELS: readonly ColorChannel[] = Object.values(ColorChannel);
export const VALUE_CHANNELS: readonly ValueChannel[] = Object.values(ValueChannel);

export function texture(
  kind: TextureKind,
  frequency: number,
  colors: readonly [Rgb, Rgb, Rgb],
  spec: TextureSpec = {},
): ProceduralTexture {
  return {
    kind,
    frequency,
    colors,
    mapping: spec.mapping ?? TEXTURE_DEFAULTS.mapping,
    detail: spec.detail ?? TEXTURE_DEFAULTS.detail,
    contrast: spec.contrast ?? TEXTURE_DEFAULTS.contrast,
    seed: spec.seed ?? TEXTURE_DEFAULTS.seed,
  };
}

export function material(spec: MaterialSpec): Material {
  const textures = spec.textures ?? [];
  return {
    name: spec.name,
    colors: { ...DEFAULT_COLORS, ...spec.colors },
    values: { ...DEFAULT_VALUES, ...spec.values },
    colorSources: { ...allSources(COLOR_CHANNELS), ...spec.colorSources },
    valueSources: { ...allSources(VALUE_CHANNELS), ...spec.valueSources },
    textures: [textures[0] ?? null, textures[1] ?? null, textures[2] ?? null],
  };
}

/** Texture A drives diffuse and ambient colour: the most common Bryce wiring. */
export const TEXTURED_COLOR = {
  [ColorChannel.Diffuse]: ChannelSource.TexA,
  [ColorChannel.Ambient]: ChannelSource.TexA,
} as const;

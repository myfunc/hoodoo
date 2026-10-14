import { COLOR_CHANNELS, VALUE_CHANNELS } from '../../model/material.factory';
import { ChannelSource, ColorChannel, TextureKind, TextureMapping, ValueChannel } from '../../model/scene.enums';
import type { Material } from '../../model/scene.types';

export const TEXTURE_KIND_LABELS: Readonly<Record<TextureKind, string>> = {
  [TextureKind.Fbm]: 'Basic Noise',
  [TextureKind.Strata]: 'Sedimentary Strata',
  [TextureKind.Marble]: 'Marble Veins',
  [TextureKind.Granite]: 'Granite',
  [TextureKind.Ripples]: 'Water Ripples',
  [TextureKind.Clouds]: 'Clouds',
  [TextureKind.Wood]: 'Wood Rings',
  [TextureKind.Checker]: 'Checkers',
  [TextureKind.Spots]: 'Spots',
  [TextureKind.Psychedelic]: 'Psychedelic',
  [TextureKind.Altitude]: 'Altitude Bands',
  [TextureKind.Slope]: 'Slope Bands',
  [TextureKind.Ridged]: 'Ridged Noise',
  [TextureKind.PoolBall]: 'Pool Ball',
  [TextureKind.Iridescent]: 'Iridescent',
  [TextureKind.Beam]: 'Light Beam',
  [TextureKind.Rainbow]: 'Rainbow',
  [TextureKind.Facade]: 'Facade',
  [TextureKind.FacadeGlass]: 'Facade Glass',
  [TextureKind.FacadeLit]: 'Facade Lit Windows',
};

export const MAPPING_LABELS: Readonly<Record<TextureMapping, string>> = {
  [TextureMapping.World]: 'World Space',
  [TextureMapping.Object]: 'Object Space',
  [TextureMapping.Parametric]: 'Parametric',
  [TextureMapping.Follows]: 'Follows Object',
};

export const TEXTURE_KINDS = Object.values(TextureKind).filter((v): v is TextureKind => typeof v === 'number');
export const MAPPINGS = Object.values(TextureMapping).filter((v): v is TextureMapping => typeof v === 'number');

/** The three texture slots of a material, by the letters the Materials Lab shows. */
export const SLOT_NAMES = ['A', 'B', 'C'] as const;
export const SLOT_SOURCES = [ChannelSource.TexA, ChannelSource.TexB, ChannelSource.TexC] as const;

export type Channel = ColorChannel | ValueChannel;

/** Each channel's name in a texture slot's line ("Texture B · Diffuse, Bump"). */
export const CHANNEL_SHORT: Readonly<Record<Channel, string>> = {
  [ColorChannel.Diffuse]: 'Diffuse',
  [ColorChannel.Ambient]: 'Ambient',
  [ColorChannel.Specular]: 'Specular',
  [ColorChannel.Transparent]: 'Transparent',
  [ValueChannel.Diffusion]: 'Diffusion',
  [ValueChannel.Ambience]: 'Ambience',
  [ValueChannel.Specularity]: 'Specularity',
  [ValueChannel.Metallicity]: 'Metallicity',
  [ValueChannel.Transparency]: 'Transparency',
  [ValueChannel.Reflection]: 'Reflection',
  [ValueChannel.Refraction]: 'Refraction',
  [ValueChannel.Bump]: 'Bump',
};

const isColor = (ch: Channel): ch is ColorChannel => (COLOR_CHANNELS as readonly string[]).includes(ch);

/** Where a channel takes its value from: flat, or one of the texture slots. */
export const sourceOf = (m: Material, ch: Channel): ChannelSource => (isColor(ch) ? m.colorSources[ch] : m.valueSources[ch as ValueChannel]);

/** The material with one channel driven from `source`. */
export function withSource(m: Material, ch: Channel, source: ChannelSource): Material {
  return isColor(ch)
    ? { ...m, colorSources: { ...m.colorSources, [ch]: source } }
    : { ...m, valueSources: { ...m.valueSources, [ch]: source } };
}

/** Every channel, colours first, in the Lab's order. */
export const CHANNELS: readonly Channel[] = [...COLOR_CHANNELS, ...VALUE_CHANNELS];

/** The channels a texture slot drives. */
export const channelsFrom = (m: Material, source: ChannelSource): Channel[] => CHANNELS.filter((ch) => sourceOf(m, ch) === source);

/** The material with every channel that a slot drove back on its flat value (the slot was emptied). */
export const withoutSource = (m: Material, source: ChannelSource): Material =>
  channelsFrom(m, source).reduce((acc, ch) => withSource(acc, ch, ChannelSource.Flat), m);

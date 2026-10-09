import { hexToRgb as h } from '../core/color';
import { TEXTURED_COLOR, material, texture } from '../model/material.factory';
import { ChannelSource, TextureKind, TextureMapping } from '../model/scene.enums';
import type { Material } from '../model/scene.types';

/** Materials Lab preset library, grouped like Bryce 2's preset categories. */
export interface MaterialCategory {
  readonly name: string;
  readonly materials: readonly Material[];
}

const A = ChannelSource.TexA;
const B = ChannelSource.TexB;
const OBJ = TextureMapping.Object;

const rocks: Material[] = [
  material({
    name: 'Canyon Strata',
    textures: [texture(TextureKind.Strata, 1.1, [h('#6e2a12'), h('#c4622a'), h('#f0b07a')], { detail: 4 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 85, ambience: 22, specularity: 8, bump: 18 },
    valueSources: { bump: A },
  }),
  material({
    name: 'Red Rock',
    textures: [texture(TextureKind.Granite, 2.4, [h('#5a1d0e'), h('#a94421'), h('#e08a5a')], { detail: 6 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 85, ambience: 20, specularity: 5, bump: 30 },
    valueSources: { bump: A },
  }),
  material({
    name: 'Sandstone',
    textures: [texture(TextureKind.Strata, 2.2, [h('#9c7a55'), h('#d9b98a'), h('#f6e3c0')], { detail: 5 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 90, ambience: 25, specularity: 4, bump: 12 },
    valueSources: { bump: A },
  }),
  material({
    name: 'Granite',
    textures: [texture(TextureKind.Granite, 6, [h('#2c2c30'), h('#86868c'), h('#e4e2dc')], { detail: 6, contrast: 30 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 80, ambience: 15, specularity: 30, bump: 10 },
    valueSources: { bump: A },
  }),
  material({
    name: 'Mossy Boulder',
    textures: [
      texture(TextureKind.Slope, 1, [h('#3f5a1e'), h('#6d7a3a'), h('#6b6258')], { detail: 5 }),
      texture(TextureKind.Fbm, 4, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 6 }),
    ],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 85, ambience: 18, specularity: 5, bump: 35 },
    valueSources: { bump: B },
  }),
  material({
    name: 'Volcanic Basalt',
    textures: [texture(TextureKind.Ridged, 2, [h('#0d0b0b'), h('#2b2522'), h('#ff4a12')], { detail: 6, contrast: 40 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 75, ambience: 30, specularity: 20, bump: 40 },
    valueSources: { bump: A },
  }),
];

const terrains: Material[] = [
  material({
    name: 'Snowy Peaks',
    textures: [
      texture(TextureKind.Altitude, 1, [h('#3a3027'), h('#7d7266'), h('#fbfbff')], { detail: 5 }),
      texture(TextureKind.Fbm, 5, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 6 }),
    ],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 85, ambience: 18, specularity: 10, bump: 25 },
    valueSources: { bump: B },
  }),
  material({
    name: 'Alpine Meadow',
    textures: [texture(TextureKind.Slope, 1, [h('#4b7a26'), h('#7f8f45'), h('#77706a')], { detail: 5 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 85, ambience: 18, specularity: 4 },
  }),
  material({
    name: 'Desert Dunes',
    textures: [texture(TextureKind.Ripples, 3, [h('#b9864d'), h('#e2b27a'), h('#f7d9a8')], { detail: 3 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 90, ambience: 25, specularity: 6, bump: 20 },
    valueSources: { bump: A },
  }),
  material({
    name: 'Chrome Checkers',
    textures: [texture(TextureKind.Checker, 0.5, [h('#101010'), h('#808080'), h('#f2f2f2')], { detail: 1 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 80, ambience: 15, specularity: 60, reflection: 35 },
  }),
  material({
    name: 'Grassy Plain',
    textures: [texture(TextureKind.Fbm, 3, [h('#2f4f17'), h('#557a2a'), h('#8ea84f')], { detail: 6 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 85, ambience: 20, specularity: 3, bump: 15 },
    valueSources: { bump: A },
  }),
  material({
    name: 'Mars Soil',
    textures: [texture(TextureKind.Fbm, 2, [h('#5b1f0c'), h('#a3461f'), h('#d9814b')], { detail: 7 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 88, ambience: 22, specularity: 4, bump: 22 },
    valueSources: { bump: A },
  }),
];

const waters: Material[] = [
  material({
    name: 'Blue Lagoon',
    colors: { diffuse: h('#0e3a5c'), ambient: h('#0b2a44'), transparent: h('#3cc4d8') },
    textures: [texture(TextureKind.Ripples, 1.5, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 4 })],
    values: { diffusion: 30, ambience: 10, specularity: 80, reflection: 60, transparency: 35, refraction: 133, bump: 30 },
    valueSources: { bump: A },
  }),
  material({
    name: 'Mirror Lake',
    colors: { diffuse: h('#0b1f30') },
    textures: [texture(TextureKind.Ripples, 0.8, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 3 })],
    values: { diffusion: 15, ambience: 5, specularity: 90, reflection: 85, bump: 12 },
    valueSources: { bump: A },
  }),
  material({
    name: 'Tropical Shallows',
    colors: { diffuse: h('#1aa6a0'), transparent: h('#7ff2e2') },
    textures: [texture(TextureKind.Ripples, 2, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 4 })],
    values: { diffusion: 40, ambience: 15, specularity: 70, reflection: 35, transparency: 60, refraction: 133, bump: 25 },
    valueSources: { bump: A },
  }),
  material({
    name: 'Turquoise Wave',
    colors: { diffuse: h('#2ab7c9') },
    textures: [texture(TextureKind.Ripples, 0.6, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 5, contrast: 20 })],
    values: { diffusion: 45, ambience: 20, specularity: 85, reflection: 55, bump: 35 },
    valueSources: { bump: A },
  }),
  material({
    name: 'Ink Sea',
    colors: { diffuse: h('#050812') },
    textures: [texture(TextureKind.Ripples, 1, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 4 })],
    values: { diffusion: 20, ambience: 5, specularity: 95, reflection: 70, bump: 35 },
    valueSources: { bump: A },
  }),
];

const clouds: Material[] = [
  material({
    name: 'Fluffy Clouds',
    colors: { diffuse: h('#ffffff'), ambient: h('#c8d4ff') },
    textures: [texture(TextureKind.Clouds, 0.08, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 6 })],
    values: { diffusion: 80, ambience: 45, specularity: 0, transparency: 100 },
    valueSources: { transparency: A },
  }),
  material({
    name: 'Storm Layer',
    colors: { diffuse: h('#5f6370'), ambient: h('#3a3c48') },
    textures: [texture(TextureKind.Clouds, 0.05, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 7, contrast: 20 })],
    values: { diffusion: 70, ambience: 40, specularity: 0, transparency: 100 },
    valueSources: { transparency: A },
  }),
  material({
    name: 'Sunset Wisps',
    colors: { diffuse: h('#ffb3c8'), ambient: h('#ff7a9a') },
    textures: [texture(TextureKind.Clouds, 0.04, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 5, contrast: 40 })],
    values: { diffusion: 70, ambience: 60, specularity: 0, transparency: 100 },
    valueSources: { transparency: A },
  }),
];

const wild: Material[] = [
  material({
    name: 'Trapper Purple',
    colors: { diffuse: h('#8a2bd8'), ambient: h('#3b0a6a'), specular: h('#ffffff') },
    values: { diffusion: 55, ambience: 20, specularity: 100, metallicity: 90, reflection: 70 },
  }),
  material({
    name: 'Psycho Chrome',
    textures: [texture(TextureKind.Psychedelic, 1.5, [h('#ff2bd6'), h('#2bf0ff'), h('#fff22b')], { detail: 4, mapping: OBJ })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 60, ambience: 20, specularity: 100, metallicity: 80, reflection: 55 },
  }),
  material({
    name: 'Vapor Grid',
    textures: [texture(TextureKind.Checker, 1, [h('#ff2bd6'), h('#7d2bff'), h('#22e6ff')], { detail: 1 })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 60, ambience: 60, specularity: 60, reflection: 30 },
  }),
  material({
    name: 'Lava Lamp',
    textures: [texture(TextureKind.Spots, 2, [h('#ff3d00'), h('#ff8a00'), h('#ffe14d')], { detail: 3, mapping: OBJ })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 70, ambience: 55, specularity: 70, reflection: 15 },
  }),
  material({
    name: 'Neon Marble',
    textures: [texture(TextureKind.Marble, 1.2, [h('#12002a'), h('#ff2bd6'), h('#2bf0ff')], { detail: 6, mapping: OBJ })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 70, ambience: 30, specularity: 90, reflection: 25 },
  }),
  material({
    name: 'Blue Egg Chrome',
    colors: { diffuse: h('#2142c8'), ambient: h('#0a1650') },
    values: { diffusion: 55, ambience: 15, specularity: 100, metallicity: 85, reflection: 75 },
  }),
  material({
    name: 'Leopard',
    textures: [texture(TextureKind.Spots, 3, [h('#1a0f05'), h('#c0822a'), h('#f0c060')], { detail: 2, contrast: 50, mapping: OBJ })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 85, ambience: 15, specularity: 15 },
  }),
];

const glass: Material[] = [
  material({
    name: 'Clear Glass',
    colors: { diffuse: h('#ffffff'), transparent: h('#ffffff') },
    values: { diffusion: 10, ambience: 0, specularity: 100, transparency: 92, reflection: 12, refraction: 152 },
  }),
  material({
    name: 'Crystal Ball',
    colors: { diffuse: h('#e8f4ff'), transparent: h('#d8ecff') },
    values: { diffusion: 5, ambience: 0, specularity: 100, transparency: 95, reflection: 10, refraction: 200 },
  }),
  material({
    name: 'Blue Glass',
    colors: { diffuse: h('#2a5cff'), transparent: h('#4f86ff') },
    values: { diffusion: 15, ambience: 5, specularity: 100, transparency: 85, reflection: 15, refraction: 150 },
  }),
  material({
    name: 'Amber',
    colors: { diffuse: h('#ff9a1a'), transparent: h('#ffb347') },
    values: { diffusion: 25, ambience: 10, specularity: 90, transparency: 75, reflection: 10, refraction: 155 },
  }),
  material({
    name: 'Soap Bubble',
    colors: { diffuse: h('#ffffff'), transparent: h('#ffffff') },
    textures: [texture(TextureKind.Psychedelic, 0.8, [h('#ff8ad8'), h('#8affff'), h('#ffff8a')], { detail: 3, mapping: OBJ })],
    colorSources: { specular: A },
    values: { diffusion: 0, ambience: 0, specularity: 100, transparency: 92, reflection: 30, refraction: 101 },
  }),
];

const metals: Material[] = [
  material({
    name: 'Chrome',
    colors: { diffuse: h('#b8bcc4'), ambient: h('#30343a') },
    values: { diffusion: 30, ambience: 5, specularity: 100, metallicity: 100, reflection: 90 },
  }),
  material({
    name: 'Gold',
    colors: { diffuse: h('#e8b23a'), ambient: h('#5a3a08') },
    values: { diffusion: 60, ambience: 10, specularity: 100, metallicity: 100, reflection: 65 },
  }),
  material({
    name: 'Copper',
    colors: { diffuse: h('#c8653a'), ambient: h('#4a1a08') },
    values: { diffusion: 60, ambience: 10, specularity: 100, metallicity: 100, reflection: 55 },
  }),
  material({
    name: 'Brushed Steel',
    textures: [texture(TextureKind.Wood, 30, [h('#7a7f88'), h('#9aa0aa'), h('#c2c8d2')], { detail: 2, mapping: OBJ })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 65, ambience: 10, specularity: 80, metallicity: 90, reflection: 35 },
  }),
  material({
    name: 'Anodized Teal',
    colors: { diffuse: h('#1d8c8c'), ambient: h('#0a3434') },
    values: { diffusion: 70, ambience: 15, specularity: 100, metallicity: 80, reflection: 40 },
  }),
];

const basic: Material[] = [
  material({ name: 'Default' }),
  material({
    name: 'Bryce Teal',
    colors: { diffuse: h('#2b8a8a'), ambient: h('#1c5c5c') },
    values: { diffusion: 80, ambience: 20, specularity: 60 },
  }),
  material({
    name: 'Red Plastic',
    colors: { diffuse: h('#d42a1e'), ambient: h('#5a0a06') },
    values: { diffusion: 80, ambience: 15, specularity: 70 },
  }),
  material({
    name: 'Flat Black',
    colors: { diffuse: h('#0c0c0c'), ambient: h('#000000') },
    values: { diffusion: 60, ambience: 0, specularity: 10 },
  }),
  material({
    name: 'Polished Wood',
    textures: [texture(TextureKind.Wood, 3, [h('#4a2410'), h('#8a4a22'), h('#c88a52')], { detail: 4, mapping: OBJ })],
    colorSources: TEXTURED_COLOR,
    values: { diffusion: 80, ambience: 15, specularity: 50, reflection: 8 },
  }),
  material({
    name: 'Glow White',
    colors: { diffuse: h('#ffffff'), ambient: h('#ffffff') },
    values: { diffusion: 30, ambience: 100, specularity: 0 },
  }),
];

export const MATERIAL_LIBRARY: readonly MaterialCategory[] = [
  { name: 'Rocks', materials: rocks },
  { name: 'Planes & Terrains', materials: terrains },
  { name: 'Waters & Liquids', materials: waters },
  { name: 'Clouds & Fog', materials: clouds },
  { name: 'Wild & Fun', materials: wild },
  { name: 'Glass', materials: glass },
  { name: 'Metals', materials: metals },
  { name: 'Simple & Basic', materials: basic },
];

const byName = new Map(MATERIAL_LIBRARY.flatMap((c) => c.materials).map((m) => [m.name, m]));

export function presetMaterial(name: string): Material {
  const found = byName.get(name);
  if (!found) throw new Error(`Unknown material preset: ${name}`);
  return found;
}

export const ALL_MATERIALS: readonly Material[] = [...byName.values()];

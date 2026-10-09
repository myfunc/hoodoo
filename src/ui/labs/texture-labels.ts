import { TextureKind, TextureMapping } from '../../model/scene.enums';

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
};

export const MAPPING_LABELS: Readonly<Record<TextureMapping, string>> = {
  [TextureMapping.World]: 'World Space',
  [TextureMapping.Object]: 'Object Space',
  [TextureMapping.Parametric]: 'Parametric',
};

export const TEXTURE_KINDS = Object.values(TextureKind).filter((v): v is TextureKind => typeof v === 'number');
export const MAPPINGS = Object.values(TextureMapping).filter((v): v is TextureMapping => typeof v === 'number');

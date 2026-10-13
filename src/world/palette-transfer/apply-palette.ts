import { hexToRgb } from '../../core/color';
import { ChannelSource, ColorChannel, SkyMode } from '../../model/scene.enums';
import type { Material, SceneObject, Sky } from '../../model/scene.types';
import type { ObjectId } from '../../model/scene.ids';
import type { World } from '../world';
import { type ApplyOptions, ObjectTarget, type Palette } from './palette.types';

/**
 * A palette from another tool applied to the scene: the seven sky roles become the
 * sky's colours exactly (hex / 255, as Hoodoo's own colour fields store them), the
 * dials only when asked, Ground or Accent only on the selected objects when asked.
 * Everything else (sun direction, fog height, cloud kinds and shape, stars, camera,
 * objects, animation) stays as it is.
 */

/** Modes that do not show the zenith and horizon colours as given: Darker dims the zenith, Off shows one flat colour. */
const INEXACT_MODES: ReadonlySet<SkyMode> = new Set([SkyMode.DarkerSky, SkyMode.AtmosphereOff]);

export const paletteLabel = (p: Palette): string => `Palette: ${p.name}`;

/** True when Apply switches the sky mode to Custom so the colours read as given. */
export const changesSkyMode = (sky: Sky): boolean => INEXACT_MODES.has(sky.mode);

export function skyWithPalette(sky: Sky, p: Palette, withDials: boolean): Sky {
  const c = p.colors;
  const d = withDials ? p.dials : null;
  return {
    ...sky,
    mode: changesSkyMode(sky) ? SkyMode.CustomSky : sky.mode,
    skyColor: hexToRgb(c.sky),
    horizonColor: hexToRgb(c.horizon),
    hazeColor: hexToRgb(c.haze),
    fogColor: hexToRgb(c.fog),
    sunColor: hexToRgb(c.sun),
    ambientColor: hexToRgb(c.ambient),
    ...(d ? { shadows: d.shadows, softShadows: d.softShadows, fogAmount: d.fog, hazeAmount: d.haze } : {}),
    clouds: { ...sky.clouds, color: hexToRgb(c.cloud), ...(d ? { cover: d.clouds } : {}) },
  };
}

/** The material with a new flat diffuse colour; its textures, values and wiring are kept. */
export function withDiffuse(m: Material, hex: string): Material {
  return { ...m, colors: { ...m.colors, [ColorChannel.Diffuse]: hexToRgb(hex) } };
}

/** A texture wired to Diffuse paints over the flat colour: the new colour shows once Diffuse is Flat again. */
export const textureHidesColor = (m: Material): boolean => m.colorSources[ColorChannel.Diffuse] !== ChannelSource.Flat;

export interface ObjectsReport {
  readonly recoloured: number;
  /** Recoloured, but a texture still drives what they show. */
  readonly textured: number;
  /** Selected but locked: left alone. */
  readonly locked: number;
}

export function objectsReport(objects: readonly SceneObject[]): ObjectsReport {
  const open = objects.filter((o) => !o.locked);
  return { recoloured: open.length, textured: open.filter((o) => textureHidesColor(o.material)).length, locked: objects.length - open.length };
}

/** Applies the palette as one undo step; returns what happened to the selected objects. */
export function applyPalette(world: World, p: Palette, o: ApplyOptions, selection: ReadonlySet<ObjectId> = world.selection): ObjectsReport {
  const label = paletteLabel(p);
  const target = o.objects === ObjectTarget.None ? null : o.objects === ObjectTarget.Ground ? p.colors.ground : p.colors.accent;
  const picked = target ? world.scene.objects.filter((x) => selection.has(x.id)) : [];
  world.beginGesture(label);
  try {
    world.setSky(skyWithPalette(world.scene.sky, p, o.dials), label);
    if (target && picked.length) world.updateObjects(selection, label, (x) => ({ ...x, material: withDiffuse(x.material, target) }));
  } finally {
    world.endGesture();
  }
  return objectsReport(picked);
}

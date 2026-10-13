import type { Rgb } from '../../../core/color';
import { ChannelSource, ColorChannel, ValueChannel } from '../../../model/scene.enums';
import type { Material } from '../../../model/scene.types';
import { SettingKind, type ToolSetting } from '../../../ui/sandbox/tool-menu';
import { type Tool, ToolButton, ToolCategory, type ToolContext, type ToolHit, ToolId, isPaintable } from './tool';

/**
 * READ ME — Garry's Mod's Colour tool on a Hoodoo material: Mouse 1 paints the
 * object's diffuse colour (flat, over any texture), and an alpha under 100 makes
 * it see-through in that colour; Mouse 2 takes the object's colour and alpha into
 * the settings; R gives it back the colour it had when play began.
 */

const ALPHAS = ['1', '0.75', '0.5', '0.25'] as const;
const PERCENT = 100;
const WHITE: Rgb = [1, 1, 1];

/** The material painted `colour`; below alpha 1 it lets light through, tinted the same. */
export function painted(m: Material, colour: Rgb, alpha: number): Material {
  const clear = alpha < 1;
  return {
    ...m,
    colors: { ...m.colors, [ColorChannel.Diffuse]: colour, ...(clear ? { [ColorChannel.Transparent]: colour } : {}) },
    colorSources: { ...m.colorSources, [ColorChannel.Diffuse]: ChannelSource.Flat },
    values: clear ? { ...m.values, [ValueChannel.Transparency]: (1 - alpha) * PERCENT } : m.values,
    valueSources: clear ? { ...m.valueSources, [ValueChannel.Transparency]: ChannelSource.Flat } : m.valueSources,
  };
}

/** The colour parts of `from` on `m`: what R puts back. */
const recoloured = (m: Material, from: Material): Material => ({
  ...m,
  colors: { ...m.colors, [ColorChannel.Diffuse]: from.colors.diffuse, [ColorChannel.Transparent]: from.colors.transparent },
  colorSources: { ...m.colorSources, [ColorChannel.Diffuse]: from.colorSources.diffuse },
  values: { ...m.values, [ValueChannel.Transparency]: from.values.transparency },
  valueSources: { ...m.valueSources, [ValueChannel.Transparency]: from.valueSources.transparency },
});

export class Colour implements Tool {
  readonly id = ToolId.Colour;
  readonly name = 'Colour';
  readonly category = ToolCategory.Render;
  readonly about = 'Recolour objects';
  readonly lines = [
    { button: ToolButton.Primary, text: 'Paint the object' },
    { button: ToolButton.Secondary, text: 'Copy its colour' },
    { button: ToolButton.Reload, text: 'Give it back its colour' },
  ];
  /** Garry's Mod starts white and opaque. */
  colour: Rgb = WHITE;
  alpha: string = ALPHAS[0];
  readonly settings: readonly ToolSetting[] = [
    { kind: SettingKind.Colours, label: 'Colour', get: () => this.colour, set: (c) => { this.colour = c; } },
    {
      kind: SettingKind.Segments, label: 'Alpha', items: ALPHAS.map((a) => ({ value: a, label: `${Number(a) * PERCENT}%` })),
      get: () => this.alpha, set: (v) => { this.alpha = v; },
    },
  ];

  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean {
    const o = hit.object;
    if (!isPaintable(o)) return false;
    if (button === ToolButton.Secondary) {
      this.colour = o.material.colors.diffuse;
      const clear = 1 - o.material.values.transparency / PERCENT;
      this.alpha = ALPHAS.reduce((best, a) => (Math.abs(Number(a) - clear) < Math.abs(Number(best) - clear) ? a : best));
      return true;
    }
    const from = ctx.edits.original(o.id)?.material;
    if (button === ToolButton.Reload && !from) return false;
    const material = from && button === ToolButton.Reload ? recoloured(o.material, from) : painted(o.material, this.colour, Number(this.alpha));
    ctx.edits.change(new Set([o.id]), `Colour ${o.name}`, (x) => ({ ...x, material }));
    return true;
  }
}

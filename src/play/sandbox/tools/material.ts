import { MATERIAL_LIBRARY, presetMaterial } from '../../../assets/materials.presets';
import { SettingKind, type ToolSetting } from '../../../ui/sandbox/tool-menu';
import { type Tool, ToolButton, ToolCategory, type ToolContext, type ToolHit, ToolId, isPaintable } from './tool';

/**
 * READ ME — Garry's Mod's Material tool with the Materials Lab's presets in place
 * of its override textures: Mouse 1 gives the object the chosen preset, Mouse 2
 * takes the object's preset into the settings, R gives it back the material it
 * had when play began. Chrome first, as Garry's Mod's env_cubemap is.
 */

const PRESETS: ReadonlySet<string> = new Set(MATERIAL_LIBRARY.flatMap((c) => c.materials.map((m) => m.name)));

export class MaterialTool implements Tool {
  readonly id = ToolId.Material;
  readonly name = 'Material';
  readonly category = ToolCategory.Render;
  readonly about = 'Change the material of an object';
  readonly lines = [
    { button: ToolButton.Primary, text: 'Apply the material' },
    { button: ToolButton.Secondary, text: 'Copy the object\'s material' },
    { button: ToolButton.Reload, text: 'Give it back its material' },
  ];
  preset = 'Chrome';
  readonly settings: readonly ToolSetting[] = [
    { kind: SettingKind.Materials, label: 'Material', get: () => this.preset, set: (name) => { this.preset = name; } },
  ];

  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean {
    const o = hit.object;
    if (!isPaintable(o)) return false;
    if (button === ToolButton.Secondary) {
      if (!PRESETS.has(o.material.name)) return false;
      this.preset = o.material.name;
      return true;
    }
    const material = button === ToolButton.Reload ? ctx.edits.original(o.id)?.material : presetMaterial(this.preset);
    if (!material || material === o.material) return false;
    ctx.edits.change(new Set([o.id]), `Material ${o.name}`, (x) => ({ ...x, material }));
    return true;
  }
}

import { MATERIAL_LIBRARY } from '../../assets/materials.presets';
import { type Rgb, hsvToRgb, rgbToHex } from '../../core/color';
import { materialPreview } from '../../render/icons';
import type { Thumbnailer } from '../../render/thumbs';
import { iconCanvas } from '../chrome/icon-canvas';
import { Choice } from '../kit/controls';
import { el } from '../kit/dom';

/**
 * READ ME — the Tool Gun's sheet of the spawn menu (Q held, docs/sandbox-mode.md
 * › Tool Gun), on the right as Garry's Mod's toolpanel.lua lays it out: the Tools
 * tab, the tools listed by category with blue headers on the left, and the
 * chosen tool's control panel on the right — its name, one line about it, then
 * its settings, built from what the tool describes. Everything is a
 * click (segments, swatches, material tiles), so the spawn menu's own cursor
 * works it while the pointer stays locked; nothing is dragged.
 */

export enum SettingKind {
  Segments = 'segments',
  Colours = 'colours',
  Materials = 'materials',
}

export interface SegmentsSetting {
  readonly kind: SettingKind.Segments;
  readonly label: string;
  readonly items: readonly { readonly value: string; readonly label: string }[];
  get(): string;
  set(value: string): void;
}

export interface ColoursSetting {
  readonly kind: SettingKind.Colours;
  readonly label: string;
  get(): Rgb;
  set(colour: Rgb): void;
}

/** The Materials Lab's presets, by name. */
export interface MaterialsSetting {
  readonly kind: SettingKind.Materials;
  readonly label: string;
  get(): string;
  set(name: string): void;
}

export type ToolSetting = SegmentsSetting | ColoursSetting | MaterialsSetting;

export interface ToolEntry {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  /** One line under the name in the control panel. */
  readonly about: string;
  readonly settings: readonly ToolSetting[];
}

const MATERIAL_PX = 40;
/** The swatches: hues across, from light to dark down, then a row of greys. */
const PALETTE = { hues: 12, shades: [[0.35, 1], [0.7, 1], [1, 1], [1, 0.7], [1, 0.45]], greys: 12 } as const;
const PICK = 'sbx-pick';

export class ToolMenu {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly settings: HTMLElement;
  private readonly title: HTMLElement;
  private readonly about: HTMLElement;
  private readonly rows = new Map<string, HTMLElement>();
  /** Each tool's settings panel, built the first time the tool is chosen. */
  private readonly panels = new Map<string, HTMLElement>();
  private readonly refreshers = new Map<string, () => void>();

  constructor(private readonly thumbs: Thumbnailer, private readonly tools: readonly ToolEntry[], private readonly pick: (id: string) => void) {
    this.list = el('div', { cls: 'gw-catlist sbx-tools-list', attrs: { role: 'listbox', 'aria-label': 'Tools' } });
    this.settings = el('div', { cls: 'sbx-tools-settings' });
    this.title = el('div', { cls: 'gw-cpanel-title' });
    this.about = el('div', { cls: 'gw-cpanel-about' });
    this.el = el('div', { cls: 'gw-sheet sbx-tools', attrs: { 'aria-label': 'Tools' } }, [
      el('div', { cls: 'gw-tabs' }, [el('div', { cls: 'gw-tab is-active', text: 'Tools' })]),
      el('div', { cls: 'gw-sheet-body sbx-tools-body' }, [
        this.list,
        el('div', { cls: 'gw-cpanel' }, [el('div', { cls: 'gw-cpanel-head' }, [this.title]), el('div', { cls: 'gw-cpanel-body' }, [this.about, this.settings])]),
      ]),
    ]);
    for (const category of [...new Set(tools.map((t) => t.category))]) {
      const items = el('div', { cls: 'gw-cat-items' });
      for (const t of tools.filter((x) => x.category === category)) {
        const row = el('div', { cls: `gw-cat-item sbx-tools-row ${PICK}`, text: t.name, attrs: { role: 'option', tabindex: '-1' } });
        row.addEventListener('click', () => this.pick(t.id));
        this.rows.set(t.id, row);
        items.append(row);
      }
      this.list.append(el('div', { cls: 'gw-cat' }, [el('div', { cls: 'gw-cat-head', text: category }), items]));
    }
  }

  /** The tool in the gun: marked in the list, its settings below, showing their values now. */
  show(id: string): void {
    for (const [key, row] of this.rows) {
      row.classList.toggle('is-current', key === id);
      row.setAttribute('aria-selected', String(key === id));
    }
    const tool = this.tools.find((t) => t.id === id);
    this.title.textContent = tool?.name ?? '';
    this.about.textContent = tool?.about ?? '';
    if (!tool) return this.settings.replaceChildren();
    let panel = this.panels.get(id);
    if (!panel) {
      panel = el('div', { cls: 'sbx-tools-panel' }, tool.settings.map((s) => this.setting(id, s)));
      this.panels.set(id, panel);
    }
    this.refreshers.get(id)?.();
    this.settings.replaceChildren(panel);
  }

  private setting(tool: string, s: ToolSetting): HTMLElement {
    const body = s.kind === SettingKind.Segments ? this.segments(tool, s) : s.kind === SettingKind.Colours ? this.colours(tool, s) : this.materials(tool, s);
    return el('div', { cls: 'sbx-tools-setting' }, [el('div', { cls: 'sbx-tools-label', text: s.label }), body]);
  }

  /** Adds to what runs when the tool's panel shows again (a value copied with Mouse 2). */
  private onShow(tool: string, refresh: () => void): void {
    const before = this.refreshers.get(tool);
    this.refreshers.set(tool, () => {
      before?.();
      refresh();
    });
  }

  private segments(tool: string, s: SegmentsSetting): HTMLElement {
    const choice = new Choice<string>({ items: s.items, value: s.get(), cls: 'segmented', onChange: (v) => s.set(v) });
    this.onShow(tool, () => choice.set(s.get()));
    return choice.el;
  }

  private colours(tool: string, s: ColoursSetting): HTMLElement {
    const chip = el('div', { cls: 'sbx-colour-now' });
    const hex = el('span', { cls: 'sbx-colour-hex' });
    const cells: { colour: Rgb; node: HTMLElement }[] = [];
    const mark = () => {
      const now = rgbToHex(s.get());
      chip.style.background = now;
      hex.textContent = now;
      for (const c of cells) c.node.classList.toggle('is-current', rgbToHex(c.colour) === now);
    };
    const grid = el('div', { cls: 'sbx-colour-grid' });
    for (const colour of palette()) {
      const node = el('div', { cls: `sbx-colour ${PICK}`, title: rgbToHex(colour), style: { background: rgbToHex(colour) } });
      node.addEventListener('click', () => {
        s.set(colour);
        mark();
      });
      cells.push({ colour, node });
      grid.append(node);
    }
    this.onShow(tool, mark);
    mark();
    return el('div', {}, [grid, el('div', { cls: 'sbx-colour-row' }, [chip, hex])]);
  }

  private materials(tool: string, s: MaterialsSetting): HTMLElement {
    const tiles: { name: string; node: HTMLElement }[] = [];
    const mark = () => {
      for (const t of tiles) t.node.classList.toggle('is-current', t.name === s.get());
    };
    const families = MATERIAL_LIBRARY.map((family) => {
      const row = el('div', { cls: 'sbx-material-row' });
      for (const m of family.materials) {
        const node = el('div', { cls: `sbx-material ${PICK}`, title: m.name, attrs: { role: 'button', tabindex: '-1', 'aria-label': m.name } }, [
          iconCanvas(this.thumbs, materialPreview(m), MATERIAL_PX),
        ]);
        node.addEventListener('click', () => {
          s.set(m.name);
          mark();
        });
        tiles.push({ name: m.name, node });
        row.append(node);
      }
      return [el('div', { cls: 'sbx-material-family', text: family.name }), row];
    });
    this.onShow(tool, mark);
    mark();
    return el('div', {}, families.flat());
  }
}

/** The colour swatches, row by row. */
function palette(): Rgb[] {
  const out: Rgb[] = [];
  for (const [s, v] of PALETTE.shades) for (let h = 0; h < PALETTE.hues; h++) out.push(hsvToRgb(h / PALETTE.hues, s, v));
  for (let g = 0; g < PALETTE.greys; g++) {
    const v = g / (PALETTE.greys - 1);
    out.push([v, v, v]);
  }
  return out;
}

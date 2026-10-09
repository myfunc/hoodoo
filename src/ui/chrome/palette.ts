import type { CreateEntry } from '../../assets/object.catalog';
import { Action } from '../../input/actions';
import { PaletteTab } from '../../world/editor-store';
import { type UiContext, hintOn } from '../context';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { HINTS, TAB_TITLES } from '../strings';
import { createTray } from './create-tray';
import { editTray } from './edit-tray';
import { SkyTray } from './sky-tray';

const TABS: readonly { tab: PaletteTab; title: string; presets: Action; hint: { title: string; text: string } }[] = [
  { tab: PaletteTab.Create, title: TAB_TITLES.create, presets: Action.ObjectLibrary, hint: HINTS.create },
  { tab: PaletteTab.Edit, title: TAB_TITLES.edit, presets: Action.MaterialLibrary, hint: HINTS.editTitle },
  { tab: PaletteTab.Sky, title: TAB_TITLES.sky, presets: Action.SkyLibrary, hint: HINTS.sky },
];

/** Bryce's palette: three embossed titles; each swaps the icon tray, its triangle opens that tab's presets. */
export class Palette {
  readonly titles: HTMLElement;
  readonly trayHost: HTMLElement;
  private readonly trays: Record<PaletteTab, HTMLElement>;
  private readonly heads = new Map<PaletteTab, HTMLElement>();

  constructor(ctx: UiContext, onCreate: (e: CreateEntry) => void) {
    this.titles = el('div', { cls: 'palette-titles' });
    for (const t of TABS) {
      const tri = glyph(GLYPH.triangleDown, GLYPH_BOX);
      tri.addEventListener('click', (e) => {
        e.stopPropagation();
        ctx.dispatch(t.presets);
      });
      const head = el('div', { cls: 'palette-title', attrs: { role: 'tab' } }, [el('span', { text: t.title }), tri]);
      head.addEventListener('click', () => ctx.editor.update({ tab: t.tab }));
      hintOn(ctx, head, t.hint);
      this.heads.set(t.tab, head);
      this.titles.append(head);
    }
    this.trays = {
      [PaletteTab.Create]: createTray(ctx, onCreate),
      [PaletteTab.Edit]: editTray(ctx),
      [PaletteTab.Sky]: new SkyTray(ctx).el,
    };
    this.trayHost = el('div', { style: { display: 'contents' } });
    ctx.editor.events.on('changed', ({ state, previous }) => {
      if (state.tab !== previous.tab) this.show(state.tab);
    });
    this.show(ctx.editor.state.tab);
  }

  private show(tab: PaletteTab): void {
    for (const [t, head] of this.heads) head.classList.toggle('is-active', t === tab);
    this.trayHost.replaceChildren(this.trays[tab]);
  }
}

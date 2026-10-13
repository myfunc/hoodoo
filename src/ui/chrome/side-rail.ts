import { SIDE_PANES, SidePane, anyPane, withPane } from '../../world/side-panes';
import { type UiContext, hintOn } from '../context';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';

interface PaneItem {
  readonly label: string;
  readonly glyph: readonly string[];
  readonly hint: string;
}

const ITEMS: Readonly<Record<SidePane, PaneItem>> = {
  [SidePane.Attributes]: { label: 'Attributes', glyph: GLYPH.move, hint: 'Place, size, turn' },
  [SidePane.Scene]: { label: 'Scene', glyph: GLYPH.cube, hint: 'Objects and groups' },
  [SidePane.Snapshots]: { label: 'Snapshots', glyph: GLYPH.camera, hint: 'Pictures to compare' },
  [SidePane.History]: { label: 'History', glyph: GLYPH.undo, hint: 'Undo along a slider' },
};

/**
 * The rail on the right edge, the left rail's twin: a named button per panel of the
 * right column. A lit button is on view; a click shows or hides its panel, and with
 * the column hidden (Tab) brings it back with that panel on.
 */
export class SideRail {
  readonly el: HTMLElement;
  private readonly buttons = new Map<SidePane, HTMLElement>();

  constructor(private readonly ctx: UiContext) {
    this.el = el('nav', { cls: 'tool-rail side-rail', attrs: { 'aria-label': 'Scene panels' } });
    for (const pane of SIDE_PANES) {
      const item = ITEMS[pane];
      const node = el('button', { cls: 'rail-button', title: `${item.label}: ${item.hint}`, attrs: { type: 'button', 'aria-label': item.label } }, [
        glyph(item.glyph, GLYPH_BOX),
        el('span', { cls: 'rail-label', text: item.label }),
      ]);
      node.addEventListener('click', () => this.press(pane));
      hintOn(ctx, node, { title: item.label, text: item.hint });
      this.buttons.set(pane, node);
      this.el.append(node);
    }
    ctx.editor.events.on('changed', ({ state, previous }) => {
      if (state.sidePanes !== previous.sidePanes || state.sidePanel !== previous.sidePanel) this.sync();
    });
    this.sync();
  }

  private press(pane: SidePane): void {
    const e = this.ctx.editor;
    const { sidePanel, sidePanes } = e.state;
    if (!sidePanel || !anyPane(sidePanes)) e.update({ sidePanel: true, maximized: false, sidePanes: withPane(sidePanes, pane, true) });
    else e.update({ sidePanes: withPane(sidePanes, pane, !sidePanes[pane]) });
  }

  private sync(): void {
    const { sidePanel, sidePanes } = this.ctx.editor.state;
    for (const [pane, node] of this.buttons) {
      const on = sidePanel && sidePanes[pane];
      node.classList.toggle('is-on', on);
      node.setAttribute('aria-pressed', String(on));
    }
  }
}

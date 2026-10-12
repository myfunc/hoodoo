import { Action } from '../../input/actions';
import { ToolId } from '../../world/tool-places';
import { type UiContext, hintOn } from '../context';
import { actionShown } from '../feature-gate';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { ToolShown, type ToolWindows } from './tool-windows';
import './tool-rail.css';

/**
 * The tool rail: a column of named buttons on the left edge that opens and closes
 * every panel and window, so none of them hides in a menu. A lit button is on
 * view; a dim lamp marks a docked window open behind the one on view. The camera
 * Controls fold away with theirs, Render and the tool windows open where they
 * live (docked or floating), and a feature's button shows only while it is on.
 */

interface RailItem {
  readonly label: string;
  readonly glyph: readonly string[];
  readonly hint: string;
  /** A tool window it opens and closes; none for the camera Controls and plain commands. */
  readonly tool?: ToolId;
  /** A command it runs instead (a dialog); its feature gates the button. */
  readonly action?: Action;
  /** Shown only while this action exists (its preview feature is on). */
  readonly gate?: Action;
}

const CONTROLS: RailItem = { label: 'Controls', glyph: GLYPH.trackball, hint: 'Camera and render balls' };

const ITEMS: readonly RailItem[] = [
  { label: 'Render', glyph: GLYPH.picture, hint: 'Live, Render View, final', tool: ToolId.RenderOptions },
  { label: 'Object', glyph: GLYPH.sliders, hint: 'Attributes: place, size, turn', tool: ToolId.Attributes },
  { label: 'Materials', glyph: GLYPH.ball, hint: 'Materials Lab', tool: ToolId.Materials },
  { label: 'Terrain', glyph: GLYPH.mountain, hint: 'Terrain Editor', tool: ToolId.Terrain },
  { label: 'Portals', glyph: GLYPH.portal, hint: 'Portals and triggers', tool: ToolId.PortalsTriggers, gate: Action.PortalsTriggers },
  { label: 'Cloud', glyph: GLYPH.cloud, hint: 'Gallery and cloud scenes', action: Action.CloudGallery, gate: Action.CloudGallery },
  { label: 'Tutorials', glyph: GLYPH.book, hint: 'Step-by-step recipes', tool: ToolId.TutorialBook },
  { label: 'Preview', glyph: GLYPH.flask, hint: 'Features to try', tool: ToolId.PreviewFeatures },
];

export class ToolRail {
  readonly el: HTMLElement;
  private readonly buttons: { item: RailItem; node: HTMLElement }[] = [];

  constructor(private readonly ctx: UiContext, private readonly windows: ToolWindows) {
    this.el = el('nav', { cls: 'tool-rail', attrs: { 'aria-label': 'Panels' } });
    for (const item of [CONTROLS, ...ITEMS]) {
      const node = el('button', { cls: 'rail-button', title: `${item.label}: ${item.hint}`, attrs: { type: 'button', 'aria-label': item.label } }, [
        glyph(item.glyph, GLYPH_BOX),
        el('span', { cls: 'rail-label', text: item.label }),
        el('span', { cls: 'rail-lamp' }),
      ]);
      node.addEventListener('click', () => this.press(item));
      hintOn(ctx, node, { title: item.label, text: item.hint });
      this.buttons.push({ item, node });
      this.el.append(node);
    }
    windows.watch(() => this.sync());
    ctx.editor.events.on('changed', ({ state, previous }) => {
      if (state.controlsOpen !== previous.controlsOpen || state.features !== previous.features || state.leftPanel !== previous.leftPanel) this.sync();
    });
    this.sync();
  }

  private press(item: RailItem): void {
    const e = this.ctx.editor;
    if (item === CONTROLS) {
      // Hidden panel: the button brings it back with the controls on view.
      e.update(e.state.leftPanel ? { controlsOpen: !e.state.controlsOpen } : { leftPanel: true, controlsOpen: true });
    } else if (item.tool) {
      if (!e.state.leftPanel && this.windows.shown(item.tool) !== ToolShown.Floating && this.windows.isOpen(item.tool)) e.update({ leftPanel: true });
      else this.windows.toggle(item.tool);
    } else if (item.action) this.ctx.dispatch(item.action);
  }

  private sync(): void {
    const s = this.ctx.editor.state;
    for (const { item, node } of this.buttons) {
      node.hidden = item.gate !== undefined && !actionShown(s.features, item.gate);
      const shown = item === CONTROLS ? (s.controlsOpen && s.leftPanel ? ToolShown.Docked : ToolShown.Closed) : item.tool ? this.windows.shown(item.tool) : ToolShown.Closed;
      // A docked page counts as on view only while the panel is.
      const onView = shown === ToolShown.Floating || (shown === ToolShown.Docked && s.leftPanel);
      node.classList.toggle('is-on', onView);
      node.classList.toggle('is-behind', !onView && shown !== ToolShown.Closed);
      node.setAttribute('aria-pressed', String(onView));
    }
  }
}

import { KEY, TEXT_TAGS } from '../../core/keys';
import { ToolId, floatSpot, isDocked, reopened, withDocked, withOpen, withSpot } from '../../world/tool-places';
import { type UiContext, hintOn } from '../context';
import { Choice } from '../kit/controls';
import { isModalOpen } from '../kit/dialog';
import { clearChildren, el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { type ToolContent, ToolWindow } from '../kit/tool-window';
import { AttributesTool } from '../labs/attributes-dialog';
import { MaterialsLab } from '../labs/materials-lab';
import { TerrainEditor } from '../labs/terrain-editor';
import { RenderOptionsTool } from '../labs/render-options';
import { PreviewFeaturesTool } from '../labs/preview-window';
import './dock.css';

/** Floating windows stack above the scene and below the modal veil (z-index 500). */
const FLOAT_Z = 450;
/** Pop-ups that take Esc for themselves. */
const POPUPS = '.ui-menu, .ui-picker, .mm';
const ORDER: readonly ToolId[] = [ToolId.RenderOptions, ToolId.Attributes, ToolId.Materials, ToolId.Terrain, ToolId.PreviewFeatures];

const BUILD: Readonly<Record<ToolId, (ctx: UiContext) => ToolContent>> = {
  [ToolId.Attributes]: (ctx) => new AttributesTool(ctx),
  [ToolId.Materials]: (ctx) => new MaterialsLab(ctx),
  [ToolId.Terrain]: (ctx) => new TerrainEditor(ctx),
  [ToolId.RenderOptions]: (ctx) => new RenderOptionsTool(ctx),
  [ToolId.PreviewFeatures]: (ctx) => new PreviewFeaturesTool(ctx),
};

interface Entry {
  readonly content: ToolContent;
  readonly win: ToolWindow;
  open: boolean;
}

const registry = new WeakMap<UiContext, ToolWindows>();

/** The tool windows of an app, one set per context: the shell mounts their dock, the commands open them. */
export function toolWindows(ctx: UiContext): ToolWindows {
  let windows = registry.get(ctx);
  if (!windows) {
    windows = new ToolWindows(ctx);
    registry.set(ctx, windows);
  }
  return windows;
}

/**
 * READ ME — the left panel and the tool windows. The panel stacks Bryce's
 * camera controls (a heading folds them away, remembered as `controlsOpen`)
 * over the docked windows, with the hint line at its foot. Render, Object
 * Attributes, the Materials Lab and the Terrain Editor are windows that leave
 * the scene usable: each opens where it lived last (EditorState.toolPlaces,
 * remembered in prefs), floating over the scene or docked in the panel, where a
 * tab strip switches between them when there are several. Render starts docked.
 * Esc closes the front floating window.
 */
export class ToolWindows {
  /** The left panel: the camera controls, the docked windows under them, the hint line at the foot. */
  readonly column: HTMLElement;
  /** The dock got its first window or lost its last: the column widens or narrows. */
  onDock: (docked: boolean) => void = () => undefined;
  private readonly tabs: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly dock: HTMLElement;
  private readonly entries = new Map<ToolId, Entry>();
  /** Floating windows, the front one last. */
  private stack: ToolId[] = [];
  private active: ToolId | null = null;

  constructor(private readonly ctx: UiContext) {
    this.tabs = el('div', { cls: 'dock-tabs' });
    this.pages = el('div', { cls: 'dock-pages' });
    this.dock = el('div', { cls: 'dock-section' }, [this.tabs, this.pages]);
    this.controls = el('section', { cls: 'controls-section' }, [this.foldHead()]);
    this.column = el('div', { cls: 'left-column' }, [this.controls, this.dock]);
    ctx.editor.events.on('changed', ({ state, previous }) => {
      if (state.toolPlaces !== previous.toolPlaces) this.settle();
      if (state.controlsOpen !== previous.controlsOpen) this.fold();
    });
    this.fold();
    window.addEventListener('keydown', (e) => this.escape(e), true);
    window.addEventListener('resize', () => { for (const id of this.stack) this.keepOnPage(id); });
  }

  /** The control panel at the top and its hint line at the foot. The windows docked open last time come back. */
  mountControls(node: HTMLElement, foot: HTMLElement): void {
    this.controls.append(node);
    this.column.append(foot);
    this.layout();
    for (const id of reopened(this.ctx.editor.state.toolPlaces, ORDER)) this.open(id, false);
  }

  /** The heading over the camera controls: a click folds them away or opens them again. */
  private foldHead(): HTMLElement {
    const head = el('button', { cls: 'controls-head', attrs: { type: 'button' } }, [glyph(GLYPH.triangleDown, GLYPH_BOX), el('span', { text: 'Controls' })]);
    head.addEventListener('click', () => this.ctx.editor.update({ controlsOpen: !this.ctx.editor.state.controlsOpen }));
    hintOn(this.ctx, head, { title: 'Controls', text: 'Fold the camera controls: room for the panels' });
    return head;
  }

  private fold(): void {
    const open = this.ctx.editor.state.controlsOpen;
    this.controls.classList.toggle('is-folded', !open);
    this.controls.firstElementChild?.setAttribute('aria-expanded', String(open));
  }

  isOpen(id: ToolId): boolean {
    return this.entries.get(id)?.open ?? false;
  }

  /** Opens a window where it lives, or brings it forward when it is open already; a docked one shows the left panel unless `reveal` is off. */
  open(id: ToolId, reveal = true): void {
    const entry = this.entry(id);
    if (!entry.open) {
      entry.open = true;
      entry.content.start((text) => { entry.win.subjectText = text; });
    }
    this.place(id, entry, reveal);
    this.remember(id, true);
  }

  close(id: ToolId): void {
    const entry = this.entries.get(id);
    if (!entry?.open) return;
    entry.open = false;
    entry.content.stop();
    entry.win.el.remove();
    this.stack = this.stack.filter((x) => x !== id);
    this.layout();
    this.remember(id, false);
  }

  private remember(id: ToolId, open: boolean): void {
    const places = this.ctx.editor.state.toolPlaces;
    const next = withOpen(places, id, open);
    if (next !== places) this.ctx.editor.update({ toolPlaces: next });
  }

  /** Docks a floating window or floats a docked one, and remembers it. */
  toggleDock(id: ToolId): void {
    const places = this.ctx.editor.state.toolPlaces;
    this.ctx.editor.update({ toolPlaces: withDocked(places, id, !isDocked(places, id)) });
  }

  private entry(id: ToolId): Entry {
    const known = this.entries.get(id);
    if (known) return known;
    const content = BUILD[id](this.ctx);
    const win = new ToolWindow({
      title: content.title,
      style: content.style,
      body: content.body,
      cls: content.cls,
      onDockToggle: () => this.toggleDock(id),
      onClose: () => this.close(id),
      onMove: (x, y, done) => this.moveTo(id, x, y, done),
      onFocus: () => this.front(id),
    });
    const entry: Entry = { content, win, open: false };
    this.entries.set(id, entry);
    return entry;
  }

  /** The remembered places changed (dock, float, Settings › Reset): open windows move to theirs. */
  private settle(): void {
    for (const [id, entry] of this.entries) {
      if (entry.open && entry.win.isDocked !== isDocked(this.ctx.editor.state.toolPlaces, id)) this.place(id, entry);
    }
  }

  private place(id: ToolId, entry: Entry, reveal = true): void {
    const { win } = entry;
    if (isDocked(this.ctx.editor.state.toolPlaces, id)) {
      this.stack = this.stack.filter((x) => x !== id);
      win.setDocked(true);
      win.el.style.cssText = '';
      if (win.el.parentElement !== this.pages) this.pages.append(win.el);
      this.active = id;
      if (reveal && (!this.ctx.editor.state.leftPanel || this.ctx.editor.state.maximized)) this.ctx.editor.update({ leftPanel: true, maximized: false });
    } else {
      const arriving = win.isDocked || !win.el.isConnected;
      win.setDocked(false);
      win.el.hidden = false;
      if (arriving) {
        document.body.append(win.el);
        this.spot(id);
      }
      this.front(id);
    }
    this.layout();
  }

  /** A window coming to float opens where it was left, or centred the first time. */
  private spot(id: ToolId): void {
    const node = this.entries.get(id)?.win.el;
    if (!node) return;
    node.classList.add('is-placing');
    const p = floatSpot(this.ctx.editor.state.toolPlaces[id], node.getBoundingClientRect(), this.page(), this.top());
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    node.classList.remove('is-placing');
  }

  private moveTo(id: ToolId, x: number, y: number, done: boolean): void {
    const node = this.entries.get(id)?.win.el;
    if (!node) return;
    const p = floatSpot({ docked: false, x, y }, node.getBoundingClientRect(), this.page(), this.top());
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    if (done) this.ctx.editor.update({ toolPlaces: withSpot(this.ctx.editor.state.toolPlaces, id, p.x, p.y) });
  }

  private keepOnPage(id: ToolId): void {
    const node = this.entries.get(id)?.win.el;
    if (!node) return;
    const r = node.getBoundingClientRect();
    this.moveTo(id, r.left, r.top, false);
  }

  private page(): { width: number; height: number } {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  /** Floating windows stay below the menu bar. */
  private top(): number {
    return document.querySelector('.menubar')?.getBoundingClientRect().bottom ?? 0;
  }

  private front(id: ToolId): void {
    if (!this.stack.includes(id) && this.entries.get(id)?.win.isDocked) return;
    this.stack = [...this.stack.filter((x) => x !== id), id];
    this.stack.forEach((x, i) => {
      const node = this.entries.get(x)?.win.el;
      if (node) node.style.zIndex = String(FLOAT_Z + i);
    });
  }

  /** The tab strip names the docked windows; one page shows at a time. */
  private layout(): void {
    const docked = ORDER.filter((id) => {
      const e = this.entries.get(id);
      return e?.open && e.win.isDocked;
    });
    if (this.active === null || !docked.includes(this.active)) this.active = docked.at(-1) ?? null;
    clearChildren(this.tabs);
    // One docked window needs no tabs: its own title bar names it.
    this.tabs.hidden = docked.length < 2;
    this.dock.hidden = !docked.length;
    if (docked.length > 1 && this.active) {
      const items = docked.map((id) => ({ value: id, label: this.entries.get(id)?.content.tab ?? id, title: this.entries.get(id)?.content.title }));
      this.tabs.append(new Choice<ToolId>({ cls: 'segmented', items, value: this.active, onChange: (t) => { this.active = t; this.show(docked); } }).el);
    }
    this.show(docked);
    this.onDock(docked.length > 0);
  }

  private show(docked: readonly ToolId[]): void {
    for (const id of docked) {
      const node = this.entries.get(id)?.win.el;
      if (node) node.hidden = id !== this.active;
    }
  }

  private escape(e: KeyboardEvent): void {
    const front = this.stack.at(-1);
    if (e.key !== KEY.Escape || !front || isModalOpen()) return;
    const target = e.target as HTMLElement | null;
    const s = this.ctx.editor.state;
    if ((target && TEXT_TAGS.has(target.tagName)) || s.playing || s.pickingFocus || this.ctx.snapshots.compared || document.querySelector(POPUPS)) return;
    e.preventDefault();
    e.stopPropagation();
    this.close(front);
  }
}

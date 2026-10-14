import type { IconSpec } from '../../render/icons';
import type { Thumbnailer } from '../../render/thumbs';
import { iconCanvas } from '../chrome/icon-canvas';
import { el } from '../kit/dom';

/**
 * READ ME — Sandbox's spawn menu (Q held, docs/sandbox-mode.md), laid out as
 * Garry's Mod's (gamemodes/sandbox spawnmenu.lua): over the picture with
 * margins, the creation sheet on the left — its Spawnlists tab with the lists
 * as a tree and the ray-traced icons of the chosen one (drawn the first time it
 * shows, so play keeps the GPU until then), how many objects the tracer holds at
 * the foot — and the tool sheet docked on the right (tool-menu.ts). Its skin is
 * GWEN's default (sandbox.css). A click asks Sandbox to spawn; clicks never
 * reach the play layer under it. The pointer stays locked while
 * it is open (a lock asked back on letting go of Q is refused once the key press
 * is a few seconds old): the mouse moves a cursor of its own, which hovers and
 * clicks what is under it, and the wheel scrolls what it is over. Unlocked, the
 * system pointer works.
 */

export interface SpawnTile {
  /** Takes the item out of its list (the player's own items); a small cross on the tile. */
  readonly remove?: () => void;
  readonly key: string;
  readonly name: string;
  /** Hoodoo's own icon, ray traced; or `picture`, a ready one (the game's props), fetched when the tile first shows. */
  readonly icon?: () => IconSpec;
  readonly picture?: () => Promise<HTMLCanvasElement | null>;
  /** A title over the tiles that follow it (a spawnlist's header), not a tile. */
  readonly header?: boolean;
}

export interface SpawnList {
  /** What an empty list says instead of icons. */
  readonly empty?: string;
  readonly name: string;
  readonly tiles: readonly SpawnTile[];
  /** How deep in the tree it sits (Garry's Mod's nested spawnlists); 0 at the top. */
  readonly depth?: number;
}

const ICON_PX = 72;
/** A nested spawnlist's step in, pixels. */
const TREE_INDENT = 14;
/** Where a top-level list sits (the tree's leaf margin, sandbox.css). */
const TREE_BASE = 18;
const HOVERED = 'is-hover';
/** What the cursor hovers and clicks: tiles, categories, the tools' rows, swatches and segments. */
const PICKABLE = '.sbx-spawn-tile, .sbx-spawn-cat, .sbx-pick, .ui-toggle, .gw-tab';
const HINT = 'Click spawns where you aim · let go of Q to aim again';
const SPAWNLISTS = 'Spawnlists';
const YOUR_LISTS = 'Your Spawnlists';

export class SpawnMenu {
  readonly el: HTMLElement;
  /** The menu's own cursor: a sibling of the menu in the play layer, placed in the layer's pixels. */
  readonly cursor: HTMLElement;
  private readonly cats: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly count: HTMLElement;
  /** Where the tool sheet docks, on the right, and the context menu's History, on the left. */
  private readonly side: HTMLElement;
  private readonly left: HTMLElement;
  /** The creation sheet's tabs (Spawnlists, Sky…) and what each shows, built the first time it opens. */
  private readonly tabs: HTMLElement;
  private readonly body: HTMLElement;
  private readonly sheets = new Map<string, { tab: HTMLElement; build: () => HTMLElement; page: HTMLElement | null }>();
  private readonly pages = new Map<string, HTMLElement>();
  /** The menu's panel and the ones that open with it. */
  private readonly panels: HTMLElement[] = [];
  private current = '';
  private readonly seen: IntersectionObserver;
  /** The game's spawnlists, under their own node, while its files are read. */
  private gameNode: HTMLElement | null = null;
  private gameNames = new Set<string>();
  /** The cursor's place on the page (client pixels) and what it is over. */
  private at: [number, number] = [0, 0];
  private hovered: HTMLElement | null = null;

  constructor(private readonly thumbs: Thumbnailer, private lists: readonly SpawnList[], private readonly spawn: (key: string) => void) {
    this.cats = el('div', { cls: 'gw-tree sbx-spawn-cats', attrs: { role: 'tree', 'aria-label': 'Spawn lists' } }, [
      el('div', { cls: 'gw-tree-node is-open', text: YOUR_LISTS }),
    ]);
    this.grid = el('div', { cls: 'gw-content sbx-spawn-grid' });
    this.count = el('div', { cls: 'sbx-spawn-count' });
    this.side = el('div', { cls: 'sbx-q-side' });
    this.left = el('div', { cls: 'sbx-q-left' });
    this.tabs = el('div', { cls: 'gw-tabs' }, [el('span', { cls: 'sbx-spawn-hint', text: HINT })]);
    this.body = el('div', { cls: 'gw-sheet-body sbx-spawn-body' });
    const create = el('div', { cls: 'gw-sheet sbx-spawn', attrs: { 'aria-label': 'Spawn menu' } }, [this.tabs, this.body]);
    this.addTab(SPAWNLISTS, () => el('div', { cls: 'sbx-spawn-lists' }, [this.cats, el('div', { cls: 'sbx-spawn-right' }, [this.grid, this.count])]));
    this.el = el('div', { cls: 'sbx-q' }, [this.left, create, this.side]);
    this.cursor = el('div', { cls: 'sbx-cursor', attrs: { 'aria-hidden': 'true' } });
    this.cursor.hidden = true;
    this.addPanel(this.el);
    // The game's props' pictures are fetched when their tiles come into view.
    this.seen = new IntersectionObserver((seen) => {
      for (const e of seen) {
        if (!e.isIntersecting) continue;
        this.seen.unobserve(e.target);
        (e.target as HTMLElement & { fetch?: () => void }).fetch?.();
      }
    }, { root: this.grid });
    for (const list of lists) this.cats.append(this.row(list));
    if (lists.length) this.show(lists[0].name);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** A tab of the creation sheet; the first one added shows first. Its page is built when it first opens. */
  addTab(name: string, build: () => HTMLElement): void {
    const tab = el('div', { cls: 'gw-tab', text: name, attrs: { role: 'tab', tabindex: '-1' } });
    tab.addEventListener('click', () => this.openTab(name));
    this.tabs.insertBefore(tab, this.tabs.lastElementChild);
    this.sheets.set(name, { tab, build, page: null });
    if (this.sheets.size === 1) this.openTab(name);
  }

  private openTab(name: string): void {
    const sheet = this.sheets.get(name);
    if (!sheet) return;
    sheet.page ??= sheet.build();
    for (const [n, s] of this.sheets) s.tab.classList.toggle('is-active', n === name);
    this.body.replaceChildren(sheet.page);
  }

  /** The tool sheet, docked on the right inside the menu. */
  dock(panel: HTMLElement): void {
    this.side.append(panel);
  }

  /** A sheet on the left that shows only in the context menu (C). */
  dockLeft(panel: HTMLElement): void {
    this.left.append(panel);
  }

  /** A panel that opens and closes with the menu and keeps its clicks from the play layer, which would lock the pointer. */
  addPanel(panel: HTMLElement): void {
    panel.hidden = !this.panels.length || !this.open;
    for (const type of ['click', 'mousedown', 'pointerdown', 'contextmenu'] as const) {
      panel.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'contextmenu') e.preventDefault();
      });
    }
    this.panels.push(panel);
  }

  /**
   * Opens or closes the menu. `context`: Garry's Mod's context menu (C) — only
   * the chosen tool's panel, on the right, the world in view.
   */
  setOpen(open: boolean, context = false): void {
    this.el.classList.toggle('is-context', open && context);
    for (const p of this.panels) p.hidden = !open;
    this.cursor.hidden = true;
    this.hover(null);
    if (!open) return;
    this.page(this.current);
    // Garry's Mod opens the menu with the cursor where the crosshair was.
    const r = this.el.parentElement?.getBoundingClientRect();
    if (r) this.at = [r.left + r.width / 2, r.top + r.height / 2];
  }

  /** The real pointer works the menu (the context menu pinned open): the own cursor hides. */
  hideCursor(): void {
    this.cursor.hidden = true;
    this.hover(null);
  }

  /** Locked mouse motion moves the menu's own cursor (shown from the first move). */
  moveCursor(dx: number, dy: number): void {
    const r = this.el.parentElement?.getBoundingClientRect();
    if (!r) return;
    this.at = [Math.min(r.right - 1, Math.max(r.left, this.at[0] + dx)), Math.min(r.bottom - 1, Math.max(r.top, this.at[1] + dy))];
    this.cursor.hidden = false;
    this.cursor.style.transform = `translate(${this.at[0] - r.left}px, ${this.at[1] - r.top}px)`;
    this.hover(this.under());
  }

  /** The locked mouse's button: a click on what the cursor is over. */
  clickAtCursor(): boolean {
    const target = this.cursor.hidden ? null : this.under();
    target?.click();
    return !!target;
  }

  /** Where the menu's own cursor is (client pixels), or null while it is hidden. */
  cursorPoint(): [number, number] | null {
    return this.cursor.hidden ? null : [this.at[0], this.at[1]];
  }

  /** The menu is the context menu (C). */
  get isContext(): boolean {
    return this.el.classList.contains('is-context');
  }

  /** Whether a click's target is one of the menu's own panels. */
  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.panels.some((p) => p.contains(target));
  }

  /** The locked mouse's wheel scrolls what the cursor is over (the icons when it is hidden). */
  scroll(dy: number): void {
    let node = this.cursor.hidden ? null : document.elementFromPoint(this.at[0], this.at[1]);
    while (node && !(node instanceof HTMLElement && node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY !== 'visible')) node = node.parentElement;
    (node instanceof HTMLElement && this.panels.some((p) => p.contains(node)) ? node : this.grid).scrollTop += dy;
  }

  private under(): HTMLElement | null {
    return document.elementFromPoint(this.at[0], this.at[1])?.closest<HTMLElement>(PICKABLE) ?? null;
  }

  private hover(target: HTMLElement | null): void {
    if (target === this.hovered) return;
    this.hovered?.classList.remove(HOVERED);
    target?.classList.add(HOVERED);
    this.hovered = target;
  }

  /** How many objects the tracer draws, of how many it can. */
  setCount(objects: number, limit: number): void {
    this.count.textContent = `${objects} / ${limit} objects`;
    this.count.classList.toggle('is-full', objects >= limit);
  }

  /** Garry's Mod's own spawnlists (null: none, its files forgotten), in a node of their own under Hoodoo's. */
  setGameLists(title: string, lists: readonly SpawnList[] | null): void {
    this.gameNode?.remove();
    for (const n of this.gameNames) this.pages.delete(n);
    this.lists = this.lists.filter((l) => !this.gameNames.has(l.name));
    this.gameNames = new Set(lists?.map((l) => l.name) ?? []);
    this.gameNode = null;
    if (!lists?.length) return;
    this.lists = [...this.lists, ...lists];
    this.gameNode = el('div', {}, [el('div', { cls: 'gw-tree-node is-open', text: title }), ...lists.map((l) => this.row(l))]);
    this.cats.append(this.gameNode);
  }

  private row(list: SpawnList): HTMLElement {
    const row = el('div', { cls: 'gw-tree-leaf sbx-spawn-cat', text: list.name, attrs: { role: 'treeitem', tabindex: '-1', 'data-list': list.name } });
    if (list.depth) row.style.marginLeft = `${TREE_BASE + TREE_INDENT * list.depth}px`;
    row.addEventListener('click', () => this.show(list.name));
    return row;
  }

  private show(name: string): void {
    this.current = name;
    this.cats.querySelectorAll<HTMLElement>('.sbx-spawn-cat').forEach((row) => {
      const on = row.dataset.list === name;
      row.classList.toggle('is-current', on);
      row.setAttribute('aria-selected', String(on));
    });
    if (this.open) this.page(name);
  }

  /** The category's tiles, drawn the first time it shows. */
  private page(name: string): void {
    let page = this.pages.get(name);
    if (!page) {
      const list = this.lists.find((l) => l.name === name);
      page = list && !list.tiles.length && list.empty
        ? el('div', { cls: 'sbx-spawn-empty', text: list.empty })
        : el('div', { cls: 'sbx-spawn-page' }, (list?.tiles ?? []).map((t) => this.tile(t)));
      this.pages.set(name, page);
    }
    this.grid.replaceChildren(page);
  }

  private tile(t: SpawnTile): HTMLElement {
    if (t.header) return el('div', { cls: 'sbx-spawn-header', text: t.name });
    const picture = t.icon ? iconCanvas(this.thumbs, t.icon(), ICON_PX) : el('canvas', { cls: 'sbx-spawn-picture' });
    const tile = el('div', { cls: 'sbx-spawn-tile', title: t.name, attrs: { role: 'button', tabindex: '-1', 'aria-label': `Spawn ${t.name}` } }, [
      picture,
      el('span', { cls: 'sbx-spawn-name', text: t.name }),
    ]);
    if (t.picture) {
      const fetchPicture = t.picture;
      Object.assign(tile, {
        fetch: () => void fetchPicture().then((c) => {
          if (!c) return;
          const canvas = picture as HTMLCanvasElement;
          canvas.width = c.width;
          canvas.height = c.height;
          canvas.getContext('2d')?.drawImage(c, 0, 0);
        }),
      });
      this.seen.observe(tile);
    }
    tile.addEventListener('click', () => this.spawn(t.key));
    if (t.remove) {
      const cross = el('div', { cls: 'sbx-spawn-remove sbx-pick', text: '×', title: `Take ${t.name} out of the list` });
      cross.addEventListener('click', (e) => {
        e.stopPropagation();
        t.remove?.();
      });
      tile.append(cross);
    }
    return tile;
  }

  /** A list's items changed (the player saved or removed one): its page is drawn again when shown. */
  setList(list: SpawnList): void {
    this.lists = this.lists.map((l) => (l.name === list.name ? list : l));
    this.pages.delete(list.name);
    if (this.current === list.name && this.open) this.page(list.name);
  }
}

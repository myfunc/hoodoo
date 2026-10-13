import type { IconSpec } from '../../render/icons';
import type { Thumbnailer } from '../../render/thumbs';
import { iconCanvas } from '../chrome/icon-canvas';
import { el } from '../kit/dom';

/**
 * READ ME — Sandbox's spawn menu (Q held, docs/sandbox-mode.md): Garry's Mod's
 * spawn lists over the picture. Categories on the left, ray-traced icons of the
 * category on the right (drawn the first time it shows, so play keeps the GPU
 * until then), and how many objects the tracer holds at the foot. A click asks
 * Sandbox to spawn; clicks never reach the play layer under it. The pointer stays
 * locked while it is open (a lock asked back on letting go of Q is refused once
 * the key press is a few seconds old): the mouse moves a cursor of its own,
 * which hovers and clicks what is under it. Unlocked, the system pointer works.
 */

export interface SpawnTile {
  readonly key: string;
  readonly name: string;
  readonly icon: () => IconSpec;
}

export interface SpawnList {
  readonly name: string;
  readonly tiles: readonly SpawnTile[];
}

const ICON_PX = 72;
const HOVERED = 'is-hover';
const PICKABLE = '.sbx-spawn-tile, .sbx-spawn-cat';
const HINT = 'Click spawns where you aim · let go of Q to aim again';

export class SpawnMenu {
  readonly el: HTMLElement;
  /** The menu's own cursor: a sibling of the menu in the play layer, placed in the layer's pixels. */
  readonly cursor: HTMLElement;
  private readonly cats: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly count: HTMLElement;
  private readonly pages = new Map<string, HTMLElement>();
  private current = '';
  /** The cursor's place on the page (client pixels) and what it is over. */
  private at: [number, number] = [0, 0];
  private hovered: HTMLElement | null = null;

  constructor(private readonly thumbs: Thumbnailer, private readonly lists: readonly SpawnList[], private readonly spawn: (key: string) => void) {
    this.cats = el('div', { cls: 'sbx-spawn-cats', attrs: { role: 'listbox', 'aria-label': 'Spawn lists' } });
    this.grid = el('div', { cls: 'sbx-spawn-grid' });
    this.count = el('div', { cls: 'sbx-spawn-count' });
    this.el = el('div', { cls: 'sbx-spawn', attrs: { 'aria-label': 'Spawn menu' } }, [
      el('div', { cls: 'sbx-spawn-head' }, [el('span', { cls: 'sbx-spawn-title', text: 'Spawn' }), el('span', { cls: 'sbx-spawn-hint', text: HINT })]),
      el('div', { cls: 'sbx-spawn-body' }, [this.cats, this.grid]),
      this.count,
    ]);
    this.cursor = el('div', { cls: 'sbx-cursor', attrs: { 'aria-hidden': 'true' } });
    this.cursor.hidden = true;
    this.el.hidden = true;
    // The play layer under the menu locks the pointer on a click: the menu keeps its clicks.
    for (const type of ['click', 'mousedown', 'pointerdown', 'contextmenu'] as const) {
      this.el.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'contextmenu') e.preventDefault();
      });
    }
    for (const list of lists) {
      const row = el('div', { cls: 'sbx-spawn-cat', text: list.name, attrs: { role: 'option', tabindex: '-1' } });
      row.addEventListener('click', () => this.show(list.name));
      this.cats.append(row);
    }
    if (lists.length) this.show(lists[0].name);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  setOpen(open: boolean): void {
    this.el.hidden = !open;
    this.cursor.hidden = true;
    this.hover(null);
    if (!open) return;
    this.page(this.current);
    // Garry's Mod opens the menu with the cursor where the crosshair was.
    const r = this.el.parentElement?.getBoundingClientRect();
    if (r) this.at = [r.left + r.width / 2, r.top + r.height / 2];
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
  clickAtCursor(): void {
    if (!this.cursor.hidden) this.under()?.click();
  }

  /** The locked mouse's wheel scrolls the icons. */
  scroll(dy: number): void {
    this.grid.scrollTop += dy;
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

  private show(name: string): void {
    this.current = name;
    this.cats.querySelectorAll<HTMLElement>('.sbx-spawn-cat').forEach((row) => {
      const on = row.textContent === name;
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
      page = el('div', { cls: 'sbx-spawn-page' }, (list?.tiles ?? []).map((t) => this.tile(t)));
      this.pages.set(name, page);
    }
    this.grid.replaceChildren(page);
  }

  private tile(t: SpawnTile): HTMLElement {
    const tile = el('div', { cls: 'sbx-spawn-tile', title: t.name, attrs: { role: 'button', tabindex: '-1', 'aria-label': `Spawn ${t.name}` } }, [
      iconCanvas(this.thumbs, t.icon(), ICON_PX),
      el('span', { cls: 'sbx-spawn-name', text: t.name }),
    ]);
    tile.addEventListener('click', () => this.spawn(t.key));
    return tile;
  }
}

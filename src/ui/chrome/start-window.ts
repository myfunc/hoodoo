import { KEY } from '../../core/keys';
import { defaultPrefs } from '../../io/prefs';
import type { RecentScene } from '../../io/recent-scenes';
import { type ExampleList, arrangeExamples, hideExample, moveExample, sameList, showExample } from '../../world/example-list';
import type { Example } from '../../world/examples';
import { EXAMPLES, examplesFor } from '../../world/examples';
import type { FeatureFlags } from '../../world/preview-features';
import { Button, Toggle } from '../kit/controls';
import { holdModal } from '../kit/dialog';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { APP_VERSION, CORRIDOR, START } from '../strings';

const THUMBS = import.meta.glob('../art/examples/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const thumbOf = (id: string): string | undefined => THUMBS[`../art/examples/${id}.jpg`];

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const DATE_FORMAT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
/** A press on a card in Edit becomes a drag once the pointer has moved this far. */
const DRAG_PX = 5;
const EXAMPLE_IDS = EXAMPLES.map((e) => e.id);
const OPEN_MARK = { closed: ' ▸', open: ' ▾' } as const;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the date. */
export function timeAgo(time: number, now = Date.now()): string {
  const minutes = Math.floor((now - time) / MINUTE_MS);
  if (minutes < 1) return 'just now';
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min ago`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours} h ago`;
  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days === 1) return 'yesterday';
  if (days < DAYS_PER_WEEK) return `${days} days ago`;
  return new Date(time).toLocaleDateString('en', DATE_FORMAT);
}

/** What the start window can do; the app decides how. */
export interface StartActions {
  /** The user's recent scenes, newest first (read again after a removal). */
  readonly recent: () => readonly RecentScene[];
  /** The entry of the scene open right now: its card only closes the window. */
  readonly currentId: string;
  readonly showAtStartup: boolean;
  readonly onNew: () => void;
  readonly onOpenFile: () => void;
  readonly onExample: (e: Example) => void;
  readonly onRecent: (e: RecentScene) => void;
  readonly onForget: (e: RecentScene) => void;
  readonly onContinue: () => void;
  readonly onShowAtStartup: (v: boolean) => void;
  /** The examples' order and the hidden ones; `onExamples` keeps a change. */
  readonly examples: ExampleList;
  readonly onExamples: (list: ExampleList) => void;
  /** The preview features on: an example of one that is off is not listed (absent: none on). */
  readonly features?: FeatureFlags;
}

/**
 * The start window, shown as the splash fades: the user's own scenes on top
 * (opened, saved or changed lately, the open one marked), the example projects
 * below, and New / Open beside the user's scenes. Edit beside Examples hides
 * examples (×) and reorders them by dragging; Hidden (n) brings them back and
 * Reset restores the original list. The choice is a setting (world/example-list.ts).
 */
export class StartWindow {
  readonly el: HTMLElement;
  private readonly win: HTMLElement;
  private readonly recentBox: HTMLElement;
  private readonly exampleGrid = el('div', { cls: 'start-grid' });
  private readonly hiddenTray = el('div', { cls: 'start-hidden-tray' });
  private readonly hiddenChip: Button;
  private readonly reset: Button;
  private list: ExampleList;
  private editing = false;
  private trayOpen = false;
  private release: (() => void) | null = null;
  private readonly keyHandler = (e: KeyboardEvent) => {
    // A key held down from the splash must not close the window on its repeats.
    if (e.key === KEY.Escape && !e.repeat) {
      e.preventDefault();
      this.close();
      this.a.onContinue();
    }
  };

  constructor(private readonly a: StartActions) {
    const action = (label: string, paths: readonly string[], run: () => void) =>
      new Button({ cls: 'start-action', content: el('span', {}, [glyph(paths, GLYPH_BOX), el('span', { text: label })]), onClick: () => { this.close(); run(); } }).el;
    const startup = new Toggle({ label: START.showAtStartup, value: a.showAtStartup, onChange: (v) => a.onShowAtStartup(v) });
    const close = new Button({ cls: 'start-close', title: START.close, content: glyph(GLYPH.cross, GLYPH_BOX), onClick: () => { this.close(); a.onContinue(); } });
    this.recentBox = el('div', { cls: 'start-recent-grid' });
    this.fillRecent();
    this.list = a.examples;
    const edit = new Toggle({ label: START.edit, title: START.editTitle, value: false, onChange: (v) => { this.editing = v; this.fillExamples(); } });
    this.hiddenChip = new Button({ cls: 'start-chip', title: START.hiddenTitle, onClick: () => { this.trayOpen = !this.trayOpen; this.fillExamples(); } });
    // Reset goes back to the list everyone starts with: the site's, if it set one.
    this.reset = new Button({ cls: 'start-chip', label: START.reset, title: START.resetTitle, onClick: () => this.setList(defaultPrefs().examples) });
    this.fillExamples();
    // Focus rests on the window itself: a key held from the splash must not press a button.
    this.win = el('div', { cls: 'start-window', attrs: { role: 'dialog', 'aria-label': START.title, tabindex: '-1' } }, [
      el('div', { cls: 'start-head' }, [
        el('div', { cls: 'start-title', text: START.title }),
        el('div', { cls: 'start-version', text: APP_VERSION }),
        el('a', { cls: 'start-credit', text: CORRIDOR.credit, title: CORRIDOR.title, attrs: { href: CORRIDOR.url, target: '_blank', rel: 'noopener noreferrer' } }),
        close.el,
      ]),
      el('section', { cls: 'start-group start-mine' }, [
        el('div', { cls: 'start-group-head' }, [
          el('h2', { cls: 'start-label', text: START.yourScenes }),
          el('div', { cls: 'start-actions' }, [action(START.newScene, GLYPH.plus, a.onNew), action(START.open, GLYPH.open, a.onOpenFile)]),
        ]),
        this.recentBox,
      ]),
      el('section', { cls: 'start-group start-examples' }, [
        el('div', { cls: 'start-group-head' }, [
          el('h2', { cls: 'start-label', text: START.examples }),
          el('div', { cls: 'start-actions' }, [this.hiddenChip.el, this.reset.el, edit.el]),
        ]),
        this.hiddenTray,
        this.exampleGrid,
      ]),
      el('div', { cls: 'start-foot' }, [startup.el]),
    ]);
    this.el = el('div', { cls: 'ui-overlay start-overlay' }, [this.win]);
  }

  open(): void {
    document.body.append(this.el);
    this.release = holdModal();
    window.addEventListener('keydown', this.keyHandler);
    this.win.focus();
  }

  close(): void {
    window.removeEventListener('keydown', this.keyHandler);
    this.release?.();
    this.release = null;
    this.el.remove();
  }

  get isOpen(): boolean {
    return this.el.isConnected;
  }

  private fillRecent(): void {
    const list = this.a.recent();
    this.recentBox.classList.toggle('is-empty', !list.length);
    this.recentBox.replaceChildren(...(list.length ? list.map((e) => this.recentCard(e)) : [el('div', { cls: 'start-none', text: START.noScenes })]));
  }

  private recentCard(e: RecentScene): HTMLElement {
    const current = e.id === this.a.currentId;
    const card = new Button({
      cls: 'start-card',
      title: e.name,
      content: el('span', {}, [
        e.thumb ? el('img', { cls: 'start-thumb', attrs: { src: e.thumb, alt: '' } }) : el('span', { cls: 'start-thumb is-empty' }),
        current ? el('span', { cls: 'start-badge is-current', text: START.current }) : null,
        el('span', { cls: 'start-card-line' }, [el('span', { cls: 'start-card-name', text: e.name }), el('span', { cls: 'start-card-when', text: timeAgo(e.time) })]),
      ]),
      onClick: () => {
        this.close();
        if (current) this.a.onContinue();
        else this.a.onRecent(e);
      },
    });
    const forget = new Button({
      cls: 'start-forget',
      title: START.forget,
      content: glyph(GLYPH.cross, GLYPH_BOX),
      onClick: () => {
        this.a.onForget(e);
        this.fillRecent();
        this.win.focus();
      },
    });
    return el('div', { cls: 'start-recent' }, [card.el, forget.el]);
  }

  private setList(next: ExampleList): void {
    this.list = next;
    this.a.onExamples(next);
    this.fillExamples();
  }

  /** The example cards in the user's order, the hidden ones in their tray, the header's chips. */
  private fillExamples(): void {
    const { shown, hidden } = arrangeExamples(examplesFor(this.a.features ?? {}), this.list);
    this.trayOpen &&= hidden.length > 0;
    this.hiddenChip.el.hidden = !hidden.length;
    this.hiddenChip.el.textContent = START.hidden(hidden.length) + (this.trayOpen ? OPEN_MARK.open : OPEN_MARK.closed);
    this.hiddenChip.active = this.trayOpen;
    this.reset.el.hidden = !this.editing;
    this.reset.disabled = sameList(this.list, defaultPrefs().examples);
    this.exampleGrid.classList.toggle('is-editing', this.editing);
    this.exampleGrid.replaceChildren(...(shown.length ? shown.map((e) => this.card(e)) : [el('div', { cls: 'start-none', text: START.allHidden })]));
    this.hiddenTray.hidden = !this.trayOpen;
    this.hiddenTray.replaceChildren(...hidden.map((e) => this.hiddenCard(e)));
  }

  private picture(e: Example): HTMLElement {
    const src = thumbOf(e.id);
    return src
      ? el('img', { cls: 'start-thumb', attrs: { src, alt: e.name, loading: 'eager', decoding: 'async', draggable: 'false' } })
      : el('span', { cls: 'start-thumb is-empty' });
  }

  private card(e: Example): HTMLElement {
    const card = new Button({
      // The featured example spans two columns and two rows: the showcase's front page.
      cls: e.featured ? 'start-card is-featured' : 'start-card',
      title: `${e.name}: ${e.blurb}`,
      content: el('span', {}, [
        this.picture(e),
        e.animated ? el('span', { cls: 'start-badge' }, [glyph(GLYPH.play, GLYPH_BOX), START.animated]) : null,
        el('span', { cls: 'start-card-line' }, [el('span', { cls: 'start-card-name', text: e.name })]),
      ]),
      onClick: () => {
        if (this.editing) return;
        this.close();
        this.a.onExample(e);
      },
    });
    const item = el('div', { cls: e.featured ? 'start-example is-featured' : 'start-example', attrs: { 'data-example': e.id } }, [card.el]);
    if (!this.editing) return item;
    const hide = new Button({ cls: 'start-forget', title: START.hide, content: glyph(GLYPH.cross, GLYPH_BOX), onClick: () => this.setList(hideExample(this.list, e.id)) });
    hide.el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    item.append(hide.el);
    this.draggable(item, e.id);
    return item;
  }

  /**
   * Edit: a card dragged over another takes its place; the order is kept on
   * release. The window follows the pointer, not the card: moving the card in
   * the page would drop a pointer capture.
   */
  private draggable(item: HTMLElement, id: string): void {
    item.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      let dragging = false;
      const move = (ev: PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) < DRAG_PX) return;
        dragging = true;
        item.classList.add('is-dragging');
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.start-example');
        if (!over || over === item || over.parentElement !== this.exampleGrid) return;
        const r = over.getBoundingClientRect();
        over.before(item);
        if (ev.clientX > r.left + r.width / 2) over.after(item);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!dragging) return;
        const next = item.nextElementSibling as HTMLElement | null;
        this.setList(moveExample(EXAMPLE_IDS, this.list, id, next?.dataset.example ?? null));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  /** A hidden example in the tray: a click shows it again where it was. */
  private hiddenCard(e: Example): HTMLElement {
    return new Button({
      cls: 'start-card is-hidden',
      title: `${START.restore}: ${e.name}`,
      content: el('span', {}, [
        this.picture(e),
        el('span', { cls: 'start-restore' }, [glyph(GLYPH.plus, GLYPH_BOX)]),
        el('span', { cls: 'start-card-line' }, [el('span', { cls: 'start-card-name', text: e.name })]),
      ]),
      onClick: () => this.setList(showExample(this.list, e.id)),
    }).el;
  }
}

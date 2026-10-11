import { KEY } from '../../core/keys';
import type { RecentScene } from '../../io/recent-scenes';
import type { Example } from '../../world/examples';
import { EXAMPLES } from '../../world/examples';
import { Button, Toggle } from '../kit/controls';
import { holdModal } from '../kit/dialog';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { APP_VERSION, START } from '../strings';

const THUMBS = import.meta.glob('../art/examples/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const thumbOf = (id: string): string | undefined => THUMBS[`../art/examples/${id}.jpg`];

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const DATE_FORMAT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

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
}

/**
 * The start window, shown as the splash fades: the user's own scenes on top
 * (opened, saved or changed lately, the open one marked), the example projects
 * below, and New / Open beside the user's scenes.
 */
export class StartWindow {
  readonly el: HTMLElement;
  private readonly win: HTMLElement;
  private readonly recentBox: HTMLElement;
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
    // Focus rests on the window itself: a key held from the splash must not press a button.
    this.win = el('div', { cls: 'start-window', attrs: { role: 'dialog', 'aria-label': START.title, tabindex: '-1' } }, [
      el('div', { cls: 'start-head' }, [
        el('div', { cls: 'start-title', text: START.title }),
        el('div', { cls: 'start-version', text: APP_VERSION }),
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
        el('div', { cls: 'start-group-head' }, [el('h2', { cls: 'start-label', text: START.examples })]),
        el('div', { cls: 'start-grid' }, EXAMPLES.map((e) => this.card(e))),
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

  private card(e: Example): HTMLElement {
    const src = thumbOf(e.id);
    const picture = src
      ? el('img', { cls: 'start-thumb', attrs: { src, alt: e.name, loading: 'eager', decoding: 'async' } })
      : el('span', { cls: 'start-thumb is-empty' });
    const card = new Button({
      cls: 'start-card',
      title: `${e.name}: ${e.blurb}`,
      content: el('span', {}, [
        picture,
        e.animated ? el('span', { cls: 'start-badge' }, [glyph(GLYPH.play, GLYPH_BOX), START.animated]) : null,
        el('span', { cls: 'start-card-line' }, [el('span', { cls: 'start-card-name', text: e.name })]),
      ]),
      onClick: () => { this.close(); this.a.onExample(e); },
    });
    return card.el;
  }
}

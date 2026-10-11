import { KEY } from '../../core/keys';
import { Studio } from '../../model/scene.enums';
import type { Example } from '../../world/examples';
import { EXAMPLES } from '../../world/examples';
import { Button, Toggle } from '../kit/controls';
import { holdModal } from '../kit/dialog';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { APP_VERSION, START, STUDIO_NAMES } from '../strings';

const THUMBS = import.meta.glob('../art/examples/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const thumbOf = (id: string): string | undefined => THUMBS[`../art/examples/${id}.jpg`];

/** What the start window can do; the app decides how. */
export interface StartActions {
  readonly studio: Studio;
  /** The autosaved scene, if any: its name for the Continue card and a picture. */
  readonly last: { readonly studio: Studio; readonly thumb: string | null } | null;
  readonly showAtStartup: boolean;
  readonly onNew: (studio: Studio) => void;
  readonly onOpenFile: (studio: Studio) => void;
  readonly onExample: (e: Example) => void;
  readonly onContinue: () => void;
  readonly onShowAtStartup: (v: boolean) => void;
}

/**
 * The start window, shown after the splash: first the studio (Hoodoo 2 or
 * Hoodoo 3D), then a new scene, a file, the last scene, or one of the example
 * projects of that studio — their pictures are right there to click.
 */
export class StartWindow {
  readonly el: HTMLElement;
  private studio: Studio;
  private readonly grid: HTMLElement;
  private readonly segments = new Map<Studio, HTMLElement>();
  private readonly note: HTMLElement;
  private release: (() => void) | null = null;
  private readonly keyHandler = (e: KeyboardEvent) => {
    if (e.key === KEY.Escape) {
      e.preventDefault();
      this.close();
      this.a.onContinue();
    }
  };

  constructor(private readonly a: StartActions) {
    this.studio = a.studio;
    const seg = el('div', { cls: 'start-studios', attrs: { role: 'radiogroup', 'aria-label': START.studio } });
    for (const s of [Studio.Two, Studio.ThreeD]) {
      const node = el('div', { cls: 'start-studio', attrs: { role: 'radio', tabindex: '0' } }, [
        el('span', { cls: 'start-studio-name', text: STUDIO_NAMES[s] }),
        el('span', { cls: 'start-studio-year', text: START.years[s] }),
      ]);
      node.addEventListener('click', () => this.pick(s));
      node.addEventListener('keydown', (e) => { if (e.key === KEY.Enter || e.key === KEY.Space) { e.preventDefault(); this.pick(s); } });
      this.segments.set(s, node);
      seg.append(node);
    }
    this.note = el('div', { cls: 'start-note' });
    this.grid = el('div', { cls: 'start-grid' });
    const action = (label: string, paths: readonly string[], run: () => void) =>
      new Button({ cls: 'start-action', content: el('span', {}, [glyph(paths, GLYPH_BOX), el('span', { text: label })]), onClick: () => { this.close(); run(); } }).el;
    const actions = el('div', { cls: 'start-actions' }, [
      action(START.newScene, GLYPH.plus, () => a.onNew(this.studio)),
      action(START.open, GLYPH.arrowDown, () => a.onOpenFile(this.studio)),
      a.last ? this.continueCard(a.last) : null,
    ]);
    const startup = new Toggle({ label: START.showAtStartup, value: a.showAtStartup, onChange: (v) => a.onShowAtStartup(v) });
    const close = new Button({ cls: 'start-close', title: START.close, content: glyph(GLYPH.cross, GLYPH_BOX), onClick: () => { this.close(); a.onContinue(); } });
    const win = el('div', { cls: 'start-window', attrs: { role: 'dialog', 'aria-label': START.title } }, [
      el('div', { cls: 'start-head' }, [
        el('div', { cls: 'start-title', text: START.title }),
        el('div', { cls: 'start-version', text: APP_VERSION }),
        close.el,
      ]),
      el('div', { cls: 'start-label', text: START.studio }),
      seg,
      this.note,
      el('div', { cls: 'start-body' }, [
        el('div', { cls: 'start-left' }, [el('div', { cls: 'start-label', text: START.begin }), actions]),
        el('div', { cls: 'start-right' }, [el('div', { cls: 'start-label', text: START.examples }), this.grid]),
      ]),
      el('div', { cls: 'start-foot' }, [startup.el]),
    ]);
    this.el = el('div', { cls: 'ui-overlay start-overlay' }, [win]);
    this.pick(this.studio);
  }

  open(): void {
    document.body.append(this.el);
    this.release = holdModal();
    window.addEventListener('keydown', this.keyHandler);
    this.segments.get(this.studio)?.focus();
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

  private pick(s: Studio): void {
    this.studio = s;
    for (const [k, node] of this.segments) {
      node.classList.toggle('is-on', k === s);
      node.setAttribute('aria-checked', String(k === s));
    }
    this.el.classList.toggle('is-3d', s === Studio.ThreeD);
    this.note.textContent = START.notes[s];
    this.grid.replaceChildren(...EXAMPLES.filter((e) => e.studio === s).map((e) => this.card(e)));
  }

  private card(e: Example): HTMLElement {
    const src = thumbOf(e.id);
    const picture = src
      ? el('img', { cls: 'start-thumb', attrs: { src, alt: e.name, loading: 'eager', decoding: 'async' } })
      : el('div', { cls: 'start-thumb is-empty' });
    const card = new Button({
      cls: 'start-card',
      title: `${e.name}: ${e.blurb}`,
      content: el('span', {}, [
        picture,
        e.studio === Studio.ThreeD ? el('span', { cls: 'start-badge' }, [glyph(GLYPH.play, GLYPH_BOX), START.animated]) : null,
        el('span', { cls: 'start-card-name', text: e.name }),
        el('span', { cls: 'start-card-blurb', text: e.blurb }),
      ]),
      onClick: () => { this.close(); this.a.onExample(e); },
    });
    return card.el;
  }

  private continueCard(last: NonNullable<StartActions['last']>): HTMLElement {
    const b = new Button({
      cls: 'start-action start-continue',
      content: el('span', {}, [
        last.thumb ? el('img', { cls: 'start-continue-thumb', attrs: { src: last.thumb, alt: '' } }) : glyph(GLYPH.undo, GLYPH_BOX),
        el('span', {}, [el('span', { text: START.continue }), el('span', { cls: 'start-card-blurb', text: STUDIO_NAMES[last.studio] })]),
      ]),
      onClick: () => { this.close(); this.a.onContinue(); },
    });
    return b.el;
  }
}

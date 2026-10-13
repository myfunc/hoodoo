import { el, onDrag } from '../kit/dom';

const MIN_THUMB_PX = 24;
/** Firefox reports wheel steps in lines; about one text line each. */
const LINE_PX = 16;
/** A fitting tray's icons shrink to this share of their size before the shelf scrolls. */
const MIN_FIT = 0.72;
/** Gaps and padding do not shrink, so the first guess falls a little short: a second pass closes it. */
const FIT_PASSES = 2;

export interface SliderGeometry {
  readonly overflows: boolean;
  readonly thumbWidth: number;
  readonly thumbLeft: number;
  /** Content pixels scrolled per pixel of thumb travel. */
  readonly scrollPerPx: number;
}

/** Where the thumb sits on a `track`-wide lip for a `view`-wide window onto `content`. */
export function sliderGeometry(track: number, view: number, content: number, scrolled: number): SliderGeometry {
  const range = content - view;
  if (range <= 1 || track <= 0) return { overflows: false, thumbWidth: 0, thumbLeft: 0, scrollPerPx: 0 };
  const thumbWidth = Math.min(track, Math.max(MIN_THUMB_PX, track * (view / content)));
  const travel = track - thumbWidth;
  return {
    overflows: true,
    thumbWidth,
    thumbLeft: travel * Math.min(1, Math.max(0, scrolled / range)),
    scrollPerPx: travel > 0 ? range / travel : 0,
  };
}

/**
 * Bryce's shelf under the palette icons. Its front lip doubles as a slider when
 * the icons do not fit: drag the thumb, click the lip to page, or use the wheel.
 */
export class Shelf {
  readonly el: HTMLElement;
  private readonly lip: HTMLElement;
  private readonly thumb: HTMLElement;
  private tray: HTMLElement | null = null;
  private readonly resize = new ResizeObserver(() => this.sync(true));
  private readonly onScroll = () => this.sync();

  constructor() {
    this.thumb = el('div', { cls: 'shelf-thumb' });
    this.lip = el('div', { cls: 'shelf-lip', attrs: { 'aria-hidden': 'true' } }, [this.thumb]);
    this.el = el('div', { cls: 'shelf' }, [this.lip]);
    this.resize.observe(this.lip);

    let from = 0;
    onDrag(this.thumb, {
      start: () => { from = this.tray?.scrollLeft ?? 0; },
      move: (dx) => {
        const t = this.tray;
        if (t) t.scrollLeft = from + dx * this.geometry(t).scrollPerPx;
      },
    });
    this.lip.addEventListener('pointerdown', (e) => {
      const t = this.tray;
      if (!t || e.target !== this.lip) return;
      const left = e.clientX < this.thumb.getBoundingClientRect().left;
      t.scrollBy({ left: (left ? -1 : 1) * t.clientWidth, behavior: 'smooth' });
    });
    this.el.addEventListener('wheel', (e) => {
      const t = this.tray;
      if (!t || !this.geometry(t).overflows || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      t.scrollLeft += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * LINE_PX : e.deltaY;
    }, { passive: false });
  }

  /** Puts `tray` on the shelf, replacing the previous one. */
  show(tray: HTMLElement): void {
    if (this.tray) {
      this.tray.removeEventListener('scroll', this.onScroll);
      this.resize.unobserve(this.tray);
    }
    this.tray = tray;
    this.el.replaceChildren(tray, this.lip);
    tray.addEventListener('scroll', this.onScroll, { passive: true });
    this.resize.observe(tray);
    this.sync(true);
  }

  private geometry(t: HTMLElement): SliderGeometry {
    return sliderGeometry(this.lip.clientWidth, t.clientWidth, t.scrollWidth, t.scrollLeft);
  }

  /** A tray marked is-fitting scales its icons (--fit) to the shelf's width, down to MIN_FIT. */
  private fit(t: HTMLElement): void {
    if (!t.classList.contains('is-fitting') || !t.clientWidth) return;
    let k = 1;
    t.style.setProperty('--fit', '1');
    for (let pass = 0; pass < FIT_PASSES && t.scrollWidth > t.clientWidth; pass++) {
      k = Math.max(MIN_FIT, k * (t.clientWidth / t.scrollWidth));
      t.style.setProperty('--fit', String(k));
    }
  }

  /** The thumb follows the tray; on a new tray or a new width the icons fit again first. */
  private sync(refit = false): void {
    if (this.tray && refit) this.fit(this.tray);
    const g = this.tray ? this.geometry(this.tray) : null;
    this.el.classList.toggle('is-overflowing', !!g?.overflows);
    if (!g?.overflows) return;
    this.thumb.style.width = `${g.thumbWidth}px`;
    this.thumb.style.transform = `translateX(${g.thumbLeft}px)`;
  }
}

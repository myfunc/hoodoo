import type { RayEngine } from '../../render/gpu/engine';
import { EngineStage } from '../../render/gpu/engine.enums';
import splashArt from '../art/splash.jpg';
import { el } from '../kit/dom';
import { APP_NAME, APP_VERSION, SPLASH } from '../strings';
import { STAGE_TEXT } from './shader-loader';

/** Warm starts are ready almost at once; the splash still stays long enough to be seen. */
const MIN_SHOW_MS = 1600;
/** A slow first compile hands over to the loader card, under which the wireframe editor already works. */
const MAX_SHOW_MS = 4600;
const FADE_MS = 400;
const TICK_MS = 150;
const FUNCTION_KEY = /^F\d{1,2}$/;

/** Browser and system shortcuts (reload, address bar, app switching) close the splash and keep working. */
const isShortcut = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey || e.altKey || FUNCTION_KEY.test(e.key);

/**
 * The welcome window shown while the app loads, after the art-filled splash
 * screens of 90s desktop apps: the "Planet Meadows" picture (rendered in Hoodoo),
 * the name, the credits and the loading stage. It leaves when the ray tracer is
 * ready, after MAX_SHOW_MS at most, or at once on a click or a key.
 */
export class Splash {
  readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly opened = performance.now();
  private closed = false;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!isShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
    this.close();
  };

  constructor(private readonly engine: RayEngine) {
    this.status = el('div', { cls: 'splash-status', attrs: { role: 'status' } });
    const art = el('img', { cls: 'splash-art', attrs: { src: splashArt, alt: SPLASH.artAlt } });
    const card = el('div', { cls: 'splash' }, [
      art,
      el('div', { cls: 'splash-name', text: APP_NAME }),
      el('div', { cls: 'splash-tag', text: SPLASH.tagline }),
      el('div', { cls: 'splash-foot' }, [
        el('div', {}, [this.status, el('div', { cls: 'splash-credits', text: SPLASH.credits })]),
        el('div', { cls: 'splash-version' }, [`${SPLASH.version} ${APP_VERSION}`, el('div', { text: SPLASH.dismiss })]),
      ]),
    ]);
    this.el = el('div', { cls: 'splash-screen is-loading', attrs: { 'aria-label': `${APP_NAME} ${APP_VERSION}` } }, [card]);
    // Shown once the picture is decoded, so it never flashes in empty.
    art.decode().catch(() => undefined).finally(() => this.el.classList.remove('is-loading'));
    this.el.addEventListener('pointerdown', () => this.close());
    window.addEventListener('keydown', this.onKey, true);
    engine.ready.then(() => this.closeIn(MIN_SHOW_MS), () => this.close());
    this.closeIn(MAX_SHOW_MS);
    this.tick('');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.onKey, true);
    this.el.classList.add('done');
    window.setTimeout(() => this.el.remove(), FADE_MS);
  }

  /** Closes once `ms` have passed since the splash opened. */
  private closeIn(ms: number): void {
    window.setTimeout(() => this.close(), Math.max(0, ms - (performance.now() - this.opened)));
  }

  private tick(shown: string): void {
    if (this.closed) return;
    const stage = this.engine.stage;
    const text = stage === EngineStage.Ready ? SPLASH.ready : `${STAGE_TEXT[stage]}…`;
    // Written only on change, so screen readers announce each stage once.
    if (text !== shown) this.status.textContent = text;
    window.setTimeout(() => this.tick(text), TICK_MS);
  }
}

import { Logger } from '../../core/log';
import type { RayEngine } from '../../render/gpu/engine';
import { EngineStage } from '../../render/gpu/engine.enums';
import { SplashKind, splashKindAt } from '../../world/splash-scene';
import archIntro from '../art/arch-intro.webm';
import archLoop from '../art/arch-loop.webm';
import archStill from '../art/arch.jpg';
import dunesIntro from '../art/dunes-intro.webm';
import dunesLoop from '../art/dunes-loop.webm';
import dunesStill from '../art/dunes.jpg';
import { el } from '../kit/dom';
import { APP_NAME, APP_VERSION, SPLASH } from '../strings';
import { STAGE_TEXT } from './shader-loader';

interface SplashArt {
  readonly still: string;
  readonly intro: string;
  readonly loop: string;
  readonly alt: string;
}

const ART: Readonly<Record<SplashKind, SplashArt>> = {
  [SplashKind.Dunes]: { still: dunesStill, intro: dunesIntro, loop: dunesLoop, alt: SPLASH.alt.dunes },
  [SplashKind.Arch]: { still: archStill, intro: archIntro, loop: archLoop, alt: SPLASH.alt.arch },
};

const logger = Logger.create('Splash');

/** Today's splash art: the dunes by day, the ring arch in the evening and at night. */
export const splashArtNow = (): SplashArt => ART[splashKindAt(new Date().getHours())];

/** Without motion (reduced-motion setting, or a browser that cannot play the clip) the still stays this long at least. */
const MIN_STILL_MS = 1600;
/** Once the ray tracer is ready, a clip that has not started playing by then (slow network) is given up. */
const STALL_MS = 1600;
/** However slow the first compile, the loader card under the splash takes over after this. */
const MAX_SHOW_MS = 15000;
const FADE_MS = 400;
const TICK_MS = 150;
const FUNCTION_KEY = /^F\d{1,2}$/;

/** Browser and system shortcuts (reload, address bar, app switching) close the splash and keep working. */
const isShortcut = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey || e.altKey || FUNCTION_KEY.test(e.key);

/**
 * The welcome window shown while the app loads, after the art-filled splash
 * screens of 90s desktop apps. It plays a short welcome clip rendered in Hoodoo
 * (the dunes by day, the ring arch at night), then its seamless loop while the
 * ray tracer is still starting, and leaves once both the clip and the ray tracer
 * are done — or at once on a click or a key.
 */
export class Splash {
  readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly art = splashArtNow();
  private video: HTMLVideoElement | null = null;
  private closed = false;
  private introDone = false;
  private ready = false;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!isShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
    this.close();
  };

  constructor(private readonly engine: RayEngine) {
    this.status = el('div', { cls: 'splash-status', attrs: { role: 'status' } });
    const card = el('div', { cls: 'splash' }, [
      this.picture(),
      el('div', { cls: 'splash-name', text: APP_NAME }),
      el('div', { cls: 'splash-tag', text: SPLASH.tagline }),
      el('div', { cls: 'splash-foot' }, [
        el('div', {}, [this.status, el('div', { cls: 'splash-credits', text: SPLASH.credits })]),
        el('div', { cls: 'splash-version' }, [`${SPLASH.version} ${APP_VERSION}`, el('div', { text: SPLASH.dismiss })]),
      ]),
    ]);
    this.el = el('div', { cls: 'splash-screen is-loading', attrs: { 'aria-label': `${APP_NAME} ${APP_VERSION}` } }, [card]);
    this.el.addEventListener('pointerdown', () => this.close());
    window.addEventListener('keydown', this.onKey, true);
    engine.ready.then(() => this.onReady(), () => this.close());
    window.setTimeout(() => this.close(), MAX_SHOW_MS);
    this.tick('');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.onKey, true);
    this.stopVideo();
    this.el.classList.add('done');
    window.setTimeout(() => this.el.remove(), FADE_MS);
  }

  /** The clip over the still, or the still alone when motion is unwanted. */
  private picture(): HTMLElement {
    const still = el('img', { cls: 'splash-art', attrs: { src: this.art.still, alt: this.art.alt } });
    // Shown once the picture is decoded, so it never flashes in empty.
    still.decode().catch(() => undefined).finally(() => this.el.classList.remove('is-loading'));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.finishIntroAfter(MIN_STILL_MS);
      return still;
    }
    const video = el('video', { cls: 'splash-art', attrs: { src: this.art.intro, 'aria-hidden': 'true' } });
    video.muted = true;
    video.playsInline = true;
    this.video = video;
    video.addEventListener('ended', () => this.onIntroEnded(), { once: true });
    video.addEventListener('error', () => this.dropVideo('clip failed to load'), { once: true });
    video.play().catch((error: unknown) => this.dropVideo('autoplay refused', error));
    return el('div', { cls: 'splash-picture' }, [still, video]);
  }

  private onReady(): void {
    this.ready = true;
    const v = this.video;
    if (v && v.currentTime === 0) window.setTimeout(() => { if (!this.introDone && v.currentTime === 0) this.dropVideo('clip stalled'); }, STALL_MS);
    this.closeIfDone();
  }

  private onIntroEnded(): void {
    const v = this.video;
    if (this.closed || !v) return;
    this.introDone = true;
    if (this.ready) {
      this.close();
      return;
    }
    // Still compiling: the loop starts where the welcome ended.
    v.loop = true;
    v.src = this.art.loop;
    v.play().catch((error: unknown) => {
      // Closing unloads the video, which aborts a pending play: not worth a warning.
      if (!this.closed) logger.warn('splash loop did not play; the last frame stays', {}, error);
    });
  }

  /** Falls back to the still: removes the clip and lets the still count as the welcome. */
  private dropVideo(reason: string, error?: unknown): void {
    if (!this.video) return;
    logger.warn('splash shows the still', { reason }, error);
    this.stopVideo();
    this.finishIntroAfter(MIN_STILL_MS);
  }

  private stopVideo(): void {
    const v = this.video;
    if (!v) return;
    this.video = null;
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.remove();
  }

  private finishIntroAfter(ms: number): void {
    window.setTimeout(() => { this.introDone = true; this.closeIfDone(); }, ms);
  }

  private closeIfDone(): void {
    if (this.ready && this.introDone) this.close();
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

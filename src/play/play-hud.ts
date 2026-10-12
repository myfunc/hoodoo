import { el } from '../ui/kit/dom';
import type { Frame } from '../render/wire/wireframe';

/** The one-line hint while playing; the setup panel and the record key are named too. */
export const PLAY_HINT = 'WASD move · Space jump · Ctrl duck · K record · Tab setup · Esc exit';
/** The same line while the plane flies. */
export const PLANE_HINT = 'Mouse fly · W/S throttle · Space boost · V view · R reset · K record · Tab setup · Esc exit';
const PAUSED_TITLE = 'Click to play';
const LOADING = 'Loading physics…';
const SECONDS_PER_MINUTE = 60;
const TENTHS = 10;
const PERCENT = 100;

/** m:ss.t for the record clock. */
function clock(seconds: number): string {
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds - m * SECONDS_PER_MINUTE;
  const tenths = Math.floor((s % 1) * TENTHS);
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}.${tenths}`;
}

/**
 * The heads-up layer over the picture: a small crosshair at the picture's
 * centre, the record light and its clock, a speed and frame-rate readout (with
 * the plane's throttle bar in it) and the hint line. The layer itself catches the mouse (pointer lock) so nothing
 * reaches the editor's handles underneath.
 */
export class PlayHud {
  readonly el: HTMLElement;
  private readonly cross: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly recTime: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly readoutText: HTMLElement;
  private readonly gauge: HTMLElement;
  private readonly gaugeFill: HTMLElement;
  private hintText = PLAY_HINT;
  private readonly hint: HTMLElement;
  private readonly title: HTMLElement;
  private readonly panelHost: HTMLElement;

  constructor() {
    this.cross = el('div', { cls: 'play-cross' });
    this.recTime = el('span', { cls: 'play-rec-time' });
    this.rec = el('div', { cls: 'play-rec' }, [el('span', { cls: 'play-rec-dot' }), el('span', { text: 'REC' }), this.recTime]);
    this.readoutText = el('span', { cls: 'play-readout-text' });
    this.gaugeFill = el('i');
    this.gauge = el('span', { cls: 'play-gauge', title: 'Throttle' }, [this.gaugeFill]);
    this.readout = el('div', { cls: 'play-readout' }, [this.readoutText, this.gauge]);
    this.hint = el('div', { cls: 'play-hint', text: LOADING });
    this.title = el('div', { cls: 'play-title', text: PAUSED_TITLE });
    this.panelHost = el('div', { cls: 'play-panel-host' });
    this.el = el('div', { cls: 'play-layer is-loading', attrs: { tabindex: '-1' } }, [this.cross, this.rec, this.readout, this.title, this.panelHost, this.hint]);
    // The editor's handles under the layer never see the mouse while playing.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'dblclick', 'contextmenu', 'wheel'] as const) {
      this.el.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'contextmenu') e.preventDefault();
      });
    }
  }

  /** Puts the crosshair at the centre of the picture (scene-window pixels). */
  place(frame: Frame | null): void {
    if (!frame) return;
    this.cross.style.left = `${frame.x + frame.w / 2}px`;
    this.cross.style.top = `${frame.y + frame.h / 2}px`;
  }

  /** Physics is ready: the hint replaces the loading note. */
  ready(): void {
    this.el.classList.remove('is-loading');
    this.hint.textContent = this.hintText;
  }

  /** The hint line for the actor being driven. */
  setHint(text: string): void {
    this.hintText = text;
    if (!this.el.classList.contains('is-loading')) this.hint.textContent = text;
  }

  /** Paused: the pointer is free, the setup panel shows. */
  set paused(on: boolean) {
    this.el.classList.toggle('is-paused', on);
  }

  setPanel(panel: HTMLElement): void {
    this.panelHost.replaceChildren(panel);
  }

  /** The record light, with how long the take runs (null: not recording). */
  recording(seconds: number | null): void {
    this.rec.classList.toggle('is-on', seconds !== null);
    if (seconds !== null) this.recTime.textContent = clock(seconds);
  }

  setReadout(text: string): void {
    if (this.readoutText.textContent !== text) this.readoutText.textContent = text;
  }

  /** The throttle bar, 0..1 (lit while boosting); null hides it (the walker). */
  setGauge(level: number | null, hot = false): void {
    this.gauge.classList.toggle('is-on', level !== null);
    this.gauge.classList.toggle('is-hot', hot);
    if (level !== null) this.gaugeFill.style.width = `${Math.round(level * PERCENT)}%`;
  }
}

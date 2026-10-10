import { Logger } from '../../core/log';
import type { RayEngine } from '../../render/gpu/engine';
import { EngineStage } from '../../render/gpu/engine.enums';
import { Button } from '../kit/controls';
import { el } from '../kit/dom';

const logger = Logger.create('ShaderLoader');
/** How long the last cold compile took here; the next one fills the bar by it. */
const COMPILE_MS_KEY = 'hoodoo.compileMs.v1';
/** Compiles shorter than this were served from the browser's cache: they do not change the estimate. */
const CACHED_MS = 400;
/** The bar never claims to be done before the engine says so. */
const ESTIMATE_CAP = 0.95;
const MS_PER_S = 1000;
const PERCENT = 100;
const FADE_MS = 450;
/** The clock and bar update ten times a second; the stripes animate in CSS. */
const TICK_MS = 100;

export const STAGE_TEXT: Readonly<Record<EngineStage, string>> = {
  [EngineStage.Queued]: 'Waiting for the graphics card',
  [EngineStage.Compiling]: 'Compiling the ray tracer for your graphics card',
  [EngineStage.WarmingUp]: 'Building the GPU code',
  [EngineStage.Ready]: 'Ready',
  [EngineStage.Failed]: 'The ray tracer could not start',
};

function readEstimate(): number {
  try {
    const v = Number(localStorage.getItem(COMPILE_MS_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (error) {
    logger.warn('compile estimate unavailable', {}, error);
    return 0;
  }
}

function saveEstimate(ms: number): void {
  try {
    localStorage.setItem(COMPILE_MS_KEY, String(Math.round(ms)));
  } catch (error) {
    logger.warn('compile estimate not saved', {}, error);
  }
}

/**
 * The first visit compiles the ray tracer for the local GPU (seconds on Windows).
 * This card over the scene window says so, counts the time and, from the second
 * cold start on, fills its bar by the time the previous compile took. It appears
 * after a short delay (CSS), so warm starts never flash it.
 */
export class ShaderLoader {
  readonly el: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly time: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly started = performance.now();
  private readonly estimate = readEstimate();
  /** A hidden tab pauses the frames compile polling waits on, so its time says nothing. */
  private wasHidden = document.hidden;

  constructor(private readonly engine: RayEngine) {
    this.stage = el('div', { cls: 'loader-stage' });
    this.time = el('span', { cls: 'loader-time' });
    this.fill = el('div', { cls: 'loader-fill' });
    const bar = el('div', { cls: this.estimate ? 'loader-bar' : 'loader-bar indeterminate' }, [this.fill]);
    const note = el('div', {
      cls: 'loader-note',
      text: 'Only the first visit after an update waits here: the browser keeps the compiled shaders. The wireframe editor already works.',
    });
    this.el = el('div', { cls: 'shader-loader', attrs: { role: 'status', 'aria-live': 'polite' } }, [
      el('div', { cls: 'loader-title' }, ['Preparing the ray tracer ', this.time]),
      this.stage, bar, note,
    ]);
    document.addEventListener('visibilitychange', () => { this.wasHidden ||= document.hidden; });
    engine.ready.then(() => this.finish(), () => this.fail());
    this.tick();
  }

  private tick(): void {
    const stage = this.engine.stage;
    if (stage === EngineStage.Ready || stage === EngineStage.Failed) return;
    const elapsed = performance.now() - this.started;
    this.stage.textContent = `${STAGE_TEXT[stage]}…`;
    this.time.textContent = `${(elapsed / MS_PER_S).toFixed(1)} s`;
    if (this.estimate) this.fill.style.width = `${Math.min(ESTIMATE_CAP, elapsed / this.estimate) * PERCENT}%`;
    window.setTimeout(() => this.tick(), TICK_MS);
  }

  private finish(): void {
    const compile = this.engine.compileMs;
    if (compile > CACHED_MS && !this.wasHidden) saveEstimate(compile);
    this.fill.style.width = `${PERCENT}%`;
    this.el.classList.add('done');
    window.setTimeout(() => this.el.remove(), FADE_MS);
  }

  private fail(): void {
    this.el.classList.add('failed');
    this.stage.textContent = STAGE_TEXT[EngineStage.Failed];
    const first = this.engine.error.split('\n').find((l) => l.trim()) ?? 'unknown error';
    const close = new Button({ cls: 'loader-close', label: 'Keep editing without renders', onClick: () => this.el.remove() });
    this.el.append(el('div', { cls: 'loader-error', text: first }), close.el);
  }
}

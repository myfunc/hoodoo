import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import { liveBounces } from '../../render/gpu/live-quality';
import type { RealtimeStatus } from '../../render/gpu/view-renderer';
import {
  RenderPreset, type RenderViewOptions, ShadowQuality, VIEW_SAMPLES, VIEW_SCALES, finalBounces, renderViewOptions, withOption,
} from '../../world/render-setup';
import { changeSetting } from '../../world/settings';
import { LiveQuality, PictureMode } from '../../world/world.enums';
import { speedLine } from '../chrome/picture-readout';
import { type UiContext, hintOn } from '../context';
import { Choice, type Dial } from '../kit/controls';
import { DialogStyle } from '../kit/dialog';
import { el } from '../kit/dom';
import type { ToolContent } from '../kit/tool-window';
import { FINAL_DEPTH_ABOUT, depthDial, sceneDepth } from './reflection-rows';
import './render-options.css';

const PERCENT = 100;
const OFF_ON = [{ value: false, label: 'Off' }, { value: true, label: 'On' }] as const;

interface Item<T> {
  readonly value: T;
  readonly label: string;
  readonly hint: string;
}

const PRESETS: readonly Item<RenderPreset>[] = [
  { value: RenderPreset.Draft, label: 'Draft', hint: 'Half size, 2 reflections, hard shadows, no lens: quick' },
  { value: RenderPreset.Balanced, label: 'Balanced', hint: 'Three-quarter size, 4 reflections, soft shadows' },
  { value: RenderPreset.Final, label: 'Final', hint: 'What Render draws, at full size, refined to 64 rays' },
  { value: RenderPreset.Custom, label: 'Custom', hint: 'Your own options: change any row below' },
];
const SHADOWS: readonly Item<ShadowQuality>[] = [
  { value: ShadowQuality.Off, label: 'Off', hint: 'Soft shadows drawn hard: quicker' },
  { value: ShadowQuality.Low, label: 'Low', hint: 'One shadow ray per light, as Render' },
  { value: ShadowQuality.High, label: 'High', hint: 'Four shadow rays per light: smooth sooner, slower' },
];

/** One row of the panel: a name with its hint, and a control. */
interface Row {
  readonly name: string;
  readonly hint: string;
  readonly control: HTMLElement;
}

/**
 * READ ME — Render › Render Options…: how Render View draws and how deep mirrors
 * and glass are traced. A tool window (ui/kit/tool-window.ts): it floats over the
 * scene or docks on the left, and every change applies at once. The Render View
 * rows are personal settings (a preset or Custom, world/render-setup.ts); the
 * Render reflections belong to the scene; the live depth is personal too. The
 * speed line shows what the options cost while Render View is on.
 */
export class RenderOptionsTool implements ToolContent {
  readonly title = 'Render Options';
  readonly tab = 'Render';
  readonly style = DialogStyle.Stone;
  readonly cls = 'render-options';
  readonly body: HTMLElement;
  private readonly mode: Choice<boolean>;
  private readonly preset: Choice<RenderPreset>;
  private readonly scale: Choice<number>;
  private readonly samples: Choice<number>;
  private readonly bounces: Dial;
  private readonly shadows: Choice<ShadowQuality>;
  private readonly lens: Choice<boolean>;
  private readonly antialias: Choice<boolean>;
  private readonly finalDepth: Dial;
  private readonly liveDepth: Dial;
  private readonly liveAbout: HTMLElement;
  private readonly speed: HTMLElement;
  private stops: (() => void)[] = [];
  private shownDepth = 0;
  /** Render View is on and the speed line waits for, or shows, its readout. */
  private measuring = false;
  private subject: (text: string) => void = () => undefined;

  constructor(private readonly ctx: UiContext) {
    const e = ctx.editor;
    const set = (patch: Partial<RenderViewOptions>) => this.change(patch);
    this.mode = this.choice(OFF_ON, (on) => e.update(on ? { picture: PictureMode.Final, quad: false } : { picture: PictureMode.Edit }));
    this.preset = this.choice(PRESETS.map(({ value, label }) => ({ value, label })), (p) => changeSetting(e, 'renderViewPreset', p));
    PRESETS.forEach((p, i) => hintOn(ctx, this.preset.el.children[i] as HTMLElement, { title: `Preset ${p.label}`, text: p.hint }));
    this.scale = this.choice(VIEW_SCALES.map((v) => ({ value: v as number, label: `${v * PERCENT}%` })), (scale) => set({ scale }));
    this.samples = this.choice(VIEW_SAMPLES.map((v) => ({ value: v as number, label: String(v) })), (samples) => set({ samples }));
    this.bounces = depthDial(this.options().bounces, (bounces) => set({ bounces }), true);
    this.shadows = this.choice(SHADOWS.map(({ value, label }) => ({ value, label })), (shadows) => set({ shadows }));
    SHADOWS.forEach((s, i) => hintOn(ctx, this.shadows.el.children[i] as HTMLElement, { title: `Soft shadows ${s.label}`, text: s.hint }));
    this.lens = this.choice(OFF_ON, (depthOfField) => set({ depthOfField }));
    this.antialias = this.choice(OFF_ON, (antialias) => set({ antialias }));
    const depth = sceneDepth(ctx.world);
    this.finalDepth = depthDial(depth.get(), (n) => depth.set(n), false);
    this.liveDepth = depthDial(e.state.settings.liveBounces, (n) => changeSetting(e, 'liveBounces', n), true);
    this.liveAbout = el('div', { cls: 'ro-about' });
    this.speed = el('div', { cls: 'ro-speed' });
    const key = shortcutOf(Action.ToggleRenderView);
    this.body = el('div', { cls: 'ro-body' }, [
      this.rows([
        { name: 'Render View', hint: `The final render in the scene window, refining in place (${key})`, control: this.mode.el },
        { name: 'Preset', hint: 'Draft is quick, Final is what Render draws', control: this.preset.el },
        { name: 'Resolution', hint: 'Pixels traced against the scene window, per side', control: this.scale.el },
        { name: 'Rays/pixel', hint: 'Rays each pixel averages before it stops refining', control: this.samples.el },
        { name: 'Bounces', hint: 'Mirror and glass bounces of this Render View preset', control: this.bounces.el },
        { name: 'Soft shadows', hint: 'The sky’s soft shadows: hard, one or four shadow rays', control: this.shadows.el },
        { name: 'Depth of field', hint: 'The camera’s aperture; off traces a pinhole', control: this.lens.el },
        { name: 'Anti-aliasing', hint: 'Rays spread over each pixel: smooth edges', control: this.antialias.el },
      ]),
      this.speed,
      el('div', { cls: 'ro-heading', text: 'Bounces elsewhere' }),
      this.rows([
        { name: 'Final render', hint: FINAL_DEPTH_ABOUT, control: this.finalDepth.el },
        { name: 'Live edit', hint: 'Mirror and glass bounces of the live picture; a personal setting', control: this.liveDepth.el },
      ]),
      this.liveAbout,
    ]);
    this.sync();
  }

  start(subject: (text: string) => void): void {
    this.subject = subject;
    this.stops = [
      this.ctx.editor.events.on('changed', () => this.sync()),
      this.ctx.world.events.on('changed', () => this.sync()),
      this.ctx.view.events.on('live', (s) => this.showSpeed(s)),
    ];
    this.sync();
  }

  stop(): void {
    for (const off of this.stops) off();
    this.stops = [];
  }

  /** What Render View traces now. */
  private options(): RenderViewOptions {
    const st = this.ctx.editor.state.settings;
    return renderViewOptions(st.renderViewPreset, st.renderViewCustom, finalBounces(this.ctx.world.scene));
  }

  /** One option changed: it joins the Custom set, or matches a preset again. */
  private change(patch: Partial<RenderViewOptions>): void {
    const e = this.ctx.editor;
    const st = e.state.settings;
    const next = withOption(st.renderViewPreset, st.renderViewCustom, finalBounces(this.ctx.world.scene), patch);
    e.update({ settings: { ...st, renderViewPreset: next.preset, renderViewCustom: next.custom } });
  }

  private sync(): void {
    const s = this.ctx.editor.state;
    const o = this.options();
    const on = s.picture === PictureMode.Final;
    this.mode.set(on);
    this.preset.set(s.settings.renderViewPreset);
    this.scale.set(o.scale);
    this.samples.set(o.samples);
    this.bounces.set(o.bounces);
    this.shadows.set(o.shadows);
    this.lens.set(o.depthOfField);
    this.antialias.set(o.antialias);
    // The scene's depth applies when its dial is let go: only a new stored value moves it (undo, Settings).
    const depth = finalBounces(this.ctx.world.scene);
    if (depth !== this.shownDepth) this.finalDepth.set(depth);
    this.shownDepth = depth;
    this.liveDepth.set(s.settings.liveBounces);
    this.liveAbout.textContent = `Render: saved with the scene · Live: Detailed traces ${liveBounces(LiveQuality.Detailed, s.settings.liveBounces)}`;
    this.body.classList.toggle('is-off', !on);
    if (!on) this.speed.textContent = `Off · turn on above or press ${shortcutOf(Action.ToggleRenderView)}`;
    else if (!this.measuring) this.speed.textContent = 'Measuring…';
    this.measuring = on;
    this.subject(on ? 'Render View on' : '');
  }

  private showSpeed(s: RealtimeStatus): void {
    if (this.ctx.editor.state.picture === PictureMode.Final && s.final) this.speed.textContent = speedLine(s);
  }

  private choice<T>(items: readonly { value: T; label: string }[], onChange: (v: T) => void): Choice<T> {
    return new Choice<T>({ items, value: items[0].value, cls: 'segmented', onChange });
  }

  private rows(rows: readonly Row[]): HTMLElement {
    return el('div', { cls: 'ro-rows' }, rows.flatMap((r) => {
      const name = el('span', { cls: 'ro-name', text: r.name });
      hintOn(this.ctx, name, { title: r.name, text: r.hint });
      hintOn(this.ctx, r.control, { title: r.name, text: r.hint });
      return [name, r.control];
    }));
  }
}

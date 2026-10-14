import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { UiContext } from '../context';
import { hintOn } from '../context';
import { Button, Choice } from '../kit/controls';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { cssColor, onThemeChange } from '../theme';
import { TimelineClock } from './timeline-clock';
import { KeyInspector } from './timeline-inspector';
import { LedgerLanes } from './timeline-lanes';
import { LedgerNames } from './timeline-names';
import { LedgerOverview } from './timeline-overview';
import { readSurfaces } from './timeline-paint';
import { RowFilter } from './timeline-rows';
import { LedgerRuler } from './timeline-ruler';
import { LedgerState, LedgerTip } from './timeline-state';
import { FilmStrip } from './timeline-strip';
import { formatClock } from './timeline-time';
import { followWindow } from './timeline-window';
import './timeline.css';

/**
 * The animation controls under the scene window (shown while Animation is on),
 * after Bryce 3D's Time Palette, laid out as a ledger: chrome VCR buttons with a
 * red stop and the time readout on top; under them a ruled sheet with one row
 * per animated thing — the Camera, the Sun (and the sky), groups with what they
 * hold, objects — each with a Key here diamond and its keys as copper rivets on
 * a ruler of seconds and frames; an overview of the whole scene underneath to
 * zoom and scroll; the key inspector docked on the right; and, switched on, a
 * film strip of the camera's picture along the ruler.
 */

const FILTERS = [
  { value: RowFilter.Animated, label: 'Animated', title: 'Rows of what moves, with the groups around them' },
  { value: RowFilter.All, label: 'All', title: 'Every object and group, to key what is still' },
  { value: RowFilter.Selected, label: 'Selected', title: 'Rows of the selection only' },
] as const;
const STRIP = [{ value: false, label: 'Off' }, { value: true, label: 'On' }] as const;
/** Bryce's stop is a red square in the middle of the VCR row. */
const STOP_GLYPH = ['M6 6h12v12H6z'] as const;

export class Timeline {
  readonly el: HTMLElement;
  private readonly clock: TimelineClock;
  private readonly play: Button;
  private readonly loop: Button;
  private shownPlaying: boolean | null = null;
  private readonly state: LedgerState;
  private readonly names: LedgerNames;
  private readonly lanes: LedgerLanes;
  private readonly ruler: LedgerRuler;
  private readonly overview: LedgerOverview;
  private readonly strip: FilmStrip;
  private readonly inspector: KeyInspector;
  private readonly range: HTMLElement;
  private readonly fit: Button;
  private queued = false;
  private shownTime = -1;
  /** The painted surfaces follow the stylesheet: read once the ledger shows, again after a theme change. */
  private surfacesRead = false;

  constructor(private readonly ctx: UiContext) {
    const tb = (action: Action, paths: readonly string[], title: string, cls = '') => {
      const b = new Button({ cls: `tl-button ${cls}`, title: `${title}${shortcutOf(action) ? ` (${shortcutOf(action)})` : ''}`, content: glyph(paths, GLYPH_BOX), onClick: () => ctx.dispatch(action) });
      hintOn(ctx, b.el, { title, text: shortcutOf(action) ? `Shortcut ${shortcutOf(action)}` : '' });
      return b;
    };
    this.play = tb(Action.PlayPause, GLYPH.play, 'Play / Pause', 'tl-play');
    this.loop = tb(Action.ToggleLoop, GLYPH.loop, 'Loop playback', 'tl-loop');
    this.clock = new TimelineClock(ctx);
    // Stop only pauses: Bryce's red square, next to Play, which toggles.
    const stop = new Button({ cls: 'tl-button tl-stop', title: 'Stop', content: glyph(STOP_GLYPH, GLYPH_BOX), onClick: () => this.stop() });
    hintOn(ctx, stop.el, { title: 'Stop', text: 'Stop playback here' });
    const changed = () => this.redraw();
    this.state = new LedgerState(ctx);
    const tip = new LedgerTip(document.body);
    this.names = new LedgerNames(ctx, this.state, tip, changed);
    this.lanes = new LedgerLanes(ctx, this.state, this.names.el, tip, changed);
    this.ruler = new LedgerRuler(ctx, this.state, changed);
    this.overview = new LedgerOverview(ctx, this.state, changed);
    this.strip = new FilmStrip(ctx, this.state, changed);
    this.inspector = new KeyInspector(ctx, this.state);
    const filter = new Choice<RowFilter>({ items: FILTERS, value: this.state.filter, cls: 'segmented tl-filter', onChange: (f) => {
      this.state.filter = f;
      this.state.invalidate();
      this.names.el.scrollTop = 0;
      this.redraw();
    } });
    const strip = new Choice<boolean>({ items: STRIP, value: false, cls: 'segmented tl-strip-switch', onChange: (on) => this.setStrip(on) });
    hintOn(ctx, filter.el, { title: 'Rows', text: 'Animated, all or selected' });
    hintOn(ctx, strip.el, { title: 'Film strip', text: 'Camera pictures by time' });
    this.range = el('span', { cls: 'tl-range' });
    // The tracks fold away: the transport and the ruler stay, a strip under the picture.
    const tracks = new Button({ label: 'Tracks', cls: 'tl-tracks', title: 'Show or fold the tracks', onClick: () => ctx.editor.update({ timelineFull: !ctx.editor.state.timelineFull }) });
    hintOn(ctx, tracks.el, { title: 'Tracks', text: 'Every animated thing with its keys; folded, the timeline is one strip' });
    this.fit = new Button({ label: 'Fit', cls: 'tl-fit', title: 'Show the whole scene', onClick: () => {
      this.state.fit();
      this.redraw();
    } });
    this.el = el('div', { cls: 'timeline' }, [
      el('div', { cls: 'tl-bar' }, [
        el('div', { cls: 'tl-transport' }, [
          tb(Action.FirstFrame, GLYPH.toStart, 'Go to start').el,
          tb(Action.PrevKey, GLYPH.stepBack, 'Previous key').el,
          stop.el,
          this.play.el,
          tb(Action.NextKey, GLYPH.stepForward, 'Next key').el,
          tb(Action.LastFrame, GLYPH.toEnd, 'Go to end').el,
        ]),
        this.clock.el,
        this.loop.el,
        tracks.el,
        el('span', { cls: 'tl-bar-gap' }),
        filter.el,
        el('span', { cls: 'tl-bar-label', text: 'Strip' }),
        strip.el,
      ]),
      el('div', { cls: 'tl-sheet' }, [
        el('div', { cls: 'tl-corner' }, [el('span', { text: 'Tracks' }), el('span', { cls: 'tl-corner-key', text: 'Key here' })]),
        this.ruler.canvas,
        this.inspector.el,
        el('div', { cls: 'tl-strip-side', text: 'Camera view' }),
        this.strip.canvas,
        this.names.el,
        this.lanes.canvas,
        el('div', { cls: 'tl-zoom' }, [this.fit.el, this.range]),
        this.overview.canvas,
      ]),
    ]);
    document.body.append(tip.el);
    // A value still being typed in the inspector goes into its own key before a press elsewhere picks another.
    this.el.addEventListener('pointerdown', (e) => {
      const typing = document.activeElement;
      if (typing instanceof HTMLInputElement && this.inspector.el.contains(typing) && !this.inspector.el.contains(e.target as Node)) typing.blur();
    }, true);
    for (const c of [this.ruler.canvas, this.lanes.canvas, this.overview.canvas, this.strip.canvas]) new ResizeObserver(changed).observe(c);
    // Toasts sit above the timeline, whatever its height.
    new ResizeObserver(() => document.body.style.setProperty('--timeline-h', `${this.el.offsetHeight}px`)).observe(this.el);
    ctx.world.events.on('changed', changed);
    ctx.world.events.on('selection', changed);
    onThemeChange(() => {
      this.surfacesRead = false;
      this.redraw();
    });
    const fold = () => {
      this.el.classList.toggle('is-mini', !ctx.editor.state.timelineFull);
      tracks.el.classList.toggle('is-active', ctx.editor.state.timelineFull);
    };
    fold();
    ctx.editor.events.on('changed', ({ state, previous }) => {
      if (state.timelineFull !== previous.timelineFull) {
        fold();
        this.redraw();
      }
      if (state.playing !== previous.playing || state.selectedKeys !== previous.selectedKeys) this.redraw();
    });
    this.redraw();
  }

  private stop(): void {
    if (this.ctx.editor.state.playing) this.ctx.dispatch(Action.PlayPause);
  }

  private setStrip(on: boolean): void {
    this.state.strip = on;
    this.el.classList.toggle('strip-on', on);
    if (!on) this.strip.stop();
    this.redraw();
  }

  private redraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  private draw(): void {
    if (!this.el.isConnected || !this.el.offsetParent) return;
    if (!this.surfacesRead) {
      this.surfacesRead = true;
      readSurfaces((name, fallback) => cssColor(this.el, name, fallback));
    }
    const w = this.ctx.world;
    const a = w.scene.animation;
    this.clock.show(w.time, a);
    const playing = this.ctx.editor.state.playing;
    if (playing !== this.shownPlaying) {
      this.shownPlaying = playing;
      this.play.el.replaceChildren(glyph(playing ? GLYPH.pause : GLYPH.play, GLYPH_BOX));
      this.play.active = playing;
    }
    this.loop.active = a.loop;
    // The playhead moving out of a zoomed sheet (playing, stepping): the sheet pages along with it.
    const st = this.state;
    if (!st.fitted && w.time !== this.shownTime) st.window = followWindow(st.window, w.time, st.total, st.minSpan);
    this.shownTime = w.time;
    const win = st.window;
    this.fit.el.hidden = st.fitted;
    this.range.textContent = st.fitted ? `All · ${formatClock(st.total)}` : `${formatClock(win.t0)}–${formatClock(win.t1)}`;
    this.names.update();
    this.ruler.draw();
    this.lanes.draw();
    this.overview.draw();
    if (st.strip) this.strip.draw();
    this.inspector.update();
  }
}

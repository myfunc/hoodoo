import { Logger } from '../core/log';
import { ViewKind } from '../model/scene.enums';
import type { UiContext } from '../ui/context';
import type { EditorState } from '../world/editor-store';
import type { PlayerSettings } from '../world/player-settings';
import { changeSetting, onSetting } from '../world/settings';
import { LiveQuality, PictureMode } from '../world/world.enums';
import { PlayHud } from './play-hud';
import { PlayInput } from './play-input';
import { PlayPanel } from './play-panel';
import { FixedClock } from './sim/clock';
import type { PlaySim } from './sim/play-sim';
import { withTakes } from './sim/take';
import './play.css';

const logger = Logger.create('Play');
const MS_PER_S = 1000;
/** The HUD's text changes at most this often. */
const READOUT_MS = 100;
const UNDO_LABEL = 'Record take';
/** The editor's hint line while playing (the HUD names the keys). */
const STATUS_HINT = { title: 'Play', text: 'Esc leaves · Tab setup' } as const;
const READY_HINT = { title: 'Ready', text: '' } as const;

let current: PlaySession | null = null;

/** A play session is running. */
export const isPlaying = (): boolean => current !== null;

/** Play: enter from the editor, or leave (the scene is as it was unless a take was recorded). */
export function togglePlay(ctx: UiContext): void {
  if (current) current.exit();
  else current = new PlaySession(ctx);
}

/** What scripted checks may drive (window.__hoodooPlay): they cannot lock the pointer. */
export interface PlayAutomation {
  readonly sim: () => PlaySim | null;
  readonly run: () => void;
  readonly pause: () => void;
  readonly key: (code: string, down: boolean) => void;
  readonly look: (dx: number, dy: number) => void;
  readonly record: () => void;
  readonly exit: () => void;
  readonly fps: () => number;
}

/**
 * READ ME — the play session: enter, pause, exit. Entering switches the
 * editor to the single Camera view with the live picture, puts the HUD over it,
 * locks the pointer and loads the simulation (Rapier comes in its own chunk).
 * Each animation frame runs the fixed 100 Hz steps that are due and hands the
 * interpolated frame to the scene window (SceneView.setPlay / playFrame). The
 * world is never touched while playing; leaving puts the editor back, and a
 * recorded take becomes keys in one undo step.
 */
class PlaySession {
  private sim: PlaySim | null = null;
  private readonly hud = new PlayHud();
  private readonly input: PlayInput;
  private readonly panel: PlayPanel;
  private readonly clock = new FixedClock();
  private readonly restore: Pick<EditorState, 'view' | 'quad' | 'liveRender' | 'picture'>;
  private readonly off: (() => void)[] = [];
  private raf = 0;
  private last = 0;
  private lastReadout = 0;
  private fps = 0;
  private paused = true;
  private ended = false;
  /** Record was switched off by the user (not by a full track). */
  private userStopped = false;

  constructor(private readonly ctx: UiContext) {
    const { editor, view } = ctx;
    const s = editor.state;
    this.restore = { view: s.view, quad: s.quad, liveRender: s.liveRender, picture: s.picture };
    editor.update({ view: ViewKind.Camera, quad: false, liveRender: true, picture: PictureMode.Edit });
    editor.setHint(STATUS_HINT);
    this.input = new PlayInput(this.hud.el, {
      look: (dx, dy) => this.sim?.driver.look(dx, dy),
      record: () => this.record(),
      setup: () => (this.input.isLocked ? this.input.release() : this.input.lock()),
      exit: () => this.exit(),
      locked: (on, byUser) => this.locked(on, byUser),
    });
    this.panel = new PlayPanel({
      player: () => this.ctx.editor.state.settings.player,
      setPlayer: (p) => changeSetting(this.ctx.editor, 'player', p),
      recording: () => this.sim?.recording ?? false,
      record: () => this.record(),
      resume: () => this.input.lock(),
      exit: () => this.exit(),
    });
    this.hud.setPanel(this.panel.el);
    this.hud.paused = true;
    this.hud.el.addEventListener('click', () => { if (!this.input.isLocked) this.input.lock(); });
    view.root.append(this.hud.el);
    view.root.classList.add('is-playing');
    // The click or key that started Play allows the lock now; otherwise the first click on the picture does.
    this.input.lock();
    this.off.push(
      view.events.on('layout', () => this.hud.place(view.pictureFrame())),
      view.events.on('live', (st) => { this.fps = st.fps; }),
      onSetting(editor, 'player', (p: PlayerSettings) => this.sim?.setPlayer(p)),
    );
    this.hud.place(view.pictureFrame());
    this.automate();
    void this.load();
  }

  exit(): void {
    if (this.ended) return;
    this.ended = true;
    current = null;
    cancelAnimationFrame(this.raf);
    const { editor, view } = this.ctx;
    const sim = this.sim;
    if (sim?.recording) sim.record(false);
    this.input.dispose();
    for (const f of this.off) f();
    this.hud.el.remove();
    view.root.classList.remove('is-playing');
    view.setPlay(null);
    editor.update(this.restore);
    editor.setHint(READY_HINT);
    delete (window as unknown as Record<string, unknown>).__hoodooPlay;
    if (!sim) return;
    this.commit(sim);
    sim.dispose();
  }

  private async load(): Promise<void> {
    const { world, editor, view } = this.ctx;
    try {
      const { PlaySim } = await import('./sim/play-sim');
      const sim = await PlaySim.create({ scene: world.scene, time: world.time, player: editor.state.settings.player });
      if (this.ended) {
        sim.dispose();
        return;
      }
      this.sim = sim;
      sim.events.on('record', ({ on }) => {
        this.panel.sync();
        if (!on && !this.userStopped) this.ctx.toast('Take full: a track holds 600 keys');
        this.userStopped = false;
      });
      this.hud.ready();
      view.setPlay({ frame: () => sim.frame(this.clock.alpha), quality: LiveQuality.Fast });
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
      logger.info('play started', { objects: world.scene.objects.length, bodies: sim.bodies.items.size });
    } catch (error) {
      logger.error('play could not start', {}, error);
      this.ctx.toast('Play could not start: the physics engine did not load');
      this.exit();
    }
  }

  private record(): void {
    const sim = this.sim;
    if (!sim) return;
    this.userStopped = sim.recording;
    sim.record(!sim.recording);
    this.panel.sync();
  }

  /** The pointer came or went: locked plays; Esc (the browser lets go, the page keeps focus) leaves; anything else pauses. */
  private locked(on: boolean, byUser: boolean): void {
    if (!on && byUser && document.hasFocus() && this.sim) {
      this.exit();
      return;
    }
    this.setPaused(!on);
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.input.active = !paused;
    this.hud.paused = paused;
    this.last = performance.now();
    if (paused) this.panel.sync();
  }

  private readonly tick = (now: number): void => {
    const sim = this.sim;
    if (!sim || this.ended) return;
    const steps = this.paused ? 0 : this.clock.advance((now - this.last) / MS_PER_S);
    this.last = now;
    for (let i = 0; i < steps; i++) sim.step(this.input.sample());
    this.ctx.view.playFrame();
    if (now - this.lastReadout > READOUT_MS) {
      this.lastReadout = now;
      const take = sim.recording ? sim.time - (sim.takeStart ?? sim.time) : null;
      this.hud.recording(take);
      this.hud.setReadout(`${sim.driver.readout?.() ?? ''} · ${this.fps} fps`);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** The takes become keys in one undo step, and one line says what was recorded. */
  private commit(sim: PlaySim): void {
    if (!sim.takes.length) return;
    const { world } = this.ctx;
    const r = withTakes(world.scene, sim.takes);
    world.setAnimation(r.animation, UNDO_LABEL);
    const bodies = r.bodies ? ` and ${r.bodies} moving object${r.bodies > 1 ? 's' : ''}` : '';
    this.ctx.toast(`Recorded ${r.seconds.toFixed(1)} s: ${r.cameraKeys} camera keys${bodies} · Undo removes the take`);
  }

  /** window.__hoodooPlay for tools/*.mjs checks. */
  private automate(): void {
    const hook: PlayAutomation = {
      sim: () => this.sim,
      run: () => this.setPaused(false),
      pause: () => this.setPaused(true),
      key: (code, down) => this.input.hold(code, down),
      look: (dx, dy) => this.sim?.driver.look(dx, dy),
      record: () => this.record(),
      exit: () => this.exit(),
      fps: () => this.fps,
    };
    (window as unknown as Record<string, unknown>).__hoodooPlay = hook;
  }
}

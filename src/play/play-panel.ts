import { Button, Choice, NumberField, Toggle } from '../ui/kit/controls';
import { el } from '../ui/kit/dom';
import { PLAY_PICTURE, PLAY_RESOLUTIONS } from '../ui/labs/play-picture';
import { type PlaneSettings, PlayActor, isPlaneSettings } from '../world/plane-settings';
import { PlayerPreset, type PlayerSettings, isPlayerSettings, presetPlayer } from '../world/player-settings';
import type { PlayResolution } from '../world/settings';

const ACTORS: readonly { value: PlayActor; label: string; title: string }[] = [
  { value: PlayActor.Walker, label: 'Walker', title: 'Half-Life’s walk: W A S D, Space jumps, V noclip' },
  { value: PlayActor.Plane, label: 'Plane', title: 'A toy plane: the mouse flies it, W and S throttle' },
];

type PlaneNumber = Exclude<keyof PlaneSettings, 'invertPitch'>;
const PLANE_FIELDS: readonly { key: PlaneNumber; label: string; title: string; digits: number }[] = [
  { key: 'speedScale', label: 'Speed ×', title: 'Every speed of the flight, times the default', digits: 2 },
  { key: 'turnRate', label: 'Turn ×', title: 'How fast it pitches, rolls and turns, times the default', digits: 2 },
];

const PRESETS: readonly { value: PlayerPreset; label: string; title: string }[] = [
  { value: PlayerPreset.Human, label: 'Human', title: 'Half-Life’s player: 1.8 units tall' },
  { value: PlayerPreset.Tiny, label: 'Tiny', title: 'A tenth of a human: everything is huge' },
  { value: PlayerPreset.Giant, label: 'Giant', title: 'Ten times a human: the scene is a model' },
  { value: PlayerPreset.Custom, label: 'Custom', title: 'Your own numbers below' },
];

type NumberKey = Exclude<keyof PlayerSettings, 'preset'>;
const FIELDS: readonly { key: NumberKey; label: string; title: string; digits: number }[] = [
  { key: 'height', label: 'Height', title: 'Feet to the top of the head, in scene units', digits: 2 },
  { key: 'eyeHeight', label: 'Eyes', title: 'Feet to the eyes', digits: 2 },
  { key: 'radius', label: 'Radius', title: 'Half the width of the body', digits: 2 },
  { key: 'jumpHeight', label: 'Jump', title: 'How high a jump lifts the feet', digits: 2 },
  { key: 'speedScale', label: 'Speed ×', title: 'Run speed and acceleration, times Half-Life’s', digits: 2 },
  { key: 'gravityScale', label: 'Gravity ×', title: 'Gravity, times Half-Life’s', digits: 2 },
  { key: 'sensitivity', label: 'Mouse', title: 'How fast the mouse turns the view', digits: 2 },
];

export interface PlayPanelHooks {
  readonly player: () => PlayerSettings;
  readonly setPlayer: (p: PlayerSettings) => void;
  readonly actor: () => PlayActor;
  readonly setActor: (a: PlayActor) => void;
  readonly plane: () => PlaneSettings;
  readonly setPlane: (p: PlaneSettings) => void;
  readonly recording: () => boolean;
  readonly record: () => void;
  readonly resume: () => void;
  readonly exit: () => void;
  /** Play's picture: sharp, smooth or both (kept in Settings). */
  readonly resolution: () => PlayResolution;
  readonly setResolution: (r: PlayResolution) => void;
}

/**
 * The setup panel, over the picture while the pointer is free (Tab): who
 * plays (Walker or Plane), the player's size and movement or the plane's
 * speed, turn rate and pitch direction (all kept in Settings), Record, Resume
 * and Exit. Lengths are scene units; a preset sets them all at Half-Life's
 * proportions, and the plane is sized after the player.
 */
export class PlayPanel {
  readonly el: HTMLElement;
  private readonly presets: Choice<PlayerPreset>;
  private readonly fields = new Map<NumberKey, NumberField>();
  private readonly recordButton: Button;
  private readonly actors: Choice<PlayActor>;
  private readonly title: HTMLElement;
  private readonly walkerGrid: HTMLElement;
  private readonly planeGrid: HTMLElement;
  private readonly planeFields = new Map<PlaneNumber, NumberField>();
  private readonly invert: Toggle;
  private readonly picture: Choice<PlayResolution>;

  constructor(private readonly hooks: PlayPanelHooks) {
    this.presets = new Choice({
      items: PRESETS, value: hooks.player().preset, cls: 'segmented',
      onChange: (preset) => { if (preset !== PlayerPreset.Custom) this.apply(presetPlayer(preset, hooks.player().sensitivity)); },
    });
    const grid = el('div', { cls: 'play-fields' });
    for (const f of FIELDS) {
      const field = new NumberField({ value: hooks.player()[f.key], digits: f.digits, title: f.title, onCommit: (v) => this.change(f.key, v) });
      this.fields.set(f.key, field);
      grid.append(el('span', { cls: 'play-field-name', text: f.label, title: f.title }), field.el);
    }
    this.walkerGrid = grid;
    this.actors = new Choice({ items: ACTORS, value: hooks.actor(), cls: 'segmented play-actors', onChange: (a) => { hooks.setActor(a); this.sync(); } });
    this.planeGrid = el('div', { cls: 'play-fields' });
    for (const f of PLANE_FIELDS) {
      const field = new NumberField({ value: hooks.plane()[f.key], digits: f.digits, title: f.title, onCommit: (v) => this.changePlane({ [f.key]: v }) });
      this.planeFields.set(f.key, field);
      this.planeGrid.append(el('span', { cls: 'play-field-name', text: f.label, title: f.title }), field.el);
    }
    this.invert = new Toggle({ label: 'Invert pitch', value: hooks.plane().invertPitch, title: 'Mouse and arrows pitch like a stick: pull back to climb', onChange: (v) => this.changePlane({ invertPitch: v }) });
    this.planeGrid.append(this.invert.el);
    this.title = el('div', { cls: 'play-panel-title', text: 'Player' });
    this.picture = new Choice({ items: PLAY_RESOLUTIONS, value: hooks.resolution(), cls: 'segmented play-picture', onChange: (r) => hooks.setResolution(r) });
    this.recordButton = new Button({ cls: 'play-record', content: el('span', { cls: 'play-rec-dot' }), label: 'Record', title: 'Record the camera and what moves as keys (K)', onClick: () => { hooks.record(); this.sync(); } });
    const resume = new Button({ label: 'Resume', title: 'Back to the game (click the picture or Tab)', onClick: () => hooks.resume() });
    const exit = new Button({ label: 'Exit', title: 'Leave Play (Esc)', onClick: () => hooks.exit() });
    this.el = el('div', { cls: 'play-panel' }, [
      this.actors.el,
      this.title,
      this.presets.el,
      grid,
      this.planeGrid,
      el('div', { cls: 'play-panel-title', text: PLAY_PICTURE.name, title: PLAY_PICTURE.hint }),
      this.picture.el,
      el('div', { cls: 'play-actions' }, [this.recordButton.el, resume.el, exit.el]),
    ]);
    // Clicks on the panel stay on the panel (the layer behind it resumes play on a click).
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => e.stopPropagation());
    this.sync();
  }

  /** A section a mode adds above Record, Resume and Exit (Sandbox's Garry's Mod files). */
  addSection(section: HTMLElement): void {
    this.el.insertBefore(section, this.el.lastElementChild);
  }

  /** Shows the settings and the record state as they are now. */
  sync(): void {
    const p = this.hooks.player();
    this.presets.set(p.preset);
    for (const [key, field] of this.fields) field.set(p[key]);
    const plane = this.hooks.plane();
    for (const [key, field] of this.planeFields) field.set(plane[key]);
    this.invert.set(plane.invertPitch);
    this.picture.set(this.hooks.resolution());
    const flying = this.hooks.actor() === PlayActor.Plane;
    this.actors.set(this.hooks.actor());
    this.title.textContent = flying ? 'Plane' : 'Player';
    this.walkerGrid.hidden = flying;
    this.planeGrid.hidden = !flying;
    this.recordButton.active = this.hooks.recording();
  }

  private changePlane(patch: Partial<PlaneSettings>): void {
    const next = { ...this.hooks.plane(), ...patch };
    // Out of range: the field shows the old value again.
    if (isPlaneSettings(next)) this.hooks.setPlane(next);
    this.sync();
  }

  private change(key: NumberKey, value: number): void {
    const next: PlayerSettings = { ...this.hooks.player(), [key]: value, preset: PlayerPreset.Custom };
    // Out of range or out of proportion (eyes above the head): the field shows the old value again.
    if (isPlayerSettings(next)) this.apply(next);
    else this.sync();
  }

  private apply(p: PlayerSettings): void {
    this.hooks.setPlayer(p);
    this.sync();
  }
}

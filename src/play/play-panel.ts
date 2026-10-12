import { Button, Choice, NumberField } from '../ui/kit/controls';
import { el } from '../ui/kit/dom';
import { PlayerPreset, type PlayerSettings, isPlayerSettings, presetPlayer } from '../world/player-settings';

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
  readonly recording: () => boolean;
  readonly record: () => void;
  readonly resume: () => void;
  readonly exit: () => void;
}

/**
 * The setup panel, over the picture while the pointer is free (Tab): the
 * player's size and movement (kept in Settings), Record, Resume and Exit.
 * Lengths are scene units; a preset sets them all at Half-Life's proportions.
 */
export class PlayPanel {
  readonly el: HTMLElement;
  private readonly presets: Choice<PlayerPreset>;
  private readonly fields = new Map<NumberKey, NumberField>();
  private readonly recordButton: Button;

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
    this.recordButton = new Button({ cls: 'play-record', content: el('span', { cls: 'play-rec-dot' }), label: 'Record', title: 'Record the camera and what moves as keys (K)', onClick: () => { hooks.record(); this.sync(); } });
    const resume = new Button({ label: 'Resume', title: 'Back to the game (click the picture or Tab)', onClick: () => hooks.resume() });
    const exit = new Button({ label: 'Exit', title: 'Leave Play (Esc)', onClick: () => hooks.exit() });
    this.el = el('div', { cls: 'play-panel' }, [
      el('div', { cls: 'play-panel-title', text: 'Player' }),
      this.presets.el,
      grid,
      el('div', { cls: 'play-actions' }, [this.recordButton.el, resume.el, exit.el]),
    ]);
    // Clicks on the panel stay on the panel (the layer behind it resumes play on a click).
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => e.stopPropagation());
    this.sync();
  }

  /** Shows the settings and the record state as they are now. */
  sync(): void {
    const p = this.hooks.player();
    this.presets.set(p.preset);
    for (const [key, field] of this.fields) field.set(p[key]);
    this.recordButton.active = this.hooks.recording();
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

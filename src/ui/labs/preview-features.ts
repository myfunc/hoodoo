import { KEY } from '../../core/keys';
import { Action } from '../../input/actions';
import { ACTIONS, shortcutOf } from '../../input/bindings';
import { loadPrefs, savePrefs } from '../../io/prefs';
import { type FeatureNotes, NOTE_LIMITS, noteCount, noteTime, notesText, withNote, withoutNote } from '../../world/feature-notes';
import { Feature, type FeatureFlags, type FeatureInfo, featureInfo, isFeatureOn, withFeature } from '../../world/preview-features';
import { type UiContext, hintOn } from '../context';
import { featureActions } from '../feature-gate';
import { Button, Choice } from '../kit/controls';
import { clearChildren, el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { showToast } from '../panels/toast';
import { APP_VERSION } from '../strings';

const OFF_ON = [{ value: false, label: 'Off' }, { value: true, label: 'On' }] as const;
/** Four lines of the comment field. */
const FIELD_MAX_PX = 72;

/** The quickest way into each feature, from its window. */
const TRY: Readonly<Record<Feature, { action: Action; label: string; hint: string }>> = {
  [Feature.Portals]: { action: Action.CreatePortals, label: 'Add a pair', hint: 'Adds a linked pair of portals to the scene' },
  [Feature.Play]: { action: Action.Play, label: 'Play now', hint: 'Walk the scene from the camera; Esc leaves' },
  [Feature.Sandbox]: { action: Action.Play, label: 'Play now', hint: 'Play with the Physics Gun on 1; Esc leaves' },
  [Feature.Cloud]: { action: Action.CloudGallery, label: 'Open Gallery', hint: 'Browse the public Gallery; sign in to save and post' },
};

/**
 * What the Preview Features window shows and changes: the switches (editor
 * state, remembered by app/bootstrap.ts) and the comments (kept in prefs).
 * Every part of the window registers a refresh with `watch`.
 */
export class PreviewModel {
  private notes: FeatureNotes = loadPrefs().featureNotes;
  private readonly refreshers: (() => void)[] = [];

  constructor(readonly ctx: UiContext) {}

  get flags(): FeatureFlags {
    return this.ctx.editor.state.features;
  }

  get comments(): FeatureNotes {
    return this.notes;
  }

  isOn(f: Feature): boolean {
    return isFeatureOn(this.flags, f);
  }

  turn(f: Feature, on: boolean): void {
    this.ctx.editor.update({ features: withFeature(this.flags, f, on) });
  }

  comment(f: Feature, text: string): void {
    this.save(withNote(this.notes, f, text));
  }

  uncomment(f: Feature, index: number): void {
    this.save(withoutNote(this.notes, f, index));
  }

  /** Every comment as text on the clipboard, to paste into a message. */
  copy(): void {
    if (!noteCount(this.notes)) {
      showToast('No comments yet: write one under a feature');
      return;
    }
    navigator.clipboard?.writeText(notesText(this.notes, APP_VERSION, (f) => this.isOn(f))).catch(() => undefined);
    showToast('Comments copied: paste them into a message');
  }

  watch(refresh: () => void): void {
    this.refreshers.push(refresh);
    refresh();
  }

  refresh(): void {
    for (const r of this.refreshers) r();
  }

  private save(next: FeatureNotes): void {
    this.notes = next;
    savePrefs({ featureNotes: next });
    this.refresh();
  }
}

/** Off | On for one feature. */
export function featureSwitch(m: PreviewModel, f: Feature): HTMLElement {
  const choice = new Choice<boolean>({ items: OFF_ON, value: m.isOn(f), cls: 'segmented pf-switch', onChange: (on) => m.turn(f, on) });
  hintOn(m.ctx, choice.el, { title: featureInfo(f).name, text: 'Off leaves no trace of it; On adds it' });
  m.watch(() => choice.set(m.isOn(f)));
  return choice.el;
}

/** A small lamp, lit while the feature is on. */
export function featureLamp(m: PreviewModel, f: Feature): HTMLElement {
  const lamp = el('span', { cls: 'pf-lamp' });
  m.watch(() => lamp.classList.toggle('is-on', m.isOn(f)));
  return lamp;
}

/** How many comments a feature has, or nothing. */
export function commentCount(m: PreviewModel, f: Feature): HTMLElement {
  const count = el('span', { cls: 'pf-count' });
  m.watch(() => {
    const n = noteCount(m.comments, f);
    count.textContent = n ? String(n) : '';
    count.title = n ? `${n} comment${n === 1 ? '' : 's'}` : '';
  });
  return count;
}

/** Its menu commands and its other additions, one short line each. */
export function addsLines(info: FeatureInfo): string[] {
  const commands = featureActions(info.id).map((a) => {
    const key = shortcutOf(a);
    return `${ACTIONS[a].menu} › ${ACTIONS[a].label.replace(/:.*/, '')}${key ? ` (${key})` : ''}`;
  });
  return [...commands, ...info.adds];
}

export const featureAdds = (info: FeatureInfo): HTMLElement =>
  el('ul', { cls: 'pf-adds' }, addsLines(info).map((line) => el('li', { text: line, title: line })));

/** Since which version, and what it needs. */
export function featureMeta(info: FeatureInfo): HTMLElement {
  const parts = [`Since ${info.since}`, ...(info.needs ? [`needs ${featureInfo(info.needs).name}`] : [])];
  return el('span', { cls: 'pf-meta', text: parts.join(' · ') });
}

/** Turns the feature on and goes straight into it. */
export function tryButton(m: PreviewModel, f: Feature): HTMLElement {
  const t = TRY[f];
  const button = new Button({ label: t.label, cls: 'pf-try', onClick: () => { m.turn(f, true); m.ctx.dispatch(t.action); } });
  hintOn(m.ctx, button.el, { title: t.label, text: t.hint });
  return button.el;
}

/** The feature's comments, oldest first, each with its time and a remove mark, and a field to add one. */
export class CommentThread {
  readonly el: HTMLElement;
  readonly field: HTMLTextAreaElement;
  private readonly list: HTMLElement;

  constructor(private readonly m: PreviewModel, private readonly f: Feature, cls = '') {
    this.list = el('div', { cls: 'pf-notes' });
    this.field = el('textarea', { cls: 'ui-number ui-text pf-field', attrs: { rows: '1', maxlength: String(NOTE_LIMITS.chars), placeholder: 'Write a comment · Enter adds it', spellcheck: 'true' } });
    const add = new Button({ label: 'Add', cls: 'pf-add', onClick: () => this.post() });
    this.field.addEventListener('keydown', (e) => {
      // The editor's keys stay out of a comment.
      e.stopPropagation();
      if (e.key === KEY.Enter && !e.shiftKey) {
        e.preventDefault();
        this.post();
      }
    });
    this.field.addEventListener('input', () => this.grow());
    this.el = el('div', { cls: `pf-thread ${cls}`.trim() }, [this.list, el('div', { cls: 'pf-compose' }, [this.field, add.el])]);
    m.watch(() => this.render());
  }

  focus(): void {
    this.field.focus();
  }

  private post(): void {
    const text = this.field.value;
    if (!text.trim()) return;
    this.field.value = '';
    this.grow();
    this.m.comment(this.f, text);
  }

  /** The field grows with its text, up to four lines. */
  private grow(): void {
    this.field.style.height = 'auto';
    this.field.style.height = `${Math.min(this.field.scrollHeight, FIELD_MAX_PX)}px`;
  }

  private render(): void {
    clearChildren(this.list);
    const notes = this.m.comments[this.f] ?? [];
    notes.forEach((n, i) => {
      const remove = new Button({ cls: 'mark-chip pf-remove', content: glyph(GLYPH.cross, GLYPH_BOX), onClick: () => this.m.uncomment(this.f, i) });
      remove.el.setAttribute('aria-label', 'Remove this comment');
      this.list.append(el('div', { cls: 'pf-note' }, [el('span', { cls: 'pf-note-time', text: noteTime(n.at) }), el('span', { cls: 'pf-note-text', text: n.text }), remove.el]));
    });
  }
}

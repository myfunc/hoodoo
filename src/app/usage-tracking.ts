import type { Action } from '../input/actions';
import { TEXT_TAGS } from '../core/keys';
import { type UsageLog, bump, loadUsage, saveUsage } from '../io/usage-log';
import { isPlaying } from '../play/session';
import type { EditorStore } from '../world/editor-store';

/** How often the minutes are counted, and how soon after a key press a command counts as run by it. */
const TICK_MS = 15000;
const MS_PER_MIN = 60000;
const KEY_WINDOW_MS = 80;
const SAVE_MS = 5000;
const LABEL_MAX = 32;

/** The places of the window a press is counted in, the first that holds it. */
const REGIONS: readonly (readonly [string, string])[] = [
  ['.ui-menu', 'Menu'],
  ['.menubar', 'Menu bar'],
  ['.side-rail', 'Right rail'],
  ['.tool-rail', 'Left rail'],
  ['.ui-dialog', 'Window'],
  ['.start-overlay', 'Start window'],
  ['.left-column', 'Left panel'],
  ['.right-column', 'Right panel'],
  ['.palette-titles, .shelf', 'Palette'],
  ['.timeline', 'Timeline'],
  ['.display-bar', 'Bottom bar'],
  ['.scene-window', 'Scene window'],
];
/** A control without a label or title is named by the words on it. */
const WORDED = 'button, .ui-button, .ui-choice > *, .menubar-item, .menubar-title, .ui-menu-item, .palette-title, .ro-name';

/** "Region › control" for a press on `t`. */
export function placeOf(t: Element): string {
  for (const [sel, name] of REGIONS) {
    const region = t.closest(sel);
    if (!region) continue;
    const where = sel === '.ui-dialog' ? `${name} ${region.getAttribute('aria-label') ?? ''}`.trim() : name;
    const what = controlName(t, region);
    return what ? `${where} › ${what}` : where;
  }
  return 'Other';
}

function controlName(t: Element, region: Element): string {
  for (let e: Element | null = t; e && e !== region; e = e.parentElement) {
    const named = e.getAttribute('aria-label') ?? e.getAttribute('title');
    if (named) return named.slice(0, LABEL_MAX);
    if (e.matches(WORDED)) return (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  }
  return '';
}

/** A key as counted: its code with the modifiers held. */
const keyName = (e: KeyboardEvent): string =>
  [e.ctrlKey && 'Ctrl', e.metaKey && 'Cmd', e.altKey && 'Alt', e.shiftKey && 'Shift', e.code].filter(Boolean).join('+');

/**
 * READ ME — counts what the editor is used for, in this browser only (io/usage-log.ts):
 * commands and whether a key ran them, presses by place, keys, and minutes in each state
 * while the window is in front. Help › Usage Log… saves it as a file.
 */
export class UsageTracking {
  readonly log: UsageLog = loadUsage();
  private lastKeyAt = -Infinity;
  private dirty = false;

  constructor(private readonly editor: EditorStore) {
    this.log.sessions++;
    this.dirty = true;
    document.addEventListener('keydown', (e) => this.key(e), true);
    document.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && e.target instanceof Element && !isPlaying()) this.count(this.log.clicks, placeOf(e.target));
    }, true);
    setInterval(() => this.tick(), TICK_MS);
    setInterval(() => this.save(), SAVE_MS);
    addEventListener('pagehide', () => this.save());
  }

  /** A command is about to run. */
  action(a: Action): void {
    this.count(this.log.actions, a);
    if (performance.now() - this.lastKeyAt < KEY_WINDOW_MS) this.count(this.log.byKey, a);
  }

  private key(e: KeyboardEvent): void {
    this.lastKeyAt = performance.now();
    const t = e.target as HTMLElement | null;
    if (e.repeat || isPlaying() || (t && (TEXT_TAGS.has(t.tagName) || t.isContentEditable))) return;
    this.count(this.log.keys, keyName(e));
  }

  private tick(): void {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    const s = this.editor.state;
    const by = TICK_MS / MS_PER_MIN;
    const states = [
      isPlaying() ? 'Play' : `Picture ${s.picture}${s.liveRender ? ' live' : ''}`,
      s.maximized ? 'Maximized' : `Panels left ${s.leftPanel ? 'on' : 'off'}, right ${s.sidePanel ? 'on' : 'off'}`,
      s.quad ? 'Four Views' : `View ${s.view}`,
    ];
    for (const name of states) bump(this.log.minutes, name, by);
    this.dirty = true;
  }

  private count(table: Record<string, number>, name: string): void {
    bump(table, name);
    this.dirty = true;
  }

  private save(): void {
    if (!this.dirty) return;
    this.dirty = false;
    saveUsage(this.log);
  }
}

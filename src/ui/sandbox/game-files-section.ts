import { Button } from '../kit/controls';
import { el } from '../kit/dom';

/** Where the player's Garry's Mod files stand. */
export enum GameFilesState {
  /** None picked: Sandbox draws its own look. */
  None = 'none',
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

export interface GameFilesStatus {
  readonly state: GameFilesState;
  /** The folder's name. */
  readonly folder?: string;
  /** Why it failed. */
  readonly error?: string;
}

export interface GameFilesHooks {
  readonly choose: () => void;
  readonly forget: () => void;
}

const TEXT: Readonly<Record<GameFilesState, (s: GameFilesStatus) => string>> = {
  [GameFilesState.None]: () => 'Real guns from your copy',
  [GameFilesState.Loading]: (s) => `Loading ${s.folder ?? 'files'}…`,
  [GameFilesState.Ready]: (s) => `${s.folder} · loaded`,
  [GameFilesState.Failed]: (s) => s.error ?? 'Could not read the folder',
};
const CHOOSE_TITLE = 'Pick your GarrysMod folder (with garrysmod and sourceengine inside); the few files used stay in this browser, nothing is uploaded';

/**
 * The Play panel's Garry's Mod section in Sandbox: one line saying where the
 * player's game files stand, and the buttons that move them on — choose a
 * folder, change it, or forget it.
 */
export class GameFilesSection {
  readonly el: HTMLElement;
  private readonly line: HTMLElement;
  private readonly choose: Button;
  private readonly forget: Button;

  constructor(hooks: GameFilesHooks) {
    this.line = el('div', { cls: 'sbx-files-line' });
    this.choose = new Button({ label: 'Choose folder…', title: CHOOSE_TITLE, onClick: () => hooks.choose() });
    this.forget = new Button({ label: 'Forget', title: 'Stop using these files and drop the ones kept in this browser', onClick: () => hooks.forget() });
    this.el = el('div', { cls: 'sbx-files' }, [
      el('div', { cls: 'play-panel-title', text: 'Garry’s Mod' }),
      this.line,
      el('div', { cls: 'play-actions' }, [this.choose.el, this.forget.el]),
    ]);
    this.set({ state: GameFilesState.None });
  }

  set(s: GameFilesStatus): void {
    const text = TEXT[s.state](s);
    this.line.textContent = text;
    this.line.title = text;
    this.line.classList.toggle('is-error', s.state === GameFilesState.Failed);
    this.choose.el.textContent = s.state === GameFilesState.Ready ? 'Change…' : 'Choose folder…';
    this.forget.el.hidden = s.state !== GameFilesState.Ready;
    for (const b of [this.choose, this.forget]) b.disabled = s.state === GameFilesState.Loading;
  }
}

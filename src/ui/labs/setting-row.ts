import type { EditorState, EditorStore } from '../../world/editor-store';
import { Choice } from '../kit/controls';
import { el } from '../kit/dom';

export interface SettingOption<T> {
  readonly value: T;
  readonly label: string;
  /** The row's one-line note while this option is chosen (instead of the row's own). */
  readonly about?: string;
}

/** One row of the Settings window: a name, a segmented choice, a one-line note. */
export interface SettingRow<T> {
  readonly label: string;
  /** One line, no wrapping: what the setting does. */
  readonly about: string;
  readonly options: readonly SettingOption<T>[];
  readonly get: (s: EditorState) => T;
  readonly set: (editor: EditorStore, value: T) => void;
}

/** A row on screen; `sync` shows the editor's value again (after Reset or a change made elsewhere). */
export interface RowView {
  readonly el: HTMLElement;
  sync(s: EditorState): void;
}

const aboutOf = <T>(row: SettingRow<T>, value: T): string => row.options.find((o) => o.value === value)?.about ?? row.about;

export function settingRow<T>(row: SettingRow<T>, editor: EditorStore): RowView {
  const about = el('span', { cls: 'setting-about' });
  const choice = new Choice<T>({
    items: row.options.map((o) => ({ value: o.value, label: o.label, title: o.about })),
    value: row.get(editor.state),
    cls: 'segmented',
    onChange: (value) => row.set(editor, value),
  });
  const node = el('div', { cls: 'setting-row' }, [el('span', { cls: 'setting-name', text: row.label }), choice.el, about]);
  const sync = (s: EditorState) => {
    const value = row.get(s);
    choice.set(value);
    about.textContent = aboutOf(row, value);
  };
  sync(editor.state);
  return { el: node, sync };
}

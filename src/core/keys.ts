/** Raw key names in one place (canon C11); components compare against these, never literals. */
export const KEY = {
  Enter: 'Enter',
  Escape: 'Escape',
  Space: ' ',
  Tab: 'Tab',
  Delete: 'Delete',
  Backspace: 'Backspace',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Shift: 'Shift',
  Alt: 'Alt',
} as const;

/** Element tag names that own the keyboard while focused. */
export const TEXT_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA']);

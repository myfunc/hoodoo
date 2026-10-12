/**
 * Garry's Mod's default keys for Sandbox (its cfg/config_default.cfg), as
 * layout-independent codes. Play's own keys (play-input.ts) move the player;
 * these are taken first, so C opens the context menu instead of ducking.
 */
export const SANDBOX_KEYS = {
  spawnMenu: 'KeyQ',
  contextMenu: 'KeyC',
  undo: 'KeyZ',
  use: 'KeyE',
  reload: 'KeyR',
  noclip: 'KeyV',
  flashlight: 'KeyF',
  zoom: 'KeyB',
  snap: ['ShiftLeft', 'ShiftRight'],
  slots: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'],
} as const;

const SNAP: ReadonlySet<string> = new Set(SANDBOX_KEYS.snap);
export const isSnapKey = (code: string): boolean => SNAP.has(code);

/** The weapon slot a number key picks (1…6), or 0. */
export const slotOfKey = (code: string): number => (SANDBOX_KEYS.slots as readonly string[]).indexOf(code) + 1;

import { describe, expect, it } from 'vitest';
import { Action } from '../actions';
import { ACTIONS, FLY_KEYS, RESIZE_KEY, WALK_KEYS, matchKey } from '../bindings';

const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent;

describe('bindings', () => {
  it('maps plain digits to camera bookmarks and Shift+digit to saving', () => {
    expect(matchKey(key('Digit3'))).toEqual({ action: Action.Bookmark, arg: 2 });
    expect(matchKey(key('Digit3', { shiftKey: true }))).toEqual({ action: Action.SaveBookmark, arg: 2 });
  });

  it('maps single letters', () => {
    expect(matchKey(key('KeyM'))?.action).toBe(Action.EditMaterial);
    expect(matchKey(key('KeyQ'))?.action).toBe(Action.QuadView);
  });

  it('opens the command palette with Ctrl/Cmd+P, Ctrl/Cmd+K and Ctrl/Cmd+/', () => {
    for (const code of ['KeyP', 'KeyK', 'Slash']) {
      expect(matchKey(key(code, { ctrlKey: true, metaKey: true }))?.action, code).toBe(Action.CommandPalette);
    }
    expect(matchKey(key('KeyP'))?.action).toBe(Action.ToggleLiveRender);
  });

  it('leaves the walk keys and the resize key free as plain keys', () => {
    for (const code of [...Object.keys(WALK_KEYS), RESIZE_KEY]) expect(matchKey(key(code)), code).toBeNull();
  });

  it('keeps the shortcuts that share a key with the walk', () => {
    // Shift+A starts no walk (Animation); E and Q fly only with the right button held.
    expect(matchKey(key('KeyA', { shiftKey: true }))?.action).toBe(Action.ToggleAnimation);
    expect(matchKey(key('KeyE'))?.action).toBe(Action.EditObject);
    expect(matchKey(key('KeyR', { ctrlKey: true, metaKey: true }))?.action).toBe(Action.Render);
    expect(Object.keys(FLY_KEYS)).toEqual(expect.arrayContaining([...Object.keys(WALK_KEYS), 'KeyE', 'KeyQ']));
  });

  it('runs Randomize from the menu only, never from a chord', () => {
    expect(ACTIONS[Action.Randomize].chords).toEqual([]);
    for (const mods of [{ altKey: true }, { shiftKey: true }, { ctrlKey: true, altKey: true }]) {
      expect(matchKey(key('KeyR', mods))?.action).not.toBe(Action.Randomize);
    }
  });

  it('never binds one chord to two actions', () => {
    const seen = new Map<string, Action>();
    for (const [action, info] of Object.entries(ACTIONS) as [Action, (typeof ACTIONS)[Action]][]) {
      for (const c of info.chords) {
        const id = `${c.code}|${!!c.mod}|${!!c.shift}|${!!c.alt}`;
        expect(seen.get(id), `${id} used by ${seen.get(id)} and ${action}`).toBeUndefined();
        seen.set(id, action);
      }
    }
  });
});

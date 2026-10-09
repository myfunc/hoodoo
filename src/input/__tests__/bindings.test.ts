import { describe, expect, it } from 'vitest';
import { Action } from '../actions';
import { ACTIONS, matchKey } from '../bindings';

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

import { describe, expect, it } from 'vitest';
import { Action } from '../../../input/actions';
import { ACTIONS, MenuName } from '../../../input/bindings';
import { MENUS } from '../menu-layout';

/** Actions that need an argument (a bookmark slot) live on the keys 1–9 only. */
const KEYS_ONLY: ReadonlySet<Action> = new Set([Action.Bookmark, Action.SaveBookmark]);

describe('menu layout', () => {
  it('lists every action that belongs to a menu', () => {
    const listed = new Set(MENUS.flatMap((m) => m.items));
    const missing = Object.values(Action).filter((a) => ACTIONS[a].menu !== MenuName.Palette && !KEYS_ONLY.has(a) && !listed.has(a));
    expect(missing).toEqual([]);
  });
});

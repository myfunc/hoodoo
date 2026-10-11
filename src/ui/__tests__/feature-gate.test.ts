import { describe, expect, it } from 'vitest';
import { Action } from '../../input/actions';
import { ACTIONS } from '../../input/bindings';
import { EditorStore } from '../../world/editor-store';
import { Feature, type FeatureFlags, PREVIEW_FEATURES } from '../../world/preview-features';
import { emptyEntries, objectEntries } from '../chrome/context-menu';
import { MENUS, SEP } from '../chrome/menu-layout';
import { FEATURE_ACTIONS, actionShown, shownEntries, showWhile } from '../feature-gate';
import { paletteActions } from '../panels/command-palette';

const ALL_ON: FeatureFlags = Object.fromEntries(PREVIEW_FEATURES.map((f) => [f.id, true]));
const ALL_FACTS = [{ animation: false }, { animation: true }] as const;

/** Every action the interface offers with these features: menu bar, right-click menus, command palette, Keyboard Shortcuts. */
function offered(flags: FeatureFlags): Set<unknown> {
  const menus = MENUS.flatMap((m) => shownEntries(m.items, flags, SEP));
  const context = [...ALL_FACTS.map((f) => objectEntries(f)), emptyEntries()].flatMap((entries) => shownEntries(entries, flags, SEP));
  const shortcuts = (Object.keys(ACTIONS) as Action[]).filter((a) => ACTIONS[a].chords.length && actionShown(flags, a));
  return new Set([...menus, ...context, ...paletteActions(flags), ...shortcuts]);
}

describe('preview features in the interface', () => {
  it('every feature is in the gate table, and an action belongs to one feature at most', () => {
    expect(Object.keys(FEATURE_ACTIONS).sort()).toEqual(Object.values(Feature).sort());
    const gated = Object.values(FEATURE_ACTIONS).flat();
    expect(new Set(gated).size).toBe(gated.length);
  });

  it('a feature that is off leaves no trace; on, it only adds', () => {
    const none = offered({});
    for (const f of Object.values(Feature)) {
      const on = offered({ [f]: true });
      for (const a of FEATURE_ACTIONS[f]) {
        expect(none.has(a), `${a} shows with ${f} off`).toBe(false);
        expect(on.has(a), `${a} missing with ${f} on`).toBe(true);
      }
      expect([...none].filter((a) => !on.has(a)), `${f} on removed something`).toEqual([]);
    }
    expect(offered(ALL_ON).has(Action.NewGroup)).toBe(true);
  });

  it('menus lose the hidden items without doubled or dangling separators', () => {
    expect(shownEntries([Action.NewGroup, SEP, Action.Group, SEP, Action.NewGroup], {}, SEP)).toEqual([Action.Group]);
    expect(shownEntries([Action.Group, SEP, Action.NewGroup, SEP, Action.Land], {}, SEP)).toEqual([Action.Group, SEP, Action.Land]);
    for (const m of MENUS) {
      const items = shownEntries(m.items, {}, SEP);
      expect(items[0]).not.toBe(SEP);
      expect(items.at(-1)).not.toBe(SEP);
      items.forEach((e, i) => { if (e === SEP) expect(items[i + 1]).not.toBe(SEP); });
    }
  });

  it('a feature control is hidden while the feature is off and comes back when it is on', () => {
    const editor = new EditorStore();
    const node = { hidden: false } as HTMLElement;
    showWhile(editor, Feature.ObjectTree, node);
    expect(node.hidden).toBe(true);
    editor.update({ features: { [Feature.ObjectTree]: true } });
    expect(node.hidden).toBe(false);
    editor.update({ features: {} });
    expect(node.hidden).toBe(true);
  });
});

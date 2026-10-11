import { describe, expect, it } from 'vitest';
import { Action } from '../../../input/actions';
import { ACTIONS } from '../../../input/bindings';
import type { UiContext } from '../../context';
import { CREATE, SceneMenu, emptyEntries, objectEntries } from '../context-menu';
import { SEP } from '../menu-layout';

const actions = (entries: readonly unknown[]) => entries.filter((e) => e !== SEP && e !== CREATE);

describe('context menus', () => {
  it('offer the object commands; New Group only with the Object Tree, keys only with animation on', () => {
    const plain = objectEntries({ tree: false, animation: false });
    expect(actions(plain)).toEqual([
      Action.Group, Action.Ungroup, Action.Duplicate, Action.Delete, Action.HideSelected, Action.Land,
      Action.ChooseMaterial, Action.EditMaterial, Action.Attributes, Action.PreviewFeatures,
    ]);
    const full = objectEntries({ tree: true, animation: true });
    expect(actions(full)).toContain(Action.NewGroup);
    expect(actions(full).slice(-3)).toEqual([Action.AddKey, Action.SelectAllKeys, Action.PreviewFeatures]);
  });

  it('end with Preview Features and never stack or trail separators', () => {
    for (const entries of [objectEntries({ tree: false, animation: false }), objectEntries({ tree: true, animation: true }), emptyEntries()]) {
      expect(entries.at(-1)).toBe(Action.PreviewFeatures);
      expect(entries[0]).not.toBe(SEP);
      entries.forEach((e, i) => { if (e === SEP) expect(entries[i + 1]).not.toBe(SEP); });
    }
  });

  it('build items from the bindings table and the commands, with a Create submenu', () => {
    const ran: Action[] = [];
    const ctx = { isChecked: () => false, isEnabled: (a: Action) => a !== Action.Paste, dispatch: (a: Action) => ran.push(a) } as unknown as UiContext;
    const created: string[] = [];
    const items = new SceneMenu(ctx, (e) => created.push(e.id)).items(emptyEntries());
    expect(items[0]).toMatchObject({ label: ACTIONS[Action.Paste].label, disabled: true });
    const create = items.find((i) => i.items);
    expect(create?.label).toBe('Create');
    create?.items?.[0].run?.();
    expect(created).toEqual(['sphere']);
    items.at(-1)?.run?.();
    expect(ran).toEqual([Action.PreviewFeatures]);
  });
});

import { describe, expect, it } from 'vitest';
import { Action } from '../../../input/actions';
import { ACTIONS } from '../../../input/bindings';
import type { UiContext } from '../../context';
import { CREATE, SceneMenu, emptyEntries, objectEntries } from '../context-menu';
import { SEP } from '../menu-layout';
import { EditorStore } from '../../../world/editor-store';

const actions = (entries: readonly unknown[]) => entries.filter((e) => e !== SEP && e !== CREATE);

describe('context menus', () => {
  it('offer the object commands (New Group among them); keys only with animation on', () => {
    const plain = objectEntries({ animation: false });
    expect(actions(plain)).toEqual([
      Action.Group, Action.Ungroup, Action.NewGroup, Action.EditGroup, Action.NewSmartGroup, Action.Duplicate, Action.Delete, Action.HideSelected, Action.Land, Action.SaveToMyObjects,
      Action.ChooseMaterial, Action.EditMaterial, Action.Attributes, Action.PreviewFeatures,
    ]);
    const full = objectEntries({ animation: true });
    expect(actions(full)).toContain(Action.NewGroup);
    expect(actions(full).slice(-3)).toEqual([Action.AddKey, Action.SelectAllKeys, Action.PreviewFeatures]);
  });

  it('end with Preview Features and never stack or trail separators', () => {
    for (const entries of [objectEntries({ animation: false }), objectEntries({ animation: true }), emptyEntries()]) {
      expect(entries.at(-1)).toBe(Action.PreviewFeatures);
      expect(entries[0]).not.toBe(SEP);
      entries.forEach((e, i) => { if (e === SEP) expect(entries[i + 1]).not.toBe(SEP); });
    }
  });

  it('build items from the bindings table and the commands, with a Create submenu', () => {
    const ran: Action[] = [];
    const ctx = { editor: new EditorStore(), isChecked: () => false, isEnabled: (a: Action) => a !== Action.Paste, dispatch: (a: Action) => ran.push(a) } as unknown as UiContext;
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

  it('offer the Chess & Billiards category in the Create submenu', () => {
    const ctx = { editor: new EditorStore(), isChecked: () => false, isEnabled: () => true, dispatch: () => undefined } as unknown as UiContext;
    const made: string[] = [];
    const create = new SceneMenu(ctx, () => undefined, (g) => made.push(g.name)).items(emptyEntries()).find((i) => i.items)!;
    const games = create.items!.find((i) => i.label === 'Chess & Billiards')!;
    expect(games.items!.map((i) => i.label)).toEqual(['Chess Set', 'Chess Board', 'White Pieces', 'Black Pieces', '', 'Pool Rack', 'Pool Balls']);
    games.items!.find((i) => i.label === 'Black Pieces')!.items![0].run?.();
    games.items!.find((i) => i.label === 'Pool Balls')!.items![9].run?.();
    expect(made).toEqual(['Black King', '9 Ball']);
    expect(new SceneMenu(ctx, () => undefined).items(emptyEntries()).find((i) => i.items)!.items!.some((i) => i.label === 'Chess & Billiards')).toBe(false);
  });
});

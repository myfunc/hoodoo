import { type CreateEntry, createEntry } from '../../assets/object.catalog';
import { Action } from '../../input/actions';
import { ACTIONS, shortcutOf } from '../../input/bindings';
import type { ObjectId } from '../../model/scene.ids';
import { Feature, isFeatureOn } from '../../world/preview-features';
import { SelectMode } from '../../world/world';
import type { UiContext } from '../context';
import { type MenuItem, openMenu } from '../kit/controls';
import { type MenuEntry, SEP } from './menu-layout';

/** The Create submenu of the empty-space menu. */
export const CREATE = 'create' as const;
export type ContextEntry = MenuEntry | typeof CREATE;

/** What the Create submenu offers: the everyday primitives of the Create palette. */
const CREATE_IDS = ['sphere', 'cube', 'cylinder', 'cone', 'pyramid', 'torus', 'terrain', 'radial'] as const;

/** What changes the object menu: the Object Tree preview, the scene's animation switch. */
export interface MenuFacts {
  readonly tree: boolean;
  readonly animation: boolean;
}

/** Right-click on an object, in the scene window or the scene list. */
export function objectEntries(f: MenuFacts): ContextEntry[] {
  return [
    Action.Group, Action.Ungroup, ...(f.tree ? [Action.NewGroup] : []), SEP,
    Action.Duplicate, Action.Delete, Action.HideSelected, Action.Land, SEP,
    Action.EditMaterial, Action.Attributes,
    ...(f.animation ? [SEP, Action.AddKey, Action.SelectAllKeys] : []),
    SEP, Action.PreviewFeatures,
  ];
}

/** Right-click on empty space in the scene window. */
export function emptyEntries(): ContextEntry[] {
  return [Action.Paste, Action.SelectAll, Action.SelectNone, SEP, CREATE, SEP, Action.PreviewFeatures];
}

/** A menu item for an action: label and shortcut from the bindings table, tick and greying from the commands. */
export function actionItem(ctx: UiContext, a: Action): MenuItem {
  return { label: ACTIONS[a].label, hint: shortcutOf(a), checked: ctx.isChecked(a), disabled: !ctx.isEnabled(a), run: () => ctx.dispatch(a) };
}

export const SEPARATOR: MenuItem = { label: '', separator: true };

/** A menu at the pointer that opens to its left when there is no room to the right. */
export const openContextMenu = (x: number, y: number, items: readonly MenuItem[]): void => openMenu(x, y, items, x);

/**
 * Context menus of the scene window and the scene list. Every item is an
 * Action, so it does exactly what the menu bar and its shortcut do.
 */
export class SceneMenu {
  constructor(private readonly ctx: UiContext, private readonly onCreate: (e: CreateEntry) => void) {}

  get facts(): MenuFacts {
    return { tree: isFeatureOn(this.ctx.editor.state.features, Feature.ObjectTree), animation: this.ctx.world.scene.animation.enabled };
  }

  /** The object menu; an object outside the selection is selected first (with `pick`: its family, or the row itself). */
  openObject(x: number, y: number, target: ObjectId, pick: readonly ObjectId[]): void {
    if (!this.ctx.world.selection.has(target)) this.ctx.world.select(pick, SelectMode.Replace);
    openContextMenu(x, y, this.items(objectEntries(this.facts)));
  }

  openEmpty(x: number, y: number): void {
    openContextMenu(x, y, this.items(emptyEntries()));
  }

  items(entries: readonly ContextEntry[]): MenuItem[] {
    return entries.map((e) => {
      if (e === SEP) return SEPARATOR;
      if (e === CREATE) return { label: 'Create', items: CREATE_IDS.map((id) => this.create(createEntry(id))) };
      return actionItem(this.ctx, e);
    });
  }

  private create(entry: CreateEntry): MenuItem {
    return { label: entry.label, run: () => this.onCreate(entry) };
  }
}

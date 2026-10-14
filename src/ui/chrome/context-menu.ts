import { type CreateEntry, PORTAL_ENTRY, createEntry } from '../../assets/object.catalog';
import { GAME_ITEMS, type GameItem, GameItemKind, Side } from '../../assets/games.library';
import { Action } from '../../input/actions';
import { ACTIONS, shortcutOf } from '../../input/bindings';
import type { ObjectId } from '../../model/scene.ids';
import { PathLoop, loopTracks, pathLoopOf } from '../../world/animation/loops';
import { SelectMode } from '../../world/world';
import type { UiContext } from '../context';
import { type MenuItem, openMenu } from '../kit/controls';
import { type MenuEntry, SEP } from './menu-layout';
import { actionShown, shownEntries } from '../feature-gate';

/** The Create submenu of the empty-space menu. */
export const CREATE = 'create' as const;
export type ContextEntry = MenuEntry | typeof CREATE;

/** What the Create submenu offers: the everyday primitives of the Create palette. */
const CREATE_IDS = ['sphere', 'cube', 'cylinder', 'cone', 'pyramid', 'torus', 'terrain', 'radial'] as const;

/** What changes the object menu: the scene's animation switch and paths (preview features: ui/feature-gate.ts). */
export interface MenuFacts {
  readonly animation: boolean;
  /** The selection's paths: an open one offers Close Path Loop, closed ones Open Path. */
  readonly loop?: PathLoop;
}

/** Right-click on an object, in the scene window or the scene list. */
export function objectEntries(f: MenuFacts): ContextEntry[] {
  return [
    Action.Group, Action.Ungroup, Action.NewGroup, Action.EditGroup, Action.NewSmartGroup, SEP,
    Action.Duplicate, Action.Delete, Action.HideSelected, Action.Land, Action.SaveToMyObjects, SEP,
    Action.ChooseMaterial, Action.EditMaterial, Action.Attributes,
    ...(f.animation ? [SEP, Action.AddKey, Action.SelectAllKeys] : []),
    ...(f.animation && f.loop === PathLoop.Open ? [Action.ClosePathLoop] : f.animation && f.loop === PathLoop.Closed ? [Action.OpenPath] : []),
    SEP, Action.PreviewFeatures,
  ];
}

/** Right-click on empty space in the scene window. */
export function emptyEntries(): ContextEntry[] {
  return [Action.Paste, Action.SelectAll, Action.SelectNone, SEP, CREATE, SEP, Action.PreviewFeatures];
}

/** An action's menu label; Delete Selected Keys counts them: Delete 4 Keys. */
function actionLabel(ctx: UiContext, a: Action): string {
  const keys = ctx.editor.state.selectedKeys.length;
  if (a === Action.DeleteKeys && keys) return `Delete ${keys} Key${keys === 1 ? '' : 's'}`;
  return ACTIONS[a].label;
}

/** A menu item for an action: label and shortcut from the bindings table, tick and greying from the commands. */
export function actionItem(ctx: UiContext, a: Action): MenuItem {
  // Delete Selected Keys has no chord of its own: Del (Clear) deletes the picked keys while any are picked.
  const hint = a === Action.DeleteKeys ? shortcutOf(Action.Delete) : shortcutOf(a);
  return { label: actionLabel(ctx, a), hint, checked: ctx.isChecked(a), disabled: !ctx.isEnabled(a), run: () => ctx.dispatch(a) };
}

export const SEPARATOR: MenuItem = { label: '', separator: true };

/** A menu at the pointer that opens to its left when there is no room to the right. */
export const openContextMenu = (x: number, y: number, items: readonly MenuItem[]): void => openMenu(x, y, items, x);

/**
 * Context menus of the scene window and the scene list. Every item is an
 * Action, so it does exactly what the menu bar and its shortcut do.
 */
export class SceneMenu {
  constructor(private readonly ctx: UiContext, private readonly onCreate: (e: CreateEntry) => void, private readonly onGame?: (item: GameItem) => void) {}

  get facts(): MenuFacts {
    const w = this.ctx.world;
    return { animation: w.scene.animation.enabled, loop: pathLoopOf(w.scene.animation, loopTracks(w.scene, w.selection)) };
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
    return shownEntries(entries, this.ctx.editor.state.features, SEP).map((e) => {
      if (e === SEP) return SEPARATOR;
      if (e === CREATE) return { label: 'Create', items: [...CREATE_IDS.map((id) => this.create(createEntry(id))), ...this.previewCreates(), ...this.gameCreates()] };
      return actionItem(this.ctx, e);
    });
  }

  private create(entry: CreateEntry): MenuItem {
    return { label: entry.label, run: () => this.onCreate(entry) };
  }

  /** The object library's Chess & Billiards category as a submenu: sets, each side's pieces, the balls. */
  private gameCreates(): MenuItem[] {
    const run = this.onGame;
    if (!run) return [];
    const item = (g: GameItem): MenuItem => ({ label: g.name, run: () => run(g) });
    const of = (kind: GameItemKind, side?: Side) => GAME_ITEMS.filter((g) => g.kind === kind && (side === undefined || g.side === side)).map(item);
    return [SEPARATOR, {
      label: 'Chess & Billiards',
      items: [
        ...of(GameItemKind.ChessSet), ...of(GameItemKind.Board),
        { label: 'White Pieces', items: of(GameItemKind.Piece, Side.White) },
        { label: 'Black Pieces', items: of(GameItemKind.Piece, Side.Black) },
        SEPARATOR,
        ...of(GameItemKind.Rack),
        { label: 'Pool Balls', items: of(GameItemKind.Ball) },
      ],
    }];
  }

  /** Creates of preview features that are on: the Portal Pair. */
  private previewCreates(): MenuItem[] {
    if (!actionShown(this.ctx.editor.state.features, Action.CreatePortals)) return [];
    return [{ label: PORTAL_ENTRY.label, run: () => this.ctx.dispatch(Action.CreatePortals) }];
  }
}

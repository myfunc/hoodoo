import type { SourceFiles } from '../../io/source/source.types';
import { ShapeKind } from '../../model/scene.enums';
import type { ObjectId } from '../../model/scene.ids';
import type { Scene, SceneObject } from '../../model/scene.types';
import type { SpawnList, SpawnMenu } from '../../ui/sandbox/spawn-menu';
import { propCollision } from '../sim/prop-collision';
import { type GamePropList, gamePropLists } from './game-props';
import { GamePropStore, PROP_KEY, isGamePropKey, nameOf, propMeshKey } from './game-prop-store';
import { PropIcons } from './viewmodel/prop-icons';

/**
 * READ ME — Garry's Mod's own props in the spawn menu, while the player's
 * files are read: the game's spawnlists as a node of the menu's tree (nested as
 * the game nests them, headers over their runs), each prop a tile whose icon
 * comes when it first shows; a click reads the prop and spawns it. Props
 * already in the scene (saved with it, or from before) are read again so they
 * are drawn and collide as themselves rather than as their boxes.
 */

/** The menu's node for the game's lists (one of which is called "Garry's Mod"). */
const TITLE = 'Game Spawnlists';
const PARENT_EMPTY = 'Pick one of the lists under this one';
const NONE_HELD = 'None of these props are in your files';
const HEADER_KEY = 'header:';

export class GamePropMenu {
  private store: GamePropStore | null = null;
  private icons: PropIcons | null = null;
  /** Counts file changes, so lists read for old files are dropped. */
  private generation = 0;

  constructor(private readonly menu: SpawnMenu) {}

  /** The player's files were read (or forgotten: null). */
  setFiles(files: SourceFiles | null): void {
    const generation = ++this.generation;
    this.menu.setGameLists(TITLE, null);
    this.store = files ? new GamePropStore(files) : null;
    try {
      this.icons = files ? new PropIcons(files) : null;
    } catch {
      // Without WebGL 2 the tiles stay blank but still spawn.
      this.icons = null;
    }
    if (!files) return;
    void gamePropLists(files).then((lists) => {
      if (generation === this.generation) this.menu.setGameLists(TITLE, inTreeOrder(lists).map((l) => this.list(l)));
    });
  }

  /** A spawn key of the game's props, read and ready as an object to spawn; null when it cannot be. */
  async object(key: string): Promise<SceneObject | null> {
    if (!key.startsWith(PROP_KEY) || !this.store) return null;
    const info = await this.store.load(key.slice(PROP_KEY.length));
    return info ? this.store.object(info) : null;
  }

  /** Reads the scene's game props that are not known yet; resolves with the ones read (their bodies want building again). */
  async readScene(scene: Scene): Promise<Set<ObjectId>> {
    const store = this.store;
    const waiting = scene.objects.filter((o) => o.kind === ShapeKind.Mesh && isGamePropKey(o.mesh) && !propCollision(o.mesh));
    if (!store || !waiting.length) return new Set();
    const keys = [...new Set(waiting.map((o) => o.mesh as string))];
    const read = new Set((await Promise.all(keys.map(async (k) => ((await store.load(k)) ? k : null)))).filter((k): k is string => k !== null));
    return new Set(waiting.filter((o) => read.has(o.mesh as string)).map((o) => o.id));
  }

  private list(l: GamePropList & { depth: number }): SpawnList {
    return {
      name: l.name,
      depth: l.depth,
      empty: l.entries.length ? NONE_HELD : PARENT_EMPTY,
      tiles: l.entries.map((e, i) => (e.kind === 'header'
        ? { key: `${HEADER_KEY}${l.id}:${i}`, name: e.value, header: true }
        : { key: PROP_KEY + propMeshKey(e.value, e.skin), name: nameOf(e.value), picture: () => this.icons?.icon(e.value) ?? Promise.resolve(null) })),
    };
  }
}

/** Lists in the game's tree order: each followed by the lists under it, with how deep it is. */
function inTreeOrder(lists: readonly GamePropList[]): (GamePropList & { depth: number })[] {
  const out: (GamePropList & { depth: number })[] = [];
  const ids = new Set(lists.map((l) => l.id));
  const walk = (parent: number, depth: number) => {
    for (const l of lists.filter((x) => x.parent === parent && x.id !== parent)) {
      out.push({ ...l, depth });
      walk(l.id, depth + 1);
    }
  };
  walk(0, 0);
  // Lists whose parent is missing go at the top level.
  for (const l of lists) if (l.parent !== 0 && !ids.has(l.parent) && !out.some((x) => x.id === l.id)) out.push({ ...l, depth: 0 });
  return out;
}

import { GAME_ROWS, type GameItem, GameItemKind } from '../../assets/games.library';
import { createEntry } from '../../assets/object.catalog';
import type { Vec3 } from '../../core/vec3';
import { type IconSpec, createIcon, objectsPreview } from '../../render/icons';
import type { SpawnList } from '../../ui/sandbox/spawn-menu';
import { randomSeed } from '../../core/rng';
import { LatheProfile, ShapeKind } from '../../model/scene.enums';
import { newGroupId } from '../../model/scene.ids';
import type { GroupNode, SceneObject } from '../../model/scene.types';
import { withBody } from '../../world/body-flags';
import { type GameBuild, buildGameItem } from '../../world/game-sets';
import { createObject } from '../../world/objects.factory';

/**
 * READ ME — what the spawn menu (Q) offers, by category: the Create palette's
 * solid shapes as Garry's Mod's construction props, and the Chess & Billiards
 * library. Each item builds its objects at the origin, standing on y = 0, as
 * props: a piece, a ball or a shape falls and tumbles (Physical); what is rigid
 * in real life (a board) is one physical group; a set keeps its pieces loose.
 */

export enum SpawnCategory {
  Primitives = 'Primitives',
  /** Map pieces: terrains to paint, water, floors, walls and blocks; they stand still, as a map does. */
  Map = 'Map',
  Chess = 'Chess',
  Billiards = 'Billiards',
}

export interface SpawnItem {
  readonly key: string;
  readonly name: string;
  readonly category: SpawnCategory;
  /** The objects and groups a spawn adds, at the origin. */
  readonly build: () => GameBuild;
  /** A Chess & Billiards item: its icon is framed as the Object Library frames it. */
  readonly game?: GameItem;
  /** The Create palette entry whose icon it shows, when its key is not one. */
  readonly icon?: string;
}

/** The palette's shapes that make sense as props, in its order (object.catalog.ts ids). */
const PRIMITIVES: readonly string[] = [
  'cube', 'slab', 'sphere', 'sphere-squashed', 'sphere-elongated', 'cylinder', 'cylinder-squashed',
  'cone', 'pyramid', 'torus', 'disk', 'square', 'stone',
];

const physical = (o: SceneObject): SceneObject => withBody(o, { physical: true });

/** One body for rigid parts: a group of their own, made physical, inside `parent` if any. */
function rigid(objects: readonly SceneObject[], name: string, parent: GroupNode['parentId']): GameBuild {
  const id = newGroupId();
  return {
    objects: objects.map((o) => ({ ...o, groupId: id })),
    groups: [{ id, name, parentId: parent, collapsed: true, body: { solid: true, physical: true } }],
  };
}

/** A library item as props: pieces and balls loose, the board one body. */
export function gameProps(item: GameItem): GameBuild {
  const built = buildGameItem(item, 0, 0);
  switch (item.kind) {
    case GameItemKind.Piece:
    case GameItemKind.Ball:
      return { objects: built.objects.map(physical), groups: [] };
    case GameItemKind.Board:
      return rigid(built.objects, item.name, null);
    case GameItemKind.Rack:
      return { objects: built.objects.map(physical), groups: built.groups };
    case GameItemKind.ChessSet: {
      const set = built.groups[0];
      const isPiece = (o: SceneObject) => o.kind === ShapeKind.Lathe;
      const board = rigid(built.objects.filter((o) => !isPiece(o)), 'Chess Board', set.id);
      return { objects: [...board.objects, ...built.objects.filter(isPiece).map(physical)], groups: [set, ...board.groups] };
    }
  }
}

const primitive = (id: string): SpawnItem => {
  const entry = createEntry(id);
  return {
    key: id, name: entry.label, category: SpawnCategory.Primitives,
    build: () => ({ objects: [physical(createObject(entry, { seed: randomSeed(), position: [0, 0, 0] }))], groups: [] }),
  };
};

const isChess = (g: GameItem) => g.kind === GameItemKind.Piece || g.kind === GameItemKind.Board || g.kind === GameItemKind.ChessSet;
const game = (g: GameItem): SpawnItem => ({
  key: g.name, name: g.name, category: isChess(g) ? SpawnCategory.Chess : SpawnCategory.Billiards, game: g, build: () => gameProps(g),
});

/** A flat terrain's level, of its height: room to dig below as well as to raise. */
const FLAT_LEVEL = 0.1;
/** Map pieces: a palette shape at a map's size, standing still; a flat terrain starts level, to paint. */
const MAP_PIECES: readonly { key: string; name: string; entry: string; size?: Vec3; flat?: boolean }[] = [
  { key: 'map-flat', name: 'Flat Terrain', entry: 'terrain', size: [20, 4, 20], flat: true },
  { key: 'map-hills', name: 'Hills', entry: 'terrain', size: [20, 5, 20] },
  { key: 'map-water', name: 'Water', entry: 'water' },
  { key: 'map-floor', name: 'Floor', entry: 'cube', size: [10, 0.25, 10] },
  { key: 'map-wall', name: 'Wall', entry: 'cube', size: [5, 2.5, 0.25] },
  { key: 'map-block', name: 'Block', entry: 'cube', size: [4, 6, 4] },
];

const mapPiece = (p: (typeof MAP_PIECES)[number]): SpawnItem => ({
  key: p.key, name: p.name, category: SpawnCategory.Map, icon: p.entry,
  build: () => {
    const o = { ...createObject(createEntry(p.entry), { seed: randomSeed(), position: [0, 0, 0], size: p.size }), name: p.name };
    const terrain = p.flat && o.terrain ? { resolution: o.terrain.resolution, heights: new Float32Array(o.terrain.resolution ** 2).fill(FLAT_LEVEL) } : o.terrain;
    return { objects: [{ ...o, terrain }], groups: [] };
  },
});

/** Everything the spawn menu offers, in its order. */
export const SPAWN_ITEMS: readonly SpawnItem[] = [
  ...PRIMITIVES.map(primitive),
  ...MAP_PIECES.map(mapPiece),
  ...GAME_ROWS.flat().filter((g) => g.profile !== LatheProfile.Column && g.profile !== LatheProfile.Pedestal).map(game),
];

export const spawnItemsOf = (category: SpawnCategory): SpawnItem[] => SPAWN_ITEMS.filter((i) => i.category === category);

/** Turns a ball's number toward the icon's camera, as the Object Library does (render/icons.ts PIECE_FROM). */
const BALL_FACING: Vec3 = [-16, 36, 0];

/** An item's icon: a shape as the Create palette draws it, a library item as the Object Library frames it. */
function iconOf(item: SpawnItem): IconSpec {
  const g = item.game;
  if (!g) return createIcon(createEntry(item.icon ?? item.key));
  const built = buildGameItem(g, 0, 0).objects;
  // The rack leaves its cue ball out (it waits far in front); a lone ball shows its number.
  const shown = g.kind === GameItemKind.Rack ? built.slice(0, -1)
    : g.kind === GameItemKind.Ball ? built.map((o) => ({ ...o, transform: { ...o.transform, rotation: BALL_FACING } }))
    : built;
  return objectsPreview(shown, g.kind === GameItemKind.ChessSet || g.kind === GameItemKind.Board || g.kind === GameItemKind.Rack);
}

/** The menu's lists: one per category, its items with their icons. */
export const spawnLists = (): SpawnList[] =>
  Object.values(SpawnCategory).map((name) => ({ name, tiles: spawnItemsOf(name).map((i) => ({ key: i.key, name: i.name, icon: () => iconOf(i) })) }));

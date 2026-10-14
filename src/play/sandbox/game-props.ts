import type { SourceFiles } from '../../io/source/source.types';
import { type Spawnlist, type SpawnlistEntry, loadSpawnlists } from '../../io/source/spawnlists';

/**
 * READ ME — the game's props for the spawn menu: Garry's Mod's own spawnlists
 * (Construction Props, Comic Props, Half-Life 2…, nested as the game nests
 * them), each keeping only the models the player's files hold, and the headers
 * over runs of them. A list left without models, and without lists under it,
 * is dropped. The icons come from viewmodel/prop-icons.ts, the props themselves
 * from io/source/static-prop.ts.
 */

export interface GamePropList {
  readonly id: number;
  readonly parent: number;
  readonly name: string;
  readonly entries: readonly SpawnlistEntry[];
}

export async function gamePropLists(files: SourceFiles): Promise<GamePropList[]> {
  return keepHeld(await loadSpawnlists(files), (path) => files.has(path));
}

/** The lists with only the models `has` finds; headers stay over models that follow them. */
export function keepHeld(lists: readonly Spawnlist[], has: (path: string) => boolean): GamePropList[] {
  const kept = lists.map((l) => ({ id: l.id, parent: l.parent, name: l.name, entries: withHeaders(l.entries.filter((e) => e.kind === 'header' || has(e.value))) }));
  const hasModels = (l: GamePropList): boolean => l.entries.length > 0 || kept.some((c) => c.parent === l.id && c.id !== l.id && hasModels(c));
  return kept.filter(hasModels);
}

/** Drops headers with no model under them before the next header. */
function withHeaders(entries: readonly SpawnlistEntry[]): SpawnlistEntry[] {
  return entries.filter((e, i) => e.kind === 'model' || entries.slice(i + 1).find((x) => x.kind === 'model' || x.kind === 'header')?.kind === 'model');
}

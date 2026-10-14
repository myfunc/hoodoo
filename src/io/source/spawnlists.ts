import { parseKeyValues } from './keyvalues';
import type { KeyValues, SourceFiles } from './source.types';

/**
 * READ ME — Garry's Mod's spawnlists (garrysmod/settings/spawnlist/*.txt): the
 * Q menu's tree of prop lists (Construction Props, Comic Props, Half-Life 2…),
 * each with its id, its parent's id (0 at the top), an icon and its contents in
 * order — models, and headers that title a run of them. Lists come sorted as the
 * game sorts them, by file name.
 */

export interface SpawnlistEntry {
  readonly kind: 'model' | 'header';
  /** The model's path (models/props_c17/oildrum001.mdl) or the header's text. */
  readonly value: string;
  readonly skin: number;
}

export interface Spawnlist {
  readonly id: number;
  readonly parent: number;
  readonly name: string;
  readonly icon: string;
  readonly entries: readonly SpawnlistEntry[];
}

const FOLDER = 'settings/spawnlist/';
const TXT = '.txt';
const decoder = new TextDecoder();

export function parseSpawnlist(text: string): Spawnlist | null {
  const root = parseKeyValues(text)[0];
  if (!root) return null;
  const get = (nodes: readonly KeyValues[], key: string) => nodes.find((n) => n.key.toLowerCase() === key)?.value ?? '';
  const contents = root.children.find((n) => n.key.toLowerCase() === 'contents')?.children ?? [];
  const entries: SpawnlistEntry[] = [];
  for (const c of [...contents].sort((a, b) => Number(a.key) - Number(b.key))) {
    const type = get(c.children, 'type').toLowerCase();
    if (type === 'model') entries.push({ kind: 'model', value: get(c.children, 'model').toLowerCase().replace(/\\/g, '/'), skin: Number(get(c.children, 'skin')) || 0 });
    else if (type === 'header') entries.push({ kind: 'header', value: get(c.children, 'text'), skin: 0 });
  }
  return { id: Number(get(root.children, 'id')), parent: Number(get(root.children, 'parentid')), name: get(root.children, 'name'), icon: get(root.children, 'icon'), entries };
}

/** Every spawnlist the files hold, in the game's order. */
export async function loadSpawnlists(files: SourceFiles): Promise<Spawnlist[]> {
  const paths = files.list(FOLDER).filter((p) => p.endsWith(TXT)).sort();
  const out: Spawnlist[] = [];
  for (const p of paths) {
    const bytes = await files.read(p);
    const list = bytes ? parseSpawnlist(decoder.decode(bytes)) : null;
    if (list) out.push(list);
  }
  return out;
}

import type { ObjectId } from '../../model/scene.ids';
import type { Animation, Key, Scene } from '../../model/scene.types';
import { type KeyRef, KeyTrack, trackKeys, trackName } from '../../world/animation/key-selection';
import { selectionTracks } from '../../world/animation/loops';
import { treeRows } from '../../world/group-tree';
import { RIG_NAMES } from '../../world/rig';
import { Rig } from '../../world/world.enums';

/**
 * The rows of the timeline's ledger: the Camera, the Sun (whose keys are the
 * sky's), then the groups and objects as a tree, each row one track. The filter
 * shows the animated ones (with the groups around them), all of them, or the
 * selection. A folded group hides what it holds and marks its keys instead.
 */

export enum RowKind {
  Camera = 'camera',
  Sun = 'sun',
  Group = 'group',
  Object = 'object',
}

export enum RowFilter {
  Animated = 'animated',
  All = 'all',
  Selected = 'selected',
}

/** The Sun row holds the sky's keys: the sun's direction and every other sky value. */
export const SUN_ROW_NAME = 'Sun & Sky';

export interface LedgerRow {
  /** The track's name (`object:<id>`, `group:<id>`, `camera:`, `sky:`): stable across rebuilds. */
  readonly id: string;
  readonly kind: RowKind;
  readonly name: string;
  readonly depth: number;
  readonly track: KeyTrack;
  readonly trackId: string;
  /** What a click on the row selects: the object, or every object in the group; none for the camera and the sun. */
  readonly members: readonly ObjectId[];
  /** A group row that holds rows under the filter. */
  readonly parent: boolean;
  readonly folded: boolean;
  /** Folded: the tracks inside, whose keys the row marks. */
  readonly inside: readonly { readonly track: KeyTrack; readonly id: string }[];
}

export interface RowOptions {
  readonly filter: RowFilter;
  readonly selection: ReadonlySet<ObjectId>;
  readonly rig: Rig | null;
  /** Ids of folded group rows. */
  readonly folded: ReadonlySet<string>;
}

const rigRow = (rig: Rig): LedgerRow => ({
  id: trackName(rig === Rig.Camera ? KeyTrack.Camera : KeyTrack.Sky, ''),
  kind: rig === Rig.Camera ? RowKind.Camera : RowKind.Sun,
  name: rig === Rig.Camera ? RIG_NAMES[Rig.Camera] : SUN_ROW_NAME,
  depth: 0,
  track: rig === Rig.Camera ? KeyTrack.Camera : KeyTrack.Sky,
  trackId: '',
  members: [],
  parent: false,
  folded: false,
  inside: [],
});

export const rowKeys = (a: Animation, row: LedgerRow): readonly Key<unknown>[] => trackKeys(a, row.track, row.trackId);

export const rowRef = (row: LedgerRow, time: number): KeyRef => ({ track: row.track, id: row.trackId, time });

/** The tracks whose keys a row shows: its own, and a folded group's insides too. */
const shownTracks = (row: LedgerRow): readonly { readonly track: KeyTrack; readonly id: string }[] => [{ track: row.track, id: row.trackId }, ...row.inside];

/** The keys the rows show from `t0` to `t1`: what a box drawn over them picks. */
export function keysBetween(a: Animation, rows: readonly LedgerRow[], t0: number, t1: number): KeyRef[] {
  return rows.flatMap((row) => shownTracks(row).flatMap((t) =>
    trackKeys(a, t.track, t.id).filter((k) => k.time >= t0 && k.time <= t1).map((k) => ({ track: t.track, id: t.id, time: k.time }))));
}

/** Every key of a row: its own track's, and for a group the keys of what it holds too (nested groups and objects). */
export function rowKeyRefs(scene: Scene, row: LedgerRow): KeyRef[] {
  const inner = row.kind === RowKind.Group && row.members.length ? selectionTracks(scene, new Set(row.members)) : [];
  const tracks = [{ track: row.track, id: row.trackId }, ...inner.filter((t) => t.track !== row.track || t.id !== row.trackId)];
  return tracks.flatMap((t) => trackKeys(scene.animation, t.track, t.id).map((k) => ({ track: t.track, id: t.id, time: k.time })));
}

/** The row is what the scene has selected: its object, its whole group, or the camera or the sun. */
export function isRowSelected(row: LedgerRow, selection: ReadonlySet<ObjectId>, rig: Rig | null): boolean {
  if (row.kind === RowKind.Camera) return rig === Rig.Camera;
  if (row.kind === RowKind.Sun) return rig === Rig.Sun;
  return row.members.length > 0 && row.members.every((id) => selection.has(id));
}

interface Draft {
  readonly row: LedgerRow;
  readonly keyed: boolean;
}

/** Every group and object as a tree, unfolded (the scene list's own folds are its business). */
function treeDrafts(scene: Scene): Draft[] {
  const open = { objects: scene.objects, groups: scene.groups?.map((g) => ({ ...g, collapsed: false })) };
  const a = scene.animation;
  return treeRows(open).map((r) => {
    const track = r.group ? KeyTrack.Group : KeyTrack.Object;
    const trackId = r.group ? r.group.id : (r.object?.id ?? '');
    return {
      keyed: trackKeys(a, track, trackId).length > 0,
      row: {
        id: trackName(track, trackId),
        kind: r.group ? RowKind.Group : RowKind.Object,
        name: r.group ? r.group.name : (r.object?.name ?? ''),
        depth: r.depth,
        track,
        trackId,
        members: r.members.map((o) => o.id),
        parent: false,
        folded: false,
        inside: [],
      },
    };
  });
}

/** Rows under `i` in the tree: the ones after it that sit deeper. */
function under(drafts: readonly Draft[], i: number): Draft[] {
  const out: Draft[] = [];
  for (let j = i + 1; j < drafts.length && drafts[j].row.depth > drafts[i].row.depth; j++) out.push(drafts[j]);
  return out;
}

/** The ledger's rows for the filter, groups folded where asked. */
export function ledgerRows(scene: Scene, o: RowOptions): LedgerRow[] {
  const drafts = treeDrafts(scene);
  const keep = (d: Draft, i: number): boolean => {
    if (o.filter === RowFilter.All) return true;
    if (o.filter === RowFilter.Selected) return isRowSelected(d.row, o.selection, o.rig);
    return d.keyed || (d.row.kind === RowKind.Group && under(drafts, i).some((x) => x.keyed));
  };
  const kept = drafts.filter(keep);
  const rows: LedgerRow[] = [];
  for (let i = 0; i < kept.length; i++) {
    const inner = under(kept, i);
    const folded = inner.length > 0 && o.folded.has(kept[i].row.id);
    rows.push({ ...kept[i].row, parent: inner.length > 0, folded, inside: folded ? inner.filter((x) => x.keyed).map((x) => ({ track: x.row.track, id: x.row.trackId })) : [] });
    if (folded) i += inner.length;
  }
  const rigs = [Rig.Camera, Rig.Sun].filter((r) => o.filter !== RowFilter.Selected || o.rig === r).map(rigRow);
  // The camera and the sun are always there to key, except when another selection is shown.
  return [...rigs, ...rows];
}

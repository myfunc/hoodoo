import type { ObjectId } from '../model/scene.ids';
import type { SceneObject } from '../model/scene.types';
import { behaviourDef } from './play/behaviour-catalog';
import { isZone } from './play/scripts';
import { isPortal, linkPortals, portalPartners, unlinkPortals } from './portals';
import type { World } from './world';

/**
 * READ ME — what Play › Portals & Triggers… lists (ui/labs/portals-triggers.ts):
 * the scene's portals, a row per linked pair and a row per portal that leads
 * nowhere, and its trigger zones, each with a one-line account of what it does;
 * and the link edits the window makes.
 */

/** A linked pair (`b` its partner), or a portal that leads nowhere (`b` null). */
export interface PortalRow {
  readonly a: SceneObject;
  readonly b: SceneObject | null;
}

/** The portals as rows, in scene order: a pair comes once, where its first portal stands. */
export function portalRows(objects: readonly SceneObject[]): PortalRow[] {
  const partners = portalPartners(objects);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const rows: PortalRow[] = [];
  for (const o of objects) {
    if (!isPortal(o) || seen.has(o.id)) continue;
    const partnerId = partners.get(o.id);
    const b = partnerId ? (byId.get(partnerId) ?? null) : null;
    seen.add(o.id);
    if (b) seen.add(b.id);
    rows.push({ a: o, b });
  }
  return rows;
}

/** The trigger zones, in scene order. */
export const zoneRows = (objects: readonly SceneObject[]): SceneObject[] => objects.filter(isZone);

/** The names of the behaviours an object carries, in order ("Spin, Bob"). */
export function behaviourNames(o: SceneObject): string[] {
  return (o.script?.behaviours ?? []).map((b) => behaviourDef(b.kind)?.label ?? b.kind);
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a zone does, in one line: its rules, its clip and behaviours ("2 rules · Spin"). */
export function zoneSummary(o: SceneObject): string {
  const rules = o.zone?.rules.length ?? 0;
  const parts = [rules ? plural(rules, 'rule') : 'no rules', ...(o.script?.clip ? ['clip'] : []), ...behaviourNames(o)];
  return parts.join(' · ');
}

/** What a portal carries besides its link: its clip and behaviours, or nothing. */
export function portalExtras(o: SceneObject): string {
  return [...(o.script?.clip ? ['clip'] : []), ...behaviourNames(o)].join(' · ');
}

/** Links portals `a` and `b`, one undo step; portals that led to them now lead nowhere. */
export function linkPortalIds(world: World, a: ObjectId, b: ObjectId): void {
  replaceObjects(world, linkPortals(world.scene.objects, a, b), 'Link Portals');
}

/** Portal `id` and its partner lead nowhere any more, one undo step. */
export function unlinkPortal(world: World, id: ObjectId): void {
  replaceObjects(world, unlinkPortals(world.scene.objects, id), 'Unlink Portals');
}

/** The objects that differ in `next` (same ids) replace theirs; locked ones too, as a link is not an edit of the object. */
function replaceObjects(world: World, nextObjects: readonly SceneObject[], label: string): void {
  const next = new Map(nextObjects.map((o) => [o.id, o]));
  const changed = new Set(world.scene.objects.filter((o) => next.get(o.id) !== o).map((o) => o.id));
  if (changed.size) world.updateObjects(changed, label, (o) => next.get(o.id) ?? o, true);
}

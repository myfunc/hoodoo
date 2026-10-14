import { JointKind } from '../../model/scene.enums';
import type { ObjectId } from '../../model/scene.ids';
import type { SceneObject } from '../../model/scene.types';
import type { MenuItem } from '../../ui/kit/controls';
import { bodyOf, canBePhysical, canCollide } from '../../world/body-flags';
import { jointsOf } from '../../world/joints';
import type { PlaySim } from '../sim/play-sim';
import type { Props } from './props';
import type { SceneEdits } from './scene-edits';

/**
 * READ ME — an object's menu in the context menu (C, Mouse 2), as Garry's Mod's
 * properties: Remove (a carved object whole), Save to My Objects, Freeze or Unfreeze for a prop,
 * Physical and Solid (Play's body flags; Physical on any part of a carved
 * object switches the whole of it), and Remove joints when it has some. Every
 * change is a History step and stays after play.
 */

const ALL_JOINTS: ReadonlySet<JointKind> = new Set(Object.values(JointKind));

export interface ObjectMenuDeps {
  readonly sim: PlaySim;
  readonly props: Props;
  readonly edits: SceneEdits;
  /** The object as the player sees it: a carved object's parts all together. */
  whole(id: ObjectId): ReadonlySet<ObjectId>;
  /** Keeps it in My Objects (with its groups and what is welded to it). */
  save(id: ObjectId): void;
}

export function objectMenu(o: SceneObject, d: ObjectMenuDeps): MenuItem[] {
  const items: MenuItem[] = [{ label: o.name, disabled: true }, { label: '', separator: true }];
  if (!o.locked) items.push({ label: 'Remove', run: () => d.edits.remove(new Set(d.whole(o.id)), `Remove ${o.name}`) });
  items.push({ label: 'Save to My Objects', run: () => d.save(o.id) });
  const body = d.sim.bodies.itemOf(o.id)?.body;
  if (body !== undefined && d.props.grabbable(body)) {
    const frozen = d.props.isFrozen(body);
    items.push({ label: frozen ? 'Unfreeze' : 'Freeze', run: () => (frozen ? d.props.unfreeze(body) : d.props.freeze(body)) });
  }
  const flags = bodyOf(o);
  if (canBePhysical(o.kind) && !o.locked) {
    items.push({ label: 'Physical', checked: d.edits.physical(o.id), run: () => d.edits.setPhysical(o.id, !d.edits.physical(o.id)) });
  }
  if (canCollide(o.kind) && !o.locked) items.push({ label: 'Solid', checked: flags.solid, run: () => d.edits.setSolid(o.id, !flags.solid) });
  if (jointsOf(d.edits.scene, o.id).length) items.push({ label: 'Remove joints', run: () => d.edits.removeJointsOf(o.id, ALL_JOINTS, `Remove joints of ${o.name}`) });
  return items;
}

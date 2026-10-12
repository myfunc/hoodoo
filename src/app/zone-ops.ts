import { ZONE_NAME, createTriggerZone } from '../world/play/scripts';
import type { World } from '../world/world';
import { dropPoint } from './scene-ops';

/** A new trigger zone (Play preview) under the point the camera looks at; its rules are set in Object Attributes. */
export function createZone(world: World): void {
  const [x, z] = dropPoint(world.scene.camera);
  const taken = new Set(world.scene.objects.map((o) => o.name));
  let name = ZONE_NAME;
  for (let n = 2; taken.has(name); n++) name = `${ZONE_NAME} ${n}`;
  world.addObjects([createTriggerZone([x, 0, z], name)], 'Create Trigger Zone');
}

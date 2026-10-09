import { BooleanMode } from '../model/scene.enums';
import type { Scene } from '../model/scene.types';
import { SCENE_LIMITS } from './scene.validate';

interface Measure {
  readonly objects: number;
  readonly terrainSamples: number;
  readonly booleanMembers: number;
}

function measure(scene: Scene): Measure {
  const members = new Map<string, number>();
  let samples = 0;
  for (const o of scene.objects) {
    if (o.terrain) samples += o.terrain.resolution * o.terrain.resolution;
    if (o.groupId && (o.boolean === BooleanMode.Negative || o.boolean === BooleanMode.Intersect)) members.set(o.groupId, (members.get(o.groupId) ?? 0) + 1);
  }
  return { objects: scene.objects.length, terrainSamples: samples, booleanMembers: Math.max(0, ...members.values()) };
}

const MESSAGES: Readonly<Record<keyof Measure, string>> = {
  objects: `A scene holds at most ${SCENE_LIMITS.objects} objects`,
  terrainSamples: 'The terrains would be too large together: lower a terrain grid or remove one',
  booleanMembers: `A group can have at most ${SCENE_LIMITS.booleanMembers} Negative or Intersect members`,
};

/**
 * The editor keeps scenes inside the same limits files and links are checked
 * against, so everything a user makes can be saved and reopened. An edit is
 * refused only when it would push a limit further than the scene already is.
 */
export function limitBreach(next: Scene, previous: Scene): string | null {
  const a = measure(next);
  const b = measure(previous);
  for (const key of Object.keys(MESSAGES) as (keyof Measure)[]) {
    if (a[key] > SCENE_LIMITS[key] && a[key] > b[key]) return MESSAGES[key];
  }
  return null;
}

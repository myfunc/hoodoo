import type { Rgb } from '../../core/color';
import type { Animation, Camera, Key, Scene, Sky, Transform } from '../../model/scene.types';
import { groupIndex, withGroups } from '../group-tree';
import { placed } from '../group-pose';
import { channelAt, rgbAt, stepAt, vec3At } from './interpolate';
import { KeyTrack, isCyclic } from './key-selection';
import { withPropsAt } from './prop-channels';

/** The values of every animated track at time `t`, laid over the scene. */

export function transformAt(keys: readonly Key<Transform>[], t: number, loop = false): Transform {
  return {
    position: vec3At(keys, t, (v) => v.position, { loop }),
    rotation: vec3At(keys, t, (v) => v.rotation, { bounded: true, loop }),
    size: vec3At(keys, t, (v) => v.size, { bounded: true, loop }),
  };
}

export function cameraAt(keys: readonly Key<Camera>[], t: number, loop = false): Camera {
  const n = (read: (c: Camera) => number, angle = false) => channelAt(keys, t, read, { bounded: true, angle, loop });
  return {
    position: vec3At(keys, t, (c) => c.position, { loop }),
    yaw: n((c) => c.yaw, true),
    pitch: n((c) => c.pitch),
    bank: n((c) => c.bank, true),
    fov: n((c) => c.fov),
    focus: n((c) => c.focus),
    aperture: n((c) => c.aperture),
  };
}

export function skyAt(keys: readonly Key<Sky>[], t: number, loop = false): Sky {
  const n = (read: (s: Sky) => number, angle = false) => channelAt(keys, t, read, { bounded: true, angle, loop });
  const step = <V>(read: (s: Sky) => V) => stepAt(keys, t, read);
  const rgb = (read: (s: Sky) => Rgb) => rgbAt(keys, t, read, loop);
  return {
    mode: step((s) => s.mode),
    skyColor: rgb((s) => s.skyColor),
    horizonColor: rgb((s) => s.horizonColor),
    sunColor: rgb((s) => s.sunColor),
    ambientColor: rgb((s) => s.ambientColor),
    sunAzimuth: n((s) => s.sunAzimuth, true),
    sunAltitude: n((s) => s.sunAltitude),
    sunVisible: step((s) => s.sunVisible),
    shadows: n((s) => s.shadows),
    softShadows: n((s) => s.softShadows),
    fogAmount: n((s) => s.fogAmount),
    fogHeight: n((s) => s.fogHeight),
    fogColor: rgb((s) => s.fogColor),
    hazeAmount: n((s) => s.hazeAmount),
    hazeColor: rgb((s) => s.hazeColor),
    stars: step((s) => s.stars),
    clouds: {
      cumulus: step((s) => s.clouds.cumulus),
      stratus: step((s) => s.clouds.stratus),
      cover: n((s) => s.clouds.cover),
      height: n((s) => s.clouds.height),
      frequency: n((s) => s.clouds.frequency),
      amplitude: n((s) => s.clouds.amplitude),
      color: rgb((s) => s.clouds.color),
    },
  };
}

const hasKeys = (tracks: Animation['groups']): boolean => Object.values(tracks ?? {}).some((k) => k.length > 0);

/** The scene moves: animation is on and some track has keys. */
export const isAnimated = (a: Animation): boolean =>
  a.enabled && (a.camera.length > 0 || a.sky.length > 0 || hasKeys(a.objects) || hasKeys(a.groups));

/** Groups with a track take their pose at `t` (a plain group gets a table entry to carry it). */
function posedGroups(scene: Scene, t: number): Scene {
  const a = scene.animation;
  const tracked = Object.entries(a.groups ?? {}).filter(([, keys]) => keys.length > 0);
  if (!tracked.length) return scene;
  const index = groupIndex(scene);
  for (const [id, keys] of tracked) {
    const node = index.get(id as never);
    if (node) index.set(node.id, { ...node, transform: transformAt(keys, t, a.loop || isCyclic(a, KeyTrack.Group, id)) });
  }
  return withGroups(scene, scene.objects, index.values());
}

/**
 * The scene posed at `t`: animated objects, groups, camera and sky take their
 * interpolated values, and every object its world pose through its groups
 * (group-pose); a still stays as it is. Keyed materials, lights and visibility
 * come out here too (prop-channels), so the live view, Render and movies all
 * read them from the posed scene, frame by frame.
 */
export function poseAt(scene: Scene, t: number): Scene {
  const a = scene.animation;
  if (!isAnimated(a)) return placed(scene);
  const loops = (track: KeyTrack, id: string) => a.loop || isCyclic(a, track, id);
  return placed({
    ...posedGroups(scene, t),
    objects: scene.objects.map((o) => {
      const keys = a.objects[o.id];
      if (!keys?.length) return o;
      const loop = loops(KeyTrack.Object, o.id);
      return { ...withPropsAt(o, keys, t, loop), local: transformAt(keys, t, loop) };
    }),
    camera: a.camera.length ? cameraAt(a.camera, t, loops(KeyTrack.Camera, '')) : scene.camera,
    sky: a.sky.length ? skyAt(a.sky, t, loops(KeyTrack.Sky, '')) : scene.sky,
  });
}

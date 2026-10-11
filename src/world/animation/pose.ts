import type { Rgb } from '../../core/color';
import type { Animation, Camera, Key, Scene, Sky, Transform } from '../../model/scene.types';
import { channelAt, rgbAt, stepAt, vec3At } from './interpolate';

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

/** The scene moves: animation is on and some track has keys. */
export const isAnimated = (a: Animation): boolean =>
  a.enabled && (a.camera.length > 0 || a.sky.length > 0 || Object.values(a.objects).some((k) => k.length > 0));

/** The scene posed at `t`: animated objects, camera and sky take their interpolated values; a still stays as it is. */
export function poseAt(scene: Scene, t: number): Scene {
  const a = scene.animation;
  if (!isAnimated(a)) return scene;
  return {
    ...scene,
    objects: scene.objects.map((o) => {
      const keys = a.objects[o.id];
      return keys?.length ? { ...o, transform: transformAt(keys, t, a.loop) } : o;
    }),
    camera: a.camera.length ? cameraAt(a.camera, t, a.loop) : scene.camera,
    sky: a.sky.length ? skyAt(a.sky, t, a.loop) : scene.sky,
  };
}

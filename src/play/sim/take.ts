import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Animation, Camera, GroupNode, Key, ObjectKey, Scene, SceneObject, Transform } from '../../model/scene.types';
import { frameTime, withKey, withPose } from '../../world/animation/keying';
import { transformAt } from '../../world/animation/pose';
import { keyGroups } from '../../world/animation/prop-channels';
import { groupIndex } from '../../world/group-tree';
import { sceneFrames } from '../../world/group-pose';
import { fromFrame } from '../../world/group-transform';
import { ANIMATION_LIMITS, SCENE_LIMITS } from '../../world/scene.validate';
import type { PlanePose } from './plane-model';
import { type PlaneTarget, planeKeys, planeTarget } from './plane-take';

/**
 * READ ME — recording: while Record is on, the session samples the take at the
 * scene's frame rate from the time it started (the play session's playhead):
 * the camera (the actor's eye) and every physical object or group that moves.
 * On exit `withTakes` writes the samples as ordinary keys — camera keys, and
 * object or group keys in their parents' space — replacing the poses the tracks
 * held over the take's span, so the take plays back on the timeline like any
 * keys. Material, light and visibility values keyed in that span stay, on the
 * take's key of their frame.
 * A flown plane becomes the scene's Plane group (made on its first take) with
 * its pose and propeller keyed (plane-take.ts).
 */

export interface TakeSample {
  /** Scene time of the sample. */
  readonly time: number;
  readonly camera: Camera;
  /** World transforms of physical objects. */
  readonly objects: ReadonlyMap<ObjectId, Transform>;
  /** World frames of physical groups. */
  readonly groups: ReadonlyMap<GroupId, Transform>;
  /** The plane, while it flies. */
  readonly plane?: PlanePose;
}

export interface Take {
  readonly samples: readonly TakeSample[];
}

/** What a take turned into: the new timeline and a few numbers for the message. */
export interface TakeResult {
  readonly animation: Animation;
  /** Objects and groups the takes bring into the scene: the plane, on its first take. */
  readonly objects: readonly SceneObject[];
  readonly groups: readonly GroupNode[];
  /** A plane was recorded. */
  readonly plane: boolean;
  readonly seconds: number;
  readonly cameraKeys: number;
  readonly bodies: number;
}

const SAME = 1e-5;

/** Sample times: the start and every frame after it, until the camera track is full. */
export class TakeRecorder {
  readonly samples: TakeSample[] = [];
  private frame = 0;

  constructor(readonly start: number, readonly fps: number, private readonly limit: number) {}

  /** Scene times of the samples due up to `time`, each returned once. */
  due(time: number): number[] {
    const out: number[] = [];
    while (!this.full) {
      const t = this.start + this.frame / this.fps;
      if (t > time + SAME) break;
      out.push(frameTime(t, this.fps));
      this.frame++;
    }
    return out;
  }

  add(sample: TakeSample): void {
    this.samples.push(sample);
  }

  /** The track limit is reached: the take ends by itself. */
  get full(): boolean {
    return this.frame >= this.limit;
  }

  take(): Take {
    return { samples: this.samples };
  }
}

/** How many camera keys a take starting at `start` may write (files keep 600 a track). */
export const takeLimit = (a: Animation, start: number): number =>
  Math.max(0, SCENE_LIMITS.keysPerTrack - a.camera.filter((k) => k.time < start - SAME).length);

/** Less than this never shows: a prop settling on the ground is not a moving object worth keys. */
const STILL = { position: 0.01, rotation: 0.5 } as const;
const near = (a: readonly number[], b: readonly number[], within: number): boolean => a.every((v, i) => Math.abs(v - b[i]) < within);
const sameTransform = (a: Transform, b: Transform): boolean => near(a.position, b.position, STILL.position) && near(a.rotation, b.rotation, STILL.rotation);

/** The track with the keys of [t0, t1] replaced by `keys`. */
function spliced<T>(track: readonly Key<T>[], keys: readonly Key<T>[], t0: number, t1: number, fps: number): Key<T>[] {
  const eps = 0.5 / fps;
  return [...track.filter((k) => k.time < t0 - eps || k.time > t1 + eps), ...keys].sort((a, b) => a.time - b.time);
}

/**
 * An object's track with the poses of [t0, t1] replaced by the take's `poses`. A key there that also
 * holds material, light or visibility values keeps them: they go back onto the take's key at their
 * frame (its pose the take's there), with the key's ease.
 */
function splicedPoses(track: readonly Key<ObjectKey>[], poses: readonly Key<Transform>[], t0: number, t1: number, fps: number): Key<ObjectKey>[] {
  const eps = 0.5 / fps;
  const values = track.filter((k) => k.time >= t0 - eps && k.time <= t1 + eps && keyGroups(k.value).size > 1);
  let out: Key<ObjectKey>[] = spliced(track, poses, t0, t1, fps);
  for (const k of values) {
    const [merged] = withPose([k], k.time, transformAt(poses, k.time), fps);
    out = withKey(out, k.time, merged.value, fps, k.ease);
  }
  return out;
}

/** Tracks of the bodies that moved during the take: world poses read in their parents' space. */
function bodyTracks<Id extends string>(samples: readonly TakeSample[], pick: (s: TakeSample) => ReadonlyMap<Id, Transform>, local: (id: Id, world: Transform) => Transform): Map<Id, Key<Transform>[]> {
  const out = new Map<Id, Key<Transform>[]>();
  const first = pick(samples[0]);
  for (const [id, start] of first) {
    if (samples.every((s) => sameTransform(pick(s).get(id) ?? start, start))) continue;
    out.set(id, samples.map((s) => ({ time: s.time, value: local(id, pick(s).get(id) ?? start) })));
  }
  return out;
}

/** The scene's timeline with the takes written in as keys; the animation comes out switched on and long enough. */
export function withTakes(scene: Scene, takes: readonly Take[]): TakeResult {
  let a = scene.animation;
  const frames = sceneFrames(scene);
  const index = groupIndex(scene);
  const parentOf = new Map(scene.objects.map((o) => [o.id as string, o.groupId]));
  const moved = new Set<string>();
  let plane: PlaneTarget | null = null;
  let seconds = 0;
  let cameraKeys = 0;
  for (const take of takes) {
    const s = take.samples;
    if (!s.length) continue;
    const [t0, t1] = [s[0].time, s[s.length - 1].time];
    seconds += t1 - t0;
    cameraKeys += s.length;
    const objects = { ...a.objects };
    for (const [id, keys] of bodyTracks(s, (x) => x.objects, (id, w) => fromFrame(frames(parentOf.get(id) ?? null), w))) {
      // Deleted in the editor while playing (the pointer was free): nothing to key.
      if (!parentOf.has(id)) continue;
      objects[id] = splicedPoses(objects[id] ?? [], keys, t0, t1, a.fps);
      moved.add(id);
    }
    const groups = { ...(a.groups ?? {}) };
    for (const [id, keys] of bodyTracks(s, (x) => x.groups, (id, w) => fromFrame(frames(index.get(id)?.parentId ?? null), w))) {
      if (!index.has(id)) continue;
      groups[id] = spliced(groups[id] ?? [], keys, t0, t1, a.fps);
      moved.add(id);
    }
    a = {
      ...a,
      enabled: true,
      duration: Math.min(ANIMATION_LIMITS.duration.max, Math.max(a.duration, t1)),
      camera: spliced(a.camera, s.map((x) => ({ time: x.time, value: x.camera })), t0, t1, a.fps),
      objects,
      ...(Object.keys(groups).length ? { groups } : {}),
    };
    const flown = s.find((x) => x.plane)?.plane;
    if (flown) {
      plane ??= planeTarget(scene, flown);
      const keys = planeKeys(plane, s);
      a = {
        ...a,
        groups: { ...(a.groups ?? {}), [plane.group]: spliced(a.groups?.[plane.group] ?? [], keys.group, t0, t1, a.fps) },
        objects: { ...a.objects, [plane.propeller]: splicedPoses(a.objects[plane.propeller] ?? [], keys.propeller, t0, t1, a.fps) },
      };
    }
  }
  return { animation: a, objects: plane?.objects ?? [], groups: plane?.groups ?? [], plane: plane !== null, seconds, cameraKeys, bodies: moved.size };
}

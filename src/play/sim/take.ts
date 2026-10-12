import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Animation, Camera, Key, Scene, Transform } from '../../model/scene.types';
import { frameTime } from '../../world/animation/keying';
import { groupIndex } from '../../world/group-tree';
import { sceneFrames } from '../../world/group-pose';
import { fromFrame } from '../../world/group-transform';
import { ANIMATION_LIMITS, SCENE_LIMITS } from '../../world/scene.validate';

/**
 * READ ME — recording: while Record is on, the session samples the take at the
 * scene's frame rate from the time it started (the play session's playhead):
 * the camera (the actor's eye) and every physical object or group that moves.
 * On exit `withTakes` writes the samples as ordinary keys — camera keys, and
 * object or group keys in their parents' space — replacing what the tracks held
 * over the take's span, so the take plays back on the timeline like any keys.
 */

export interface TakeSample {
  /** Scene time of the sample. */
  readonly time: number;
  readonly camera: Camera;
  /** World transforms of physical objects. */
  readonly objects: ReadonlyMap<ObjectId, Transform>;
  /** World frames of physical groups. */
  readonly groups: ReadonlyMap<GroupId, Transform>;
}

export interface Take {
  readonly samples: readonly TakeSample[];
}

/** What a take turned into: the new timeline and a few numbers for the message. */
export interface TakeResult {
  readonly animation: Animation;
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

const near = (a: readonly number[], b: readonly number[]): boolean => a.every((v, i) => Math.abs(v - b[i]) < SAME);
const sameTransform = (a: Transform, b: Transform): boolean => near(a.position, b.position) && near(a.rotation, b.rotation);

/** The track with the keys of [t0, t1] replaced by `keys`. */
function spliced<T>(track: readonly Key<T>[], keys: readonly Key<T>[], t0: number, t1: number, fps: number): Key<T>[] {
  const eps = 0.5 / fps;
  return [...track.filter((k) => k.time < t0 - eps || k.time > t1 + eps), ...keys].sort((a, b) => a.time - b.time);
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
      objects[id] = spliced(objects[id] ?? [], keys, t0, t1, a.fps);
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
  }
  return { animation: a, seconds, cameraKeys, bodies: moved.size };
}

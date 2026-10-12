import type { Animation } from '../model/scene.types';
import type { UiContext } from '../ui/context';
import { type KeyRef, KeyTrack, allKeyRefs, liveKeyRefs, withoutKeys } from '../world/animation/key-selection';
import { PathLoop, loopTracks, pathLoopOf, selectionTracks, withPathLoop } from '../world/animation/loops';
import { allKeyTimes, frameTime, hasKeyAt, withKey, withoutKey } from '../world/animation/keying';
import { clampLength, withLength } from '../world/animation/duration';
import { offerFit } from '../ui/chrome/timeline-length';
import { EMPTY_ANIMATION } from '../world/scene.defaults';
import { Rig } from '../world/world.enums';

/** Timeline commands: the animation switch, keys at the playhead, stepping, playback. */

const MS_PER_S = 1000;

export const isAnimationOn = (ctx: UiContext): boolean => ctx.world.scene.animation.enabled;

const anim = (ctx: UiContext): Animation => ctx.world.scene.animation;

/**
 * Animation on or off for this scene, one undo step. Off, the timeline hides, edits
 * are not keyed and the scene rests in its start pose; the keys wait for it to come back.
 */
export function toggleAnimation(ctx: UiContext): void {
  const a = anim(ctx);
  const enabled = !a.enabled;
  ctx.world.setAnimation({ ...a, enabled }, enabled ? 'Animation on' : 'Animation off');
  if (!enabled && allKeyTimes(a).length) ctx.toast('Animation off. The keys are kept until it is back on');
}

/** Keys the selection where it is now: a whole group by its own transform, single objects by theirs; the sun when it is selected (a sky key); with nothing selected, the camera. */
export function addKey(ctx: UiContext): void {
  const w = ctx.world;
  const items = w.selectedItems();
  const count = items.groups.length + items.objects.length;
  if (!count) {
    if (w.rig === Rig.Sun) keySun(ctx);
    else keyCamera(ctx);
    return;
  }
  const single = items.objects.length === 1 && !items.groups.length ? w.object(items.objects[0])?.name : undefined;
  w.addKeys(items, single ? `Key ${single}` : items.groups.length === 1 && !items.objects.length ? 'Key group' : `Key ${count} items`);
}

/** Removes the keys at the playhead: of the selection (its groups' own tracks too), or of the camera and sky when nothing is selected. */
export function removeKey(ctx: UiContext): void {
  const w = ctx.world;
  const a = anim(ctx);
  const t = frameTime(w.time, a.fps);
  const items = w.selectedItems();
  if (items.objects.length || items.groups.length) {
    const tracks = selectionTracks(w.scene, w.selection);
    const refs = tracks.map((r) => ({ ...r, time: t }));
    w.setAnimation(withoutKeys(a, refs), 'Remove key');
    return;
  }
  // The camera or the sun selected: only its own key goes (the sun's is the sky's).
  if (w.rig) {
    w.setAnimation(w.rig === Rig.Camera ? { ...a, camera: withoutKey(a.camera, t, a.fps) } : { ...a, sky: withoutKey(a.sky, t, a.fps) }, 'Remove key');
    return;
  }
  if (!hasKeyAt(a.camera, t, a.fps) && !hasKeyAt(a.sky, t, a.fps)) {
    ctx.toast('No camera or sky key here. Select an object to remove its key');
    return;
  }
  w.setAnimation({ ...a, camera: withoutKey(a.camera, t, a.fps), sky: withoutKey(a.sky, t, a.fps) }, 'Remove key');
}

/** Starts (or extends) the camera move: a key of the camera as it is now. */
export function keyCamera(ctx: UiContext): void {
  const w = ctx.world;
  const a = anim(ctx);
  const t = frameTime(w.time, a.fps);
  w.setAnimation({ ...a, camera: withKey(a.camera, t, w.scene.camera, a.fps) }, 'Key camera');
  if (a.camera.length === 0) ctx.toast('Camera keyed. Move the playhead and the camera to make it fly');
}

/** A key of the sun where it is now: the sky's key, on the Sky lane. */
export function keySun(ctx: UiContext): void {
  const w = ctx.world;
  const a = anim(ctx);
  w.setAnimation({ ...a, sky: withKey(a.sky, frameTime(w.time, a.fps), w.scene.sky, a.fps) }, 'Key sun');
}

export function stepFrames(ctx: UiContext, frames: number): void {
  const a = anim(ctx);
  ctx.world.setTime(ctx.world.time + frames / a.fps);
}

export function jumpKey(ctx: UiContext, direction: 1 | -1): void {
  const a = anim(ctx);
  const now = ctx.world.time;
  const half = 0.5 / a.fps;
  // Keys past the end of the scene wait there; stepping stays inside it.
  const times = allKeyTimes(a).filter((t) => t <= a.duration + half);
  const next = direction > 0 ? times.find((t) => t > now + half) : times.reverse().find((t) => t < now - half);
  if (next !== undefined) ctx.world.setTime(next);
}

/** Animation Setup in one undo step; a new length keeps the keys where they are (and offers to fit those past the end). */
export function setTimeline(ctx: UiContext, patch: { duration?: number; fps?: number; loop?: boolean }): void {
  let a = anim(ctx);
  if (patch.duration !== undefined) a = withLength(a, clampLength(patch.duration));
  ctx.world.setAnimation({ ...a, fps: patch.fps ?? a.fps, loop: patch.loop ?? a.loop }, 'Animation setup');
  offerFit(ctx);
}

export function clearAnimation(ctx: UiContext): void {
  const a = anim(ctx);
  ctx.world.setAnimation({ ...EMPTY_ANIMATION, enabled: a.enabled, duration: a.duration, fps: a.fps, loop: a.loop }, 'Clear all keys');
}

/** Close Path Loop is offered while a selected path is open, Open Path while all are closed. */
export function canLoopPath(ctx: UiContext, close: boolean): boolean {
  return pathLoopOf(anim(ctx), loopTracks(ctx.world.scene, ctx.world.selection)) === (close ? PathLoop.Open : PathLoop.Closed);
}

/**
 * Closes the selection's paths into seamless loops (the end of the timeline
 * repeats the first key; the timeline loops) or opens them again; one undo step.
 */
export function setPathLoop(ctx: UiContext, close: boolean): void {
  const tracks = loopTracks(ctx.world.scene, ctx.world.selection);
  if (!tracks.length) return;
  const a = anim(ctx);
  ctx.world.setAnimation(withPathLoop(a, tracks, close), close ? 'Close path loop' : 'Open path');
  if (close && !a.loop) ctx.toast('Loop Playback is on: the path flows from its end into its start');
}

export const hasPickedKeys = (ctx: UiContext): boolean => ctx.editor.state.selectedKeys.length > 0;

/** Picks every key shown: of the selection (its groups' own tracks too), or of every animated object and group, the camera and the sky. */
export function selectAllKeys(ctx: UiContext): void {
  const groups = selectionTracks(ctx.world.scene, ctx.world.selection).filter((r) => r.track === KeyTrack.Group).map((r) => r.id);
  const refs = allKeyRefs(anim(ctx), ctx.world.selectedObjects().map((o) => o.id), groups);
  if (!refs.length) ctx.toast('No keys to select');
  ctx.editor.update({ selectedKeys: refs });
}

/** Deletes the picked keys in one undo step; an object track left without keys goes with them. */
export function deleteSelectedKeys(ctx: UiContext): void {
  const refs = ctx.editor.state.selectedKeys;
  if (!refs.length) return;
  ctx.world.setAnimation(withoutKeys(anim(ctx), refs), refs.length === 1 ? 'Delete key' : 'Delete keys');
  if (ctx.editor.state.selectedKeys.length) ctx.editor.update({ selectedKeys: [] });
}

/** Keeps the picked keys honest: dropped when the object selection changes, pruned when keys vanish. */
export function keepKeySelection(ctx: UiContext): void {
  let selection = [...ctx.world.selection];
  const drop = (refs: readonly KeyRef[]) => {
    if (refs !== ctx.editor.state.selectedKeys) ctx.editor.update({ selectedKeys: refs });
  };
  ctx.world.events.on('selection', ({ ids }) => {
    const changed = ids.size !== selection.length || selection.some((id) => !ids.has(id));
    selection = [...ids];
    if (changed && ctx.editor.state.selectedKeys.length) drop([]);
  });
  ctx.world.events.on('changed', () => {
    const picked = ctx.editor.state.selectedKeys;
    if (picked.length) drop(liveKeyRefs(anim(ctx), picked));
  });
}

/**
 * Real-time playback: the playhead follows the clock (frames are skipped when the
 * scene is slow to draw); at the end it loops or stops.
 */
export class Player {
  private frame = 0;
  private last = 0;
  private clock = 0;

  constructor(private readonly ctx: UiContext) {
    ctx.world.events.on('history', () => {
      // Animation turned off (by the switch, an undo or a new scene) stops the show.
      if (this.playing && !isAnimationOn(ctx)) this.stop();
    });
  }

  get playing(): boolean {
    return this.ctx.editor.state.playing;
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  play(): void {
    if (this.playing || !isAnimationOn(this.ctx)) return;
    const w = this.ctx.world;
    const start = anim(this.ctx);
    if (w.time >= start.duration - 0.5 / start.fps) w.setTime(0);
    this.clock = w.time;
    this.last = performance.now();
    this.ctx.editor.update({ playing: true });
    const step = (now: number) => {
      if (!this.playing) return;
      const a = anim(this.ctx);
      this.clock += (now - this.last) / MS_PER_S;
      this.last = now;
      if (this.clock >= a.duration) {
        if (!a.loop) {
          w.setTime(a.duration);
          this.stop();
          return;
        }
        this.clock %= a.duration;
      }
      w.setTime(this.clock);
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    if (this.playing) this.ctx.editor.update({ playing: false });
  }
}

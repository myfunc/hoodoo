import type { Animation } from '../model/scene.types';
import type { UiContext } from '../ui/context';
import { type KeyRef, allKeyRefs, liveKeyRefs, withoutKeys } from '../world/animation/key-selection';
import { allKeyTimes, frameTime, hasKeyAt, withDuration, withKey, withoutKey } from '../world/animation/keying';
import { EMPTY_ANIMATION } from '../world/scene.defaults';

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

/** Keys the selected objects where they are now; with nothing selected, the camera. */
export function addKey(ctx: UiContext): void {
  const w = ctx.world;
  const a = anim(ctx);
  const t = frameTime(w.time, a.fps);
  const targets = w.selectedObjects();
  if (!targets.length) {
    keyCamera(ctx);
    return;
  }
  const objects = { ...a.objects };
  for (const o of targets) objects[o.id] = withKey(objects[o.id] ?? [], t, o.transform, a.fps);
  w.setAnimation({ ...a, objects }, targets.length === 1 ? `Key ${targets[0].name}` : `Key ${targets.length} objects`);
}

/** Removes the keys at the playhead: of the selection, or of the camera and sky when nothing is selected. */
export function removeKey(ctx: UiContext): void {
  const w = ctx.world;
  const a = anim(ctx);
  const t = frameTime(w.time, a.fps);
  const ids = w.selectedObjects().map((o) => o.id);
  if (ids.length) {
    const objects = { ...a.objects };
    for (const id of ids) {
      const left = withoutKey(objects[id] ?? [], t, a.fps);
      if (left.length) objects[id] = left;
      else delete objects[id];
    }
    w.setAnimation({ ...a, objects }, 'Remove key');
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

export function stepFrames(ctx: UiContext, frames: number): void {
  const a = anim(ctx);
  ctx.world.setTime(ctx.world.time + frames / a.fps);
}

export function jumpKey(ctx: UiContext, direction: 1 | -1): void {
  const a = anim(ctx);
  const now = ctx.world.time;
  const half = 0.5 / a.fps;
  const times = allKeyTimes(a);
  const next = direction > 0 ? times.find((t) => t > now + half) : times.reverse().find((t) => t < now - half);
  if (next !== undefined) ctx.world.setTime(next);
}

export function setTimeline(ctx: UiContext, patch: { duration?: number; fps?: number; loop?: boolean }): void {
  let a = anim(ctx);
  if (patch.duration !== undefined && patch.duration !== a.duration) a = withDuration(a, patch.duration);
  ctx.world.setAnimation({ ...a, fps: patch.fps ?? a.fps, loop: patch.loop ?? a.loop }, 'Animation setup');
}

export function clearAnimation(ctx: UiContext): void {
  const a = anim(ctx);
  ctx.world.setAnimation({ ...EMPTY_ANIMATION, enabled: a.enabled, duration: a.duration, fps: a.fps, loop: a.loop }, 'Clear all keys');
}

export const hasPickedKeys = (ctx: UiContext): boolean => ctx.editor.state.selectedKeys.length > 0;

/** Picks every key shown: of the selected objects, or of every animated object, the camera and the sky. */
export function selectAllKeys(ctx: UiContext): void {
  const refs = allKeyRefs(anim(ctx), ctx.world.selectedObjects().map((o) => o.id));
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

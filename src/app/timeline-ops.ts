import { Studio } from '../model/scene.enums';
import type { Animation } from '../model/scene.types';
import type { UiContext } from '../ui/context';
import { allKeyTimes, frameTime, hasKeyAt, withDuration, withKey, withoutKey } from '../world/animation/keying';
import { EMPTY_ANIMATION } from '../world/scene.defaults';

/** Timeline commands of Hoodoo 3D: keys at the playhead, stepping, playback. */

const MS_PER_S = 1000;

export const isMotionStudio = (ctx: UiContext): boolean => ctx.world.scene.studio === Studio.ThreeD;

const anim = (ctx: UiContext): Animation => ctx.world.scene.animation;

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
  ctx.world.setAnimation({ ...EMPTY_ANIMATION, duration: a.duration, fps: a.fps, loop: a.loop }, 'Clear all keys');
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
      // A new scene or an undo across studios stops the show.
      if (this.playing && !isMotionStudio(ctx)) this.stop();
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
    if (this.playing || !isMotionStudio(this.ctx)) return;
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

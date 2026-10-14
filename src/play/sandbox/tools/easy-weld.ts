import { type Vec3, cross, dot, normalize, scale, sub } from '../../../core/vec3';
import type { ObjectId } from '../../../model/scene.ids';
import { type Quat, conjQ, eulerOfQuat, mulQ, quatOfEuler, rotateQ } from '../../sim/quat';
import type { ToolContext, ToolHit } from './tool';

/**
 * READ ME — Garry's Mod's Easy Weld (the Weld tool's Mouse 2): pick a prop by
 * one of its faces, then a spot on another object; the prop turns so that face
 * lies on the spot and moves onto it; the mouse turns it about the spot's
 * normal (Shift: by 45°); a click welds it there. The move and the weld are one
 * History step; R before the click takes the move back.
 */

/** Degrees of turn per pixel of mouse, and the snap with Shift. */
const TURN = { perPixel: 0.4, snap: 45 } as const;
const DEG = Math.PI / 180;
const PARALLEL = 0.9999;
const SIDE: Vec3 = [1, 0, 0];
const UP: Vec3 = [0, 1, 0];

interface Picked {
  readonly a: ObjectId;
  /** The picked face's point and normal in the prop's own frame. */
  readonly point: Vec3;
  readonly normal: Vec3;
}

interface Turning extends Picked {
  readonly b: ObjectId;
  /** Where the face lies, the spot's normal, and the prop's turn before any mouse turn. */
  readonly spot: Vec3;
  readonly axis: Vec3;
  readonly base: Quat;
  angle: number;
}

export class EasyWeld {
  private picked: Picked | null = null;
  private turning: Turning | null = null;

  get stage(): 'none' | 'picked' | 'turning' {
    return this.turning ? 'turning' : this.picked ? 'picked' : 'none';
  }

  /** Mouse 2: the prop by a face, then the spot it goes onto. True when it did something. */
  click(hit: ToolHit, ctx: ToolContext, isProp: boolean): boolean {
    if (!hit.normal) return false;
    const pose = ctx.pose(hit.object.id);
    if (!pose) return false;
    const q = quatOfEuler(pose.rotation);
    if (!this.picked) {
      if (!isProp) return false;
      this.picked = { a: hit.object.id, point: rotateQ(conjQ(q), sub(hit.point, pose.position)), normal: rotateQ(conjQ(q), hit.normal) };
      return true;
    }
    if (hit.object.id === this.picked.a) return false;
    const aPose = ctx.pose(this.picked.a);
    if (!aPose) return this.cancel(ctx);
    const qa = quatOfEuler(aPose.rotation);
    // The picked face's normal, as the prop stands now, turned to face the spot's.
    const base = mulQ(turnBetween(rotateQ(qa, this.picked.normal), scale(hit.normal, -1)), qa);
    ctx.edits.beginStroke('Easy Weld');
    this.turning = { ...this.picked, b: hit.object.id, spot: hit.point, axis: hit.normal, base, angle: 0 };
    this.place(ctx);
    return true;
  }

  /** The mouse turns the prop about the spot's normal while it waits for the click. */
  look(dx: number, ctx: ToolContext, snap: boolean): boolean {
    const t = this.turning;
    if (!t) return false;
    t.angle += dx * TURN.perPixel;
    this.place(ctx, snap);
    return true;
  }

  /** The click that welds where it stands: the prop's face point onto the spot. Returns the two ids and the weld point. */
  finish(): { a: ObjectId; b: ObjectId; spot: Vec3 } | null {
    const t = this.turning;
    if (!t) return null;
    this.picked = null;
    this.turning = null;
    return { a: t.a, b: t.b, spot: t.spot };
  }

  /** Called after the weld is made (or not): the History step closes. */
  done(ctx: ToolContext): void {
    ctx.edits.endStroke();
  }

  /** R: forget the picked prop, or take the move back. */
  cancel(ctx: ToolContext): boolean {
    const was = this.stage;
    this.picked = null;
    if (this.turning) {
      this.turning = null;
      ctx.edits.endStroke();
      ctx.edits.undo();
    }
    return was !== 'none';
  }

  private place(ctx: ToolContext, snap = false): void {
    const t = this.turning;
    if (!t) return;
    const angle = snap ? Math.round(t.angle / TURN.snap) * TURN.snap : t.angle;
    const turn = mulQ(axisQ(t.axis, angle * DEG), t.base);
    const position = sub(t.spot, rotateQ(turn, t.point));
    ctx.edits.change(new Set([t.a]), 'Easy Weld', (o) => ({ ...o, transform: { ...o.transform, position, rotation: eulerOfQuat(turn, o.transform.rotation) } }));
  }
}

function axisQ(axis: Vec3, angle: number): Quat {
  const a = normalize(axis);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

/** The shortest turn that takes direction `from` to `to`. */
function turnBetween(from: Vec3, to: Vec3): Quat {
  const [f, t] = [normalize(from), normalize(to)];
  const d = dot(f, t);
  if (d > PARALLEL) return [0, 0, 0, 1];
  if (d < -PARALLEL) {
    const axis = normalize(cross(f, Math.abs(dot(f, SIDE)) < PARALLEL ? SIDE : UP));
    return axisQ(axis, Math.PI);
  }
  const axis = normalize(cross(f, t));
  return axisQ(axis, Math.acos(d));
}


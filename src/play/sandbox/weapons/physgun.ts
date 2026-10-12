import { add, scale } from '../../../core/vec3';
import { Button } from '../../sim/actor';
import { Layer } from '../../sim/physics';
import { NoticeKind, WeaponId } from '../sandbox.enums';
import { type Grip, gripOf, holdTarget, pullToward, reached, snapped, turned } from './grip';
import type { Weapon, WeaponContext, WeaponInput, WeaponView } from './weapon';

/** Garry's Mod's Physics Gun, in Half-Life units (scaled by the player's size). */
export const PHYSGUN = {
  /** physgun_maxrange. */
  range: 4096,
  /** Each wheel step pushes or pulls this far. */
  wheelStep: 32,
  /** Never closer than this to the eye. */
  minReach: 40,
  /** The held body chases its target this fast at most. */
  maxSpeed: 4000,
  /** Share of the gap to the target closed each step. */
  gain: 0.5,
  /** E with the mouse: degrees of turn per pixel. */
  turnPerPx: 0.3,
  /** Shift with E: gm_snapangles. */
  snapDeg: 45,
  /** R twice within this many seconds unfreezes everything the player froze. */
  doubleR: 0.3,
} as const;

const unfrozeText = (n: number): string => `Unfroze ${n} prop${n > 1 ? 's' : ''}`;

const HINT = 'Mouse 1 grab · Wheel push and pull · E turn · Mouse 2 freeze · R unfreeze';

/**
 * READ ME — the Physics Gun (docs/sandbox-mode.md). Mouse 1 held takes the
 * first prop the beam meets and holds its grabbed point on the aim; every step
 * the body is given the velocity that closes half the gap, so it still collides
 * and a flick throws it. The wheel changes the distance, E with the mouse turns
 * it (Shift in 45° steps), Mouse 2 freezes it where it is, R unfreezes what it
 * points at, and R twice lets every frozen prop of the player go.
 */
export class PhysicsGun implements Weapon {
  readonly id = WeaponId.PhysicsGun;
  readonly hint = HINT;
  private grip: Grip | null = null;
  /** The turn as the mouse made it, before snapping. */
  private rawTurn: Grip['turn'] | null = null;
  /** Frozen with Mouse 1 still down: no new grab until it is let go. */
  private spent = false;
  private firing = false;
  private end: WeaponView['end'] = null;
  private flash: WeaponView['flash'] = null;
  private lastReload = -Infinity;
  /** The last R unfroze the prop it pointed at. */
  private unfrozeOne = false;

  step(input: WeaponInput, ctx: WeaponContext): void {
    this.firing = input.held.has(Button.Attack);
    if (!this.firing) {
      this.spent = false;
      if (this.grip) this.release(ctx);
    }
    if (this.grip && input.pressed.has(Button.Attack2)) this.freeze(ctx);
    if (this.firing && !this.grip && !this.spent) this.tryGrab(ctx);
    if (this.grip) this.hold(input, ctx);
    else if (input.pressed.has(Button.Reload)) this.reload(ctx);
    this.end = this.grip ? ctx.physics.worldPoint(this.grip.body, this.grip.local) : this.firing ? this.aimEnd(ctx) : null;
  }

  look(dx: number, dy: number, ctx: WeaponContext): boolean {
    if (!this.grip || !ctx.use) return false;
    this.rawTurn = turned(this.rawTurn ?? this.grip.turn, dx, dy, PHYSGUN.turnPerPx);
    this.grip = { ...this.grip, turn: ctx.snap ? snapped(this.rawTurn, ctx.eye.yaw, PHYSGUN.snapDeg) : this.rawTurn };
    return true;
  }

  wantsWheel(): boolean {
    return this.grip !== null;
  }

  view(): WeaponView {
    const g = this.grip;
    return { firing: this.firing, end: this.end, held: g && { body: g.body, local: g.local, distance: g.distance }, flash: this.flash };
  }

  holster(ctx: WeaponContext): void {
    if (this.grip) this.release(ctx);
    this.firing = false;
    this.end = null;
  }

  private tryGrab(ctx: WeaponContext): void {
    const hit = ctx.physics.raycast(ctx.eye.position, ctx.aim, PHYSGUN.range * ctx.unit, { layers: Layer.World | Layer.Prop });
    if (!hit || !ctx.props.grabbable(hit.body)) return;
    // A frozen prop comes loose while held, as in Garry's Mod.
    if (ctx.props.isFrozen(hit.body)) ctx.props.unfreeze(hit.body);
    this.grip = gripOf(hit.body, ctx.physics.pose(hit.body), hit.point, ctx.eye.position, ctx.eye.yaw);
    this.rawTurn = null;
    ctx.props.setFloating(hit.body, true);
  }

  private hold(input: WeaponInput, ctx: WeaponContext): void {
    let g = this.grip as Grip;
    if (input.reach) g = reached(g, input.reach, PHYSGUN.wheelStep * ctx.unit, PHYSGUN.minReach * ctx.unit, PHYSGUN.range * ctx.unit);
    if (!ctx.use) this.rawTurn = null;
    this.grip = g;
    const target = holdTarget(g, ctx.eye.position, ctx.aim, ctx.eye.yaw);
    const v = pullToward(ctx.physics.pose(g.body), target, ctx.dt, PHYSGUN.gain, PHYSGUN.maxSpeed * ctx.unit);
    ctx.physics.setVelocity(g.body, v.linear, v.angular);
  }

  /** Let go: the body keeps the velocity it had, so a flick throws it. */
  private release(ctx: WeaponContext): void {
    if (!this.grip) return;
    ctx.props.setFloating(this.grip.body, false);
    this.grip = null;
    this.rawTurn = null;
  }

  private freeze(ctx: WeaponContext): void {
    const body = (this.grip as Grip).body;
    this.release(ctx);
    ctx.props.freeze(body);
    this.flash = { body, time: ctx.time };
    this.spent = true;
  }

  /** R unfreezes the frozen prop it points at; R again at once unfreezes every other prop the player froze. */
  private reload(ctx: WeaponContext): void {
    if (ctx.time - this.lastReload < PHYSGUN.doubleR) {
      const n = ctx.props.unfreezeAll();
      if (n) ctx.notify(unfrozeText(n), NoticeKind.Info);
      else if (!this.unfrozeOne) ctx.notify('Nothing frozen', NoticeKind.Info);
      this.lastReload = -Infinity;
      return;
    }
    this.lastReload = ctx.time;
    const hit = ctx.physics.raycast(ctx.eye.position, ctx.aim, PHYSGUN.range * ctx.unit, { layers: Layer.World | Layer.Prop });
    this.unfrozeOne = !!hit && ctx.props.isFrozen(hit.body);
    if (!hit || !this.unfrozeOne) return;
    ctx.props.unfreeze(hit.body);
    ctx.notify(unfrozeText(1), NoticeKind.Info);
    this.flash = { body: hit.body, time: ctx.time };
  }

  /** Where the beam goes when nothing is held: the first surface on the aim, or the end of the range. */
  private aimEnd(ctx: WeaponContext): WeaponView['end'] {
    const reach = PHYSGUN.range * ctx.unit;
    const hit = ctx.physics.raycast(ctx.eye.position, ctx.aim, reach, { layers: Layer.World | Layer.Prop });
    return hit ? hit.point : add(ctx.eye.position, scale(ctx.aim, reach));
  }
}

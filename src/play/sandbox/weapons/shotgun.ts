import { type Vec3, add, cross, normalize, scale } from '../../../core/vec3';
import { Button } from '../../sim/actor';
import { Layer } from '../../sim/physics';
import { CUES } from '../audio/cues';
import { WeaponId } from '../sandbox.enums';
import { type Impact, VmRole, type Weapon, type WeaponContext, type WeaponInput, type WeaponView } from './weapon';

/**
 * READ ME — Half-Life 2's shotgun (weapon_shotgun.cpp) as Garry's Mod hands it
 * out: six shells in the tube, 64 more (the sandbox loadout's buckshot). Mouse 1
 * fires seven pellets in a 10° cone and, with shells left, pumps after the shot;
 * held, it fires again as soon as it can. Mouse 2 fires two shells at once,
 * twelve pellets (one shell left: a single shot). R loads shell by shell —
 * start, a shell each 0.4 s, finish — and a shot breaks it off once a shell is
 * in. Empty with nothing to load, it clicks. Each pellet pushes what it hits
 * at the point it hits, so it turns too (Source's bullet force for buckshot, and
 * at least a visible shove however heavy), and the shot knocks the view back.
 * The times are the c_shotgun sequences' own.
 */

const CLIP = 6;
const RESERVE = 64;
/** Pellets of one shot and of the double shot (sk_plr_num_shotgun_pellets, and 12 for altfire). */
const PELLETS = { single: 7, double: 12 } as const;
/** VECTOR_CONE_10DEGREES: the sine of half the cone. */
const SPREAD = 0.08716;
/** Seconds each sequence takes (c_shotgun's frames at 30 a second). */
const TIMES = { draw: 0.733, fire: 0.333, fire2: 0.5, pump: 0.533, dry: 0.333, reloadStart: 0.5, reload: 0.4, reloadEnd: 0.433 } as const;
/**
 * A pellet's push: BULLET_IMPULSE(200 grains, 1200 ft/s) with Source's exaggeration, kg·inches a second
 * (1200·12·200·0.0000648·3.5), scaled to the player like every Garry's Mod length.
 */
const PELLET_FORCE = 653;
/**
 * The least a pellet speeds up what it hits, inches a second: a full shot moves even the spawn
 * menu's 1600 kg cube a hand's width or so, a double shot more, as a player expects a shot to show.
 */
const MIN_SHOVE = 12;
/** How far a pellet flies (MAX_TRACE_LENGTH), inches. */
const RANGE = 56756;
/** ViewPunch: Mouse 1 up by 1–2° and sideways by up to 2°; Mouse 2 up or down by up to 5°. */
const PUNCH = { single: { pitch: [1, 2], yaw: 2 }, double: { pitch: 5 } } as const;
/** Hits kept for the impacts' effects. */
const KEEP_IMPACTS = 24;
const UP: Vec3 = [0, 1, 0];

export class Shotgun implements Weapon {
  readonly id = WeaponId.Shotgun;
  readonly hint = 'Mouse 1 fire · Mouse 2 both barrels · R reload';
  private clip = CLIP;
  private reserve = RESERVE;
  /** Simulation time the gun is ready again. */
  private next = 0;
  private needPump = false;
  private inReload = false;
  /** A shot asked for while loading: the load ends, then it fires. */
  private delayed: Button.Attack | Button.Attack2 | null = null;
  private act: WeaponView['act'] = null;
  private muzzle: number | null = null;
  private impacts: Impact[] = [];
  private deployed = false;

  constructor(private readonly random: () => number = Math.random) {}

  step(input: WeaponInput, ctx: WeaponContext): void {
    const t = ctx.time;
    if (!this.deployed) {
      this.deployed = true;
      this.play(VmRole.Draw, t, TIMES.draw);
      return;
    }
    const shot = input.held.has(Button.Attack2) ? Button.Attack2 : input.held.has(Button.Attack) ? Button.Attack : null;
    if (this.inReload) {
      if (shot && this.clip >= 1) this.delayed = shot;
      if (t < this.next) return;
      if (this.delayed || this.clip >= CLIP || this.reserve <= 0) {
        this.inReload = false;
        this.play(VmRole.ReloadEnd, t, TIMES.reloadEnd);
        return;
      }
      this.clip++;
      this.reserve--;
      ctx.sound(CUES.shotgunReload);
      this.play(VmRole.Reload, t, TIMES.reload);
      return;
    }
    if (t < this.next) return;
    if (this.needPump) {
      this.needPump = false;
      ctx.sound(CUES.shotgunPump);
      this.play(VmRole.Pump, t, TIMES.pump);
      return;
    }
    const want = this.delayed ?? shot;
    this.delayed = null;
    if (want === Button.Attack2 && this.clip >= 2) return this.fire(ctx, true);
    if (want && this.clip >= 1) return this.fire(ctx, false);
    if (want && this.reserve > 0) return this.startReload(t);
    if (want && input.pressed.has(want)) {
      ctx.sound(CUES.shotgunEmpty);
      this.play(VmRole.Dry, t, TIMES.dry);
      return;
    }
    if (input.pressed.has(Button.Reload) && this.clip < CLIP && this.reserve > 0) this.startReload(t);
  }

  view(): WeaponView {
    return {
      firing: false, end: null, held: null, flash: null, shot: null,
      act: this.act, muzzle: this.muzzle, ammo: { clip: this.clip, reserve: this.reserve }, impacts: this.impacts,
    };
  }

  holster(): void {
    this.deployed = false;
    this.inReload = false;
    this.delayed = null;
  }

  private startReload(t: number): void {
    // Emptied, it pumps once the load is done.
    if (this.clip <= 0) this.needPump = true;
    this.inReload = true;
    this.play(VmRole.ReloadStart, t, TIMES.reloadStart);
  }

  private fire(ctx: WeaponContext, double: boolean): void {
    const t = ctx.time;
    this.clip -= double ? 2 : 1;
    this.muzzle = t;
    ctx.sound(double ? CUES.shotgunDouble : CUES.shotgunFire);
    this.play(double ? VmRole.Fire2 : VmRole.Fire, t, double ? TIMES.fire2 : TIMES.fire);
    this.needPump = this.clip > 0;
    const p = PUNCH;
    if (double) ctx.kick(this.between(-p.double.pitch, p.double.pitch), 0);
    else ctx.kick(this.between(p.single.pitch[0], p.single.pitch[1]), this.between(-p.single.yaw, p.single.yaw));
    const right = normalize(cross(ctx.aim, UP));
    const up = cross(right, ctx.aim);
    for (let i = 0; i < (double ? PELLETS.double : PELLETS.single); i++) {
      // Source's FireBullets: two uniform randoms a side, so pellets crowd the middle.
      const x = (this.between(-1, 1) + this.between(-1, 1)) * 0.5;
      const y = (this.between(-1, 1) + this.between(-1, 1)) * 0.5;
      const dir = normalize(add(ctx.aim, add(scale(right, x * SPREAD), scale(up, y * SPREAD))));
      const hit = ctx.physics.raycast(ctx.eye.position, dir, RANGE * ctx.unit, { layers: Layer.World | Layer.Prop });
      if (!hit) continue;
      // Source's force, but never less than a visible shove: Hoodoo's shapes weigh far more than Garry's Mod's hollow props.
      const push = Math.max(PELLET_FORCE, ctx.physics.mass(hit.body) * MIN_SHOVE) * ctx.unit;
      ctx.physics.applyImpulse(hit.body, scale(dir, push), hit.point);
      this.impacts.push({ point: hit.point, normal: hit.normal, body: hit.body, time: t });
    }
    if (this.impacts.length > KEEP_IMPACTS) this.impacts = this.impacts.slice(-KEEP_IMPACTS);
  }

  private play(role: VmRole, t: number, seconds: number): void {
    this.act = { role, time: t };
    this.next = t + seconds;
  }

  private between(a: number, b: number): number {
    return a + this.random() * (b - a);
  }
}

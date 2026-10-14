import type { Cue } from '../audio/mixer';
import type { Vec3 } from '../../../core/vec3';
import type { Button, Eye } from '../../sim/actor';
import type { BodyId, Physics } from '../../sim/physics';
import type { Props } from '../props';
import type { NoticeKind, WeaponId } from '../sandbox.enums';

/** What a weapon may use: the physics, the props, the player's eye and scale, the held modifier keys. */
export interface WeaponContext {
  readonly physics: Physics;
  readonly props: Props;
  /** World units per Half-Life unit: Garry's Mod's numbers scale with the player. */
  readonly unit: number;
  readonly dt: number;
  /** Simulation time, seconds. */
  readonly time: number;
  readonly eye: Eye;
  /** The unit aim from the eye. */
  readonly aim: Vec3;
  /** E (use) and Shift are down. */
  readonly use: boolean;
  readonly snap: boolean;
  /** A notice at the bottom right, with the game's sound for it when it has one. */
  notify(text: string, kind: NoticeKind, sound?: Cue): void;
  /** The gun's own sound, in the head. */
  sound(cue: Cue): void;
  /** Source's ViewPunch: the view (and the aim) knocked by degrees, up and right, coming back by itself. */
  kick(pitch: number, yaw: number): void;
}

/** The hands' sequences a gun asks for, by what they do (Source's activities). */
export enum VmRole {
  Draw = 'draw',
  Idle = 'idle',
  Fire = 'fire',
  Fire2 = 'fire2',
  Dry = 'dry',
  Pump = 'pump',
  ReloadStart = 'reload-start',
  Reload = 'reload',
  ReloadEnd = 'reload-end',
}

/** A bullet's hit: where, the surface's normal there, the body, and when (simulation seconds). */
export interface Impact {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly body: BodyId;
  readonly time: number;
}

/** One fixed step of the mouse buttons and R for the weapon in hand. */
export interface WeaponInput {
  readonly held: ReadonlySet<Button>;
  /** Went down this step. */
  readonly pressed: ReadonlySet<Button>;
  /** Wheel steps since the last step (+ toward the player), when the weapon took them. */
  readonly reach: number;
}

/** What the overlay draws for a weapon: its beam, the body it holds, a flash. */
export interface WeaponView {
  /** The trigger is down: the beam shows. */
  readonly firing: boolean;
  /** Where the beam ends in the world, or null (nothing in reach: it fades into the distance). */
  readonly end: Vec3 | null;
  /** The body held and the grabbed point on it. */
  readonly held: { readonly body: BodyId; readonly local: Vec3; readonly distance: number } | null;
  /** A prop just frozen (true) or unfrozen (false), and when (simulation seconds): Garry's Mod flashes a green or red halo. */
  readonly flash: { readonly body: BodyId; readonly time: number; readonly frozen: boolean } | null;
  /** The Tool Gun's last shot that did something: where it hit and when (simulation seconds). */
  readonly shot?: { readonly end: Vec3; readonly time: number } | null;
  /** What the gun's little screen shows (the Tool Gun's tool). */
  readonly screen?: string;
  /** The sequence the hands should play now, and since when (a new time plays it again). */
  readonly act?: { readonly role: VmRole; readonly time: number } | null;
  /** When the muzzle last flashed (simulation seconds). */
  readonly muzzle?: number | null;
  /** Rounds in the gun and in reserve, for the HUD. */
  readonly ammo?: { readonly clip: number; readonly reserve: number } | null;
  /** The latest bullets' hits, newest last. */
  readonly impacts?: readonly Impact[];
}

export interface Weapon {
  readonly id: WeaponId;
  /** One line for the hint while this weapon is out. */
  readonly hint: string;
  step(input: WeaponInput, ctx: WeaponContext): void;
  /** Mouse motion the weapon takes instead of the view (E turns what the Physics Gun holds). */
  look?(dx: number, dy: number, ctx: WeaponContext): boolean;
  /** Whether the weapon takes the wheel now (instead of switching weapons). */
  wantsWheel?(): boolean;
  view(): WeaponView;
  /** Put away: let go of anything held. */
  holster(ctx: WeaponContext): void;
}

/** Garry's Mod's default weapon colour (cl_weaponcolor): the Physics Gun's glow, beam and halo. */
export const DEFAULT_WEAPON_COLOR: readonly [number, number, number] = [0.3, 1.8, 2.1];

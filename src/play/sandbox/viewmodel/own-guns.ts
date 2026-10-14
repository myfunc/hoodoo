import { type Vec3, add, cross, length, normalize, scale, sub } from '../../../core/vec3';
import type { BonePose, Matrix3x4, SourceBone, SourceModel, SourceSequence } from '../../../io/source/source.types';
import { WeaponId } from '../sandbox.enums';
import { MeshBuilder } from './own-mesh';
import { ToolScreen } from './tool-screen';
import type { VmGpu, VmMaterial } from './vm-gpu';

/**
 * READ ME — Sandbox's own Physics Gun and Tool Gun, for players without Garry's
 * Mod files: simple solids built as Source models (own-mesh.ts) where Garry's
 * Mod's c_ models sit (measured from c_superphyscannon and c_toolgun), so the
 * hands layer moves, lights and fires them exactly as it does the real ones.
 * The Physics Gun has a glowing core in the weapon colour and three claws on
 * their own bones that open with the "active" pose parameter while the trigger
 * is down; the Tool Gun has the little screen the tool's name scrolls across.
 * Both have draw and fire sequences; there are no arms.
 */

/** Material slots. */
enum Slot {
  Dark = 0,
  Steel = 1,
  Glow = 2,
  Light = 3,
  Rubber = 4,
  Screen = 5,
  Red = 6,
  Blue = 7,
  Lamp = 8,
}
interface Look {
  readonly color: readonly [number, number, number];
  readonly phong?: boolean;
  readonly glow?: boolean;
  /** A fixed glow colour; without it the glow follows the weapon colour. */
  readonly tint?: readonly [number, number, number];
}
const LOOKS: Readonly<Record<Slot, Look>> = {
  [Slot.Dark]: { color: [0.035, 0.037, 0.042], phong: true },
  [Slot.Steel]: { color: [0.12, 0.125, 0.135], phong: true },
  [Slot.Glow]: { color: [1, 1, 1], glow: true },
  [Slot.Light]: { color: [0.16, 0.165, 0.17], phong: true },
  [Slot.Rubber]: { color: [0.008, 0.008, 0.008] },
  [Slot.Screen]: { color: [1, 1, 1], glow: true, tint: [1, 1, 1] },
  [Slot.Red]: { color: [0.32, 0.012, 0.006], phong: true },
  [Slot.Blue]: { color: [0.01, 0.045, 0.36], phong: true },
  [Slot.Lamp]: { color: [1, 1, 1], glow: true, tint: [0.3, 1, 0.35] },
};
const PHONG = { exponent: 24, boost: 2.5, fresnel: [0.15, 0.5, 1] as const } as const;
const SIDES = 8;
const ROUND = 16;
const TWIST = Math.PI / SIDES;
const DEG = Math.PI / 180;

/**
 * The Physics Gun: a tapered body rising toward the front housing, kept under
 * the line from the eye to the muzzle so the glowing core between the claws
 * shows over it, as the real one's does; inches.
 */
const PHYS = {
  axis: { y: -12.3, z: -12.9 },
  /** The barrel's direction: forward, a little left and up, so the eye sees the gun's length, not its end. */
  dir: [1, 0.08, 0.1] as Vec3,
  /** Along the barrel's line (x as distance at the muzzle's 59.3), sunk below it at the rear. */
  body: { from: 37, to: 47.5, r0: 1.8, r1: 4.4, sink: 2.2 },
  band: { from: 46.5, to: 48.5, r: 4.9 },
  front: { from: 48, to: 58.2, r0: 4.8, r1: 2.6 },
  core: { x: 59.4, r: 2.5 },
  halo: { x: 57.4, r: 3.3, tube: 0.4 },
  strips: { from: 0.15, to: 0.85, angles: [65, 115], lift: 0.3, half: 0.28 },
  doodads: [{ from: 50.3, to: 55.3, r: 4.3, deg: 160 }, { from: 50.3, to: 55.3, r: 4.3, deg: 20 }],
  doodadR: 0.55,
  /** Arms from the housing out to each claw's hinge. */
  mounts: { from: 54, rFrom: 3.4, half: [0.55, 0.45] as const },
  /** Glowing coils around the front housing, and the window on its top where the core's light shows. */
  coils: { at: [49.5, 52, 54.5], tube: 0.28, inset: 0.1 },
  window: { x: 51.5, r: 1.4, deg: 90 },
  /** Claws: hinge at the base radius, tip nearer the axis; open turns the tip outward. */
  claw: { base: 62, tip: 69.6, rBase: 10.6, rTip: 8.2, half: [0.8, 1.25] as const, open: 26, angles: [90, 210, 330] },
  muzzle: 59.3,
} as const;

const PHYS_MUZZLE: Vec3 = [PHYS.muzzle, PHYS.axis.y, PHYS.axis.z];
const PHYS_FRAME = (() => {
  const forward = normalize(PHYS.dir);
  const side = normalize(cross([0, 0, 1], forward));
  return { forward, side, up: cross(forward, side) };
})();

/** The Tool Gun (measured from c_toolgun: body, top housing, the tilted screen). */
const TOOL = {
  axis: { y: -6.1, z: -2.7 },
  barrel: { from: 21.5, to: 25.9, r0: 0.6, r1: 0.5 },
  tipRing: { x: 25.6, r: 0.6, tube: 0.14 },
  body: { centre: [18.6, -6.1, -3.3] as Vec3, half: [3.4, 0.9, 1.2] as Vec3 },
  top: { centre: [20, -6.2, -1.6] as Vec3, half: [1.7, 1.1, 0.5] as Vec3 },
  spinner: { from: 17.4, to: 19.9, r: 1.05, y: -6.1, z: -3.3 },
  grip: { centre: [14.8, -6.1, -6.2] as Vec3, half: [0.8, 0.75, 2.1] as Vec3, tilt: 24 },
  /** The screen leans back toward the eye: its bottom edge nearer than its top. */
  screen: { left: -5.15, right: -7.25, bottom: [16.3, -2.3] as const, top: [17.9, -0.8] as const, frame: 0.15 },
  tubes: [
    { slot: Slot.Red, from: [16.2, -5.0, -2.4] as Vec3, to: [22, -5.15, -2.9] as Vec3 },
    { slot: Slot.Blue, from: [16.2, -7.2, -2.4] as Vec3, to: [22, -7.05, -2.9] as Vec3 },
  ],
  tubeR: 0.17,
  lamp: { centre: [20.6, -7.05, -3.6] as Vec3, r: 0.18 },
  muzzle: 25.9,
} as const;

/** Sequences: frames at 30 a second. */
const FPS = 30;
const DRAW = { frames: 16, drop: [-3, 2, -9] as Vec3, pitch: -24 } as const;
const FIRE = { frames: 10, kick: -1.4, pitch: -5, peak: 0.25 } as const;

/** One gun: its model and the material for each slot. */
export interface OwnGun {
  readonly model: SourceModel;
  readonly slots: readonly (VmMaterial | null)[];
}

/** The guns' models alone. */
export function ownGunModels(): Map<WeaponId, SourceModel> {
  return new Map([[WeaponId.PhysicsGun, physicsGun()], [WeaponId.ToolGun, toolGun()]]);
}

/** Both guns with their materials, and the Tool Gun's screen. */
export function ownGuns(gpu: VmGpu): { guns: Map<WeaponId, OwnGun>; screen: ToolScreen } {
  const screen = new ToolScreen(gpu, null);
  const slots = Object.values(Slot).filter((v): v is Slot => typeof v === 'number').map((s) => material(gpu, s, screen));
  return { guns: new Map([...ownGunModels()].map(([id, model]) => [id, { model, slots }])), screen };
}

function material(gpu: VmGpu, s: Slot, screen: ToolScreen): VmMaterial {
  const look = LOOKS[s];
  return {
    base: s === Slot.Screen ? screen.texture : gpu.white, bump: null, detail: null, detailScale: 1, detailBlend: 0,
    color: look.color, alpha: 1, translucent: false, additive: false, alphaTest: 0, noCull: true,
    unlit: false, selfIllum: !!look.glow, selfIllumTint: look.tint ?? null,
    phong: !!look.phong, phongExponent: PHONG.exponent, phongBoost: PHONG.boost, phongTint: [1, 1, 1], fresnel: PHONG.fresnel,
    baseAlphaPhongMask: false, rim: false, rimExponent: 1, rimBoost: 0, halfLambert: true, hidden: false,
  };
}

/** A point on the Physics Gun's barrel line at x (its distance matching x at the muzzle), off it by r toward the angle. */
function physAt(x: number, r = 0, deg = 0): Vec3 {
  return add(add(PHYS_MUZZLE, scale(PHYS_FRAME.forward, x - PHYS.muzzle)), scale(physRadial(deg), r));
}

/** Out from the barrel toward the angle (degrees; 90 is up, 0 is left). */
function physRadial(deg: number): Vec3 {
  return add(scale(PHYS_FRAME.side, Math.cos(deg * DEG)), scale(PHYS_FRAME.up, Math.sin(deg * DEG)));
}


function physicsGun(): SourceModel {
  const m = new MeshBuilder();
  const { body, band, front, core, halo, strips, mounts, claw } = PHYS;
  const [rear, fore] = [add(physAt(body.from), scale(PHYS_FRAME.up, -body.sink)), physAt(body.to)];
  m.prism(Slot.Dark, 0, rear, fore, body.r0, body.r1, ROUND, TWIST);
  // Glowing strips along the body's top, lifted off its surface.
  for (const deg of strips.angles) {
    const along = (t: number, r: number): Vec3 => add(add(scale(rear, 1 - t), scale(fore, t)), scale(physRadial(deg), r));
    const [ta, tb] = [strips.from, strips.to];
    const ra = body.r0 + (body.r1 - body.r0) * ta + strips.lift;
    const rb = body.r0 + (body.r1 - body.r0) * tb + strips.lift;
    m.prism(Slot.Glow, 0, along(ta, ra), along(tb, rb), strips.half, strips.half, SIDES);
  }
  m.prism(Slot.Steel, 0, physAt(band.from), physAt(band.to), band.r, band.r, ROUND, TWIST);
  m.prism(Slot.Dark, 0, physAt(front.from), physAt(front.to), front.r0, front.r1, ROUND, TWIST);
  for (const d of PHYS.doodads) m.prism(Slot.Steel, 0, physAt(d.from, d.r, d.deg), physAt(d.to, d.r, d.deg), PHYS.doodadR, PHYS.doodadR, SIDES);
  m.sphere(Slot.Glow, 0, physAt(core.x), core.r, ROUND);
  m.ring(Slot.Glow, 0, physAt(halo.x), PHYS_FRAME.forward, halo.r, halo.tube, ROUND * 2, SIDES);
  // The housing's radius where each coil sits, so the coils hug it.
  const housing = (x: number) => front.r0 + ((front.r1 - front.r0) * (x - front.from)) / (front.to - front.from);
  for (const x of PHYS.coils.at) m.ring(Slot.Glow, 0, physAt(x), PHYS_FRAME.forward, housing(x) - PHYS.coils.inset, PHYS.coils.tube, ROUND * 2, SIDES);
  const w = PHYS.window;
  m.sphere(Slot.Glow, 0, physAt(w.x, housing(w.x) - w.r / 2, w.deg), w.r, ROUND);
  const bones: SourceBone[] = [bone('base', -1, [0, 0, 0])];
  claw.angles.forEach((deg, i) => {
    const out = physRadial(deg);
    const side = cross(out, PHYS_FRAME.forward);
    const [a, b] = [physAt(claw.base, claw.rBase, deg), physAt(claw.tip, claw.rTip, deg)];
    const root = physAt(mounts.from, mounts.rFrom, deg);
    const arm = normalize(sub(a, root));
    m.box(Slot.Steel, 0, scale(add(root, a), 0.5), [length(sub(a, root)) / 2, mounts.half[0], mounts.half[1]], [arm, side, cross(arm, side)]);
    const along = normalize(sub(b, a));
    m.box(Slot.Steel, i + 1, scale(add(a, b), 0.5), [length(sub(b, a)) / 2, claw.half[0], claw.half[1]], [along, side, cross(along, side)]);
    m.sphere(Slot.Glow, i + 1, b, claw.half[0], SIDES);
    bones.push(bone(`claw${i}`, 0, a));
  });
  // The claws turn about their sides: open tips them outward.
  const turns = claw.angles.map((deg) => axisQuat(cross(physRadial(deg), PHYS_FRAME.forward), -claw.open * DEG));
  const closed = (): BonePose[] => bones.map((b) => ({ position: b.position, quat: b.quat }));
  const open = (): BonePose[] => bones.map((b, i) => ({ position: b.position, quat: i ? turns[i - 1] : b.quat }));
  return model('own_physgun', bones, m, physAt(PHYS.muzzle), [closed, open], true);
}

function toolGun(): SourceModel {
  const m = new MeshBuilder();
  const at = (x: number): Vec3 => [x, TOOL.axis.y, TOOL.axis.z];
  const { barrel, tipRing, body, top, spinner, grip, screen, lamp } = TOOL;
  m.prism(Slot.Steel, 0, at(barrel.from), at(barrel.to), barrel.r0, barrel.r1, ROUND / 2, TWIST);
  m.ring(Slot.Dark, 0, at(tipRing.x), [1, 0, 0], tipRing.r, tipRing.tube, ROUND, SIDES);
  m.box(Slot.Light, 0, body.centre, body.half);
  m.box(Slot.Light, 0, top.centre, top.half);
  m.prism(Slot.Steel, 0, [spinner.from, spinner.y, spinner.z], [spinner.to, spinner.y, spinner.z], spinner.r, spinner.r, ROUND, TWIST);
  const t = grip.tilt * DEG;
  m.box(Slot.Rubber, 0, grip.centre, grip.half, [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]]);
  const [bx, bz] = screen.bottom;
  const [tx, tz] = screen.top;
  const f = screen.frame;
  m.quad(Slot.Dark, 0, [[bx + f, screen.left + f, bz - f], [bx + f, screen.right - f, bz - f], [tx + f, screen.right - f, tz + f], [tx + f, screen.left + f, tz + f]]);
  m.quad(Slot.Screen, 0, [[bx, screen.left, bz], [bx, screen.right, bz], [tx, screen.right, tz], [tx, screen.left, tz]]);
  for (const tube of TOOL.tubes) m.prism(tube.slot, 0, tube.from, tube.to, TOOL.tubeR, TOOL.tubeR, SIDES);
  m.sphere(Slot.Lamp, 0, lamp.centre, lamp.r, SIDES);
  const bones = [bone('base', -1, [0, 0, 0])];
  const rest = (): BonePose[] => bones.map((b) => ({ position: b.position, quat: b.quat }));
  return model('own_toolgun', bones, m, at(TOOL.muzzle), [rest], false);
}

/** A model from its bones and solids, with idle (blending `idle` poses over "active" when there are two), draw and fire. */
function model(name: string, bones: SourceBone[], m: MeshBuilder, muzzle: Vec3, idle: readonly (() => BonePose[])[], claws: boolean): SourceModel {
  const sequence = (seqName: string, activity: string, frames: number, looping: boolean, animations: number[], blend = false): SourceSequence => ({
    name: seqName, activity, fps: FPS, frames, looping, blendParams: blend ? [0, -1] : [-1, -1], blendSize: blend ? [2, 1] : [1, 1], animations, events: [],
  });
  const IDLE_ANIMS = idle.length;
  const [drawAnim, fireAnim] = [IDLE_ANIMS, IDLE_ANIMS + 1];
  // The whole gun moved by `offset` and pitched about its muzzle (the root bone turns about the eye).
  const moved = (offset: Vec3, pitch: number): BonePose[] => {
    const pose = idle[0]();
    const quat = axisQuat([0, 1, 0], pitch * DEG);
    pose[0] = { position: add(offset, sub(muzzle, rotate(quat, muzzle))), quat };
    return pose;
  };
  return {
    name,
    bones,
    attachments: [{ name: 'muzzle', bone: 0, local: translation(muzzle) }],
    textures: [],
    skins: [],
    meshes: m.meshes(),
    poseParameters: claws ? [{ name: 'active', start: 0, end: 1, loop: 0 }] : [],
    sequences: [
      sequence('idle', 'ACT_VM_IDLE', 1, true, idle.map((_, i) => i), idle.length > 1),
      sequence('draw', 'ACT_VM_DRAW', DRAW.frames, false, [drawAnim]),
      sequence('fire', 'ACT_VM_PRIMARYATTACK', FIRE.frames, false, [fireAnim]),
    ],
    animationCount: IDLE_ANIMS + 2,
    animationPose(animation: number, frame: number): BonePose[] {
      if (animation < IDLE_ANIMS) return idle[animation]();
      if (animation === drawAnim) {
        // Up from below the screen, levelling out (ease out).
        const k = 1 - Math.min(1, frame / (DRAW.frames - 1));
        const ease = k * k;
        return moved(scale(DRAW.drop, ease), DRAW.pitch * ease);
      }
      // A short kick back and up, then settling.
      const t = Math.min(1, frame / (FIRE.frames - 1));
      const k = t < FIRE.peak ? t / FIRE.peak : 1 - (t - FIRE.peak) / (1 - FIRE.peak);
      return moved([FIRE.kick * k, 0, 0], FIRE.pitch * k);
    },
  };
}

function bone(name: string, parent: number, position: Vec3): SourceBone {
  return { name, parent, position, quat: [0, 0, 0, 1], poseToBone: translation(scale(position, -1)), flags: 0 };
}


function axisQuat(axis: Vec3, angle: number): [number, number, number, number] {
  const a = normalize(axis);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

/** A vector turned by a unit quaternion. */
function rotate(q: readonly [number, number, number, number], v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

function translation(p: Vec3): Matrix3x4 {
  return new Float32Array([1, 0, 0, p[0], 0, 1, 0, p[1], 0, 0, 1, p[2]]);
}

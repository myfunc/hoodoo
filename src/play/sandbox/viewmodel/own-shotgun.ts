import { type Vec3, add, scale, sub } from '../../../core/vec3';
import type { BonePose, SourceModel, SourceSequence } from '../../../io/source/source.types';
import { MeshBuilder } from './own-mesh';
import { DEG, FPS, ROUND, SIDES, Slot, TWIST, axisQuat, bone, rotate, translation } from './own-guns';

/**
 * READ ME — Sandbox's own shotgun, for players without Half-Life 2's files: a
 * SPAS-12 of simple solids where c_shotgun sits (its muzzle measured at 52.8,
 * −9, −5.8 inches), the fore-end on a bone of its own so the pump slides it.
 * Its sequences are the real one's, frame for frame long, with the same
 * activities: draw, idle, fire, the double shot, the pump, dry fire, and the
 * reload's start (the gun rolls its loading port toward the eye), one shell
 * pushed in, and finish.
 */

const AXIS = { y: -9, z: -5.6 } as const;
const GUN = {
  barrel: { from: 30, to: 52.8, r: 0.5, z: -5.25 },
  shroud: { from: 31, to: 46.5, r: 0.82, z: -5.25 },
  tube: { from: 30, to: 48.5, r: 0.48, z: -6.55 },
  fore: { centre: [40, AXIS.y, -6.6] as Vec3, half: [3.6, 0.95, 0.85] as Vec3 },
  receiver: { centre: [25.5, AXIS.y, -5.75] as Vec3, half: [5, 0.82, 1.35] as Vec3 },
  port: { centre: [24, AXIS.y - 0.84, -5.3] as Vec3, half: [1.6, 0.05, 0.45] as Vec3 },
  guard: { centre: [22.2, AXIS.y, -7.6] as Vec3, half: [1.3, 0.35, 0.55] as Vec3 },
  grip: { centre: [19.4, AXIS.y, -8.6] as Vec3, half: [0.85, 0.7, 2.1] as Vec3, tilt: 20 },
  stock: { centre: [14.5, AXIS.y, -5.6] as Vec3, half: [5.5, 0.32, 0.75] as Vec3 },
  sight: { centre: [51.5, AXIS.y, -4.55] as Vec3, half: [0.4, 0.12, 0.25] as Vec3 },
  muzzle: [52.8, AXIS.y, -5.25] as Vec3,
  /** Where the gun turns: about its grip. */
  pivot: [22, AXIS.y, -6.5] as Vec3,
} as const;

/** Frames (30 a second, c_shotgun's own) and how far each move goes: inches, degrees. */
const SEQ = {
  draw: { frames: 23, drop: [-3, 2, -10] as Vec3, pitch: -26 },
  fire: { frames: 11, kick: -2.2, pitch: -7, peak: 0.18 },
  fire2: { frames: 16, kick: -3.4, pitch: -12, peak: 0.15 },
  dry: { frames: 11, kick: -0.4, pitch: -1.2, peak: 0.3 },
  pump: { frames: 17, slide: -3.8, roll: 7, back: 0.45 },
  reloadStart: { frames: 16, roll: -38, lift: [0, -1.4, 1.6] as Vec3 },
  reload: { frames: 13, push: 0.9, peak: 0.4 },
  reloadEnd: { frames: 14 },
} as const;

enum Anim { Idle, Draw, Fire, Fire2, Dry, Pump, ReloadStart, Reload, ReloadEnd }

export function ownShotgun(): SourceModel {
  const m = new MeshBuilder();
  const along = (x: number, z: number): Vec3 => [x, AXIS.y, z];
  const g = GUN;
  m.prism(Slot.Dark, 0, along(g.barrel.from, g.barrel.z), along(g.barrel.to, g.barrel.z), g.barrel.r, g.barrel.r, ROUND, TWIST);
  m.prism(Slot.Steel, 0, along(g.shroud.from, g.shroud.z), along(g.shroud.to, g.shroud.z), g.shroud.r, g.shroud.r, SIDES, TWIST);
  m.prism(Slot.Dark, 0, along(g.tube.from, g.tube.z), along(g.tube.to, g.tube.z), g.tube.r, g.tube.r, ROUND, TWIST);
  m.box(Slot.Rubber, 1, g.fore.centre, g.fore.half);
  m.box(Slot.Dark, 0, g.receiver.centre, g.receiver.half);
  m.box(Slot.Steel, 0, g.port.centre, g.port.half);
  m.box(Slot.Dark, 0, g.guard.centre, g.guard.half);
  const t = g.grip.tilt * DEG;
  m.box(Slot.Rubber, 0, g.grip.centre, g.grip.half, [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]]);
  m.box(Slot.Steel, 0, g.stock.centre, g.stock.half);
  m.box(Slot.Steel, 0, g.sight.centre, g.sight.half);
  const bones = [bone('base', -1, [0, 0, 0]), bone('pump', 0, g.fore.centre)];
  const sequence = (name: string, activity: string, frames: number, looping: boolean, anim: Anim): SourceSequence => ({
    name, activity, fps: FPS, frames, looping, blendParams: [-1, -1], blendSize: [1, 1], animations: [anim], events: [],
  });
  return {
    name: 'own_shotgun',
    bones,
    attachments: [{ name: 'muzzle', bone: 0, local: translation(g.muzzle) }],
    textures: [],
    skins: [],
    meshes: m.meshes(),
    poseParameters: [],
    sequences: [
      sequence('idle01', 'ACT_VM_IDLE', 1, true, Anim.Idle),
      sequence('draw', 'ACT_VM_DRAW', SEQ.draw.frames, false, Anim.Draw),
      sequence('fire01', 'ACT_VM_PRIMARYATTACK', SEQ.fire.frames, false, Anim.Fire),
      sequence('altfire', 'ACT_VM_SECONDARYATTACK', SEQ.fire2.frames, false, Anim.Fire2),
      sequence('dryfire', 'ACT_VM_DRYFIRE', SEQ.dry.frames, false, Anim.Dry),
      sequence('pump', 'ACT_SHOTGUN_PUMP', SEQ.pump.frames, false, Anim.Pump),
      sequence('reload1', 'ACT_SHOTGUN_RELOAD_START', SEQ.reloadStart.frames, false, Anim.ReloadStart),
      sequence('reload2', 'ACT_VM_RELOAD', SEQ.reload.frames, false, Anim.Reload),
      sequence('reload3', 'ACT_SHOTGUN_RELOAD_FINISH', SEQ.reloadEnd.frames, false, Anim.ReloadEnd),
    ],
    animationCount: Anim.ReloadEnd + 1,
    animationPose: (animation: number, frame: number) => pose(animation as Anim, frame, bones.map((b) => ({ position: b.position, quat: b.quat }))),
  };
}

/** A frame of an animation: the gun moved and turned about its grip, the fore-end slid. */
function pose(a: Anim, frame: number, rest: BonePose[]): BonePose[] {
  const at = (frames: number) => Math.min(1, frame / Math.max(1, frames - 1));
  /** Up to the peak, then back down: a kick. */
  const kick = (t: number, peak: number) => (t < peak ? t / peak : 1 - (t - peak) / (1 - peak));
  const ease = (t: number) => t * t * (3 - 2 * t);
  const out = rest.map((p) => ({ ...p }));
  const gun = (offset: Vec3, pitch: number, roll: number) => {
    const quat = mulQ(axisQuat([0, 1, 0], pitch * DEG), axisQuat([1, 0, 0], roll * DEG));
    out[0] = { position: add(offset, sub(GUN.pivot, rotate(quat, GUN.pivot))), quat };
  };
  const slide = (x: number) => { out[1] = { position: add(rest[1].position, [x, 0, 0]), quat: rest[1].quat }; };
  const rolled = (k: number, extra: Vec3 = [0, 0, 0]) => gun(add(scale(SEQ.reloadStart.lift, k), extra), 0, SEQ.reloadStart.roll * k);
  switch (a) {
    case Anim.Draw: {
      const k = 1 - at(SEQ.draw.frames);
      const e = k * k;
      gun(scale(SEQ.draw.drop, e), SEQ.draw.pitch * e, 0);
      break;
    }
    case Anim.Fire:
    case Anim.Fire2:
    case Anim.Dry: {
      const s = a === Anim.Fire ? SEQ.fire : a === Anim.Fire2 ? SEQ.fire2 : SEQ.dry;
      const k = kick(at(s.frames), s.peak);
      gun([s.kick * k, 0, 0], s.pitch * k, 0);
      break;
    }
    case Anim.Pump: {
      // Back, then forward again, the gun canting a little as the hand pulls.
      const t = at(SEQ.pump.frames);
      const k = ease(t < SEQ.pump.back ? t / SEQ.pump.back : 1 - (t - SEQ.pump.back) / (1 - SEQ.pump.back));
      slide(SEQ.pump.slide * k);
      gun([0, 0, 0], 0, SEQ.pump.roll * k);
      break;
    }
    case Anim.ReloadStart:
      rolled(ease(at(SEQ.reloadStart.frames)));
      break;
    case Anim.Reload:
      rolled(1, [0, 0, SEQ.reload.push * kick(at(SEQ.reload.frames), SEQ.reload.peak)]);
      break;
    case Anim.ReloadEnd:
      rolled(1 - ease(at(SEQ.reloadEnd.frames)));
      break;
    default:
      break;
  }
  return out;
}

function mulQ(a: readonly [number, number, number, number], b: readonly [number, number, number, number]): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

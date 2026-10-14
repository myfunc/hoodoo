import type { Vec3 } from '../../../core/vec3';
import { attachmentFrame, boneToModel, findSequence, sequencePose, skinMatrices } from '../../../io/source/animation';
import { loadModel } from '../../../io/source/model';
import type { Matrix3x4, SourceFiles, SourceModel } from '../../../io/source/source.types';
import { WeaponId } from '../sandbox.enums';
import type { GpuModel, VmGpu, VmLighting, VmMaterial } from './vm-gpu';
import type { ToolScreen } from './tool-screen';
import { VmMaterials } from './vm-materials';
import { ownGuns } from './own-guns';
import { Bob, type GunPose, Lag, REST_POSE, type ViewAxes } from './vm-motion';
import { VM_CLIP, mergedBones, originOf, perspective, transform4, viewmodelMatrix, vmVerticalFov } from './vm-space';

/**
 * READ ME — the gun in the hands, drawn from the player's own Garry's Mod files:
 * the weapon's c_ model with the player's arms bone-merged onto it, posed by its
 * sequences (draw on taking it out, the attack on firing, idle between), moved
 * by Half-Life 2's walking bob and turn lag, lit by the scene (vm-light.ts) and
 * shaded as Source shades it (vm-shaders.ts). It also tells where the muzzle is,
 * so beams start there.
 */

export interface WeaponLook {
  readonly model: string;
  /** Source viewmodel field of view (horizontal on a 4:3 screen). */
  readonly fov: number;
}

/** What Garry's Mod uses: the physgun is the blue super gravity gun, the Tool Gun its own model. */
export const WEAPON_LOOKS: Readonly<Record<WeaponId, WeaponLook>> = {
  [WeaponId.PhysicsGun]: { model: 'models/weapons/c_superphyscannon.mdl', fov: 54 },
  [WeaponId.ToolGun]: { model: 'models/weapons/c_toolgun.mdl', fov: 62 },
};

/** Gordon's HEV arms, as close to Half-Life 2 as Garry's Mod's hands get. */
export const ARMS_MODEL = 'models/weapons/c_arms_hev.mdl';

/** Activities by role, with plain sequence names as a fallback. */
const ACTIVITY = {
  draw: ['ACT_VM_DRAW', 'draw'],
  idle: ['ACT_VM_IDLE', 'idle'],
  fire: ['ACT_VM_PRIMARYATTACK', 'fire'],
} as const;
type Role = keyof typeof ACTIVITY;

interface Loaded {
  readonly model: SourceModel;
  readonly gpu: GpuModel;
  readonly slots: readonly (VmMaterial | null)[];
}

export interface ViewInput {
  readonly dt: number;
  /** The view's axes in world space. */
  readonly axes: ViewAxes;
  /** Source pitch, degrees, positive looking down. */
  readonly pitch: number;
  /** Horizontal speed, Source units per second. */
  readonly speed: number;
}

export class Viewmodel {
  private weapon: WeaponId = WeaponId.PhysicsGun;
  private sequence = -1;
  private cycle = 0;
  private role: Role = 'idle';
  private readonly bob = new Bob();
  private readonly lag = new Lag();
  private pose: GunPose = REST_POSE;
  private frames: Matrix3x4[] = [];
  private readonly poseValues = new Map<string, number>();

  private constructor(
    private readonly gpu: VmGpu,
    private readonly arms: Loaded | null,
    private readonly weapons: ReadonlyMap<WeaponId, Loaded>,
    /** The Tool Gun's screen, when its model has one. */
    readonly screen: ToolScreen | null,
  ) {}

  /** Loads the arms and every weapon the files have; null when there is no gun to show. */
  static async load(gpu: VmGpu, files: SourceFiles): Promise<Viewmodel | null> {
    const materials = new VmMaterials(gpu, files);
    const one = async (path: string): Promise<Loaded | null> => {
      if (!files.has(path)) return null;
      const model = await loadModel(files, path);
      const slots = await Promise.all(model.textures.map((t) => materials.slot(t)));
      return { model, gpu: gpu.upload(model), slots };
    };
    const entries = await Promise.all((Object.keys(WEAPON_LOOKS) as WeaponId[]).map(async (id) => [id, await one(WEAPON_LOOKS[id].model)] as const));
    const weapons = new Map(entries.filter((e): e is [WeaponId, Loaded] => e[1] !== null));
    if (!weapons.size) return null;
    return new Viewmodel(gpu, await one(ARMS_MODEL), weapons, materials.screen);
  }

  /** Sandbox's own guns (own-guns.ts), for players without the game's files. */
  static own(gpu: VmGpu): Viewmodel {
    const { guns, screen } = ownGuns(gpu);
    const weapons = new Map([...guns].map(([id, g]) => [id, { model: g.model, gpu: gpu.upload(g.model), slots: g.slots }] as const));
    return new Viewmodel(gpu, null, weapons, screen);
  }

  has(id: WeaponId): boolean {
    return this.weapons.has(id);
  }

  /** Takes a weapon out: its draw sequence, then idle. */
  deploy(id: WeaponId): void {
    this.weapon = id;
    this.play('draw');
  }

  fire(): void {
    this.play('fire');
  }

  /** A pose parameter of the current weapon by name (the claws, for one). */
  setPoseParameter(name: string, value: number): void {
    this.poseValues.set(name.toLowerCase(), value);
  }

  private get current(): Loaded | null {
    return this.weapons.get(this.weapon) ?? null;
  }

  private play(role: Role): void {
    const w = this.current;
    if (!w) return;
    const seq = ACTIVITY[role].map((n) => findSequence(w.model, n)).find((i) => i >= 0) ?? -1;
    if (seq < 0 && role !== 'idle') return this.play('idle');
    this.sequence = seq;
    this.cycle = 0;
    this.role = role;
  }

  /** Advances the sequence and the gun's motion. */
  update(v: ViewInput): void {
    const w = this.current;
    if (!w) return;
    if (this.sequence < 0) this.play('idle');
    const seq = w.model.sequences[this.sequence];
    if (seq) {
      const length = Math.max(1, seq.frames - 1) / Math.max(seq.fps, 1);
      this.cycle += v.dt / length;
      if (this.cycle >= 1) {
        if (seq.looping) this.cycle -= Math.floor(this.cycle);
        else if (this.role !== 'idle') this.play('idle');
        else this.cycle = 1;
      }
    }
    this.bob.update(v.dt, v.speed);
    this.lag.update(v.dt, v.axes);
    this.pose = this.lag.apply(this.bob.apply(REST_POSE), v.axes, v.pitch);
    const params: Record<number, number> = {};
    w.model.poseParameters.forEach((p, i) => {
      const value = this.poseValues.get(p.name.toLowerCase());
      if (value !== undefined) params[i] = value;
    });
    this.frames = boneToModel(w.model, this.sequence >= 0 ? sequencePose(w.model, this.sequence, this.cycle, params) : restPoses(w.model));
  }

  get fov(): number {
    return WEAPON_LOOKS[this.weapon].fov;
  }

  /** The projection the hands are drawn with. */
  projection(aspect: number): Float32Array {
    return perspective(vmVerticalFov(this.fov), aspect, VM_CLIP.near, VM_CLIP.far);
  }

  /** An attachment of the current weapon in GPU view space (inches, the hands' field of view). */
  attachment(name: string): Vec3 | null {
    const w = this.current;
    if (!w || !this.frames.length) return null;
    const f = attachmentFrame(w.model, name, this.frames);
    return f ? transform4(viewmodelMatrix(this.pose), originOf(f)) : null;
  }

  draw(aspect: number, light: VmLighting, weaponColor: readonly [number, number, number]): void {
    const w = this.current;
    if (!w || !this.frames.length) return;
    const proj = this.projection(aspect);
    const mv = viewmodelMatrix(this.pose);
    if (this.arms) {
      const armsFrames = mergedBones(this.arms.model, w.model, this.frames, boneToModel(this.arms.model, restPoses(this.arms.model)));
      this.gpu.setBones(this.arms.gpu, skinMatrices(this.arms.model, armsFrames));
      this.gpu.drawModel(this.arms.gpu, this.arms.slots, mv, proj, light, weaponColor);
    }
    this.gpu.setBones(w.gpu, skinMatrices(w.model, this.frames));
    this.gpu.drawModel(w.gpu, w.slots, mv, proj, light, weaponColor);
  }
}

const restPoses = (m: SourceModel) => m.bones.map((b) => ({ position: b.position, quat: b.quat }));

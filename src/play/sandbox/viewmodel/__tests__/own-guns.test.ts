import { describe, expect, it } from 'vitest';
import { attachmentFrame, boneToModel, findSequence, sequencePose, skinMatrices } from '../../../../io/source/animation';
import { WeaponId } from '../../sandbox.enums';
import { ownGunModels } from '../own-guns';

const models = ownGunModels();

describe('own guns', () => {
  it('give both guns idle, draw and fire, a muzzle, and meshes bound to their bones', () => {
    for (const id of [WeaponId.PhysicsGun, WeaponId.ToolGun]) {
      const m = models.get(id)!;
      for (const act of ['ACT_VM_IDLE', 'ACT_VM_DRAW', 'ACT_VM_PRIMARYATTACK']) expect(findSequence(m, act)).toBeGreaterThanOrEqual(0);
      const frames = boneToModel(m, sequencePose(m, findSequence(m, 'ACT_VM_IDLE'), 0));
      expect(skinMatrices(m, frames)).toHaveLength(m.bones.length * 12);
      expect(attachmentFrame(m, 'muzzle', frames)).not.toBeNull();
      for (const mesh of m.meshes) {
        expect(mesh.indices.length % 3).toBe(0);
        expect(Math.max(...mesh.bones)).toBeLessThan(m.bones.length);
      }
    }
  });

  it('sit where Garry\'s Mod\'s guns sit: the muzzles at the measured attachments', () => {
    const at = (id: WeaponId) => {
      const m = models.get(id)!;
      const f = attachmentFrame(m, 'muzzle', boneToModel(m, sequencePose(m, findSequence(m, 'ACT_VM_IDLE'), 0)))!;
      return [f[3], f[7], f[11]];
    };
    expect(at(WeaponId.PhysicsGun).map((v) => Math.round(v))).toEqual([59, -12, -13]);
    expect(at(WeaponId.ToolGun).map((v) => Math.round(v))).toEqual([26, -6, -3]);
  });

  it('open the Physics Gun\'s claws with the active pose parameter', () => {
    const m = models.get(WeaponId.PhysicsGun)!;
    const idle = findSequence(m, 'ACT_VM_IDLE');
    const tip = (active: number) => boneToModel(m, sequencePose(m, idle, 0, { 0: active }))[1];
    const [closed, open] = [tip(0), tip(1)];
    // The top claw's frame turns: its forward axis tips up when open.
    expect(open[8]).not.toBeCloseTo(closed[8], 2);
  });

  it('start the draw below the screen and end it at rest', () => {
    const m = models.get(WeaponId.ToolGun)!;
    const draw = findSequence(m, 'ACT_VM_DRAW');
    const muzzle = (cycle: number) => attachmentFrame(m, 'muzzle', boneToModel(m, sequencePose(m, draw, cycle)))!;
    expect(muzzle(0)[11]).toBeLessThan(muzzle(1)[11] - 4);
    expect(muzzle(1)[11]).toBeCloseTo(-2.7, 3);
  });
});

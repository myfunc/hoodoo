import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModel, parseModel, unsupportedModelAnimations } from '../model';
import { parseMdl } from '../mdl';
import { boneToModel, findSequence, sequencePose, skinMatrices } from '../animation';
import type { SourceFiles, SourceModel } from '../source.types';

class FolderFiles implements SourceFiles {
  constructor(private readonly root: string) {}
  has(path: string): boolean { return existsSync(join(this.root, path)); }
  async read(path: string): Promise<Uint8Array | null> {
    return this.has(path) ? new Uint8Array(readFileSync(join(this.root, path))) : null;
  }
  list(prefix: string): string[] {
    const walk = (path: string): string[] => readdirSync(join(this.root, path), { withFileTypes: true })
      .flatMap(entry => entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`]);
    return this.has(prefix) ? walk(prefix.replace(/\/$/, '')) : [];
  }
}

function skeleton(name = 'fixture'): Uint8Array {
  const bytes = new Uint8Array(1024), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => bytes.set(new TextEncoder().encode(value), at);
  const int = (at: number, value: number) => view.setInt32(at, value, true);
  text(0, 'IDST'); int(4, 48); int(8, 17); text(12, name); int(76, bytes.length);
  int(156, 1); int(160, 408); int(408, 216); int(412, -1); text(624, 'root');
  view.setFloat32(408 + 56, 1, true);
  for (const at of [504, 524, 544]) view.setFloat32(at, 1, true);
  return bytes;
}

function companions() {
  const vvd = new Uint8Array(64 + 3 * 48), vd = new DataView(vvd.buffer);
  vvd.set(new TextEncoder().encode('IDSV')); vd.setInt32(4, 4, true); vd.setInt32(8, 17, true);
  vd.setInt32(12, 1, true); vd.setInt32(16, 3, true); vd.setInt32(56, 64, true);
  for (let i = 0; i < 3; i++) {
    vd.setFloat32(64 + i * 48, 1, true); vvd[64 + i * 48 + 15] = 1;
    vd.setFloat32(64 + i * 48 + 16, i, true);
  }
  const vtx = new Uint8Array(185), td = new DataView(vtx.buffer);
  const int = (at: number, value: number) => td.setInt32(at, value, true);
  int(0, 7); int(16, 17); int(20, 1); int(28, 1); int(32, 36);
  int(36, 1); int(40, 8); int(44, 1); int(48, 8); int(52, 1); int(56, 12);
  int(64, 1); int(68, 9); int(73, 3); int(77, 52); int(81, 3); int(85, 79); int(89, 1); int(93, 25);
  int(98, 3); int(106, 3); vtx[116] = 1;
  for (let i = 0; i < 3; i++) { td.setUint16(125 + i * 9 + 4, i, true); td.setUint16(152 + i * 2, i, true); }
  return { vvd, vtx };
}

function drawable(): Uint8Array {
  const bytes = skeleton(), view = new DataView(bytes.buffer);
  const int = (at: number, value: number) => view.setInt32(at, value, true);
  int(232, 1); int(236, 640); int(644, 1); int(652, 16);
  int(656 + 72, 1); int(656 + 76, 148); int(656 + 80, 3); int(804 + 8, 3);
  return bytes;
}

function skinnedPositions(model: SourceModel, poses = model.bones.map(bone => ({ position: bone.position, quat: bone.quat }))) {
  const matrices = skinMatrices(model, boneToModel(model, poses));
  return model.meshes.flatMap(mesh => {
    const positions: number[] = [];
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
      const point = mesh.positions.subarray(vertex * 3, vertex * 3 + 3);
      for (let row = 0; row < 3; row++) {
        let value = 0;
        for (let influence = 0; influence < 3; influence++) {
          const at = mesh.bones[vertex * 3 + influence] * 12 + row * 4;
          value += mesh.weights[vertex * 3 + influence] * (matrices[at] * point[0] + matrices[at + 1] * point[1] + matrices[at + 2] * point[2] + matrices[at + 3]);
        }
        positions.push(value);
      }
    }
    return positions;
  });
}

function bounds(positions: readonly number[]): number[] {
  const result = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  positions.forEach((value, index) => {
    const axis = index % 3;
    result[axis] = Math.min(result[axis], value); result[axis + 3] = Math.max(result[axis + 3], value);
  });
  return result;
}

describe('Source model assembly', () => {
  it('joins companions, preserves skinning and rejects mismatched checksums', () => {
    const { vvd, vtx } = companions();
    const model = parseModel(drawable(), vvd, vtx);
    expect(model.meshes[0].indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(skinnedPositions(model)).toEqual(Array.from(model.meshes[0].positions));
    new DataView(vtx.buffer).setInt32(16, 18, true);
    expect(() => parseModel(drawable(), vvd, vtx)).toThrow('checksum');
    expect(() => parseModel(drawable(), null, null)).toThrow('Missing');
  });

  it('loads normalized include paths without geometry and rejects include cycles', async () => {
    const mdl = skeleton(), view = new DataView(mdl.buffer);
    view.setInt32(336, 1, true); view.setInt32(340, 700, true); view.setInt32(704, 8, true);
    mdl.set(new TextEncoder().encode('weapons/include.mdl'), 708);
    const stored = new Map([['models/main.mdl', mdl], ['models/weapons/include.mdl', skeleton('include')]]);
    const files: SourceFiles = { has: path => stored.has(path), read: async path => stored.get(path) ?? null, list: () => [] };
    expect((await loadModel(files, 'MAIN.MDL')).bones[0].name).toBe('root');
    stored.set('models/weapons/include.mdl', mdl);
    await expect(loadModel(files, 'main.mdl')).rejects.toThrow('Cyclic');
    await expect(loadModel(files, '../main.mdl')).rejects.toThrow('escapes');
  });

  it('falls back from dx90 to dx80 through SourceFiles', async () => {
    const { vvd, vtx } = companions();
    const stored = new Map([['models/test.mdl', drawable()], ['models/test.vvd', vvd], ['models/test.dx80.vtx', vtx]]);
    const files: SourceFiles = { has: path => stored.has(path), read: async path => stored.get(path) ?? null, list: () => [] };
    expect((await loadModel(files, 'test.mdl')).meshes[0].indices.length).toBe(3);
  });

  it('reports unsupported external and alternate-format animations and returns rest', () => {
    const mdl = skeleton(), view = new DataView(mdl.buffer);
    view.setInt32(180, 2, true); view.setInt32(184, 700, true);
    view.setInt32(704, 200, true); view.setInt32(716, 1, true); view.setInt32(752, 1, true);
    view.setInt32(804, 120, true); view.setInt32(812, 64, true); view.setInt32(816, 1, true);
    mdl.set(new TextEncoder().encode('external'), 900); mdl.set(new TextEncoder().encode('frame-format'), 920);
    const model = parseModel(mdl, null, null);
    expect(unsupportedModelAnimations(model)).toEqual(['external', 'frame-format']);
    expect(model.animationPose(0, 0)[0].position).toEqual([0, 0, 0]);
    expect(model.animationPose(1, 0)[0].position).toEqual([0, 0, 0]);
  });

  it('remaps included animation bones, indices and pose parameters by name', () => {
    const main = skeleton(), view = new DataView(main.buffer);
    view.setInt32(180, 1, true); view.setInt32(184, 760, true);
    view.setInt32(776, 1, true);
    const include: SourceModel = {
      name: 'included', bones: [
        { name: 'absent', parent: -1, position: [0, 0, 0], quat: [0, 0, 0, 1], flags: 0, poseToBone: new Float32Array(12) },
        { name: 'root', parent: -1, position: [0, 0, 0], quat: [0, 0, 0, 1], flags: 0, poseToBone: new Float32Array(12) },
      ], attachments: [], textures: [], skins: [], meshes: [],
      poseParameters: [{ name: 'aim', start: -1, end: 1, loop: 0 }],
      sequences: [{ name: 'draw', activity: 'ACT_VM_DRAW', fps: 30, frames: 3, looping: false,
        animations: [0], blendParams: [0, -1], blendSize: [1, 1], events: [] }], animationCount: 1,
      animationPose: () => [{ position: [99, 0, 0], quat: [0, 0, 0, 1] }, { position: [3, 0, 0], quat: [0, 0, 0, 1] }],
    };
    const model = parseModel(main, null, null, [include]);
    expect(model.animationCount).toBe(2); expect(model.animationPose(1, 0)[0].position).toEqual([3, 0, 0]);
    expect(model.sequences[0].animations).toEqual([1]); expect(model.sequences[0].blendParams).toEqual([0, -1]);
    expect(model.poseParameters[0].name).toBe('aim');
  });
});

const sourceDir = process.env.HOODOO_SOURCE_DIR;
describe.skipIf(!sourceDir)('Player-owned Source models', () => {
  const files = new FolderFiles(sourceDir ?? '');
  const names = ['c_superphyscannon', 'c_toolgun', 'c_arms_hev'];
  for (const name of names) it(`loads and verifies ${name}`, async () => {
    const path = `models/weapons/${name}.mdl`;
    const model = await loadModel(files, path);
    const triangleCount = model.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
    expect(triangleCount).toBeGreaterThan(0);
    for (const mesh of model.meshes) expect(mesh.indices.every(index => index < mesh.positions.length / 3)).toBe(true);
    const textures = model.textures.map(slot => ({ name: slot.name, vmt: slot.candidates.find(candidate => files.has(candidate)) ?? null, candidates: slot.candidates }));
    console.info('MODEL', JSON.stringify({ name, bones: model.bones.length, meshes: model.meshes.length, triangles: triangleCount,
      attachments: model.attachments.map(attachment => attachment.name),
      sequences: model.sequences.map(sequence => ({ name: sequence.name, activity: sequence.activity,
        frames: sequence.frames, fps: sequence.fps, looping: sequence.looping, blendParams: sequence.blendParams, blendSize: sequence.blendSize })),
      poseParameters: model.poseParameters, textures, unsupported: unsupportedModelAnimations(model) }));
    expect(textures.filter(slot => slot.vmt === null), 'unresolved VMT slots').toEqual([]);
    if (name !== 'c_arms_hev') expect(model.attachments.some(attachment => attachment.name === 'muzzle')).toBe(true);
    if (name !== 'c_arms_hev') {
      expect(model.sequences.some(sequence => /idle/i.test(sequence.name))).toBe(true);
      expect(model.sequences.some(sequence => /draw/i.test(sequence.name))).toBe(true);
      expect(model.sequences.some(sequence => /fire/i.test(sequence.name))).toBe(true);
    }
    const rest = skinnedPositions(model), original = model.meshes.flatMap(mesh => Array.from(mesh.positions));
    let maximumError = 0;
    rest.forEach((value, index) => { maximumError = Math.max(maximumError, Math.abs(value - original[index])); });
    console.info('REST', name, maximumError);
    expect(maximumError).toBeLessThan(1e-3);
    if (name !== 'c_arms_hev') {
      const sequenceIndex = model.sequences.findIndex(sequence => /idle/i.test(sequence.name));
      const a = bounds(rest), b = bounds(skinnedPositions(model, sequencePose(model, sequenceIndex, 0)));
      const longest = Math.max(...[0, 1, 2].map(axis => a[axis + 3] - a[axis]));
      // Viewmodels reorient the bind frame to camera axes; compare box sizes.
      const sizes = (box: number[]) => [0, 1, 2].map(axis => box[axis + 3] - box[axis]).sort((a, b) => a - b);
      const restSizes = sizes(a), idleSizes = sizes(b);
      const change = Math.max(...restSizes.map((value, axis) => Math.abs(value - idleSizes[axis]))) / longest;
      console.info('IDLE bbox size change', name, change);
      expect(change).toBeLessThan(0.5);
      for (const cycle of [0, 0.25, 0.5, 0.75, 0.999]) {
        const poses = sequencePose(model, sequenceIndex, cycle);
        expect(poses.every(pose => [...pose.position, ...pose.quat].every(Number.isFinite))).toBe(true);
      }
      expect(findSequence(model, 'ACT_VM_DRAW')).toBeGreaterThanOrEqual(0);
    }
    for (const sequence of model.sequences) for (const animation of sequence.animations) {
      for (const frame of [0, 29.5, 30, sequence.frames - 1]) {
        expect(model.animationPose(animation, frame).every(pose => [...pose.position, ...pose.quat].every(Number.isFinite))).toBe(true);
      }
    }
    expect(parseMdl((await files.read(path))!).bones.length).toBe(model.bones.length);
  });
  it('finds shared ValveBiped names for arms merging', async () => {
    const [gun, arms] = await Promise.all(['c_superphyscannon', 'c_arms_hev'].map(name => loadModel(files, `models/weapons/${name}.mdl`)));
    const names = new Set(gun.bones.map(bone => bone.name));
    const shared = arms.bones.filter(bone => bone.name.startsWith('ValveBiped') && names.has(bone.name));
    console.info('SHARED ValveBiped', shared.length);
    expect(shared.length).toBeGreaterThan(0);
  });
});

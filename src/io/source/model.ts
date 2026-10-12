import { parseMdl } from './mdl';
import { decodeAnimation, unsupportedAnimations } from './mdl-animation';
import { parseVvd } from './vvd';
import { parseVtx } from './vtx';
import { sequenceBlends } from './mdl.types';
import type { BonePose, SourceFiles, SourceMesh, SourceModel } from './source.types';

const PATH = { mdl: '.mdl', vvd: '.vvd', vtx: ['.dx90.vtx', '.dx80.vtx', '.sw.vtx'], models: 'models/' } as const;
const diagnostics = new WeakMap<SourceModel, readonly string[]>();

type Studio = ReturnType<typeof parseMdl>;
type Vertices = ReturnType<typeof parseVvd>;

function readMeshes(studio: Studio, vertices: Vertices, topology: ReturnType<typeof parseVtx>): SourceMesh[] {
  if (studio.checksum !== vertices.checksum || studio.checksum !== topology.checksum) throw new Error('MDL/VVD/VTX checksum mismatch');
  if (studio.bodyParts.length !== topology.bodyParts.length) throw new Error('MDL/VTX body part count mismatch');
  const meshes: SourceMesh[] = [];
  studio.bodyParts.forEach((body, bodyPart) => {
    if (body.length !== topology.bodyParts[bodyPart].length) throw new Error('MDL/VTX model count mismatch');
    body.forEach((model, modelIndex) => {
      const vtxMeshes = topology.bodyParts[bodyPart][modelIndex];
      if (model.meshes.length !== vtxMeshes.length) throw new Error('MDL/VTX mesh count mismatch');
      model.meshes.forEach((mesh, i) => {
        const start = model.vertexOffset + mesh.vertexOffset, end = start + mesh.vertices;
        if (!Number.isInteger(start) || start < 0 || end * 3 > vertices.positions.length) throw new Error('MDL mesh outside VVD vertices');
        const indices = vtxMeshes[i];
        if (indices.some(index => index >= mesh.vertices)) throw new Error('VTX mesh vertex outside MDL mesh');
        const bones = vertices.bones.slice(start * 3, end * 3), weights = vertices.weights.slice(start * 3, end * 3);
        if (bones.some((bone, at) => weights[at] !== 0 && bone >= studio.bones.length)) throw new Error('VVD bone outside MDL skeleton');
        meshes.push({
          bodyPart, model: modelIndex, material: studio.skins[0]?.[mesh.material] ?? mesh.material,
          positions: vertices.positions.slice(start * 3, end * 3), normals: vertices.normals.slice(start * 3, end * 3),
          tangents: vertices.tangents.slice(start * 4, end * 4), uvs: vertices.uvs.slice(start * 2, end * 2),
          bones, weights, indices,
        });
      });
    });
  });
  return meshes;
}

function assemble(studio: Studio, meshes: readonly SourceMesh[], includes: readonly SourceModel[]): SourceModel {
  const sequences = [...studio.sequences], poseParameters = [...studio.poseParameters];
  const sample: ((frame: number) => BonePose[])[] = studio.animations.map(animation =>
    frame => decodeAnimation(studio.reader, studio.bones, animation, frame));
  const unsupported = unsupportedAnimations(studio.reader, studio.animations);
  for (const include of includes) {
    const offset = sample.length;
    const boneMap = studio.bones.map(bone => include.bones.findIndex(other => other.name.toLowerCase() === bone.name.toLowerCase()));
    for (let i = 0; i < include.animationCount; i++) {
      sample.push(frame => {
        const poses = include.animationPose(i, frame);
        return studio.bones.map((bone, index) => boneMap[index] < 0 ? { position: bone.position, quat: bone.quat } : poses[boneMap[index]]);
      });
    }
    const parameterMap = include.poseParameters.map(parameter => {
      let index = poseParameters.findIndex(other => other.name.toLowerCase() === parameter.name.toLowerCase());
      if (index < 0) { index = poseParameters.length; poseParameters.push(parameter); }
      return index;
    });
    for (const sequence of include.sequences) {
      const remapped = {
        ...sequence, animations: sequence.animations.map(index => index < 0 ? index : index + offset),
        blendParams: sequence.blendParams.map(index => index < 0 ? -1 : parameterMap[index]) as [number, number],
      };
      const bounds = sequenceBlends.get(sequence);
      if (bounds) sequenceBlends.set(remapped, bounds);
      sequences.push(remapped);
    }
    unsupported.push(...unsupportedModelAnimations(include).map(name => `${include.name}:${name}`));
  }
  const model: SourceModel = {
    name: studio.name, bones: studio.bones, attachments: studio.attachments,
    textures: studio.textures, skins: studio.skins, meshes, poseParameters, sequences,
    animationCount: sample.length,
    animationPose(animation, frame) {
      return sample[animation]?.(frame) ?? studio.bones.map(bone => ({ position: bone.position, quat: bone.quat }));
    },
  };
  diagnostics.set(model, unsupported);
  return model;
}

/** READ ME — the companions must belong to the same MDL; includes are already decoded. */
export function parseModel(mdl: Uint8Array, vvd: Uint8Array | null, vtx: Uint8Array | null, includes: readonly SourceModel[] = []): SourceModel {
  const studio = parseMdl(mdl);
  const drawable = studio.bodyParts.some(body => body.some(model => model.meshes.length > 0));
  if (drawable && (!vvd || !vtx)) throw new Error('Missing VVD/VTX for drawable MDL');
  return assemble(studio, vvd && vtx ? readMeshes(studio, parseVvd(vvd), parseVtx(vtx)) : [], includes);
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').toLowerCase().replace(/^\//, '');
  if (normalized.split('/').includes('..')) throw new Error('Source model path escapes game root');
  return normalized.startsWith(PATH.models) ? normalized : PATH.models + normalized;
}

async function readModel(files: SourceFiles, path: string, ancestors: ReadonlySet<string>): Promise<SourceModel> {
  if (ancestors.has(path)) throw new Error(`Cyclic MDL include: ${path}`);
  const mdl = await files.read(path);
  if (!mdl) throw new Error(`Missing Source model: ${path}`);
  const studio = parseMdl(mdl), next = new Set(ancestors).add(path);
  const includes = await Promise.all(studio.includes.map(include => readModel(files, normalizePath(include), next)));
  const stem = path.slice(0, -PATH.mdl.length);
  const vvd = await files.read(stem + PATH.vvd);
  let vtx: Uint8Array | null = null;
  for (const extension of PATH.vtx) {
    vtx = await files.read(stem + extension);
    if (vtx) break;
  }
  return parseModel(mdl, vvd, vtx, includes);
}

/** READ ME — read only the player's mounted files; animation-only includes need no geometry. */
export async function loadModel(files: SourceFiles, path: string): Promise<SourceModel> {
  const normalized = normalizePath(path);
  if (!normalized.endsWith(PATH.mdl)) throw new Error('Source model path must end in .mdl');
  return readModel(files, normalized, new Set());
}

/** External animation blocks and alternate frame encoding fall back to rest pose. */
export function unsupportedModelAnimations(model: SourceModel): readonly string[] {
  return diagnostics.get(model) ?? [];
}

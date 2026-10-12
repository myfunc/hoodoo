import { STUDIO, readVec3, relativeString, studioReader, table, requireRange } from './mdl-header';
import { readAnimations, readPoseParameters, readSequences } from './mdl-sequences';
import type { StudioBone, StudioBodyModel } from './mdl.types';

const BONE = { parent: 4, position: 32, quat: 44, rotation: 60, posScale: 72, rotScale: 84, inverse: 96, flags: 160 } as const;
const ATTACHMENT = { bone: 8, local: 12 } as const;
const BODY = { models: 4, modelIndex: 12 } as const;
const MODEL = { meshes: 72, vertices: 80, vertexOffset: 84, vertexSize: 48 } as const;
const MESH = { material: 0, vertices: 8, vertexOffset: 12 } as const;
const INCLUDE = { name: 4 } as const;

/** READ ME — MDL skeleton, materials and motion; geometry comes from VVD/VTX. */
export function parseMdl(bytes: Uint8Array) {
  const reader = studioReader(bytes);
  const bones: StudioBone[] = table(reader, STUDIO.bones, STUDIO.boneSize).map(at => {
    const quat = reader.floats(at + BONE.quat, 4);
    return {
      name: relativeString(reader, at), parent: reader.i32(at + BONE.parent),
      position: readVec3(reader, at + BONE.position), quat: [quat[0], quat[1], quat[2], quat[3]],
      rotation: readVec3(reader, at + BONE.rotation),
      positionScale: readVec3(reader, at + BONE.posScale), rotationScale: readVec3(reader, at + BONE.rotScale),
      poseToBone: new Float32Array(reader.floats(at + BONE.inverse, STUDIO.matrixSize)), flags: reader.i32(at + BONE.flags),
    };
  });
  for (const bone of bones) {
    if (bone.parent < -1 || bone.parent >= bones.length) throw new Error('Invalid MDL bone parent');
  }
  const directories = table(reader, STUDIO.directories, STUDIO.floatSize).map(at => {
    const offset = reader.i32(at);
    requireRange(reader, offset, 1);
    return reader.cstring(offset).replaceAll('\\', '/').toLowerCase().replace(/\/?$/, '/').replace(/^\//, '');
  });
  const textures = table(reader, STUDIO.textures, STUDIO.textureSize).map(at => {
    const name = relativeString(reader, at).replaceAll('\\', '/').toLowerCase();
    return { name, candidates: (directories.length ? directories : ['']).map(dir => `materials/${dir}${name}.vmt`) };
  });
  const skinRefs = reader.i32(STUDIO.skinRefs);
  const skinFamilies = reader.i32(STUDIO.skinFamilies);
  const skinIndex = reader.i32(STUDIO.skins);
  requireRange(reader, skinIndex, skinFamilies * skinRefs * STUDIO.shortSize);
  const skins = Array.from({ length: skinFamilies }, (_, family) =>
    Array.from({ length: skinRefs }, (_, slot) => reader.u16(skinIndex + (family * skinRefs + slot) * STUDIO.shortSize)));
  const bodyParts: StudioBodyModel[][] = table(reader, STUDIO.bodyParts, STUDIO.bodySize).map(body =>
    Array.from({ length: reader.i32(body + BODY.models) }, (_, index) => {
      const at = body + reader.i32(body + BODY.modelIndex) + index * STUDIO.modelSize;
      requireRange(reader, at, STUDIO.modelSize);
      return {
      vertexOffset: reader.i32(at + MODEL.vertexOffset) / MODEL.vertexSize,
      vertices: reader.i32(at + MODEL.vertices),
      meshes: table(reader, MODEL.meshes, STUDIO.meshSize, at).map(mesh => ({
        material: reader.i32(mesh + MESH.material), vertices: reader.i32(mesh + MESH.vertices),
        vertexOffset: reader.i32(mesh + MESH.vertexOffset),
      })),
    }; }));
  const attachments = table(reader, STUDIO.attachments, STUDIO.attachmentSize).map(at => ({
    name: relativeString(reader, at), bone: reader.i32(at + ATTACHMENT.bone),
    local: new Float32Array(reader.floats(at + ATTACHMENT.local, STUDIO.matrixSize)),
  }));
  const animations = readAnimations(reader);
  return {
    reader, name: reader.fixedString(STUDIO.name, STUDIO.nameSize), checksum: reader.i32(STUDIO.checksum), bones,
    attachments, textures, skins, bodyParts, animations,
    sequences: readSequences(reader, animations), poseParameters: readPoseParameters(reader),
    includes: table(reader, STUDIO.includes, STUDIO.includeSize).map(at => relativeString(reader, at, INCLUDE.name)),
  };
}

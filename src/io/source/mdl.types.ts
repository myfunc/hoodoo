import type { Vec3 } from '../../core/vec3';
import type { SourceBone, SourceSequence } from './source.types';

export interface StudioBone extends SourceBone {
  readonly rotation: Vec3;
  readonly positionScale: Vec3;
  readonly rotationScale: Vec3;
}

export interface StudioAnimation {
  readonly name: string;
  readonly offset: number;
  readonly fps: number;
  readonly flags: number;
  readonly frames: number;
  readonly block: number;
  readonly data: number;
  readonly sectionOffset: number;
  readonly sectionFrames: number;
}

export interface StudioMesh {
  readonly material: number;
  readonly vertices: number;
  readonly vertexOffset: number;
}

export interface StudioBodyModel {
  readonly vertexOffset: number;
  readonly vertices: number;
  readonly meshes: readonly StudioMesh[];
}

export interface SequenceBlend {
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
}

export const sequenceBlends = new WeakMap<SourceSequence, SequenceBlend>();

/**
 * Triangle meshes (ShapeKind.Mesh): models read from elsewhere (a game's props) that the ray
 * tracer draws as they are. A scene keeps only a mesh's key (SceneObject.mesh); the triangles
 * and pictures live in the mesh library (assets/mesh-library.ts) for as long as the page does.
 */

/** How a part reads its picture's alpha. */
export enum MeshAlpha {
  /** Alpha is ignored: the part is solid. */
  Opaque = 0,
  /** Where alpha is under one half there is nothing: leaves, fences, grilles. */
  Cutout = 1,
}

/** A picture: RGBA bytes, rows from the top. Any size; the renderer resamples it. */
export interface MeshImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

/** A run of triangles that share a picture. */
export interface MeshPart {
  /** First index of the run in `indices` (a multiple of three) and how many indices it has. */
  readonly start: number;
  readonly count: number;
  /** Which of `images` it wears; -1 for none (the material's colour alone). */
  readonly image: number;
  readonly alpha?: MeshAlpha;
}

/** A mesh in its own units, Y up, any size: the object's box stretches it to its size. */
export interface MeshData {
  /** x, y, z per vertex. */
  readonly positions: Float32Array;
  /** x, y, z per vertex; absent: each triangle is flat. */
  readonly normals?: Float32Array;
  /** u, v per vertex, (0, 0) at the picture's top-left; absent: no picture. */
  readonly uvs?: Float32Array;
  /** Three vertex indices per triangle. */
  readonly indices: Uint32Array;
  /** The triangles by picture; absent: all of them, without one. */
  readonly parts?: readonly MeshPart[];
  readonly images?: readonly MeshImage[];
}

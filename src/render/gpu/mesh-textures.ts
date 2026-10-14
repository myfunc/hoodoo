import { type MeshEntry, meshEntry } from '../../assets/mesh-library';
import { ShapeKind } from '../../model/scene.enums';
import type { Scene } from '../../model/scene.types';
import { type Uniforms, GlError, dataTexture, uploadFloatRows } from './gl';
import { MESH_IMAGE_SIZE, MESH_TEX_WIDTH, packMeshes } from './mesh-pack';

/**
 * An engine's mesh data on the GPU (37-mesh.glsl): the meshes a scene draws and their
 * pictures, uploaded again only when that set (or a mesh registered anew) changes.
 */
export class MeshTextures {
  private readonly data: WebGLTexture;
  private readonly images: WebGLTexture;
  private key = '';
  private slotsNow: ReadonlyMap<string, number> = new Map();

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.data = dataTexture(gl);
    uploadFloatRows(gl, this.data, MESH_TEX_WIDTH, 1, new Float32Array(MESH_TEX_WIDTH * 4));
    const images = gl.createTexture();
    if (!images) throw new GlError('Cannot allocate mesh pictures');
    this.images = images;
    this.uploadImages(new Uint8Array(4), 1, 1);
  }

  /** Brings the GPU copy up to `scene`'s meshes; returns their header texels by key (scene-packer.ts). */
  update(scene: Scene): ReadonlyMap<string, number> {
    const used = new Map<string, MeshEntry>();
    for (const o of scene.objects) {
      if (o.kind !== ShapeKind.Mesh || o.hidden || used.has(o.mesh ?? '')) continue;
      const e = meshEntry(o.mesh);
      if (e) used.set(e.key, e);
    }
    const meshes = [...used.values()];
    const key = meshes.map((m) => `${m.key}#${m.version}`).join('|');
    if (key === this.key) return this.slotsNow;
    const packed = packMeshes(meshes);
    uploadFloatRows(this.gl, this.data, MESH_TEX_WIDTH, packed.rows, packed.data);
    this.uploadImages(packed.images, packed.layers, MESH_IMAGE_SIZE);
    this.key = key;
    this.slotsNow = packed.slots;
    return this.slotsNow;
  }

  bind(u: Uniforms, dataUnit: number, imageUnit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + dataUnit);
    gl.bindTexture(gl.TEXTURE_2D, this.data);
    gl.activeTexture(gl.TEXTURE0 + imageUnit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.images);
    u.i('uMesh', dataUnit);
    u.i('uMeshImages', imageUnit);
  }

  private uploadImages(bytes: Uint8Array, layers: number, size: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.images);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }
}

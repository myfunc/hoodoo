import type { SourceModel, SourceTexture } from '../../../io/source/source.types';
import { GlError, Uniforms, dataTexture, linkProgram, uploadFloatRows } from '../../../render/gpu/gl';
import { MAX_LIGHTS, SKIN_FS, SKIN_VS, SPRITE_FS, SPRITE_VS } from './vm-shaders';

/**
 * The WebGL2 side of the gun in the hands: its own canvas over the picture,
 * skinned models with their bone texture, Source textures, and additive sprite
 * quads for glows and beams. It draws what it is told; Viewmodel decides what.
 */

/** Everything a skinned mesh needs from its material (vm-materials.ts fills it in). */
export interface VmMaterial {
  readonly base: WebGLTexture;
  readonly bump: WebGLTexture | null;
  readonly detail: WebGLTexture | null;
  readonly detailScale: number;
  readonly detailBlend: number;
  readonly color: readonly [number, number, number];
  readonly alpha: number;
  readonly translucent: boolean;
  readonly additive: boolean;
  readonly alphaTest: number;
  readonly noCull: boolean;
  /** UnlitGeneric: the texture as it is, no light. */
  readonly unlit: boolean;
  readonly selfIllum: boolean;
  /** Fixed tint, or null when the weapon colour drives it (PlayerWeaponColor). */
  readonly selfIllumTint: readonly [number, number, number] | null;
  readonly phong: boolean;
  readonly phongExponent: number;
  readonly phongBoost: number;
  readonly phongTint: readonly [number, number, number];
  readonly fresnel: readonly [number, number, number];
  readonly baseAlphaPhongMask: boolean;
  readonly rim: boolean;
  readonly rimExponent: number;
  readonly rimBoost: number;
  readonly halfLambert: boolean;
  /** Not drawn (tool textures, $no_draw). */
  readonly hidden: boolean;
}

/** The light around the hands: Source's ambient cube (+x −x +y −y +z −z, world axes) and directional lights. */
export interface VmLighting {
  readonly ambient: Float32Array;
  readonly lightDir: Float32Array;
  readonly lightColor: Float32Array;
  /** View space to world space (column-major 3×3). */
  readonly viewToWorld: Float32Array;
}

export interface GpuMesh {
  readonly vao: WebGLVertexArrayObject;
  readonly count: number;
  readonly slot: number;
  readonly hasTangents: boolean;
}

export interface GpuModel {
  readonly meshes: readonly GpuMesh[];
  readonly bones: WebGLTexture;
}

/** Floats per sprite vertex: position 3, uv 2, colour 4. */
export const SPRITE_STRIDE = 9;
const SPRITE_ATTRS = { pos: 3, uv: 2, color: 4 } as const;
const FLOAT = Float32Array.BYTES_PER_ELEMENT;
const RGBA = 4;
const TANGENT_SIZE = 4;
const WHITE_PIXEL = new Uint8Array([255, 255, 255, 255]);
const FLAT_NORMAL = new Uint8Array([128, 128, 255, 255]);
const SKIN_ATTRS = ['aPos', 'aNormal', 'aTangent', 'aUv', 'aBones', 'aWeights'] as const;
const SAMPLER = { base: 0, bump: 1, detail: 2, bones: 3, sprite: 0 } as const;
const ATTR_SIZES = { aPos: 3, aNormal: 3, aTangent: 4, aUv: 2, aBones: 3, aWeights: 3 } as const;
/** Textures with this VTF flag clamp instead of repeating. */
const VTF_CLAMP_S = 0x4;
const VTF_CLAMP_T = 0x8;

export class VmGpu {
  readonly gl: WebGL2RenderingContext;
  private readonly skin: WebGLProgram;
  private readonly skinU: Uniforms;
  private readonly sprite: WebGLProgram;
  private readonly spriteU: Uniforms;
  private readonly spriteVao: WebGLVertexArrayObject;
  private readonly spriteBuf: WebGLBuffer;
  readonly white: WebGLTexture;
  readonly flat: WebGLTexture;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) throw new GlError('WebGL2 unavailable for the hands');
    this.gl = gl;
    this.skin = linkProgram(gl, SKIN_VS, SKIN_FS);
    this.skinU = new Uniforms(gl, this.skin);
    this.sprite = linkProgram(gl, SPRITE_VS, SPRITE_FS);
    this.spriteU = new Uniforms(gl, this.sprite);
    this.white = this.pixel(WHITE_PIXEL);
    this.flat = this.pixel(FLAT_NORMAL);
    this.spriteVao = gl.createVertexArray() as WebGLVertexArrayObject;
    this.spriteBuf = gl.createBuffer() as WebGLBuffer;
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    let offset = 0;
    for (const [name, size] of [['aPos', SPRITE_ATTRS.pos], ['aUv', SPRITE_ATTRS.uv], ['aColor', SPRITE_ATTRS.color]] as const) {
      const loc = gl.getAttribLocation(this.sprite, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, SPRITE_STRIDE * FLOAT, offset * FLOAT);
      offset += size;
    }
    gl.bindVertexArray(null);
  }

  private pixel(rgba: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return tex;
  }

  /** A Source texture on the GPU, mipmapped; colour textures in sRGB so lighting happens in linear light. */
  texture(t: SourceTexture, srgb: boolean, frame = 0): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, t.width, t.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, t.rgba(frame, 0));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, t.flags & VTF_CLAMP_S ? gl.CLAMP_TO_EDGE : gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, t.flags & VTF_CLAMP_T ? gl.CLAMP_TO_EDGE : gl.REPEAT);
    return tex;
  }

  /** A texture a canvas draws (the Tool Gun's screen): clamped, without mipmaps; `updateCanvasTexture` loads it again. */
  canvasTexture(canvas: HTMLCanvasElement): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture() as WebGLTexture;
    this.updateCanvasTexture(tex, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  updateCanvasTexture(tex: WebGLTexture, canvas: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  /** A model's meshes on the GPU (positions in the model's own Source space). */
  upload(model: SourceModel): GpuModel {
    const gl = this.gl;
    const meshes = model.meshes.map((m) => {
      const vao = gl.createVertexArray() as WebGLVertexArrayObject;
      gl.bindVertexArray(vao);
      const count = m.positions.length / ATTR_SIZES.aPos;
      const tangents = m.tangents.length ? m.tangents : new Float32Array(count * TANGENT_SIZE);
      const data: Record<(typeof SKIN_ATTRS)[number], Float32Array> = {
        aPos: m.positions, aNormal: m.normals, aTangent: tangents, aUv: m.uvs, aBones: Float32Array.from(m.bones), aWeights: m.weights,
      };
      for (const name of SKIN_ATTRS) {
        const loc = gl.getAttribLocation(this.skin, name);
        if (loc < 0) continue;
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data[name], gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, ATTR_SIZES[name], gl.FLOAT, false, 0, 0);
      }
      const ibuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, count: m.indices.length, slot: m.material, hasTangents: m.tangents.length > 0 };
    });
    return { meshes, bones: dataTexture(this.gl) };
  }

  /** Skinning matrices, 3×4 per bone (rows), into the model's bone texture. */
  setBones(model: GpuModel, skin: Float32Array): void {
    uploadFloatRows(this.gl, model.bones, skin.length / RGBA, 1, skin);
  }

  /** Sizes the canvas to its box and clears it. */
  begin(): void {
    const { gl, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = [Math.round(canvas.clientWidth * dpr), Math.round(canvas.clientHeight * dpr)];
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  clearDepth(): void {
    const gl = this.gl;
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  /** Draws a skinned model: opaque meshes first, then translucent and additive ones without writing depth. */
  drawModel(model: GpuModel, slots: readonly (VmMaterial | null)[], modelView: Float32Array, proj: Float32Array, light: VmLighting, weaponColor: readonly [number, number, number]): void {
    const { gl, skinU: u } = this;
    gl.useProgram(this.skin);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.skin, 'uModelView'), false, modelView);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.skin, 'uProj'), false, proj);
    gl.uniformMatrix3fv(gl.getUniformLocation(this.skin, 'uViewToWorld'), false, light.viewToWorld);
    gl.uniform3fv(gl.getUniformLocation(this.skin, 'uAmbient'), light.ambient);
    gl.uniform3fv(gl.getUniformLocation(this.skin, 'uLightDir'), light.lightDir.subarray(0, MAX_LIGHTS * 3));
    gl.uniform3fv(gl.getUniformLocation(this.skin, 'uLightColor'), light.lightColor.subarray(0, MAX_LIGHTS * 3));
    gl.activeTexture(gl.TEXTURE0 + SAMPLER.bones);
    gl.bindTexture(gl.TEXTURE_2D, model.bones);
    u.i('uBones', SAMPLER.bones);
    u.i('uBase', SAMPLER.base);
    u.i('uBump', SAMPLER.bump);
    u.i('uDetail', SAMPLER.detail);
    const passes: ((m: VmMaterial) => boolean)[] = [(m) => !m.translucent && !m.additive, (m) => m.translucent || m.additive];
    passes.forEach((inPass, pass) => {
      for (const mesh of model.meshes) {
        const m = slots[mesh.slot];
        if (!m || m.hidden || !inPass(m)) continue;
        this.material(m, mesh, weaponColor);
        gl.depthMask(pass === 0);
        if (m.additive) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
        } else if (m.translucent) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        } else gl.disable(gl.BLEND);
        if (m.noCull) gl.disable(gl.CULL_FACE);
        else {
          gl.enable(gl.CULL_FACE);
          gl.cullFace(gl.BACK);
          gl.frontFace(gl.CW);
        }
        gl.bindVertexArray(mesh.vao);
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
      }
    });
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
  }

  private material(m: VmMaterial, mesh: GpuMesh, weaponColor: readonly [number, number, number]): void {
    const { gl, skinU: u } = this;
    const bind = (unit: number, tex: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    };
    bind(SAMPLER.base, m.base);
    bind(SAMPLER.bump, m.bump ?? this.flat);
    bind(SAMPLER.detail, m.detail ?? this.white);
    u.i('uHasBump', m.bump ? 1 : 0);
    u.i('uHasTangents', mesh.hasTangents ? 1 : 0);
    u.i('uHasDetail', m.detail ? 1 : 0);
    u.f('uDetailScale', m.detailScale);
    u.f('uDetailBlend', m.detailBlend);
    u.f('uColor', ...m.color);
    u.f('uAlpha', m.alpha);
    u.i('uTranslucent', m.translucent ? 1 : 0);
    u.f('uAlphaTest', m.alphaTest);
    u.i('uUnlit', m.unlit ? 1 : 0);
    u.i('uSelfIllum', m.selfIllum ? 1 : 0);
    u.f('uSelfIllumTint', ...(m.selfIllumTint ?? weaponColor));
    u.i('uPhong', m.phong ? 1 : 0);
    u.f('uPhongExponent', m.phongExponent);
    u.f('uPhongBoost', m.phongBoost);
    u.f('uPhongTint', ...m.phongTint);
    u.f('uFresnel', ...m.fresnel);
    u.i('uBaseAlphaPhongMask', m.baseAlphaPhongMask ? 1 : 0);
    u.i('uRim', m.rim ? 1 : 0);
    u.f('uRimExponent', m.rimExponent);
    u.f('uRimBoost', m.rimBoost);
    u.i('uHalfLambert', m.halfLambert ? 1 : 0);
  }

  /** Additive quads (SPRITE_STRIDE floats per vertex, triangles), in view space through `proj`. */
  drawSprites(vertices: Float32Array, texture: WebGLTexture, proj: Float32Array, depthTest: boolean): void {
    if (!vertices.length) return;
    const gl = this.gl;
    gl.useProgram(this.sprite);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.sprite, 'uProj'), false, proj);
    gl.activeTexture(gl.TEXTURE0 + SAMPLER.sprite);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    this.spriteU.i('uTex', SAMPLER.sprite);
    if (depthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / SPRITE_STRIDE);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}

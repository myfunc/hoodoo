import { Logger } from '../../core/log';
import type { Scene } from '../../model/scene.types';
import type { ViewBasis } from '../../world/camera-math';
import { EngineStage } from './engine.enums';
import { type Target, GlError, Uniforms, createTarget, dataTexture, deleteTarget, linkProgram, linkProgramAsync, uploadFloatRows } from './gl';
import { GpuFence } from './gpu-fence';
import header from './glsl/00-header.glsl?raw';
import noise from './glsl/10-noise.glsl?raw';
import textures from './glsl/20-textures.glsl?raw';
import shapes from './glsl/30-shapes.glsl?raw';
import terrain from './glsl/35-terrain.glsl?raw';
import sceneGlsl from './glsl/40-scene.glsl?raw';
import sky from './glsl/50-sky.glsl?raw';
import shade from './glsl/60-shade.glsl?raw';
import main from './glsl/90-main.glsl?raw';
import blitFrag from './glsl/blit.glsl?raw';
import fullscreen from './glsl/fullscreen.vert.glsl?raw';
import { MAT_TEXELS, OBJ_TEXELS } from './render.constants';
import { NOISE_SIZE, bakeNoise } from './noise-texture';
import { type PackedScene, packScene, skyUniforms } from './scene-packer';

const TRACE_SOURCE = [header, noise, textures, shapes, terrain, sceneGlsl, sky, shade, main].join('\n');
const COLD_FLAG = 'cold';
const HEADER_END = 'out vec4 fragColor;';

/**
 * Profiling aid: `?cold` makes the source unique so the driver cannot reuse a build
 * from an earlier visit (tools/perf.mjs). One nonce per page: engines share the build.
 */
const COLD_NONCE = new URLSearchParams(location.search).has(COLD_FLAG) ? `\nconst float COLD_NONCE = ${Math.random()};\n` : '';
const FINAL_SOURCE = TRACE_SOURCE.replace(HEADER_END, HEADER_END + COLD_NONCE);

const UNIT_OBJECTS = 0;
const UNIT_MATERIALS = 1;
const UNIT_TERRAINS = 2;
const UNIT_NOISE = 3;
const UNIT_TERRAIN_MAX = 4;
const UNIT_CUR = 0;
const UNIT_PREV = 1;

/** One trace call: which pixels of which image, at what block size and sample. */
export interface TraceRequest {
  readonly target: Target;
  /** Full image size in pixels. */
  readonly width: number;
  readonly height: number;
  /** Image-space pixel offset of the target's origin (tiles). */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly block: number;
  /** Target rows [rowStart, rowEnd) to write, counted from the target's bottom. */
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly jitterX: number;
  readonly jitterY: number;
  readonly sample: number;
  readonly bounces: number;
  readonly transparentBg: boolean;
  /** Weight of this sample in a running average; 1 replaces. */
  readonly blend: number;
}

export interface BlitRequest {
  readonly cur: Target;
  readonly curScale: readonly [number, number];
  readonly prev: Target | null;
  readonly prevScale: readonly [number, number];
  readonly split: number;
  readonly checker: boolean;
  readonly into: Target | null;
  readonly width: number;
  readonly height: number;
}

/**
 * READ ME — the GPU ray tracer. Owns one WebGL2 context, the trace program and
 * the scene data textures. It reflects a Scene snapshot; it never changes one.
 */
export class RayEngine {
  readonly gl: WebGL2RenderingContext;
  readonly floatInternal: number;
  private readonly logger = Logger.create('RayEngine');
  private trace: WebGLProgram | null = null;
  private readonly blit: WebGLProgram;
  private tu: Uniforms | null = null;
  private readonly bu: Uniforms;
  /** Resolves when the trace program is compiled and has drawn once (seconds on Windows). */
  readonly ready: Promise<void>;
  private stageNow = EngineStage.Queued;
  private stageSince = performance.now();
  private failure = '';
  private compileTime = 0;
  private sceneState: { scene: Scene; dirty: boolean } | null = null;
  private viewState: { basis: ViewBasis; dirty: boolean } | null = null;
  private readonly objectsTex: WebGLTexture;
  private readonly materialsTex: WebGLTexture;
  private readonly terrainTex: WebGLTexture;
  private readonly noiseTex: WebGLTexture;
  private readonly terrainMaxTex: WebGLTexture;
  private readonly vao: WebGLVertexArrayObject;
  private terrainKey = '';
  private packed: PackedScene | null = null;

  /** `after`: start compiling once that settles, so a second engine reuses the browser's compiled copy. */
  constructor(readonly canvas: HTMLCanvasElement, preserve: boolean, after: Promise<unknown> = Promise.resolve()) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: preserve });
    if (!gl) throw new GlError('WebGL2 is not available');
    this.gl = gl;
    const floatOk = !!gl.getExtension('EXT_color_buffer_float');
    const blend32 = floatOk && !!gl.getExtension('EXT_float_blend');
    this.floatInternal = blend32 ? gl.RGBA32F : floatOk ? gl.RGBA16F : gl.RGBA8;
    this.blit = linkProgram(gl, fullscreen, blitFrag);
    this.bu = new Uniforms(gl, this.blit);
    this.ready = this.prepare(after);
    this.ready.catch((error: unknown) => this.logger.error('trace program unavailable', { stage: this.stageNow }, error));
    this.objectsTex = dataTexture(gl);
    this.materialsTex = dataTexture(gl);
    const terrainTex = gl.createTexture();
    const vao = gl.createVertexArray();
    if (!terrainTex || !vao) throw new GlError('Cannot allocate engine resources');
    this.terrainTex = terrainTex;
    this.vao = vao;
    this.noiseTex = this.createNoise();
    const maxTex = gl.createTexture();
    if (!maxTex) throw new GlError('Cannot allocate terrain grid');
    this.terrainMaxTex = maxTex;
    this.logger.info('engine created', { float: this.floatInternal === gl.RGBA32F ? '32F' : '16F' });
  }

  get isReady(): boolean {
    return this.trace !== null;
  }

  get stage(): EngineStage {
    return this.stageNow;
  }

  /** Milliseconds spent in the current stage. */
  get stageMs(): number {
    return performance.now() - this.stageSince;
  }

  get error(): string {
    return this.failure;
  }

  /** How long compiling and warming up took (0 until ready). */
  get compileMs(): number {
    return this.compileTime;
  }

  private setStage(stage: EngineStage): void {
    this.stageNow = stage;
    this.stageSince = performance.now();
  }

  private async prepare(after: Promise<unknown>): Promise<void> {
    await after.catch(() => undefined);
    const gl = this.gl;
    const started = performance.now();
    this.setStage(EngineStage.Compiling);
    try {
      const program = await linkProgramAsync(gl, fullscreen, FINAL_SOURCE);
      this.logger.info('trace program linked', { ms: Math.round(performance.now() - started) });
      this.setStage(EngineStage.WarmingUp);
      const uniforms = new Uniforms(gl, program);
      await this.warmUp(program, uniforms);
      this.trace = program;
      this.tu = uniforms;
      this.compileTime = performance.now() - started;
      this.setStage(EngineStage.Ready);
      this.logger.info('trace program compiled', { ms: Math.round(this.compileTime) });
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error);
      this.setStage(EngineStage.Failed);
      throw error;
    }
  }

  /**
   * One 1×1 draw, awaited through a fence: drivers build the GPU code on the first
   * draw, and doing it here keeps that wait off the page (a blocking call such as a
   * canvas copy would otherwise freeze it for seconds on Windows).
   */
  private async warmUp(program: WebGLProgram, u: Uniforms): Promise<void> {
    const gl = this.gl;
    const target = this.createTarget(1, 1);
    gl.useProgram(program);
    this.bindData(u);
    u.f('uResolution', 1, 1);
    u.f('uBlock', 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, 1, 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const fence = new GpuFence(gl);
    fence.mark();
    while (fence.busy) {
      if (gl.isContextLost()) throw new GlError('The graphics context was lost while preparing the ray tracer');
      await new Promise((r) => requestAnimationFrame(r));
    }
    deleteTarget(gl, target);
  }

  get droppedObjects(): number {
    return this.packed?.dropped ?? 0;
  }

  createTarget(width: number, height: number, linear = false): Target {
    const gl = this.gl;
    return createTarget(gl, width, height, this.floatInternal, linear ? gl.LINEAR : gl.NEAREST);
  }

  /** Uploads the scene data; uniforms are applied at the next trace (the program may still be compiling). */
  setScene(scene: Scene): void {
    const gl = this.gl;
    const p = packScene(scene);
    this.packed = p;
    uploadFloatRows(gl, this.objectsTex, OBJ_TEXELS, p.count, p.objects);
    uploadFloatRows(gl, this.materialsTex, MAT_TEXELS, p.count, p.materials);
    if (p.terrains.key !== this.terrainKey) this.uploadTerrains(p);
    this.sceneState = { scene, dirty: true };
  }

  setView(b: ViewBasis): void {
    this.viewState = { basis: b, dirty: true };
  }

  private applyUniforms(u: Uniforms): void {
    const p = this.packed;
    if (this.sceneState?.dirty && p) {
      u.i('uObjectCount', p.count);
      u.i('uLoopGuard', 0);
      u.i('uLightCount', p.lightCount);
      u.v4array('uLightPos', p.lightPos);
      u.v4array('uLightColor', p.lightColor);
      u.v4array('uLightDir', p.lightDir);
      const s = this.sceneState.scene.sky;
      const k = skyUniforms(s);
      u.f('uSunDir', ...k.sunDir);
      u.f('uSunColor', ...s.sunColor);
      u.f('uSkyColor', ...s.skyColor);
      u.f('uHorizonColor', ...s.horizonColor);
      u.f('uAmbientColor', ...s.ambientColor);
      u.f('uFogColor', ...s.fogColor);
      u.f('uHazeColor', ...s.hazeColor);
      u.f('uCloudColor', ...s.clouds.color);
      u.f('uSkyParams', ...k.skyParams);
      u.f('uFogParams', ...k.fogParams);
      u.f('uCloudParams', ...k.cloudParams);
      u.f('uCloudKinds', ...k.cloudKinds);
      this.sceneState.dirty = false;
    }
    if (this.viewState?.dirty) {
      const b = this.viewState.basis;
      u.f('uCamPos', ...b.origin);
      u.f('uCamFwd', ...b.forward);
      u.f('uCamRight', ...b.right);
      u.f('uCamUp', ...b.up);
      u.f('uHalfH', b.halfHeight);
      u.f('uAspect', b.aspect);
      u.i('uOrtho', b.ortho ? 1 : 0);
      u.f('uLens', ...b.lens);
      this.viewState.dirty = false;
    }
  }

  /** Traces the requested rows; a no-op until the program is compiled. */
  traceRows(r: TraceRequest): void {
    const gl = this.gl;
    if (!this.trace || !this.tu) return;
    gl.useProgram(this.trace);
    this.applyUniforms(this.tu);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.target.fbo);
    const tw = Math.ceil(r.width / r.block);
    const th = Math.ceil(r.height / r.block);
    gl.viewport(0, 0, Math.min(tw, r.target.width), Math.min(th, r.target.height));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, r.rowStart, r.target.width, r.rowEnd - r.rowStart);
    if (r.blend < 1) {
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, r.blend);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    } else gl.disable(gl.BLEND);
    const u = this.tu;
    u.f('uResolution', r.width, r.height);
    u.f('uOffset', r.offsetX, r.offsetY);
    u.f('uBlock', r.block);
    u.f('uJitter', r.jitterX, r.jitterY);
    u.i('uSample', r.sample);
    u.i('uMaxBounces', r.bounces);
    u.i('uTransparentBg', r.transparentBg ? 1 : 0);
    this.bindData(u);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
  }

  present(b: BlitRequest): void {
    const gl = this.gl;
    gl.useProgram(this.blit);
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.into ? b.into.fbo : null);
    gl.viewport(0, 0, b.width, b.height);
    gl.activeTexture(gl.TEXTURE0 + UNIT_CUR);
    gl.bindTexture(gl.TEXTURE_2D, b.cur.tex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_PREV);
    gl.bindTexture(gl.TEXTURE_2D, (b.prev ?? b.cur).tex);
    const u = this.bu;
    u.i('uCur', UNIT_CUR);
    u.i('uPrev', UNIT_PREV);
    u.f('uCurScale', ...b.curScale);
    u.f('uPrevScale', ...b.prevScale);
    u.f('uSplit', b.split);
    u.i('uHasPrev', b.prev ? 1 : 0);
    u.i('uChecker', b.checker ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Waits for queued GPU work; used by tiled export between tiles. */
  finish(): void {
    this.gl.finish();
  }

  private createNoise(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new GlError('Cannot allocate noise texture');
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE, 0, gl.RED, gl.FLOAT, bakeNoise());
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);
    return tex;
  }

  private bindData(u: Uniforms): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + UNIT_OBJECTS);
    gl.bindTexture(gl.TEXTURE_2D, this.objectsTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_MATERIALS);
    gl.bindTexture(gl.TEXTURE_2D, this.materialsTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_TERRAINS);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.terrainTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_NOISE);
    gl.bindTexture(gl.TEXTURE_3D, this.noiseTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_TERRAIN_MAX);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.terrainMaxTex);
    u.i('uNoise', UNIT_NOISE);
    u.i('uTerrainMax', UNIT_TERRAIN_MAX);
    u.i('uObjects', UNIT_OBJECTS);
    u.i('uMaterials', UNIT_MATERIALS);
    u.i('uTerrains', UNIT_TERRAINS);
  }

  private uploadTerrains(p: PackedScene): void {
    const gl = this.gl;
    const { res, layers } = p.terrains;
    const count = Math.max(layers.length, 1);
    const data = new Float32Array(res * res * count);
    layers.forEach((l, i) => data.set(l, i * res * res));
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.terrainTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R16F, res, res, count, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const cells = p.terrains.cells;
    const grid = new Float32Array(cells * cells * count);
    p.terrains.maxLayers.forEach((l, i) => grid.set(l, i * cells * cells));
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.terrainMaxTex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R16F, cells, cells, count, 0, gl.RED, gl.FLOAT, grid);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.terrainKey = p.terrains.key;
  }
}

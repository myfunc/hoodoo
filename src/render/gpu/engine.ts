import { Logger } from '../../core/log';
import { type RenderStyle, renderStyle } from './render-style';
import type { Scene } from '../../model/scene.types';
import type { ViewBasis } from '../../world/camera-math';
import { EngineStage } from './engine.enums';
import { type Target, GlError, Uniforms, createTarget, dataTexture, deleteTarget, linkProgram, linkProgramAsync, uploadFloatRows } from './gl';
import { GpuFence } from './gpu-fence';
import { gpuName } from './gpu-name';
import blitFrag from './glsl/blit.glsl?raw';
import temporalFrag from './glsl/temporal.glsl?raw';
import fullscreen from './glsl/fullscreen.vert.glsl?raw';
import { MAT_TEXELS, MAX_OBJECTS, OBJ_TEXELS, TEXEL_FLOATS } from './render.constants';
import { NOISE_SIZE, bakeNoise } from './noise-texture';
import { type PackedScene, packScene, scanRows, skyUniforms } from './scene-packer';
import { packLathe } from './lathe-pack';
import { MeshTextures } from './mesh-textures';
import { meshLibraryVersion } from '../../assets/mesh-library';
import { FAST_DEFINE, GAME_DEFINE, TRACE_SOURCE, withDefines } from './trace-source';

const COLD_FLAG = 'cold';

/**
 * Profiling aid: `?cold` makes the source unique so the driver cannot reuse a build
 * from an earlier visit (tools/perf.mjs). One nonce per page: engines share the build.
 * The nonce is used (90-main.glsl), or the translator would drop it and macOS would
 * serve the Metal build it keeps for every program it has seen.
 */
const COLD_NONCE = new URLSearchParams(location.search).has(COLD_FLAG) ? `#define COLD_NONCE ${Math.random()}` : '';
const FINAL_SOURCE = withDefines(TRACE_SOURCE, COLD_NONCE);
/** The interaction preview: the same tracer without its second trace (90-main.glsl). */
const FAST_SOURCE = withDefines(FINAL_SOURCE, FAST_DEFINE);
/** The game renderer's tracer: noiseless, deep, HDR, and the first hit in a second target (90-main.glsl). */
const GAME_SOURCE = withDefines(FINAL_SOURCE, GAME_DEFINE);

const UNIT_OBJECTS = 0;
const UNIT_MATERIALS = 1;
const UNIT_TERRAINS = 2;
const UNIT_NOISE = 3;
const UNIT_TERRAIN_MAX = 4;
const UNIT_LATHE = 5;
const UNIT_MESH = 6;
const UNIT_MESH_IMAGES = 7;
const UNIT_CUR = 0;
const UNIT_PREV = 1;
/** Uniform buffer binding of the game variant's object scan (GameScan in 00-header.glsl). */
const SCAN_BINDING = 0;
const SCAN_BLOCK = 'GameScan';
const SCAN_BYTES = MAX_OBJECTS * 2 * TEXEL_FLOATS * Float32Array.BYTES_PER_ELEMENT;
/** Any blend weight: a warm-up draw with blending on only has to blend. */
const WARM_BLEND = 0.5;

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
  /** Draw with the interaction preview once it is compiled (`prepareFast`). */
  readonly fast?: boolean;
  /**
   * Shadow rays per light and ray when shadows are soft (Render View's Soft shadows): 1 by
   * default, as Render traces; more smooth the penumbra sooner; 0 draws soft shadows hard.
   */
  readonly shadowRays?: number;
  /**
   * Draw with the game renderer's variant (`prepareGame`) into a target with two colour
   * attachments (`createGameTarget`). Until it is compiled the preview program draws, into the first only.
   */
  readonly game?: GameTrace;
}

/** What the game variant of the tracer needs besides a trace request (game-renderer.ts). */
export interface GameTrace {
  /** World size of one traced pixel at a distance of 1: finer texture and terrain detail fades. */
  readonly pixelAngle: number;
  /** Diffuse light in this many bands (the toon look); 0 keeps it smooth. */
  readonly toonBands: number;
}

/** The game renderer's trace target: colour (HDR) and the first hit (distance, object, normal). */
export interface GameTarget extends Target {
  readonly aux: WebGLTexture;
}

export interface BlitRequest {
  readonly cur: Target;
  readonly curScale: readonly [number, number];
  readonly prev: Target | null;
  readonly prevScale: readonly [number, number];
  readonly split: number;
  readonly checker: boolean;
  readonly into: Target | null;
  /** Viewport origin inside `into` (pixels, rows from the bottom); 0 when omitted. */
  readonly left?: number;
  readonly bottom?: number;
  readonly width: number;
  readonly height: number;
  /** Weight of `cur` over the whole of `prev` (split must be 1); 1 shows `cur` alone. */
  readonly fade?: number;
}

/** A new moving frame over the last one (temporal.glsl): both in the bottom-left `width`×`height` of their targets. */
export interface HistoryRequest {
  readonly fresh: Target;
  readonly history: Target;
  readonly into: Target;
  readonly width: number;
  readonly height: number;
  /** Share of the (clamped) last frame the result keeps. */
  readonly keep: number;
}

/** Which program a warm-up prepares (engine.ts warmUp). */
enum Variant {
  Final,
  Fast,
  Game,
}

/** A compiled trace program and the scene and view versions its uniforms hold. */
interface TraceProgram {
  readonly program: WebGLProgram;
  readonly u: Uniforms;
  sceneVersion: number;
  viewVersion: number;
}

/**
 * READ ME — the GPU ray tracer. Owns one WebGL2 context, the trace program and
 * the scene data textures. It reflects a Scene snapshot; it never changes one.
 */
export class RayEngine {
  readonly gl: WebGL2RenderingContext;
  readonly floatInternal: number;
  /** The live view's moving frames and the game's colour: half float (they average a few rays), 8-bit without float targets. */
  readonly halfInternal: number;
  /** The GPU this context draws with, short (gpu-name.ts); '' when the browser does not tell. */
  readonly gpu: string;
  private readonly logger = Logger.create('RayEngine');
  private trace: TraceProgram | null = null;
  private fast: TraceProgram | null = null;
  private fastStarted = false;
  private game: TraceProgram | null = null;
  private gameStarted = false;
  /** The game variant's object scan (a uniform buffer at SCAN_BINDING), uploaded with each scene. */
  private readonly scanBuffer: WebGLBuffer;
  private readonly blit: WebGLProgram;
  private readonly bu: Uniforms;
  private readonly temporal: WebGLProgram;
  private readonly tu: Uniforms;
  /** Resolves when the trace program is compiled and has drawn once (seconds on Windows). */
  readonly ready: Promise<void>;
  private stageNow = EngineStage.Queued;
  private stageSince = performance.now();
  private failure = '';
  private compileTime = 0;
  private scene: Scene | null = null;
  private sceneVersion = 0;
  private view: ViewBasis | null = null;
  private viewVersion = 0;
  private readonly objectsTex: WebGLTexture;
  private readonly materialsTex: WebGLTexture;
  private readonly terrainTex: WebGLTexture;
  private readonly noiseTex: WebGLTexture;
  private readonly terrainMaxTex: WebGLTexture;
  private readonly latheTex: WebGLTexture;
  private readonly meshes: MeshTextures;
  private meshVersion = -1;
  private readonly vao: WebGLVertexArrayObject;
  private terrainKey = '';
  private packed: PackedScene | null = null;
  /** The scene's soft-shadow style (render-style.ts), applied per draw: Render View may draw it hard. */
  private style: RenderStyle = [0, 0, 0, 0];

  /** `after`: start compiling once that settles, so a second engine reuses the browser's compiled copy. */
  constructor(readonly canvas: HTMLCanvasElement, preserve: boolean, after: Promise<unknown> = Promise.resolve()) {
    // A ray tracer wants the faster of two GPUs (laptops; browsers that let a page choose).
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: preserve, powerPreference: 'high-performance' });
    if (!gl) throw new GlError('WebGL2 is not available');
    this.gl = gl;
    const floatOk = !!gl.getExtension('EXT_color_buffer_float');
    const blend32 = floatOk && !!gl.getExtension('EXT_float_blend');
    this.floatInternal = blend32 ? gl.RGBA32F : floatOk ? gl.RGBA16F : gl.RGBA8;
    this.halfInternal = this.floatInternal === gl.RGBA8 ? gl.RGBA8 : gl.RGBA16F;
    this.blit = linkProgram(gl, fullscreen, blitFrag);
    this.bu = new Uniforms(gl, this.blit);
    this.temporal = linkProgram(gl, fullscreen, temporalFrag);
    this.tu = new Uniforms(gl, this.temporal);
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
    this.latheTex = dataTexture(gl);
    const lathe = packLathe();
    uploadFloatRows(gl, this.latheTex, lathe.width, lathe.rows, lathe.data);
    this.meshes = new MeshTextures(gl);
    const scan = gl.createBuffer();
    if (!scan) throw new GlError('Cannot allocate the object scan');
    this.scanBuffer = scan;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, SCAN_BINDING, scan);
    gl.bufferData(gl.UNIFORM_BUFFER, SCAN_BYTES, gl.DYNAMIC_DRAW);
    this.gpu = gpuName(gl);
    this.logger.info('engine created', { float: this.floatInternal === gl.RGBA32F ? '32F' : '16F', gpu: this.gpu });
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
      await this.warmUp(program, uniforms, Variant.Final);
      this.trace = { program, u: uniforms, sceneVersion: -1, viewVersion: -1 };
      this.compileTime = performance.now() - started;
      this.setStage(EngineStage.Ready);
      this.logger.info('trace program compiled', { ms: Math.round(this.compileTime) });
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error);
      this.setStage(EngineStage.Failed);
      throw error;
    }
  }

  /** True once the interaction preview can draw. */
  get fastReady(): boolean {
    return this.fast !== null;
  }

  /**
   * Compiles the interaction preview after the main program, in the background.
   * Until it is ready (or if it fails) `fast` requests draw with the main program.
   */
  prepareFast(): void {
    if (this.fastStarted) return;
    this.fastStarted = true;
    this.compileVariant(FAST_SOURCE, Variant.Fast, 'preview', (p) => { this.fast = p; })
      .catch((error: unknown) => this.logger.warn('preview program unavailable, moving frames use the full tracer', {}, error));
  }

  /** True once the game renderer's tracer can draw. */
  get gameReady(): boolean {
    return this.game !== null;
  }

  /**
   * Compiles the game renderer's tracer in the background, on first use only (the editor
   * never needs it). Until it is ready `game` requests draw with the preview program.
   */
  prepareGame(): void {
    if (this.gameStarted) return;
    this.gameStarted = true;
    this.prepareFast();
    const bindScan = (program: WebGLProgram) => this.gl.uniformBlockBinding(program, this.gl.getUniformBlockIndex(program, SCAN_BLOCK), SCAN_BINDING);
    this.compileVariant(GAME_SOURCE, Variant.Game, 'game', (p) => { this.game = p; }, bindScan)
      .catch((error: unknown) => this.logger.warn('game program unavailable, Play draws with the preview program', {}, error));
  }

  /** Compiles a variant of the tracer once the main program is ready, sets it up, warms it up and hands it over. */
  private async compileVariant(source: string, variant: Variant, name: string, done: (p: TraceProgram) => void, setup?: (p: WebGLProgram) => void): Promise<void> {
    await this.ready;
    const started = performance.now();
    const program = await linkProgramAsync(this.gl, fullscreen, source);
    setup?.(program);
    const uniforms = new Uniforms(this.gl, program);
    await this.warmUp(program, uniforms, variant);
    done({ program, u: uniforms, sceneVersion: -1, viewVersion: -1 });
    this.logger.info(`${name} program compiled`, { ms: Math.round(performance.now() - started) });
  }

  /**
   * 1×1 draws into every kind of target the program will draw into, awaited through a fence:
   * drivers build the GPU code on the first draw of each, and doing it here keeps that wait off
   * the page and out of the user's first drag (a blocking call such as a canvas copy would
   * otherwise freeze it for seconds on Windows). Each kind matters: ANGLE on Metal builds the
   * code again for every target format with blending on or off (about 0.4 s each on an M4 for
   * this shader, the whole browser waiting), and on Direct3D for every set of outputs, so the
   * game variant, with two outputs, is warmed up on a two-output target: warmed on one it would
   * be compiled twice, the second time in the middle of the first frame of Play.
   */
  private async warmUp(program: WebGLProgram, u: Uniforms, variant: Variant): Promise<void> {
    const gl = this.gl;
    // The targets first: making one binds its texture, which must not stay bound to a sampler the draw reads.
    const targets: { target: Target; blends: readonly boolean[] }[] = variant === Variant.Game
      ? [{ target: this.createGameTarget(1, 1), blends: [false] }]
      : variant === Variant.Fast
        ? [{ target: createTarget(gl, 1, 1, this.halfInternal, gl.LINEAR), blends: [false] }]
        : [
          { target: this.createTarget(1, 1), blends: [false, true] },
          { target: createTarget(gl, 1, 1, this.halfInternal, gl.LINEAR), blends: [false, true] },
        ];
    gl.useProgram(program);
    this.bindData(u);
    u.f('uResolution', 1, 1);
    u.f('uBlock', 1);
    gl.viewport(0, 0, 1, 1);
    gl.bindVertexArray(this.vao);
    gl.blendColor(0, 0, 0, WARM_BLEND);
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    for (const { target, blends } of targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      for (const blend of blends) {
        if (blend) gl.enable(gl.BLEND);
        else gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const fence = new GpuFence(gl);
    fence.mark();
    while (fence.busy) {
      if (gl.isContextLost()) throw new GlError('The graphics context was lost while preparing the ray tracer');
      await new Promise((r) => requestAnimationFrame(r));
    }
    for (const { target } of targets) {
      if ('aux' in target) this.deleteGameTarget(target as GameTarget);
      else deleteTarget(gl, target);
    }
  }

  get droppedObjects(): number {
    return this.packed?.dropped ?? 0;
  }

  createTarget(width: number, height: number, linear = false): Target {
    const gl = this.gl;
    return createTarget(gl, width, height, this.floatInternal, linear ? gl.LINEAR : gl.NEAREST);
  }

  /** A target for `game` trace requests: HDR colour (half float) and the first hit (full float where it can). */
  createGameTarget(width: number, height: number): GameTarget {
    const gl = this.gl;
    const t = createTarget(gl, width, height, this.halfInternal, gl.NEAREST);
    const aux = createTarget(gl, width, height, this.floatInternal, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, aux.tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Only the texture is kept: the second framebuffer is never drawn to.
    gl.deleteFramebuffer(aux.fbo);
    return { ...t, aux: aux.tex };
  }

  deleteGameTarget(t: GameTarget | null): void {
    if (!t) return;
    this.gl.deleteTexture(t.aux);
    deleteTarget(this.gl, t);
  }

  /** Sets the canvas's pixel size; a no-op when it already has it (assigning clears the canvas). */
  sizeCanvas(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /**
   * Uploads the scene data; uniforms are applied at the next trace (the program may still be compiling).
   * The same snapshot is uploaded once, so several views of one scene share the upload.
   */
  setScene(scene: Scene): void {
    if (this.scene === scene && this.meshVersion === meshLibraryVersion()) return;
    const gl = this.gl;
    this.meshVersion = meshLibraryVersion();
    const p = packScene(scene, this.meshes.update(scene));
    this.packed = p;
    uploadFloatRows(gl, this.objectsTex, OBJ_TEXELS, p.count, p.objects);
    uploadFloatRows(gl, this.materialsTex, MAT_TEXELS, p.count, p.materials);
    if (p.terrains.key !== this.terrainKey) this.uploadTerrains(p);
    this.uploadScan(p);
    this.scene = scene;
    this.style = renderStyle(scene.sky);
    this.sceneVersion++;
  }

  /** The game variant reads the object scan from a uniform buffer (scene-packer.ts scanRows). */
  private uploadScan(p: PackedScene): void {
    const gl = this.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.scanBuffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, scanRows(p));
  }

  setView(b: ViewBasis): void {
    this.view = b;
    this.viewVersion++;
  }

  private applyUniforms(t: TraceProgram): void {
    const p = this.packed;
    const u = t.u;
    if (t.sceneVersion !== this.sceneVersion && p && this.scene) {
      u.i('uObjectCount', p.count);
      u.i('uLoopGuard', 0);
      u.i('uLightCount', p.lightCount);
      u.v4array('uLightPos', p.lightPos);
      u.v4array('uLightColor', p.lightColor);
      u.v4array('uLightDir', p.lightDir);
      const s = this.scene.sky;
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
      t.sceneVersion = this.sceneVersion;
    }
    if (t.viewVersion !== this.viewVersion && this.view) {
      const b = this.view;
      u.f('uCamPos', ...b.origin);
      u.f('uCamFwd', ...b.forward);
      u.f('uCamRight', ...b.right);
      u.f('uCamUp', ...b.up);
      u.f('uHalfH', b.halfHeight);
      u.f('uAspect', b.aspect);
      u.i('uOrtho', b.ortho ? 1 : 0);
      u.f('uLens', ...b.lens);
      t.viewVersion = this.viewVersion;
    }
  }

  /** Traces the requested rows; a no-op until the program is compiled. */
  traceRows(r: TraceRequest): void {
    const gl = this.gl;
    const game = r.game && this.game;
    const t = game || ((r.fast || r.game) && this.fast) || this.trace;
    if (!t) return;
    gl.useProgram(t.program);
    this.applyUniforms(t);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.target.fbo);
    // A game target's second buffer takes the game program's first hits; a stand-in program writes only colour
    // (WebGL refuses a draw into a buffer the program has no output for).
    if ('aux' in r.target) gl.drawBuffers(game ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0, gl.NONE]);
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
    const u = t.u;
    u.f('uResolution', r.width, r.height);
    u.f('uOffset', r.offsetX, r.offsetY);
    u.f('uBlock', r.block);
    u.f('uJitter', r.jitterX, r.jitterY);
    u.i('uSample', r.sample);
    u.i('uMaxBounces', r.bounces);
    u.i('uTransparentBg', r.transparentBg ? 1 : 0);
    this.applyShadows(u, r.shadowRays ?? 1);
    if (game && r.game) {
      u.f('uPixelAngle', r.game.pixelAngle);
      u.f('uToonBands', r.game.toonBands);
    }
    this.bindData(u);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
  }

  /** The soft-shadow style of the scene's sky, drawn hard (0 rays) or with that many shadow rays per light. */
  private applyShadows(u: Uniforms, rays: number): void {
    const [sun, lamp, rolloff, unused] = this.style;
    const hard = rays <= 0;
    u.f('uStyle', hard ? 0 : sun, hard ? 0 : lamp, rolloff, unused);
    // Hard lights cast the same shadow every time: one ray says it all.
    u.i('uShadowRays', hard || (sun <= 0 && lamp <= 0) ? 1 : Math.round(rays));
  }

  present(b: BlitRequest): void {
    const gl = this.gl;
    gl.useProgram(this.blit);
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.into ? b.into.fbo : null);
    gl.viewport(b.left ?? 0, b.bottom ?? 0, b.width, b.height);
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
    u.f('uFade', b.fade ?? 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Writes `fresh` with `keep` of `history` into `into` (the live view's Detailed quality under a still camera). */
  blendHistory(r: HistoryRequest): void {
    const gl = this.gl;
    gl.useProgram(this.temporal);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.into.fbo);
    gl.viewport(0, 0, r.width, r.height);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0 + UNIT_CUR);
    gl.bindTexture(gl.TEXTURE_2D, r.fresh.tex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_PREV);
    gl.bindTexture(gl.TEXTURE_2D, r.history.tex);
    const u = this.tu;
    u.i('uFresh', UNIT_CUR);
    u.i('uHistory', UNIT_PREV);
    u.f('uSize', r.width, r.height);
    u.f('uKeep', r.keep);
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
    gl.activeTexture(gl.TEXTURE0 + UNIT_LATHE);
    gl.bindTexture(gl.TEXTURE_2D, this.latheTex);
    u.i('uLathe', UNIT_LATHE);
    this.meshes.bind(u, UNIT_MESH, UNIT_MESH_IMAGES);
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

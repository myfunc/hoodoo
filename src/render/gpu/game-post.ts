import type { ViewBasis } from '../../world/camera-math';
import type { GameTarget } from './engine';
import { GAME, type SunSpot, bloomSizes, bloomWeight, cameraRows } from './game-frame';
import type { InkLook, Look } from './game-looks';
import { MOTION_FLOATS } from './game-motion';
import { sharpenAmount, upscaleKernel } from './game-upscale';
import { type Target, Uniforms, createTarget, deleteTarget, linkProgram } from './gl';
import { TEXEL_FLOATS } from './render.constants';
import fullscreen from './glsl/fullscreen.vert.glsl?raw';
import taaFrag from './glsl/game-taa.glsl?raw';
import inkFrag from './glsl/game-ink.glsl?raw';
import bloomFrag from './glsl/game-bloom.glsl?raw';
import shaftsFrag from './glsl/game-shafts.glsl?raw';
import compositeFrag from './glsl/game-composite.glsl?raw';

interface Pass {
  readonly program: WebGLProgram;
  readonly u: Uniforms;
}

/** One frame's temporal upscale: the traced picture, its first hits, and the cameras of this frame and the last. */
export interface UpscaleRequest {
  readonly src: Target;
  readonly aux: WebGLTexture;
  /** The traced size: the bottom-left corner of `src` and `aux`. */
  readonly width: number;
  readonly height: number;
  readonly jitter: readonly [number, number];
  readonly view: ViewBasis;
  readonly prev: ViewBasis;
  /** False: start the average afresh (first frame, a new size, the preview program still drawing). */
  readonly history: boolean;
  /** How the traced objects moved since the last frame (game-motion.ts); null when none did. */
  readonly motion: Float32Array | null;
}

const UNIT_A = 0;
const UNIT_B = 1;
const UNIT_C = 2;
/** The uniform buffer binding of the objects' motion (the tracer's object scan has 0). */
const MOTION_BINDING = 1;
const MOTION_BLOCK = 'GameMotion';
const GLSL_VERSION = '#version 300 es';

/**
 * READ ME — the game renderer's passes after tracing (game-renderer.ts), each a
 * full-screen triangle: ink outlines on the traced picture (the ink look), the
 * temporal upscale into a ping-pong pair of HDR pictures at the view's size, a bloom
 * chain of halved levels, light shafts on one of them, and the composite onto the
 * canvas with the look's grade. It owns its programs and targets; the tracer does not
 * know it exists.
 */
export class GamePost {
  private readonly taa: Pass;
  private readonly inkPass: Pass;
  private readonly bloom: Pass;
  private readonly shafts: Pass;
  private readonly composite: Pass;
  private readonly hdrFormat: number;
  /** The upscaled pictures: [shown, the one written next]. */
  private history: [Target, Target] | null = null;
  private inked: Target | null = null;
  private down: Target[] = [];
  private up: Target[] = [];
  private shaft: Target | null = null;
  /** The shafts' target holds nothing: no look's shafts or no sun since it was cleared. */
  private shaftsDark = false;
  private width = 0;
  private height = 0;
  /** The last frame's traced size per side (the sharpening follows it). */
  private traced = 1;
  private readonly motionBuffer: WebGLBuffer;

  constructor(private readonly gl: WebGL2RenderingContext, floatInternal: number) {
    this.hdrFormat = floatInternal === gl.RGBA8 ? gl.RGBA8 : gl.RGBA16F;
    const pass = (frag: string): Pass => {
      const program = linkProgram(gl, fullscreen, frag);
      return { program, u: new Uniforms(gl, program) };
    };
    this.taa = pass(taaFrag.replace(GLSL_VERSION, `${GLSL_VERSION}\n#define MOTION_VECS ${MOTION_FLOATS / TEXEL_FLOATS}`));
    gl.uniformBlockBinding(this.taa.program, gl.getUniformBlockIndex(this.taa.program, MOTION_BLOCK), MOTION_BINDING);
    this.motionBuffer = gl.createBuffer()!;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, MOTION_BINDING, this.motionBuffer);
    gl.bufferData(gl.UNIFORM_BUFFER, MOTION_FLOATS * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);
    this.inkPass = pass(inkFrag);
    this.bloom = pass(bloomFrag);
    this.shafts = pass(shaftsFrag);
    this.composite = pass(compositeFrag);
  }

  /** The view's size (the history and the bloom follow it) and the traced target's (the ink target matches it). */
  resize(width: number, height: number, traceWidth: number, traceHeight: number): void {
    const gl = this.gl;
    this.release();
    this.width = width;
    this.height = height;
    const linear = (w: number, h: number) => createTarget(gl, w, h, this.hdrFormat, gl.LINEAR);
    this.history = [linear(width, height), linear(width, height)];
    this.inked = createTarget(gl, traceWidth, traceHeight, this.hdrFormat, gl.NEAREST);
    const sizes = bloomSizes(width, height);
    this.down = sizes.map(([w, h]) => linear(w, h));
    this.up = sizes.slice(0, -1).map(([w, h]) => linear(w, h));
    const [sw, sh] = sizes[GAME.shaftLevel];
    this.shaft = linear(sw, sh);
    this.shaftsDark = false;
  }

  release(): void {
    const gl = this.gl;
    for (const t of [...(this.history ?? []), this.inked, ...this.down, ...this.up, this.shaft]) deleteTarget(gl, t);
    this.history = null;
    this.inked = null;
    this.down = [];
    this.up = [];
    this.shaft = null;
  }

  /** The ink look: outlines from the first hits drawn into a copy of the traced picture, which is returned. */
  ink(src: GameTarget, width: number, height: number, ink: InkLook): Target {
    const out = this.inked!;
    const u = this.use(this.inkPass, out, width, height);
    this.bind(UNIT_A, src.tex);
    this.bind(UNIT_B, src.aux);
    u.i('uCur', UNIT_A);
    u.i('uAux', UNIT_B);
    u.f('uCurSize', width, height);
    u.f('uInkColor', ...ink.color);
    u.f('uInk', ink.strength, ink.depth, ink.crease);
    this.draw();
    return out;
  }

  /** The new frame into the running average at the view's size; the result becomes the shown picture. */
  upscale(r: UpscaleRequest): void {
    const [shown, next] = this.history!;
    const u = this.use(this.taa, next, this.width, this.height);
    this.bind(UNIT_A, r.src.tex);
    this.bind(UNIT_B, r.aux);
    this.bind(UNIT_C, shown.tex);
    u.i('uCur', UNIT_A);
    u.i('uAux', UNIT_B);
    u.i('uHistory', UNIT_C);
    u.f('uCurSize', r.width, r.height);
    u.f('uOutSize', this.width, this.height);
    u.f('uJitter', ...r.jitter);
    u.i('uHasHistory', r.history ? 1 : 0);
    u.f('uMaxWeight', GAME.restWeight, GAME.movingWeight);
    this.traced = r.width / this.width;
    const k = upscaleKernel(this.traced);
    u.f('uKernel', k.temporal, k.flat, k.across, k.along);
    const cam = cameraRows(r.view);
    const prev = cameraRows(r.prev);
    u.v4array('uCam', cam.rows);
    u.v4array('uPrev', prev.rows);
    u.f('uCamExtra', ...cam.extra);
    u.f('uPrevExtra', ...prev.extra);
    u.i('uHasMotion', r.motion ? 1 : 0);
    if (r.motion) {
      this.gl.bindBuffer(this.gl.UNIFORM_BUFFER, this.motionBuffer);
      this.gl.bufferSubData(this.gl.UNIFORM_BUFFER, 0, r.motion);
    }
    this.draw();
    this.history = [next, shown];
  }

  /** Bloom down and up the chain from the shown picture, then the shafts (when the look has them and the sun is in view). */
  glow(look: Look, sun: SunSpot): void {
    const b = look.bloom;
    let src = this.history![0];
    this.down.forEach((t, i) => {
      const u = this.use(this.bloom, t, t.width, t.height);
      this.bind(UNIT_A, src.tex);
      u.i('uSrc', UNIT_A);
      u.i('uSame', UNIT_A);
      u.f('uTexel', 1 / src.width, 1 / src.height);
      u.i('uUp', 0);
      u.i('uFirst', i === 0 ? 1 : 0);
      u.f('uBloom', b.threshold, b.knee, b.spread);
      this.draw();
      src = t;
    });
    for (let i = this.up.length - 1; i >= 0; i--) {
      const t = this.up[i];
      const u = this.use(this.bloom, t, t.width, t.height);
      this.bind(UNIT_A, src.tex);
      this.bind(UNIT_B, this.down[i].tex);
      u.i('uSrc', UNIT_A);
      u.i('uSame', UNIT_B);
      u.f('uTexel', 1 / src.width, 1 / src.height);
      u.i('uUp', 1);
      u.f('uBloom', b.threshold, b.knee, b.spread);
      this.draw();
      src = t;
    }
    this.lightShafts(look, sun);
  }

  /** Light shafts, when the look has them and the sun is in view; else their target is cleared once and the pass skipped. */
  private lightShafts(look: Look, sun: SunSpot): void {
    const gl = this.gl;
    const shafts = look.shafts;
    const out = this.shaft!;
    if (!shafts || sun.strength <= 0) {
      if (this.shaftsDark) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.shaftsDark = true;
      return;
    }
    this.shaftsDark = false;
    const u = this.use(this.shafts, out, out.width, out.height);
    this.bind(UNIT_A, this.history![0].tex);
    u.i('uSrc', UNIT_A);
    u.f('uSunUv', ...sun.uv);
    u.f('uFacing', sun.strength);
    u.f('uShaft', shafts.decay, shafts.reach, shafts.focus, shafts.threshold);
    u.f('uAspect', this.width / this.height);
    this.draw();
  }

  /** The shown picture with its glow, through the look, onto the canvas. */
  present(look: Look): void {
    const gl = this.gl;
    if (!this.history) return;
    gl.useProgram(this.composite.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    this.bind(UNIT_A, this.history[0].tex);
    this.bind(UNIT_B, (this.up[0] ?? this.down[0]).tex);
    this.bind(UNIT_C, this.shaft!.tex);
    const u = this.composite.u;
    u.i('uHdr', UNIT_A);
    u.i('uBloom', UNIT_B);
    u.i('uShafts', UNIT_C);
    u.f('uOutSize', this.width, this.height);
    u.f('uTone', look.exposure, look.curve, look.contrast, look.saturation);
    u.f('uLift', ...look.lift);
    u.f('uGamma', ...look.gamma);
    u.f('uGain', ...look.gain);
    u.f('uShadowTint', ...look.shadowTint);
    u.f('uHighlightTint', ...look.highlightTint);
    u.f('uBloomTint', ...look.bloom.tint);
    u.f('uHalation', ...look.halation);
    u.f('uShaftTint', ...(look.shafts?.tint ?? [0, 0, 0]));
    u.f('uLens', look.fringe, look.vignette, look.soften, sharpenAmount(look.sharpen, this.traced));
    u.f('uExtra', look.scanlines, look.map?.amount ?? 0, bloomWeight(look.bloom.spread));
    u.f('uMapLo', ...(look.map?.lo ?? [0, 0, 0]));
    u.f('uMapMid', ...(look.map?.mid ?? [0, 0, 0]));
    u.f('uMapHi', ...(look.map?.hi ?? [0, 0, 0]));
    this.draw();
  }

  private use(p: Pass, into: Target, width: number, height: number): Uniforms {
    const gl = this.gl;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    return p.u;
  }

  private bind(unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  private draw(): void {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }
}

import { Logger } from '../../core/log';
import type { Vec3 } from '../../core/vec3';
import type { Scene, SceneObject } from '../../model/scene.types';
import { type ViewBasis, sameBasis } from '../../world/camera-math';
import type { GameTarget, RayEngine } from './engine';
import { PlayResolution } from '../../world/settings';
import { GAME, type SunSpot, jitterAt, pixelAngle, sunOnScreen } from './game-frame';
import { type GameLook, LOOKS, type Look, lookFrom } from './game-looks';
import { motionRows } from './game-motion';
import { GamePost } from './game-post';
import { FramePacer, GAME_SIZE, GameSize, startScale } from './game-size';
import { jitterPhases } from './game-upscale';
import { GpuFence } from './gpu-fence';
import { packedObjects, skyUniforms } from './scene-packer';
import type { RealtimeStatus, ViewRenderer } from './view-renderer';

const MS_PER_S = 1000;
const FPS_SMOOTHING = 0.1;
const PINHOLE: readonly [number, number] = [0, 0];
/** skyUniforms' fogParams: whether the sun is drawn, and night (the moon lights the scene). */
const SUN_VISIBLE = 2;
const NIGHT = 3;
/** Jitter and noise indices wrap here, long before floats lose integers. */
const FRAME_WRAP = 1 << 20;
/** The traced picture's blend for `?gpuload` repeats: drawn over itself, so tile GPUs cannot skip it. */
const LOAD_BLEND = 0.5;
const LOAD_FLAG = 'gpuload';
const LOAD_MAX = 16;
/** How long after a frame the fence is watched, in budgets: a frame later than that is slow whatever its time. */
const WATCH_BUDGETS = 2;
/** The scene window draws at most this many device pixels per CSS pixel (viewport.ts). */
const MAX_PIXEL_RATIO = 2;

/** `?gpuload=<n>` traces each frame n more times: a GPU n + 1 times slower at tracing, to test the size control. */
export function gpuLoadFrom(search: string): number {
  const n = Math.round(Number(new URLSearchParams(search).get(LOAD_FLAG) ?? 0));
  return Number.isFinite(n) ? Math.min(LOAD_MAX, Math.max(0, n)) : 0;
}

/**
 * READ ME — the game renderer: Play's picture (PictureMode.Game), built for 60 fps
 * with deep reflections. Every picture it traces the noiseless game variant of
 * the tracer (GAME_TRACE in 90-main.glsl: 4–5 mirror and glass bounces, shadow rays
 * from the first hit, detail faded by the ray's footprint) at a size GameSize keeps where
 * the GPU finishes each frame well inside its budget, with the sample jittered inside each
 * pixel. GamePost then upsamples it into a running average at the view's size, reprojected
 * through the camera's motion and clipped to the new samples, so edges are smooth, nothing
 * shimmers and a still camera builds up the view's own detail; then bloom, light shafts and
 * a look (game-looks.ts) onto the canvas. FramePacer keeps pictures at 60 a second on faster
 * displays. While nothing changes it keeps refining for `GAME.settleFrames` frames, then rests.
 */
export class GameRenderer implements ViewRenderer {
  /** Frames to refine for once nothing changes (the readouts show it as rays). */
  target: number = GAME.settleFrames;
  /** The grade (game-looks.ts); `?look=` on the URL picks another one to compare. */
  look: GameLook = lookFrom(location.search);
  private readonly load = gpuLoadFrom(location.search);
  private resolution = PlayResolution.Auto;
  private trace: GameTarget | null = null;
  private post: GamePost | null = null;
  private width = 0;
  private height = 0;
  private scene: Scene | null = null;
  private basis: ViewBasis | null = null;
  private sceneDirty = false;
  private changed = false;
  /** Frames drawn since the last change. */
  private still = 0;
  private frame = 0;
  /** The camera the shown average was drawn with, and whether there is one to build on. */
  private prev: ViewBasis | null = null;
  private history = false;
  private hasImage = false;
  private sunDir: Vec3 | null = null;
  /** The traced objects of the last frame drawn, to tell how they moved since (game-motion.ts). */
  private drawn: readonly SceneObject[] | null = null;
  private size = new GameSize(1);
  /** Traced pixels the size control last settled at: a new view size starts from there. */
  private settledPixels: number = GAME_SIZE.startPixels;
  private readonly pacer = new FramePacer();
  private readonly fence: GpuFence;
  /** A drawn frame whose GPU time the size control has not heard yet. */
  private pending = false;
  private fps = 0;
  private lastFrameEnd = 0;
  /** The post passes would not compile: the live preview draws instead (ViewPictures.rendererFor). */
  private failed = false;
  private readonly logger = Logger.create('GameRenderer');

  constructor(private readonly engine: RayEngine) {
    this.fence = new GpuFence(engine.gl);
  }

  /** False once its passes failed to compile: then the live preview stands in. */
  get usable(): boolean {
    return !this.failed;
  }

  resize(width: number, height: number): void {
    this.engine.sizeCanvas(width, height);
    if (this.failed || (width === this.width && height === this.height)) return;
    try {
      this.post ??= new GamePost(this.engine.gl, this.engine.floatInternal);
    } catch (error) {
      this.failed = true;
      this.logger.error('game renderer unavailable, the live preview draws instead', {}, error);
      return;
    }
    if (this.width) this.settledPixels = this.width * this.height * this.size.scale * this.size.scale;
    this.width = width;
    this.height = height;
    this.engine.deleteGameTarget(this.trace);
    this.trace = this.engine.createGameTarget(width, height);
    this.post.resize(width, height, width, height);
    this.size = new GameSize(startScale(width, height, this.settledPixels), this.resolution, Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.history = false;
    this.hasImage = false;
    this.changed = true;
  }

  update(scene: Scene, basis: ViewBasis): void {
    if (scene === this.scene && this.basis && sameBasis(basis, this.basis)) return;
    if (scene !== this.scene) this.sceneDirty = true;
    this.scene = scene;
    this.basis = basis;
    this.changed = true;
  }

  get imageReady(): boolean {
    return this.hasImage;
  }

  /** The user's choice between a sharp and a smooth picture (Settings' playResolution). */
  setResolution(resolution: PlayResolution): void {
    if (resolution === this.resolution) return;
    this.resolution = resolution;
    this.size.mode = resolution;
    this.changed = true;
  }

  reset(): void {
    this.scene = null;
    this.basis = null;
    this.prev = null;
    this.drawn = null;
    this.history = false;
    this.hasImage = false;
    this.changed = true;
    this.still = 0;
  }

  /** Gives the GPU memory back (the picture leaves the game renderer); the next `resize` allocates again. */
  release(): void {
    this.engine.deleteGameTarget(this.trace);
    this.trace = null;
    this.post?.release();
    if (this.width) this.settledPixels = this.width * this.height * this.size.scale * this.size.scale;
    this.width = 0;
    this.height = 0;
    this.reset();
  }

  status(): RealtimeStatus {
    const settled = !this.changed && this.still >= this.target;
    return { samples: Math.min(this.still, this.target), target: this.target, scale: this.size.scale, fps: Math.round(this.fps), moving: !settled, game: true };
  }

  tick(now: number = performance.now()): boolean {
    if (!this.trace || !this.scene || !this.basis) return false;
    if (!this.engine.isReady) return true;
    this.engine.prepareGame();
    this.pacer.frame(now);
    if (this.fence.busy) return true;
    this.measured();
    if (!this.changed && this.still >= this.target) return false;
    if (this.pacer.due) this.draw();
    return true;
  }

  present(): void {
    if (this.hasImage) this.post?.present(this.currentLook);
  }

  private get currentLook(): Look {
    return LOOKS[this.look];
  }

  /** One frame: trace at the steady size, then ink, upscale, glow and the look onto the canvas. */
  private draw(): void {
    const engine = this.engine;
    const post = this.post!;
    const target = this.trace!;
    const look = this.currentLook;
    const scale = this.size.scale;
    const w = Math.max(1, Math.round(this.width * scale));
    const h = Math.max(1, Math.round(this.height * scale));
    let motion: Float32Array | null = null;
    if (this.sceneDirty) {
      engine.setScene(this.scene!);
      this.sunDir = keyLight(this.scene!);
      const objects = packedObjects(this.scene!);
      if (this.drawn) motion = motionRows(this.drawn, objects);
      this.drawn = objects;
      this.sceneDirty = false;
    }
    // The traced picture covers the view's frustum whatever its rounding; the game camera is a pinhole.
    const view: ViewBasis = { ...this.basis!, aspect: this.width / this.height, lens: PINHOLE };
    engine.setView(view);
    const jitter = jitterAt(this.frame, jitterPhases(scale));
    const ready = engine.gameReady;
    const sun: SunSpot = this.sunDir ? sunOnScreen(view, this.sunDir) : { uv: [0, 0], strength: 0 };
    // Detail fades at the view's pixel, not the traced one: the jittered frames add up to the view's detail.
    const lodAngle = pixelAngle(view, this.height);
    for (let i = 0; i <= this.load; i++) {
      engine.traceRows({
        target, width: w, height: h, offsetX: 0, offsetY: 0, block: 1, rowStart: 0, rowEnd: h,
        jitterX: jitter[0], jitterY: jitter[1], sample: this.frame, bounces: look.bounces, transparentBg: false, blend: i ? LOAD_BLEND : 1,
        game: { pixelAngle: lodAngle, toonBands: look.toonBands },
      });
    }
    // Until the game program is compiled the preview draws: no first hits to ink or reproject with.
    const src = look.ink && ready ? post.ink(target, w, h, look.ink) : target;
    post.upscale({ src, aux: target.aux, width: w, height: h, jitter, view, prev: this.prev ?? view, history: this.history && ready, motion });
    post.glow(look, sun);
    post.present(look);
    this.fence.mark();
    this.fence.watch(this.pacer.budget * WATCH_BUDGETS);
    this.pacer.drew();
    this.prev = view;
    this.history = true;
    this.frame = (this.frame + 1) % FRAME_WRAP;
    this.still = this.changed ? 0 : this.still + 1;
    this.changed = false;
    this.pending = true;
    this.hasImage = true;
    this.countFrame();
  }

  /** Once a frame is done, the size control learns how long the GPU took (frames of the stand-in program do not count). */
  private measured(): void {
    if (!this.pending) return;
    this.pending = false;
    const ms = this.fence.elapsed;
    if (ms !== null && this.engine.gameReady) this.size.frame(ms, this.pacer.budget);
  }

  private countFrame(): void {
    const now = performance.now();
    if (this.lastFrameEnd) this.fps += (MS_PER_S / (now - this.lastFrameEnd) - this.fps) * FPS_SMOOTHING;
    this.lastFrameEnd = now;
  }
}

/** The light that casts shafts: the sun by day, the moon by night; null when the sky does not draw it. */
function keyLight(scene: Scene): Vec3 | null {
  const k = skyUniforms(scene.sky);
  if (k.fogParams[SUN_VISIBLE] < 1) return null;
  const [x, y, z] = k.sunDir;
  return k.fogParams[NIGHT] > 0 ? [-x, -y, -z] : [x, y, z];
}

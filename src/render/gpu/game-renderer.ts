import { Logger } from '../../core/log';
import type { Vec3 } from '../../core/vec3';
import type { Scene, SceneObject } from '../../model/scene.types';
import { type ViewBasis, sameBasis } from '../../world/camera-math';
import type { GameTarget, RayEngine } from './engine';
import { GAME, GAME_PACE, type SunSpot, jitterAt, pixelAngle, startScale, sunOnScreen } from './game-frame';
import { type GameLook, LOOKS, type Look, lookFrom } from './game-looks';
import { motionRows } from './game-motion';
import { GamePost } from './game-post';
import { GpuFence } from './gpu-fence';
import { MotionScale } from './motion-scale';
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

/**
 * READ ME — the game renderer: Play's picture (PictureMode.Game), built for 60 fps
 * with deep reflections. Every display frame it traces the noiseless game variant of
 * the tracer (GAME_TRACE in 90-main.glsl: 4–5 mirror and glass bounces, shadow rays
 * from the first hit, detail faded by the ray's footprint) at a size MotionScale keeps
 * where every frame is finished by the next display frame (GAME_PACE), with the sample
 * jittered inside each pixel. GamePost then
 * upscales it into a running average at the view's size, reprojected through the
 * camera's motion and clipped to the new samples, so edges are smooth and nothing
 * shimmers; then bloom, light shafts and a look (game-looks.ts) onto the canvas.
 * While nothing changes it keeps refining for `GAME.settleFrames` frames, then rests.
 */
export class GameRenderer implements ViewRenderer {
  /** Frames to refine for once nothing changes (the readouts show it as rays). */
  target: number = GAME.settleFrames;
  /** The grade (game-looks.ts); `?look=` on the URL picks another one to compare. */
  look: GameLook = lookFrom(location.search);
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
  private motion = new MotionScale(1, GAME_PACE);
  private readonly fence: GpuFence;
  private pending = false;
  private late = false;
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
    this.width = width;
    this.height = height;
    this.engine.deleteGameTarget(this.trace);
    this.trace = this.engine.createGameTarget(width, height);
    this.post.resize(width, height, width, height);
    this.motion = new MotionScale(startScale(width, height), GAME_PACE);
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
    this.width = 0;
    this.height = 0;
    this.reset();
  }

  status(): RealtimeStatus {
    const settled = !this.changed && this.still >= this.target;
    return { samples: Math.min(this.still, this.target), target: this.target, scale: this.motion.scale, fps: Math.round(this.fps), moving: !settled };
  }

  tick(): boolean {
    if (!this.trace || !this.scene || !this.basis) return false;
    if (!this.engine.isReady) return true;
    this.engine.prepareGame();
    if (this.fence.busy) {
      if (this.pending) this.late = true;
      return true;
    }
    this.pace();
    if (!this.changed && this.still >= this.target) return false;
    this.draw();
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
    const scale = this.motion.scale;
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
    const jitter = jitterAt(this.frame);
    const ready = engine.gameReady;
    const sun: SunSpot = this.sunDir ? sunOnScreen(view, this.sunDir) : { uv: [0, 0], strength: 0 };
    engine.traceRows({
      target, width: w, height: h, offsetX: 0, offsetY: 0, block: 1, rowStart: 0, rowEnd: h,
      jitterX: jitter[0], jitterY: jitter[1], sample: this.frame, bounces: look.bounces, transparentBg: false, blend: 1,
      game: { pixelAngle: pixelAngle(view, h), toonBands: look.toonBands },
    });
    // Until the game program is compiled the preview draws: no first hits to ink or reproject with.
    const src = look.ink && ready ? post.ink(target, w, h, look.ink) : target;
    post.upscale({ src, aux: target.aux, width: w, height: h, jitter, view, prev: this.prev ?? view, history: this.history && ready, motion });
    post.glow(look, sun);
    post.present(look);
    this.fence.mark();
    this.prev = view;
    this.history = true;
    this.frame = (this.frame + 1) % FRAME_WRAP;
    this.still = this.changed ? 0 : this.still + 1;
    this.changed = false;
    this.pending = true;
    this.late = false;
    this.hasImage = true;
    this.countFrame();
  }

  /** Once a frame is done, the size control learns whether it was late (still on the GPU at the next animation frame). */
  private pace(): void {
    if (!this.pending) return;
    this.pending = false;
    this.motion.paced(this.late);
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

import { type Vec3, add, dot, scale, sub } from '../../../core/vec3';
import type { SourceFiles } from '../../../io/source/source.types';
import type { Frame } from '../../../render/wire/wireframe';
import { skyUniforms } from '../../../render/gpu/scene-packer';
import { cameraAxes } from '../../../world/camera-math';
import { Layer } from '../../sim/physics';
import type { PlayFrame, PlaySim } from '../../sim/play-sim';
import { WeaponId } from '../sandbox.enums';
import { DEFAULT_WEAPON_COLOR, type WeaponView } from '../weapons/weapon';
import { SpriteBatch, type Rgba } from './vm-effects';
import { VmGpu } from './vm-gpu';
import { handsLighting } from './vm-light';
import { VmMaterials } from './vm-materials';
import { perspective, toWorldFov, vmVerticalFov } from './vm-space';
import { Viewmodel } from './viewmodel';

/**
 * READ ME — the hands layer: a WebGL canvas laid exactly over the picture that
 * shows Garry's Mod's own guns from the player's files. Each display frame it
 * moves and poses the hands (Viewmodel), draws the Physics Gun's beam in the
 * world's perspective from the muzzle to the held point — bending toward where
 * the aim wants it, as Source's quadratic beam does — then the hands and gun in
 * their own perspective, then the glows. Sandbox falls back to its 2D beam
 * while this layer is missing (no game files).
 */

const FX = {
  beamHeld: 'materials/sprites/physbeama.vmt',
  beamFree: 'materials/sprites/physbeam.vmt',
  endGlow: 'materials/sprites/physg_glow1.vmt',
  muzzleGlow: 'materials/sprites/physg_glow2.vmt',
  core: 'materials/effects/fluttercore_gmod.vmt',
  toolTracer: 'materials/effects/tool_tracer.vmt',
  selectRing: 'materials/effects/select_ring.vmt',
  selectDot: 'materials/effects/select_dot.vmt',
} as const;

/**
 * The Tool Gun's shot (gmod_tool DoShootEffect): the ToolTracer from the muzzle for a
 * moment, and selection_indicator at the hit: a dot fading over a second and six
 * rings spreading 256 inches a second and fading five times as fast, each at its own
 * speed (selection_ring.lua picks them at random; these are spread evenly).
 */
const SHOT = {
  tracer: 0.1, tracerWidth: 4, ringSize: 4, ringGrowth: 256, ringFade: 5, dotSize: 4, dotLife: 1,
  ringSpeeds: [0.5, 0.7, 0.9, 1.1, 1.3, 1.5], ringColor: [0.3, 0.76, 0.98],
} as const;

/** Sizes in Source units (inches) and the beam's texture scroll per second. */
const LOOK = {
  /** Source's DrawBeamQuadratic width for the gravity gun's beam. */
  beamWidth: 13,
  scroll: 1,
  endGlow: 10,
  muzzleGlow: 8,
  core: 4,
  /** Glow sprites' alphas from the materials ($alpha). */
  endAlpha: 0.5,
  muzzleAlpha: 0.3,
  /** How fast the claws follow (per second). */
  clawRate: 8,
} as const;
const CLAW_PARAM = 'active';
const MUZZLE_NAMES = ['muzzle', 'core'];
const CLIP = { near: 1, far: 1e6 } as const;
const SUN_RAY = 1e5;
const MS_PER_S = 1000;
const DEG = Math.PI / 180;

type Fx = keyof typeof FX;

export class HandsLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly batch = new SpriteBatch();
  private weapon: WeaponId | null = null;
  private last = 0;
  /** The Tool Gun's shot last kicked (simulation seconds). */
  private kicked: number | null = null;
  private claws = 0;

  private constructor(
    private readonly gpu: VmGpu,
    private readonly hands: Viewmodel,
    private readonly fx: ReadonlyMap<Fx, WebGLTexture>,
  ) {
    this.canvas = gpu.canvas;
  }

  /** Builds the layer from the player's game files, or null when they hold no gun. */
  static async create(files: SourceFiles): Promise<HandsLayer | null> {
    const canvas = document.createElement('canvas');
    canvas.className = 'sandbox-hands';
    const gpu = new VmGpu(canvas);
    const hands = await Viewmodel.load(gpu, files);
    if (!hands) return null;
    const materials = new VmMaterials(gpu, files);
    const fx = new Map<Fx, WebGLTexture>();
    await Promise.all((Object.keys(FX) as Fx[]).map(async (k) => {
      const t = await materials.spriteTexture(FX[k]);
      if (t) fx.set(k, t);
    }));
    return new HandsLayer(gpu, hands, fx);
  }

  has(id: WeaponId): boolean {
    return this.hands.has(id);
  }

  fire(): void {
    this.hands.fire();
  }

  draw(f: PlayFrame, picture: Frame, view: WeaponView, weapon: WeaponId, sim: PlaySim, weaponColor = DEFAULT_WEAPON_COLOR): void {
    const now = performance.now() / MS_PER_S;
    const dt = this.last ? Math.min(now - this.last, 1) : 0;
    this.last = now;
    if (weapon !== this.weapon) {
      this.weapon = weapon;
      this.hands.deploy(weapon);
    }
    this.place(picture);
    const cam = f.camera;
    const axes = cameraAxes(cam);
    const unit = sim.player.tuning.unit;
    // The claws open while Mouse 1 is held, easing like the super gravity gun's.
    this.claws += (Number(view.firing) - this.claws) * Math.min(1, dt * LOOK.clawRate);
    this.hands.setPoseParameter(CLAW_PARAM, this.claws);
    this.hands.update({ dt, axes, pitch: -cam.pitch, speed: sim.player.speed });
    const sun = skyUniforms(f.scene.sky).sunDir;
    const sunlit = !sim.physics.raycast(cam.position, sun, SUN_RAY, { layers: Layer.World | Layer.Prop });
    const light = handsLighting({ sky: f.scene.sky, ...axes, sunlit });
    const aspect = picture.w / picture.h;
    this.gpu.begin();
    // World points in the eye's frame, inches: x right, y up, z toward the viewer.
    const toView = (p: Vec3): Vec3 => {
      const d = sub(p, cam.position);
      return scale([dot(d, axes.right), dot(d, axes.up), -dot(d, axes.forward)], 1 / unit);
    };
    const worldProj = perspective(cam.fov, aspect, CLIP.near, CLIP.far);
    const color = beamColor(weaponColor);
    const muzzle = this.muzzle(cam.fov);
    this.shot(view, sim.time, toView, worldProj, muzzle, now);
    if (view.firing && view.end && muzzle) {
      const end = toView(view.end);
      // Source: the control point is halfway to where the aim wants the body, the end where it is.
      const want: Vec3 = view.held ? [0, 0, -view.held.distance / unit] : end;
      const control = scale(add(muzzle, want), 0.5);
      this.sprites(view.held ? 'beamHeld' : 'beamFree', worldProj, false, (b) => b.quadraticBeam(muzzle, control, end, LOOK.beamWidth, color, now * LOOK.scroll));
      this.sprites('endGlow', worldProj, false, (b) => b.sprite(end, LOOK.endGlow, [1, 1, 1, LOOK.endAlpha]));
    }
    this.gpu.clearDepth();
    this.hands.draw(aspect, light, weaponColor);
    const vmMuzzle = this.attachment();
    if (view.firing && vmMuzzle) {
      const vmProj = this.hands.projection(aspect);
      this.sprites('muzzleGlow', vmProj, false, (b) => b.sprite(vmMuzzle, LOOK.muzzleGlow, [color[0], color[1], color[2], LOOK.muzzleAlpha]));
      this.sprites('core', vmProj, false, (b) => b.sprite(vmMuzzle, LOOK.core, color, now));
    }
  }

  /** A Tool Gun shot: the gun's attack, the tracer while it lasts, the dot and rings at the hit. */
  private shot(view: WeaponView, time: number, toView: (p: Vec3) => Vec3, proj: Float32Array, muzzle: Vec3 | null, now: number): void {
    const shot = view.shot;
    if (!shot) return;
    if (shot.time !== this.kicked) {
      this.kicked = shot.time;
      this.hands.fire();
    }
    const age = time - shot.time;
    const end = toView(shot.end);
    if (muzzle && age < SHOT.tracer) {
      const fade = 1 - age / SHOT.tracer;
      this.sprites('toolTracer', proj, false, (b) => b.quadraticBeam(muzzle, scale(add(muzzle, end), 0.5), end, SHOT.tracerWidth, [1, 1, 1, fade], now));
    }
    if (age < SHOT.dotLife) this.sprites('selectDot', proj, false, (b) => b.sprite(end, SHOT.dotSize, [1, 1, 1, 1 - age / SHOT.dotLife]));
    const [r, g, bl] = SHOT.ringColor;
    this.sprites('selectRing', proj, false, (b) => {
      for (const speed of SHOT.ringSpeeds) {
        const alpha = 1 - age * SHOT.ringFade * speed;
        if (alpha > 0) b.sprite(end, SHOT.ringSize + age * SHOT.ringGrowth * speed, [r, g, bl, alpha]);
      }
    });
  }

  dispose(): void {
    this.gpu.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
  }

  /** The canvas covers the picture exactly (CSS pixels of the layer). */
  private place(p: Frame): void {
    const s = this.canvas.style;
    const px = (v: number) => `${Math.round(v)}px`;
    if (s.left !== px(p.x) || s.top !== px(p.y) || s.width !== px(p.w) || s.height !== px(p.h)) {
      Object.assign(s, { left: px(p.x), top: px(p.y), width: px(p.w), height: px(p.h) });
    }
  }

  private attachment(): Vec3 | null {
    for (const n of MUZZLE_NAMES) {
      const a = this.hands.attachment(n);
      if (a) return a;
    }
    return null;
  }

  /** The muzzle as the world's camera sees it (Source moves viewmodel points into the world's field of view). */
  private muzzle(worldFov: number): Vec3 | null {
    const a = this.attachment();
    if (!a) return null;
    const half = (deg: number) => Math.tan((deg * DEG) / 2);
    return toWorldFov(a, half(vmVerticalFov(this.hands.fov)), half(worldFov));
  }

  private sprites(fx: Fx, proj: Float32Array, depth: boolean, build: (b: SpriteBatch) => void): void {
    const tex = this.fx.get(fx);
    if (!tex) return;
    this.batch.clear();
    build(this.batch);
    this.gpu.drawSprites(this.batch.vertices, tex, proj, depth);
  }
}

/** The beam and glow colour: the weapon colour as it is — above 1 it overbrights the white textures into a cyan glow with a white core. */
const beamColor = (c: readonly [number, number, number]): Rgba => [c[0], c[1], c[2], 1];

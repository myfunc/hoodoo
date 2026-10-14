import { type Vec3, cross, normalize } from '../../../core/vec3';
import { boneToModel, skinMatrices } from '../../../io/source/animation';
import { loadModel } from '../../../io/source/model';
import type { SourceFiles, SourceModel } from '../../../io/source/source.types';
import { VmGpu, type VmLighting } from './vm-gpu';
import { VmMaterials } from './vm-materials';
import { perspective } from './vm-space';

/**
 * READ ME — the spawn menu's icons for the game's props, as Garry's Mod makes
 * them: the icon the game has cached for the model (materials/spawnicons, made
 * when the player first saw it in Garry's Mod), else one drawn here the way
 * the game draws it (PositionSpawnIcon: looking down 25° from the front left,
 * 220°, from 15 sizes away with a narrow lens that fits the model), lit plainly
 * from above. One small WebGL canvas draws them all, one at a time; each is
 * copied out to a canvas of its own.
 */

const SIZE = 128;
const ICONS = 'materials/spawnicons/';
const MDL = /\.mdl$/i;
const PNG = '.png';
/** PositionSpawnIcon: the view's angles (pitch down, yaw), how far back in sizes, the lens per size. */
const VIEW = { pitch: 25, yaw: 220, back: 15, fovBase: 4, fovPerSize: 0.04, near: 1 } as const;
const DEG = Math.PI / 180;
/** Plain studio light: the ambient cube's faces (+x −x +y −y +z −z) and one key light from above and behind the eye. */
const AMBIENT = [0.6, 0.6, 0.85, 0.35, 0.6, 0.6] as const;
const KEY: Vec3 = [-0.4, 0.8, 0.45];
const KEY_COLOR: Vec3 = [1.3, 1.25, 1.17];
const AXES = 3;
const NO_TINT: readonly [number, number, number] = [1, 1, 1];

export class PropIcons {
  private readonly gpu: VmGpu;
  private readonly materials: VmMaterials;
  private readonly made = new Map<string, Promise<HTMLCanvasElement | null>>();
  /** Icons are drawn one after another on the one canvas. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly files: SourceFiles) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    this.gpu = new VmGpu(canvas);
    this.materials = new VmMaterials(this.gpu, files);
  }

  /** The prop's icon, or null when the files have neither an icon nor the model. */
  icon(path: string): Promise<HTMLCanvasElement | null> {
    const key = path.toLowerCase();
    let p = this.made.get(key);
    if (!p) {
      p = this.cached(key).then((c) => c ?? this.drawn(key)).catch(() => null);
      this.made.set(key, p);
    }
    return p;
  }

  private async cached(path: string): Promise<HTMLCanvasElement | null> {
    const file = ICONS + path.replace(MDL, PNG);
    const bytes = this.files.has(file) ? await this.files.read(file) : null;
    if (!bytes) return null;
    const image = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
    const out = blank();
    out.getContext('2d')?.drawImage(image, 0, 0, SIZE, SIZE);
    return out;
  }

  private drawn(path: string): Promise<HTMLCanvasElement | null> {
    const job = this.queue.then(async () => {
      if (!this.files.has(path)) return null;
      const model = await loadModel(this.files, path);
      const slots = await Promise.all(model.textures.map((t) => this.materials.slot(t)));
      return this.render(model, slots);
    });
    this.queue = job.catch(() => null);
    return job;
  }

  private render(model: SourceModel, slots: Awaited<ReturnType<VmMaterials['slot']>>[]): HTMLCanvasElement {
    const g = this.gpu.upload(model);
    const frames = boneToModel(model, model.bones.map((b) => ({ position: b.position, quat: b.quat })));
    this.gpu.setBones(g, skinMatrices(model, frames));
    const { min, max } = bounds(model);
    const middle = min.map((v, i) => (v + max[i]) / 2) as unknown as Vec3;
    const size = Math.max(...min.map((v, i) => Math.abs(v) + Math.abs(max[i])));
    const forward = angleForward(VIEW.pitch, VIEW.yaw);
    const eye: Vec3 = [middle[0] - forward[0] * size * VIEW.back, middle[1] - forward[1] * size * VIEW.back, middle[2] - forward[2] * size * VIEW.back];
    const right = normalize(cross(forward, [0, 0, 1]));
    const up = cross(right, forward);
    const far = size * VIEW.back * 2 + size * 2;
    this.gpu.beginAt(SIZE, SIZE);
    this.gpu.drawModel(g, slots, lookAt(eye, right, up, forward), perspective(VIEW.fovBase + size * VIEW.fovPerSize, 1, VIEW.near, far), light(right, up, forward), NO_TINT);
    const out = blank();
    out.getContext('2d')?.drawImage(this.gpu.canvas, 0, 0);
    return out;
  }
}

function blank(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return c;
}

/** Source's forward from pitch (down) and yaw, degrees: x forward, y left, z up. */
function angleForward(pitch: number, yaw: number): Vec3 {
  const [p, y] = [pitch * DEG, yaw * DEG];
  return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)];
}

/** Column-major view matrix: the model's Source points into the GPU's view (x right, y up, z back). */
function lookAt(eye: Vec3, right: Vec3, up: Vec3, forward: Vec3): Float32Array {
  const back: Vec3 = [-forward[0], -forward[1], -forward[2]];
  const rows = [right, up, back];
  const out = new Float32Array(AXES * AXES + AXES + AXES + 1);
  rows.forEach((r, row) => {
    for (let c = 0; c < AXES; c++) out[c * (AXES + 1) + row] = r[c];
    out[AXES * (AXES + 1) + row] = -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]);
  });
  out[out.length - 1] = 1;
  return out;
}

/** The studio light, its view-to-world turn in Hoodoo's axes (y up), as the hands' shader reads it. */
function light(right: Vec3, up: Vec3, forward: Vec3): VmLighting {
  const h = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];
  const back: Vec3 = [-forward[0], -forward[1], -forward[2]];
  return {
    ambient: Float32Array.from(AMBIENT.flatMap((a) => [a, a, a])),
    lightDir: Float32Array.from(normalize(KEY)),
    lightColor: Float32Array.from(KEY_COLOR),
    viewToWorld: Float32Array.from([...h(right), ...h(up), ...h(back)]),
  };
}

function bounds(m: SourceModel): { min: Vec3; max: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of m.meshes) {
    for (let k = 0; k < mesh.positions.length; k += AXES) {
      for (let a = 0; a < AXES; a++) {
        min[a] = Math.min(min[a], mesh.positions[k + a]);
        max[a] = Math.max(max[a], mesh.positions[k + a]);
      }
    }
  }
  return Number.isFinite(min[0]) ? { min: min as unknown as Vec3, max: max as unknown as Vec3 } : { min: [0, 0, 0], max: [0, 0, 0] };
}


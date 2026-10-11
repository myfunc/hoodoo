import type { Vec3 } from '../../core/vec3';
import type { Key, Scene } from '../../model/scene.types';
import { channelAt } from '../../world/animation/interpolate';
import { WIRE } from './wire.constants';
import type { WireProjector } from './wireframe';

/**
 * Motion paths, as Bryce 3D drew them: the route of every animated
 * object (and of the camera, seen from another view) as a dotted line, with a
 * square at each key. Squares are handles: the scene window drags them.
 */

export enum PathTrack {
  Object = 'object',
  Camera = 'camera',
}

/** A key square on screen, for picking. */
export interface KeyHandle {
  readonly track: PathTrack;
  /** Object id, or '' for the camera. */
  readonly id: string;
  readonly time: number;
  readonly world: Vec3;
  readonly x: number;
  readonly y: number;
}

const PATH = {
  color: 'rgba(40, 40, 40, 0.55)',
  selected: WIRE.selected,
  camera: '#1f7a7a',
  dash: [2, 3],
  width: 1.2,
  key: 3,
  keySelected: 4,
  /** Path samples per second of animation, at most `maxSamples` per path. */
  perSecond: 12,
  maxSamples: 240,
} as const;

function positionAt<T>(keys: readonly Key<T>[], t: number, read: (v: T) => Vec3, loop: boolean): Vec3 {
  return [0, 1, 2].map((axis) => channelAt(keys, t, (v) => read(v)[axis], { loop })) as unknown as Vec3;
}

function drawPath<T>(
  g: CanvasRenderingContext2D, proj: WireProjector, scene: Scene, keys: readonly Key<T>[], read: (v: T) => Vec3,
  style: { color: string; key: number }, handle: Omit<KeyHandle, 'time' | 'world' | 'x' | 'y'>, out: KeyHandle[],
): void {
  if (keys.length < 2) return;
  const a = scene.animation;
  const first = keys[0].time;
  const last = keys[keys.length - 1].time;
  const n = Math.min(PATH.maxSamples, Math.max(2, Math.ceil((last - first) * PATH.perSecond)));
  g.strokeStyle = style.color;
  g.setLineDash(PATH.dash as unknown as number[]);
  g.lineWidth = PATH.width;
  g.beginPath();
  let prev: Vec3 | null = null;
  for (let i = 0; i <= n; i++) {
    const p = proj.view(positionAt(keys, first + ((last - first) * i) / n, read, a.loop));
    if (prev) {
      const s = proj.segment(prev, p);
      if (s) {
        g.moveTo(s[0], s[1]);
        g.lineTo(s[2], s[3]);
      }
    }
    prev = p;
  }
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = style.color;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1;
  for (const k of keys) {
    const world = read(k.value);
    const v = proj.view(world);
    if (!proj.basis.ortho && v[2] < WIRE.nearPlane) continue;
    const [x, y] = proj.screen(v);
    g.fillRect(x - style.key, y - style.key, style.key * 2, style.key * 2);
    g.strokeRect(x - style.key + 0.5, y - style.key + 0.5, style.key * 2 - 1, style.key * 2 - 1);
    out.push({ ...handle, time: k.time, world, x, y });
  }
}

/**
 * Draws the paths; returns the key squares (the selection's last, so they win a pick).
 * Over a rendered picture only the selection's paths show, like its wireframe.
 */
export function drawMotionPaths(
  g: CanvasRenderingContext2D, scene: Scene, proj: WireProjector, selection: ReadonlySet<string>, opts: { camera: boolean; overRender: boolean },
): KeyHandle[] {
  const out: KeyHandle[] = [];
  const a = scene.animation;
  g.save();
  const ids = Object.keys(a.objects).sort((x, y) => Number(selection.has(x)) - Number(selection.has(y)));
  for (const id of ids) {
    const o = scene.objects.find((x) => x.id === id);
    const sel = selection.has(id);
    if (!o || o.hidden || (opts.overRender && !sel)) continue;
    drawPath(g, proj, scene, a.objects[id], (v) => v.position,
      { color: sel ? PATH.selected : PATH.color, key: sel ? PATH.keySelected : PATH.key }, { track: PathTrack.Object, id }, out);
  }
  if (opts.camera) drawPath(g, proj, scene, a.camera, (c) => c.position, { color: PATH.camera, key: PATH.keySelected }, { track: PathTrack.Camera, id: '' }, out);
  g.restore();
  return out;
}

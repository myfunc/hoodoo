import type { Vec3 } from '../../core/vec3';
import type { Key, Scene } from '../../model/scene.types';
import { channelAt } from '../../world/animation/interpolate';
import { type KeyRef, KeyTrack, isKeyPicked } from '../../world/animation/key-selection';
import { WIRE } from './wire.constants';
import type { WireProjector } from './wireframe';

/**
 * Motion paths, as Bryce 3D drew them: the route of every animated
 * object (and of the camera, seen from another view) as a dotted line, with a
 * square at each key and the owner's name beside the first one. Squares are
 * handles: the scene window picks and drags them; picked keys show filled yellow.
 */

/** A key square on screen, for picking. */
export interface KeyHandle {
  readonly track: KeyTrack;
  /** Object id, or '' for the camera. */
  readonly id: string;
  /** Whose path it is: the object's name, or Camera. */
  readonly owner: string;
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
  cameraDash: [6, 3],
  width: 1.2,
  key: 3,
  keySelected: 4,
  keyEdge: 'rgba(255,255,255,0.85)',
  picked: '#ffd030',
  pickedEdge: '#2a2a2a',
  /** Path samples per second of animation, at most `maxSamples` per path. */
  perSecond: 12,
  maxSamples: 240,
} as const;

/** The owner's tag beside the first key. */
const TAG = { font: 'bold 10px Geneva, Verdana, sans-serif', dx: 8, dy: -8, padX: 3, height: 13, back: 'rgba(255,255,255,0.78)', baseline: 3.5 } as const;
const CAMERA_NAME = 'Camera';

interface PathStyle {
  readonly color: string;
  readonly key: number;
  readonly dash: readonly number[];
}

function positionAt<T>(keys: readonly Key<T>[], t: number, read: (v: T) => Vec3, loop: boolean): Vec3 {
  return [0, 1, 2].map((axis) => channelAt(keys, t, (v) => read(v)[axis], { loop })) as unknown as Vec3;
}

function drawTag(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  g.font = TAG.font;
  const w = g.measureText(text).width + TAG.padX * 2;
  const left = x + TAG.dx;
  const mid = y + TAG.dy;
  g.fillStyle = TAG.back;
  g.fillRect(left, mid - TAG.height / 2, w, TAG.height);
  g.fillStyle = color;
  g.fillText(text, left + TAG.padX, mid + TAG.baseline);
}

function drawPath<T>(
  g: CanvasRenderingContext2D, proj: WireProjector, scene: Scene, keys: readonly Key<T>[], read: (v: T) => Vec3,
  style: PathStyle, handle: Pick<KeyHandle, 'track' | 'id' | 'owner'>, picked: readonly KeyRef[], out: KeyHandle[],
): void {
  if (keys.length < 2) return;
  const a = scene.animation;
  const first = keys[0].time;
  const last = keys[keys.length - 1].time;
  const n = Math.min(PATH.maxSamples, Math.max(2, Math.ceil((last - first) * PATH.perSecond)));
  g.strokeStyle = style.color;
  g.setLineDash(style.dash as number[]);
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
  g.lineWidth = 1;
  let tagAt: [number, number] | null = null;
  for (const k of keys) {
    const world = read(k.value);
    const v = proj.view(world);
    if (!proj.basis.ortho && v[2] < WIRE.nearPlane) continue;
    const [x, y] = proj.screen(v);
    const on = isKeyPicked(picked, { ...handle, time: k.time }, a.fps);
    const r = on ? style.key + 1 : style.key;
    g.fillStyle = on ? PATH.picked : style.color;
    g.strokeStyle = on ? PATH.pickedEdge : PATH.keyEdge;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.strokeRect(x - r + 0.5, y - r + 0.5, r * 2 - 1, r * 2 - 1);
    out.push({ ...handle, time: k.time, world, x, y });
    tagAt ??= [x, y];
  }
  if (tagAt) drawTag(g, handle.owner, tagAt[0], tagAt[1], style.color);
}

/**
 * Draws the paths; returns the key squares (the selection's last, so they win a pick).
 * Over a rendered picture only the selection's paths show, like its wireframe.
 */
export function drawMotionPaths(
  g: CanvasRenderingContext2D, scene: Scene, proj: WireProjector, selection: ReadonlySet<string>,
  opts: { camera: boolean; overRender: boolean; keys?: readonly KeyRef[] },
): KeyHandle[] {
  const out: KeyHandle[] = [];
  const a = scene.animation;
  const picked = opts.keys ?? [];
  g.save();
  const ids = Object.keys(a.objects).sort((x, y) => Number(selection.has(x)) - Number(selection.has(y)));
  for (const id of ids) {
    const o = scene.objects.find((x) => x.id === id);
    const sel = selection.has(id);
    if (!o || o.hidden || (opts.overRender && !sel)) continue;
    const style = { color: sel ? PATH.selected : PATH.color, key: sel ? PATH.keySelected : PATH.key, dash: PATH.dash };
    drawPath(g, proj, scene, a.objects[id], (v) => v.position, style, { track: KeyTrack.Object, id, owner: o.name }, picked, out);
  }
  if (opts.camera) {
    const style = { color: PATH.camera, key: PATH.keySelected, dash: PATH.cameraDash };
    drawPath(g, proj, scene, a.camera, (c) => c.position, style, { track: KeyTrack.Camera, id: '', owner: CAMERA_NAME }, picked, out);
  }
  g.restore();
  return out;
}

import type { Vec3 } from '../../core/vec3';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Key, Scene, Transform } from '../../model/scene.types';
import { channelAt } from '../../world/animation/interpolate';
import { type KeyRef, KeyTrack, isCyclic, isKeyPicked } from '../../world/animation/key-selection';
import { sceneFrames } from '../../world/group-pose';
import { framePoint } from '../../world/group-transform';
import { chain, coverItems, groupIndex } from '../../world/group-tree';
import { WIRE } from './wire.constants';
import type { WireProjector } from './wireframe';

/**
 * Motion paths, as Bryce 3D drew them: the route of every animated
 * object (and of the camera, seen from another view) as a dotted line, with a
 * square at each key and the owner's name beside the first one. Squares are
 * handles: the scene window picks and drags them; picked keys show filled yellow.
 * A keyed group has a path of its own, named after it. Paths inside a group are
 * drawn where the group is now, so they travel with it. With a keyed group
 * selected its path is the bold one; what moves inside it shows faintly.
 */

/** A key square on screen, for picking. */
export interface KeyHandle {
  readonly track: KeyTrack;
  /** Object or group id, or '' for the camera. */
  readonly id: string;
  /** Whose path it is: the object's or group's name, or Camera. */
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
  /** Paths inside a selected keyed group: there, but quiet. */
  faint: 'rgba(208, 32, 42, 0.32)',
  keyFaint: 2,
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
  /** The owner's name beside the first key. */
  readonly tag: boolean;
}

/** How one track is drawn: the space its keys live in, whether it loops, its look. */
interface TrackDraw {
  readonly frame: Transform | null;
  readonly loop: boolean;
  readonly style: PathStyle;
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
  g: CanvasRenderingContext2D, proj: WireProjector, scene: Scene, keys: readonly Key<T>[], local: (v: T) => Vec3,
  how: TrackDraw, handle: Pick<KeyHandle, 'track' | 'id' | 'owner'>, picked: readonly KeyRef[], out: KeyHandle[],
): void {
  if (keys.length < 2) return;
  const a = scene.animation;
  const { frame, style } = how;
  const read = frame ? (v: T) => framePoint(frame, local(v)) : local;
  const first = keys[0].time;
  const last = keys[keys.length - 1].time;
  const n = Math.min(PATH.maxSamples, Math.max(2, Math.ceil((last - first) * PATH.perSecond)));
  g.strokeStyle = style.color;
  g.setLineDash(style.dash as number[]);
  g.lineWidth = PATH.width;
  g.beginPath();
  let prev: Vec3 | null = null;
  for (let i = 0; i <= n; i++) {
    const p = proj.view(positionAt(keys, first + ((last - first) * i) / n, read, how.loop));
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
  if (tagAt && style.tag) drawTag(g, handle.owner, tagAt[0], tagAt[1], style.color);
}

enum Emphasis {
  Normal = 0,
  Faint = 1,
  Selected = 2,
}

const STYLES: Readonly<Record<Emphasis, PathStyle>> = {
  [Emphasis.Normal]: { color: PATH.color, key: PATH.key, dash: PATH.dash, tag: true },
  [Emphasis.Faint]: { color: PATH.faint, key: PATH.keyFaint, dash: PATH.dash, tag: false },
  [Emphasis.Selected]: { color: PATH.selected, key: PATH.keySelected, dash: PATH.dash, tag: true },
};

interface PathJob {
  readonly emphasis: Emphasis;
  readonly keys: readonly Key<Transform>[];
  readonly draw: TrackDraw;
  readonly handle: Pick<KeyHandle, 'track' | 'id' | 'owner'>;
}

/** Every object and group path with its look: a selected keyed group bold, what moves inside it faint. */
function pathJobs(scene: Scene, selection: ReadonlySet<string>): PathJob[] {
  const a = scene.animation;
  const frame = sceneFrames(scene);
  const index = groupIndex(scene);
  const keyed = (id: GroupId) => (a.groups?.[id]?.length ?? 0) > 1;
  const whole = selection.size ? coverItems(scene, selection as ReadonlySet<ObjectId>).groups : [];
  const loud = new Set(whole.filter(keyed));
  // Inside a selected group that moves on its own path, the paths of its parts are quiet.
  const quiet = (parent: GroupId | null) => chain(index, parent).some((g) => loud.has(g));
  const jobs: PathJob[] = [];
  for (const [id, keys] of Object.entries(a.groups ?? {})) {
    const node = index.get(id as GroupId);
    if (!node) continue;
    const emphasis = loud.has(node.id) ? Emphasis.Selected : quiet(node.parentId) ? Emphasis.Faint : Emphasis.Normal;
    const draw = { frame: frame(node.parentId), loop: a.loop || isCyclic(a, KeyTrack.Group, id), style: STYLES[emphasis] };
    jobs.push({ emphasis, keys, draw, handle: { track: KeyTrack.Group, id, owner: node.name } });
  }
  for (const [id, keys] of Object.entries(a.objects)) {
    const o = scene.objects.find((x) => x.id === id);
    if (!o || o.hidden) continue;
    const emphasis = !selection.has(id) ? Emphasis.Normal : quiet(o.groupId) ? Emphasis.Faint : Emphasis.Selected;
    const draw = { frame: frame(o.groupId), loop: a.loop || isCyclic(a, KeyTrack.Object, id), style: STYLES[emphasis] };
    jobs.push({ emphasis, keys, draw, handle: { track: KeyTrack.Object, id, owner: o.name } });
  }
  // Louder paths last: drawn on top, and their squares win a pick.
  return jobs.sort((x, y) => x.emphasis - y.emphasis);
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
  for (const job of pathJobs(scene, selection)) {
    if (opts.overRender && job.emphasis === Emphasis.Normal) continue;
    drawPath(g, proj, scene, job.keys, (v) => v.position, job.draw, job.handle, picked, out);
  }
  if (opts.camera) {
    const draw = { frame: null, loop: a.loop || isCyclic(a, KeyTrack.Camera, ''), style: { color: PATH.camera, key: PATH.keySelected, dash: PATH.cameraDash, tag: true } };
    drawPath(g, proj, scene, a.camera, (c) => c.position, draw, { track: KeyTrack.Camera, id: '', owner: CAMERA_NAME }, picked, out);
  }
  g.restore();
  return out;
}

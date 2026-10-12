import type { Vec3 } from '../../core/vec3';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Key, Scene, Transform } from '../../model/scene.types';
import { channelAt } from '../../world/animation/interpolate';
import { type KeyRef, KeyTrack, isCyclic, isKeyPicked, sameKey } from '../../world/animation/key-selection';
import { sceneFrames } from '../../world/group-pose';
import { framePoint } from '../../world/group-transform';
import { chain, coverItems, groupIndex } from '../../world/group-tree';
import { Tone, tonedTable } from '../tone';
import { WIRE, WIRE_TONES } from './wire.constants';
import type { WireProjector } from './wireframe';

/**
 * Motion paths, as Bryce 3D drew them: the route of every animated
 * object (and of the camera, seen from another view) as a dotted line, with a
 * square at each key and the owner's name beside the first one. Squares are
 * handles: the scene window picks and drags them; picked keys show filled yellow.
 * A keyed group has a path of its own, named after it. Paths inside a group are
 * drawn where the group is now, so they travel with it. With a keyed group
 * selected its path is the bold one; what moves inside it shows faintly.
 * The camera's keys are little cameras, not squares. The key under the pointer
 * is ringed and shows its number and time; while a key is dragged its path is
 * the bold one and every other path fades.
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

const PATH_LIGHT = {
  color: 'rgba(40, 40, 40, 0.55)' as string,
  selected: WIRE_TONES[Tone.Light].selected,
  camera: '#1f7a7a' as string,
  dash: [2, 3],
  cameraDash: [6, 3],
  width: 1.2,
  key: 3,
  keySelected: 4,
  keyEdge: 'rgba(255,255,255,0.85)' as string,
  picked: '#ffd030',
  pickedEdge: '#2a2a2a',
  /** Paths inside a selected keyed group: there, but quiet. */
  faint: 'rgba(208, 32, 42, 0.32)' as string,
  keyFaint: 2,
  /** Path samples per second of animation, at most `maxSamples` per path. */
  perSecond: 12,
  maxSamples: 240,
} as const;
/** On dark chrome the dotted routes and the camera's path are drawn light, the key squares rimmed dark. */
const PATH_DARK: typeof PATH_LIGHT = {
  ...PATH_LIGHT,
  color: 'rgba(214, 212, 204, 0.62)',
  selected: WIRE_TONES[Tone.Dark].selected,
  camera: '#52cfca',
  keyEdge: 'rgba(16, 16, 18, 0.85)',
  faint: 'rgba(255, 79, 74, 0.36)',
};
const PATH = tonedTable({ [Tone.Light]: PATH_LIGHT, [Tone.Dark]: PATH_DARK });

/** The owner's tag beside the first key; a key's own tag (number and time) sits below it. */
const TAG_LIGHT = { font: 'bold 10px Geneva, Verdana, sans-serif', dx: 8, dy: -8, keyDy: 14, padX: 3, height: 13, back: 'rgba(255,255,255,0.78)' as string, baseline: 3.5 } as const;
const TAG = tonedTable({ [Tone.Light]: TAG_LIGHT, [Tone.Dark]: { ...TAG_LIGHT, back: 'rgba(22, 22, 24, 0.8)' } });
const CAMERA_NAME = 'Camera';
/** The ring round the key under the pointer or held. */
const RING = { color: '#ffb000', width: 2, gap: 4 } as const;
/** A camera key's marker: a body (share of the key size) with a lens on its right. */
const CAMERA_MARK = { body: 1.5, height: 1, lens: 1.2 } as const;
const SECONDS_DIGITS = 1;

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

function drawTag(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, dy: number = TAG.dy): void {
  g.font = TAG.font;
  const w = g.measureText(text).width + TAG.padX * 2;
  const left = x + TAG.dx;
  const mid = y + dy;
  g.fillStyle = TAG.back;
  g.fillRect(left, mid - TAG.height / 2, w, TAG.height);
  g.fillStyle = color;
  g.fillText(text, left + TAG.padX, mid + TAG.baseline);
}

/** A key's marker: a square, or a little camera for the camera's keys. */
function drawMarker(g: CanvasRenderingContext2D, camera: boolean, x: number, y: number, r: number): void {
  if (!camera) {
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.strokeRect(x - r + 0.5, y - r + 0.5, r * 2 - 1, r * 2 - 1);
    return;
  }
  const w = r * CAMERA_MARK.body;
  const h = r * CAMERA_MARK.height;
  const lens = r * CAMERA_MARK.lens;
  g.beginPath();
  g.rect(x - w - lens / 2, y - h, w * 2, h * 2);
  g.moveTo(x + w - lens / 2, y);
  g.lineTo(x + w + lens / 2, y - h);
  g.lineTo(x + w + lens / 2, y + h);
  g.closePath();
  g.fill();
  g.stroke();
}

/** The key under the pointer, or held: ringed, with its number and time beside it. */
function drawKeyFocus(g: CanvasRenderingContext2D, x: number, y: number, r: number, index: number, time: number): void {
  g.strokeStyle = RING.color;
  g.lineWidth = RING.width;
  g.beginPath();
  g.arc(x, y, r + RING.gap, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 1;
  drawTag(g, `Key ${index + 1} · ${time.toFixed(SECONDS_DIGITS)} s`, x, y, PATH.pickedEdge, TAG.keyDy);
}

/** How the scene window wants a key shown: under the pointer, or held by a drag. */
export interface KeyFocus {
  readonly ref: KeyRef;
  readonly held: boolean;
}

function drawPath<T>(
  g: CanvasRenderingContext2D, proj: WireProjector, scene: Scene, keys: readonly Key<T>[], local: (v: T) => Vec3,
  how: TrackDraw, handle: Pick<KeyHandle, 'track' | 'id' | 'owner'>, picked: readonly KeyRef[], out: KeyHandle[], focus: KeyFocus | null = null,
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
  let focused: { x: number; y: number; r: number; index: number; time: number } | null = null;
  const camera = handle.track === KeyTrack.Camera;
  for (const [index, k] of keys.entries()) {
    const world = read(k.value);
    const v = proj.view(world);
    if (!proj.basis.ortho && v[2] < WIRE.nearPlane) continue;
    const [x, y] = proj.screen(v);
    const ref = { ...handle, time: k.time };
    const on = isKeyPicked(picked, ref, a.fps);
    const lit = !!focus && sameKey(focus.ref, ref, a.fps);
    const r = (on ? style.key + 1 : style.key) + (lit && focus?.held ? 1 : 0);
    g.fillStyle = on || (lit && focus?.held) ? PATH.picked : style.color;
    g.strokeStyle = on ? PATH.pickedEdge : PATH.keyEdge;
    drawMarker(g, camera, x, y, r);
    out.push({ ...handle, time: k.time, world, x, y });
    tagAt ??= [x, y];
    if (lit) focused = { x, y, r, index, time: k.time };
  }
  if (tagAt && style.tag) drawTag(g, handle.owner, tagAt[0], tagAt[1], style.color);
  if (focused) drawKeyFocus(g, focused.x, focused.y, focused.r, focused.index, focused.time);
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
  opts: { camera: boolean; overRender: boolean; keys?: readonly KeyRef[]; focus?: KeyFocus | null; cameraSelected?: boolean },
): KeyHandle[] {
  const out: KeyHandle[] = [];
  const a = scene.animation;
  const picked = opts.keys ?? [];
  const focus = opts.focus ?? null;
  // A key held: its path is the bold one, every other path fades.
  const held = focus?.held ? focus.ref : null;
  const mine = (job: Pick<PathJob, 'handle'>) => !!held && held.track === job.handle.track && held.id === job.handle.id;
  g.save();
  for (const job of pathJobs(scene, selection)) {
    if (opts.overRender && job.emphasis === Emphasis.Normal && !mine(job)) continue;
    const draw = held ? { ...job.draw, style: STYLES[mine(job) ? Emphasis.Selected : Emphasis.Faint] } : job.draw;
    drawPath(g, proj, scene, job.keys, (v) => v.position, draw, job.handle, picked, out, focus);
  }
  if (opts.camera) {
    const handle = { track: KeyTrack.Camera, id: '', owner: CAMERA_NAME };
    const color = held && !mine({ handle }) ? PATH.faint : opts.cameraSelected || mine({ handle }) ? PATH.selected : PATH.camera;
    const draw = { frame: null, loop: a.loop || isCyclic(a, KeyTrack.Camera, ''), style: { color, key: PATH.keySelected, dash: PATH.cameraDash, tag: true } };
    drawPath(g, proj, scene, a.camera, (c) => c.position, draw, handle, picked, out, focus);
  }
  g.restore();
  return out;
}

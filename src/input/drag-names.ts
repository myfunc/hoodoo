import type { GroupId } from '../model/scene.ids';
import type { Scene } from '../model/scene.types';
import { EVEN_AXIS, GizmoKind, type GizmoPart } from '../render/wire/gizmo';
import type { KeyHandle } from '../render/wire/motion-paths';
import { KeyTrack, trackKeys } from '../world/animation/key-selection';
import { sameTime } from '../world/animation/keying';
import { type Doing, type EditorStore, IDLE_HINT } from '../world/editor-store';
import { groupIndex } from '../world/group-tree';
import { RIG_NAMES, rigFlags, sunReadout } from '../world/rig';
import { Rig, type World } from '../world/world';

/**
 * What a drag in the scene window moves, named: the tag beside the pointer says it
 * in one line ("Moving key 2 of Blue Egg · 2.0 s", "Camera · orbit", "Sun ·
 * azimuth 40° · altitude 34°") and the hint line in its short form, so it is
 * never a guess whether the view or an object is moving.
 */

/** How the camera is being moved. */
export enum CameraMove {
  Move = 'move',
  Aim = 'aim',
  Orbit = 'orbit',
  Pan = 'pan',
  Dolly = 'dolly',
  Walk = 'walk',
  Fly = 'fly',
}

const SECONDS_DIGITS = 1;
const AXIS_NAMES = ['X', 'Y', 'Z'] as const;
const LOCKED_TEXT = 'unlock it in the scene list';

const join = (...parts: readonly string[]): string => parts.filter(Boolean).join(' · ');

/** With animation on and the playhead past zero an edit is a key: say where. */
function keyedAt(scene: Scene, time: number): string {
  const a = scene.animation;
  return a.enabled && time > 0.5 / a.fps ? `key at ${time.toFixed(SECONDS_DIGITS)} s` : '';
}

/** The selection by name: one object, one whole group, else a count. */
function selectionName(world: World): string {
  const items = world.selectedItems();
  if (items.objects.length === 1 && !items.groups.length) return world.object(items.objects[0])?.name ?? '';
  if (items.groups.length === 1 && !items.objects.length) return `group ${groupIndex(world.scene).get(items.groups[0] as GroupId)?.name ?? ''}`.trim();
  return `${items.objects.length + items.groups.length} items`;
}

/** The selection being dragged. */
export function movingName(world: World): Doing {
  const who = selectionName(world);
  const at = keyedAt(world.scene, world.time);
  return { title: who, text: join('moving', at), line: join(`Moving ${who}`, at) };
}

/** A handle of the selection: moving along an axis, resizing or turning. */
export function handleName(world: World, part: GizmoPart): Doing {
  const who = selectionName(world);
  const axis = AXIS_NAMES[part.axis] ?? '';
  let what = `moving along ${axis}`;
  if (part.kind === GizmoKind.Rotate) what = `turning about ${axis}`;
  else if (part.kind === GizmoKind.Resize) what = part.axis === EVEN_AXIS ? 'resizing' : `stretching along ${axis}`;
  const at = keyedAt(world.scene, world.time);
  return { title: who, text: join(what, at), line: join(`${who}: ${what}`, at) };
}

/** A motion-path key: its number on its track, whose it is and its time. */
export function keyName(scene: Scene, h: Pick<KeyHandle, 'track' | 'id' | 'owner' | 'time'>, count = 1): Doing {
  const a = scene.animation;
  const index = trackKeys(a, h.track, h.id).findIndex((k) => sameTime(k.time, h.time, a.fps));
  const owner = h.track === KeyTrack.Camera ? RIG_NAMES[Rig.Camera] : h.owner;
  const keys = count > 1 ? `${count} keys` : `key ${index + 1}`;
  const when = `${h.time.toFixed(SECONDS_DIGITS)} s`;
  return { title: owner, text: join(keys, when), line: join(`Moving ${keys} of ${owner}`, when) };
}

function lockedName(rig: Rig): Doing {
  return { title: 'Locked', text: `${RIG_NAMES[rig]}: ${LOCKED_TEXT}`, line: join(`${RIG_NAMES[rig]} locked`, LOCKED_TEXT) };
}

/** The scene camera: how it moves, where it is keyed; a locked one says so instead. */
export function cameraName(world: World, how: CameraMove): Doing {
  if (rigFlags(world.scene, Rig.Camera).locked) return lockedName(Rig.Camera);
  const name = RIG_NAMES[Rig.Camera];
  const text = join(how, keyedAt(world.scene, world.time));
  return { title: name, text, line: join(name, text) };
}

/** Orbit, pan, dolly or walk in the Camera view name the camera only when it is selected, keyed or locked: then it is an edit. */
export function cameraNavName(world: World, how: CameraMove): Doing | null {
  const s = world.scene;
  const keyed = s.animation.enabled && s.animation.camera.length > 0;
  return world.rig === Rig.Camera || keyed || rigFlags(s, Rig.Camera).locked ? cameraName(world, how) : null;
}

export function sunName(world: World): Doing {
  if (rigFlags(world.scene, Rig.Sun).locked) return lockedName(Rig.Sun);
  const name = RIG_NAMES[Rig.Sun];
  const text = join(sunReadout(world.scene.sky), keyedAt(world.scene, world.time));
  return { title: name, text, line: join(name, text) };
}

/** The tag and the hint line name the drag (`hint` false: the tag only, the hint line is the handle's own). */
export function showDoing(editor: EditorStore, doing: Doing, hint = true): void {
  const was = editor.state.doing;
  if (was && was.line === doing.line && was.title === doing.title && was.text === doing.text) return;
  editor.update(hint ? { doing, hint: doing } : { doing });
}

/** The drag is over: the tag goes, and the hint line if it still names the drag. */
export function clearDoing(editor: EditorStore): void {
  const was = editor.state.doing;
  if (!was) return;
  editor.update(editor.state.hint === was ? { doing: null, hint: { title: IDLE_HINT.title, text: '' } } : { doing: null });
}

import type { CreateEntry } from '../assets/object.catalog';
import type { LibraryObject } from '../assets/object.library';
import type { GameItem } from '../assets/games.library';
import { buildGameItem } from '../world/game-sets';
import { createEntry } from '../assets/object.catalog';
import { randomSeed } from '../core/rng';
import { type Vec3, add } from '../core/vec3';
import { type MyObject, buildMyObject, itemOf, saveMyObject } from '../io/my-objects';
import { ViewKind } from '../model/scene.enums';
import type { Camera, Scene } from '../model/scene.types';
import type { SceneView } from '../render/viewport';
import { boxSphere, unionBox, worldBox } from '../world/bounds';
import { frameSphere, pivotOf } from '../world/camera-math';
import type { EditorStore } from '../world/editor-store';
import { INFINITE_KINDS, createObject } from '../world/objects.factory';
import type { World } from '../world/world';
import { FRAME_MARGIN, MAX_PIVOT_DISTANCE } from './app.constants';

/** Where new objects appear: under the point the camera looks at (Bryce used the world centre). */
export function dropPoint(camera: Camera): [number, number] {
  const p = pivotOf(camera);
  const d = Math.hypot(p[0], p[2]);
  return d > MAX_PIVOT_DISTANCE ? [0, 0] : [p[0], p[2]];
}

export function createFromPalette(world: World, entry: CreateEntry): void {
  const obj = createObject(entry, { seed: randomSeed() });
  const [x, z] = INFINITE_KINDS.has(entry.kind) ? [0, 0] : dropPoint(world.scene.camera);
  const p = obj.transform.position;
  world.addObjects([{ ...obj, transform: { ...obj.transform, position: [p[0] + x, p[1], p[2] + z] } }], `Create ${entry.label}`);
}

export function createFromLibrary(world: World, lib: LibraryObject): void {
  const obj = createObject(createEntry('terrain'), { seed: randomSeed(), recipe: lib.recipe, size: lib.size, material: lib.material, name: lib.name });
  const [x, z] = dropPoint(world.scene.camera);
  world.addObjects([{ ...obj, transform: { ...obj.transform, position: [x, lib.size[1], z] } }], `Create ${lib.name}`);
}

/** A Chess & Billiards item under the camera's aim; a set comes as one named group. */
export function createGameItem(world: World, item: GameItem): void {
  const [x, z] = dropPoint(world.scene.camera);
  const { objects, groups } = buildGameItem(item, x, z);
  world.addObjects(objects, `Create ${item.name}`, groups);
}

/** One of My Objects under the camera's aim: its objects, groups and welds, one History step. */
export function createMyObject(world: World, item: MyObject): void {
  const [x, z] = dropPoint(world.scene.camera);
  const { objects, groups, joints } = buildMyObject(item);
  const label = `Create ${item.name}`;
  world.beginGesture(label);
  world.addObjects(objects.map((o) => ({ ...o, transform: { ...o.transform, position: add(o.transform.position, [x, 0, z]) } })), label, groups);
  if (joints.length) world.setJoints([...(world.scene.joints ?? []), ...joints], label);
  world.endGesture();
}

/** The selection, with the groups it is in and what is welded to it, into My Objects under its group's or object's name. */
export function saveSelectionToMyObjects(world: World): MyObject | null {
  const scene = world.scene;
  const parts = [...world.selection].map((id) => itemOf(scene, id));
  const unique = <T extends { id: string }>(xs: T[]) => [...new Map(xs.map((v) => [v.id, v])).values()];
  const part = { objects: unique(parts.flatMap((p) => p.objects)), groups: unique(parts.flatMap((p) => p.groups)), joints: unique(parts.flatMap((p) => p.joints)) };
  const top = part.groups.find((g) => g.parentId === null);
  const name = top?.name ?? (part.objects.length === 1 ? part.objects[0].name : `${part.objects[0]?.name ?? 'Object'} and more`);
  return part.objects.length ? saveMyObject(name, part) : null;
}

/** Frames the selection (or everything) in the active view. */
export function frame(world: World, editor: EditorStore, view: SceneView, selectionOnly: boolean): void {
  // Edit Group: Frame Scene frames the group.
  const scene: Scene = world.viewScene;
  const objs = scene.objects.filter((o) => !o.hidden && !INFINITE_KINDS.has(o.kind) && (!selectionOnly || world.selection.has(o.id)));
  const box = unionBox(objs.map(worldBox));
  if (!box) return;
  const sphere = boxSphere(box);
  const kind = editor.state.view;
  const r = sphere.radius * FRAME_MARGIN;
  if (kind === ViewKind.Camera) world.setCamera(frameSphere(scene.camera, sphere.center, r), 'Frame');
  else if (kind === ViewKind.Director) editor.update({ director: frameSphere(editor.state.director, sphere.center, r) });
  else world.setView(kind, { center: sphere.center as Vec3, span: r * 2 });
  view.requestDraw();
}

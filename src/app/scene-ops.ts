import type { CreateEntry } from '../assets/object.catalog';
import type { LibraryObject } from '../assets/object.library';
import { createEntry } from '../assets/object.catalog';
import { randomSeed } from '../core/rng';
import type { Vec3 } from '../core/vec3';
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
function dropPoint(camera: Camera): [number, number] {
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

/** Frames the selection (or everything) in the active view. */
export function frame(world: World, editor: EditorStore, view: SceneView, selectionOnly: boolean): void {
  const scene: Scene = world.scene;
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

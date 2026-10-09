import { Bus } from '../core/bus';
import { Logger } from '../core/log';
import { add } from '../core/vec3';
import type { ViewKind } from '../model/scene.enums';
import { type GroupId, type ObjectId, newGroupId, newObjectId } from '../model/scene.ids';
import type { Camera, DocumentSetup, Material, OrthoView, Scene, SceneObject, Sky } from '../model/scene.types';
import { History } from './history';
import { limitBreach } from './scene-limits';
import { COPY_SUFFIX, DUPLICATE_OFFSET, HISTORY_LIMIT } from './world.constants';
import { ChangeKind, type WorldEvents } from './world.events';
import { SelectMode } from './world.enums';

export { SelectMode } from './world.enums';

/**
 * READ ME — the only place the scene changes.
 * Scenes are immutable snapshots; every method builds a new one and records it.
 * Between beginGesture and endGesture all edits amend one history entry,
 * so a whole drag is a single undo step. Selection is not part of history.
 */
export class World {
  readonly events = new Bus<WorldEvents>();
  private readonly logger = Logger.create('World');
  private readonly history: History<Scene>;
  private selected = new Set<ObjectId>();
  private gesture: string | null = null;
  private gestureOpened = false;
  private clipboard: readonly SceneObject[] = [];
  private materialClipboard: Material | null = null;

  constructor(initial: Scene) {
    this.history = new History(initial, 'Open scene', HISTORY_LIMIT);
  }

  get scene(): Scene {
    return this.history.current;
  }

  get selection(): ReadonlySet<ObjectId> {
    return this.selected;
  }

  selectedObjects(): SceneObject[] {
    return this.scene.objects.filter((o) => this.selected.has(o.id));
  }

  object(id: ObjectId): SceneObject | undefined {
    return this.scene.objects.find((o) => o.id === id);
  }

  load(scene: Scene, label: string): void {
    this.history.reset(label, scene);
    this.selected = new Set();
    this.logger.info('scene loaded', { label, objects: scene.objects.length });
    this.emitAll(ChangeKind.All);
  }

  /** Swaps the whole scene as an undoable step (New, Open, demo, shared link). */
  replaceScene(scene: Scene, label: string): void {
    this.endGesture();
    this.commit(label, scene, ChangeKind.All);
    this.selected = new Set();
    this.events.emit('selection', { ids: this.selected });
  }

  /** Re-entering the gesture that is already open keeps amending the same entry. */
  beginGesture(label: string): void {
    if (this.gesture === label) return;
    this.gesture = label;
    this.gestureOpened = false;
  }

  get inGesture(): boolean {
    return this.gesture !== null;
  }

  endGesture(): void {
    this.gesture = null;
    this.gestureOpened = false;
  }

  addObjects(objects: readonly SceneObject[], label: string): void {
    if (!this.commit(label, { ...this.scene, objects: [...this.scene.objects, ...objects] }, ChangeKind.Objects)) return;
    this.select(objects.map((o) => o.id), SelectMode.Replace);
  }

  removeObjects(ids: ReadonlySet<ObjectId>, label: string): void {
    const objects = this.scene.objects.filter((o) => !ids.has(o.id) || o.locked);
    if (objects.length === this.scene.objects.length) return;
    this.commit(label, { ...this.scene, objects }, ChangeKind.Objects);
    this.pruneSelection();
  }

  /** Applies fn to the given objects; locked objects are skipped unless `includeLocked`. */
  updateObjects(ids: ReadonlySet<ObjectId>, label: string, fn: (o: SceneObject) => SceneObject, includeLocked = false): void {
    let touched = false;
    const objects = this.scene.objects.map((o) => {
      if (!ids.has(o.id) || (o.locked && !includeLocked)) return o;
      touched = true;
      return fn(o);
    });
    if (touched) this.commit(label, { ...this.scene, objects }, ChangeKind.Objects);
  }

  setMaterial(ids: ReadonlySet<ObjectId>, material: Material, label = 'Material'): void {
    this.updateObjects(ids, label, (o) => ({ ...o, material }));
  }

  setSky(sky: Sky, label: string): void {
    this.commit(label, { ...this.scene, sky }, ChangeKind.Sky);
  }

  setCamera(camera: Camera, label: string): void {
    this.commit(label, { ...this.scene, camera }, ChangeKind.Camera);
  }

  setDocument(document: DocumentSetup): void {
    this.commit('Document setup', { ...this.scene, document }, ChangeKind.Document);
  }

  /** Orthographic pan and zoom are navigation, not edits: they amend the current entry. */
  setView(kind: ViewKind, view: OrthoView): void {
    const scene = { ...this.scene, views: { ...this.scene.views, [kind]: view } };
    this.history.amend(scene);
    this.events.emit('changed', { scene, kind: ChangeKind.Views });
  }

  setBookmark(slot: number, camera: Camera | null): void {
    const bookmarks = this.scene.bookmarks.map((b, i) => (i === slot ? camera : b));
    this.commit(camera ? 'Save camera' : 'Clear camera', { ...this.scene, bookmarks }, ChangeKind.Views);
  }

  group(ids: ReadonlySet<ObjectId>): GroupId | null {
    if (ids.size < 2) return null;
    const groupId = newGroupId();
    this.updateObjects(ids, 'Group', (o) => ({ ...o, groupId }), true);
    return groupId;
  }

  ungroup(ids: ReadonlySet<ObjectId>): void {
    const groups = new Set(this.scene.objects.filter((o) => ids.has(o.id)).map((o) => o.groupId));
    const members = new Set(this.scene.objects.filter((o) => o.groupId && groups.has(o.groupId)).map((o) => o.id));
    this.updateObjects(members, 'Ungroup', (o) => ({ ...o, groupId: null }), true);
  }

  /** Selecting one member of a group selects the whole family, like Bryce. */
  groupMembers(id: ObjectId): ObjectId[] {
    const obj = this.object(id);
    if (!obj?.groupId) return [id];
    return this.scene.objects.filter((o) => o.groupId === obj.groupId).map((o) => o.id);
  }

  duplicate(ids: ReadonlySet<ObjectId>, label = 'Duplicate'): void {
    const copies = this.cloneObjects(this.scene.objects.filter((o) => ids.has(o.id)));
    if (copies.length) this.addObjects(copies, label);
  }

  copy(ids: ReadonlySet<ObjectId>): void {
    this.clipboard = this.scene.objects.filter((o) => ids.has(o.id));
  }

  paste(): void {
    const copies = this.cloneObjects(this.clipboard);
    if (copies.length) this.addObjects(copies, 'Paste');
  }

  hasClipboard(): boolean {
    return this.clipboard.length > 0;
  }

  copyMaterial(id: ObjectId): void {
    this.materialClipboard = this.object(id)?.material ?? null;
  }

  pasteMaterial(ids: ReadonlySet<ObjectId>): void {
    if (this.materialClipboard) this.setMaterial(ids, this.materialClipboard, 'Paste material');
  }

  select(ids: readonly ObjectId[], mode: SelectMode): void {
    const next = mode === SelectMode.Replace ? new Set<ObjectId>() : new Set(this.selected);
    for (const id of ids) {
      if (mode === SelectMode.Toggle && next.has(id)) next.delete(id);
      else next.add(id);
    }
    this.selected = next;
    this.events.emit('selection', { ids: this.selected });
  }

  selectAll(): void {
    this.select(this.scene.objects.filter((o) => !o.hidden).map((o) => o.id), SelectMode.Replace);
  }

  /** History moves are refused while a drag is open: the drag would keep writing into the past. */
  canUndo(): boolean {
    return !this.inGesture && this.history.canUndo();
  }

  canRedo(): boolean {
    return !this.inGesture && this.history.canRedo();
  }

  undo(): void {
    if (this.canUndo()) this.jumpTo(this.history.position - 1);
  }

  redo(): void {
    if (this.canRedo()) this.jumpTo(this.history.position + 1);
  }

  jumpTo(position: number): void {
    if (this.inGesture) return;
    this.history.jump(position);
    this.pruneSelection();
    this.emitAll(ChangeKind.All);
  }

  historyState(): WorldEvents['history'] {
    return { labels: this.history.labels, position: this.history.position };
  }

  private cloneObjects(source: readonly SceneObject[]): SceneObject[] {
    const groupMap = new Map<GroupId, GroupId>();
    const offset = [DUPLICATE_OFFSET, 0, DUPLICATE_OFFSET] as const;
    return source.map((o) => {
      let groupId: GroupId | null = null;
      if (o.groupId) {
        groupId = groupMap.get(o.groupId) ?? newGroupId();
        groupMap.set(o.groupId, groupId);
      }
      return {
        ...o,
        id: newObjectId(),
        name: o.name.endsWith(COPY_SUFFIX) ? o.name : o.name + COPY_SUFFIX,
        groupId,
        locked: false,
        transform: { ...o.transform, position: add(o.transform.position, offset) },
      };
    });
  }

  /** Records the new scene; false (and a `refused` event) when it would exceed the scene limits. */
  private commit(label: string, scene: Scene, kind: ChangeKind): boolean {
    const breach = limitBreach(scene, this.scene);
    if (breach) {
      this.events.emit('refused', { reason: breach });
      return false;
    }
    if (this.gesture && this.gestureOpened) {
      this.history.amend(scene);
    } else {
      this.history.push(this.gesture ?? label, scene);
      this.gestureOpened = this.gesture !== null;
      this.events.emit('history', this.historyState());
    }
    this.events.emit('changed', { scene, kind });
    return true;
  }

  private pruneSelection(): void {
    const alive = new Set(this.scene.objects.map((o) => o.id));
    const next = new Set([...this.selected].filter((id) => alive.has(id)));
    if (next.size !== this.selected.size) {
      this.selected = next;
      this.events.emit('selection', { ids: this.selected });
    }
  }

  private emitAll(kind: ChangeKind): void {
    this.events.emit('changed', { scene: this.scene, kind });
    this.events.emit('selection', { ids: this.selected });
    this.events.emit('history', this.historyState());
  }
}

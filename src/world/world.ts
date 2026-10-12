import { Bus } from '../core/bus';
import { Logger } from '../core/log';
import { add } from '../core/vec3';
import type { ViewKind } from '../model/scene.enums';
import { type GroupId, type ObjectId, newGroupId, newObjectId } from '../model/scene.ids';
import type { Animation, BodyFlags, Camera, DocumentSetup, GroupNode, Material, OrthoView, RenderSetup, Scene, SceneObject, Sky } from '../model/scene.types';
import { frameTime, recordKeys, withKey, withPose } from './animation/keying';
import { poseAt } from './animation/pose';
import { repivoted, settled } from './group-edits';
import { localOf } from './group-pose';
import { IDENTITY } from './group-transform';
import { type TreeItems, cloneGroups, coverItems, dissolved, familyOf, freshGroupName, groupIndex, grouped, reparented, ungrouped, withEmptyGroup, withGroup, withGroups, withoutObjects } from './group-tree';
import { withGroupBody } from './body-flags';
import type { PlayScript } from '../model/play.types';
import { withScript } from './play/scripts';
import { History } from './history';
import { limitBreach } from './scene-limits';
import { relinkCopies } from './portals';
import { COPY_SUFFIX, DUPLICATE_OFFSET, HISTORY_LIMIT } from './world.constants';
import { ChangeKind, type WorldEvents } from './world.events';
import { Rig, SelectMode } from './world.enums';
import { lockedCamera, lockedSun, rigFlags, withRigFlags } from './rig';

export { Rig, SelectMode } from './world.enums';

/**
 * READ ME — the only place the scene changes.
 * Scenes are immutable snapshots; every method builds a new one and records it.
 * Between beginGesture and endGesture all edits amend one history entry,
 * so a whole drag is a single undo step. Selection is not part of history.
 * Animation: the playhead is session state; the current scene is always posed
 * at it, and edits become keys at the playhead (animation/keying). With
 * animation off the playhead rests at zero and the scene is a still.
 * Groups: an edit that moves a whole group moves the group itself (group-edits).
 * The camera or the sun can be selected instead of objects (world/rig): a selected
 * camera is keyed like an object, a locked one keeps its place and aim.
 */
export class World {
  readonly events = new Bus<WorldEvents>();
  private readonly logger = Logger.create('World');
  private readonly history: History<Scene>;
  private selected = new Set<ObjectId>();
  /** The camera or the sun, selected in place of objects. */
  private selectedRig: Rig | null = null;
  private gesture: string | null = null;
  private gestureOpened = false;
  private clipboard: readonly SceneObject[] = [];
  private clipboardGroups: ReadonlyMap<GroupId, GroupNode> = new Map();
  private materialClipboard: Material | null = null;
  private playhead = 0;
  /** The recorded scene while a preview is shown in its place (previewMaterial). */
  private previewBase: Scene | null = null;

  constructor(initial: Scene) {
    this.history = new History(initial, 'Open scene', HISTORY_LIMIT);
  }

  get scene(): Scene {
    return this.history.current;
  }

  get selection(): ReadonlySet<ObjectId> {
    return this.selected;
  }

  /** The camera or the sun when one of them is the selection, else null. */
  get rig(): Rig | null {
    return this.selectedRig;
  }

  /** Selects the camera or the sun (null: nothing); the objects are let go. */
  selectRig(rig: Rig | null): void {
    if (rig === this.selectedRig && !this.selected.size) return;
    this.selectedRig = rig;
    this.selected = new Set();
    this.events.emit('selection', { ids: this.selected });
  }

  selectedObjects(): SceneObject[] {
    return this.scene.objects.filter((o) => this.selected.has(o.id));
  }

  object(id: ObjectId): SceneObject | undefined {
    return this.scene.objects.find((o) => o.id === id);
  }

  /** Seconds on the timeline. */
  get time(): number {
    return this.playhead;
  }

  /** Moves the playhead: the scene takes the pose at that frame. Navigation, not an edit. */
  setTime(t: number): void {
    const a = this.scene.animation;
    const time = a.enabled ? Math.min(a.duration, Math.max(0, frameTime(t, a.fps))) : 0;
    if (time === this.playhead) return;
    this.playhead = time;
    this.pose(ChangeKind.Time);
  }

  /**
   * Replaces the timeline (keys moved, added or removed, duration changed, on or off) and re-poses the scene.
   * `added`: objects and groups that come with the keys in the same undo step (Play's recorded plane).
   */
  setAnimation(animation: Animation, label: string, added?: { readonly objects: readonly SceneObject[]; readonly groups: readonly GroupNode[] }): void {
    // Switched off, the scene stays a still in its start pose.
    if (!animation.enabled) this.setTime(0);
    const base = added?.objects.length ? withGroups(this.scene, [...this.scene.objects, ...added.objects], [...(this.scene.groups ?? []), ...added.groups]) : this.scene;
    const scene = poseAt({ ...base, animation }, this.playhead);
    this.commit(label, scene, added?.objects.length ? ChangeKind.All : ChangeKind.Time, false);
    if (this.playhead > animation.duration) this.setTime(animation.duration);
  }

  /**
   * Add Key: whole groups key their own transform, single objects their pose
   * inside their group. A group keyed for the first time gets its pivot at its
   * centre (nothing moves), so it turns about its middle.
   */
  addKeys(items: TreeItems, label: string): void {
    let scene = this.scene;
    for (const g of items.groups) if (!scene.animation.groups?.[g]?.length) scene = repivoted(scene, g);
    const a = scene.animation;
    const t = frameTime(this.playhead, a.fps);
    const index = groupIndex(scene);
    const groups = { ...(a.groups ?? {}) };
    for (const g of items.groups) groups[g] = withKey(groups[g] ?? [], t, index.get(g)?.transform ?? IDENTITY, a.fps);
    const objects = { ...a.objects };
    for (const o of scene.objects.filter((x) => items.objects.includes(x.id))) objects[o.id] = withPose(objects[o.id] ?? [], t, localOf(o), a.fps);
    const animation = { ...a, objects, ...(items.groups.length || a.groups ? { groups } : {}) };
    this.commit(label, poseAt({ ...scene, animation }, this.playhead), ChangeKind.Time, false);
  }

  load(scene: Scene, label: string): void {
    this.playhead = 0;
    this.history.reset(label, poseAt(scene, 0));
    this.selected = new Set();
    this.selectedRig = null;
    this.logger.info('scene loaded', { label, objects: scene.objects.length });
    this.emitAll(ChangeKind.All);
  }

  /** Swaps the whole scene as an undoable step (New, Open, demo, shared link). */
  replaceScene(scene: Scene, label: string): void {
    this.endGesture();
    this.playhead = 0;
    this.commit(label, poseAt(scene, 0), ChangeKind.All, false);
    this.selected = new Set();
    this.selectedRig = null;
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

  /** `groups` are new groups the objects point at (copies of nested groups). */
  addObjects(objects: readonly SceneObject[], label: string, groups: readonly GroupNode[] = []): void {
    const all = [...this.scene.objects, ...objects];
    const next = groups.length ? withGroups(this.scene, all, [...(this.scene.groups ?? []), ...groups]) : { ...this.scene, objects: all };
    if (!this.commit(label, next, ChangeKind.Objects)) return;
    this.select(objects.map((o) => o.id), SelectMode.Replace);
  }

  /** Locked objects stay; a group that loses every object goes with them. */
  removeObjects(ids: ReadonlySet<ObjectId>, label: string): void {
    const gone = new Set(this.scene.objects.filter((o) => ids.has(o.id) && !o.locked).map((o) => o.id));
    if (!gone.size) return;
    this.commit(label, withoutObjects(this.scene, gone), ChangeKind.Objects);
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

  /**
   * Shows `material` on the objects without recording it: no undo step, no key,
   * the redo list untouched (the material menu's hover). endPreview puts the
   * recorded scene back; end it before the next edit.
   */
  previewMaterial(ids: ReadonlySet<ObjectId>, material: Material): void {
    const base = (this.previewBase ??= this.scene);
    this.show({ ...base, objects: base.objects.map((o) => (ids.has(o.id) ? { ...o, material } : o)) });
  }

  endPreview(): void {
    const base = this.previewBase;
    this.previewBase = null;
    if (base) this.show(base);
  }

  private show(scene: Scene): void {
    this.history.amend(scene);
    this.events.emit('changed', { scene, kind: ChangeKind.Objects });
  }

  /** A locked sun keeps its direction (world/rig). */
  setSky(sky: Sky, label: string): void {
    const next = rigFlags(this.scene, Rig.Sun).locked ? lockedSun(this.scene.sky, sky) : sky;
    if (sameJson(next, this.scene.sky)) return;
    this.commit(label, { ...this.scene, sky: next }, ChangeKind.Sky);
  }

  /** A locked camera keeps its place and aim (world/rig); false when nothing changed. */
  setCamera(camera: Camera, label: string): boolean {
    const next = rigFlags(this.scene, Rig.Camera).locked ? lockedCamera(this.scene.camera, camera) : camera;
    if (sameJson(next, this.scene.camera)) return false;
    return this.commit(label, { ...this.scene, camera: next }, ChangeKind.Camera);
  }

  /** The camera's or the sun's eye or lock in the scene list. */
  setRigFlags(rig: Rig, patch: { hidden?: boolean; locked?: boolean }, label: string): void {
    this.commit(label, withRigFlags(this.scene, rig, patch), rig === Rig.Camera ? ChangeKind.Camera : ChangeKind.Sky, false);
  }

  setDocument(document: DocumentSetup): void {
    this.commit('Document setup', { ...this.scene, document }, ChangeKind.Document);
  }

  /** The final render's options (Render Options): one undo step, never keyed. */
  setRenderSetup(render: RenderSetup | undefined, label = 'Render options'): void {
    if (sameJson(render, this.scene.render)) return;
    const { render: _previous, ...rest } = this.scene;
    this.commit(label, render ? { ...rest, render } : rest, ChangeKind.Document, false);
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

  /**
   * Bryce's Group: the selected objects form one flat group. With `nested` (the
   * Object Tree preview) whole groups in the selection go inside the new group,
   * which sits in their common parent.
   */
  group(ids: ReadonlySet<ObjectId>, nested = false): GroupId | null {
    if (nested) {
      const id = newGroupId();
      const next = grouped(this.scene, ids, id, freshGroupName(this.scene));
      return next && this.commit('Group', next, ChangeKind.Objects) ? id : null;
    }
    if (ids.size < 2) return null;
    const groupId = newGroupId();
    this.updateObjects(ids, 'Group', (o) => ({ ...o, groupId }), true);
    return groupId;
  }

  /** Dissolves the selected groups; what they held moves up one level (to the top in a flat scene). */
  ungroup(ids: ReadonlySet<ObjectId>): void {
    const next = ungrouped(this.scene, ids);
    if (next) this.commit('Ungroup', next, ChangeKind.Objects);
  }

  /**
   * Object Tree: a named group around the selection (one item is enough), or an
   * empty group inside `parent` when nothing is selected. Empty groups stay until
   * they are deleted (Ungroup), so they can be filled by dragging rows in.
   */
  newGroup(ids: ReadonlySet<ObjectId>, parent: GroupId | null = null): GroupId | null {
    const id = newGroupId();
    const name = freshGroupName(this.scene);
    const next = ids.size ? grouped(this.scene, ids, id, name, 1) : withEmptyGroup(this.scene, id, name, parent);
    return next && this.commit('New group', next, ChangeKind.Objects) ? id : null;
  }

  /** Dissolves these groups, empty ones included; what they held moves up one level. */
  ungroupGroups(groups: ReadonlySet<GroupId>): void {
    const next = dissolved(this.scene, groups);
    if (next) this.commit('Ungroup', next, ChangeKind.Objects);
  }

  /** The whole groups the selection is made of (outermost), and the single objects beside them. */
  selectedItems(): TreeItems {
    return coverItems(this.scene, this.selected);
  }

  /** Selecting one member of a group selects the whole family, like Bryce: the outermost group with all inside. */
  groupMembers(id: ObjectId): ObjectId[] {
    return familyOf(this.scene, id);
  }

  /** Moves objects and groups into a group, or to the top level with null; false when refused (a loop, too deep). */
  reparent(items: TreeItems, target: GroupId | null): boolean {
    const next = reparented(this.scene, items, target);
    return next !== null && this.commit(target ? 'Move into group' : 'Move out of groups', next, ChangeKind.Objects);
  }

  renameGroup(id: GroupId, name: string): void {
    this.commit('Rename group', withGroup(this.scene, id, { name }), ChangeKind.Objects);
  }

  /** Play: a physical group is one rigid body (solid always); one undo step. */
  setGroupBody(id: GroupId, patch: Partial<BodyFlags>): void {
    const index = groupIndex(this.scene);
    const node = index.get(id);
    if (!node) return;
    index.set(id, withGroupBody(node, patch));
    this.commit('Physics', withGroups(this.scene, this.scene.objects, index.values()), ChangeKind.Objects);
  }

  /** Play: the group's own clip and behaviours (world/play/scripts.ts); one undo step. */
  setGroupScript(id: GroupId, label: string, patch: (s: PlayScript) => PlayScript): void {
    const index = groupIndex(this.scene);
    const node = index.get(id);
    if (!node) return;
    index.set(id, withScript(node, patch));
    this.commit(label, withGroups(this.scene, this.scene.objects, index.values()), ChangeKind.Objects);
  }

  /** Folding a group in the scene list is navigation: it amends the current entry quietly, so the render keeps refining. */
  setGroupCollapsed(id: GroupId, collapsed: boolean): void {
    this.history.amend(withGroup(this.scene, id, { collapsed }));
  }

  duplicate(ids: ReadonlySet<ObjectId>, label = 'Duplicate'): void {
    const { objects, groups } = this.cloneObjects(this.scene.objects.filter((o) => ids.has(o.id)), groupIndex(this.scene));
    if (objects.length) this.addObjects(objects, label, groups);
  }

  copy(ids: ReadonlySet<ObjectId>): void {
    this.clipboard = this.scene.objects.filter((o) => ids.has(o.id));
    this.clipboardGroups = groupIndex(this.scene);
  }

  paste(): void {
    const { objects, groups } = this.cloneObjects(this.clipboard, this.clipboardGroups);
    if (objects.length) this.addObjects(objects, 'Paste', groups);
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
    this.selectedRig = null;
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
    // An older entry was posed at another time: show it at the playhead (zero when it is a still).
    const a = this.history.current.animation;
    if (!a.enabled) this.playhead = 0;
    this.history.amend(poseAt(this.history.current, Math.min(this.playhead, a.duration)));
    this.pruneSelection();
    this.emitAll(ChangeKind.All);
  }

  historyState(): WorldEvents['history'] {
    return { labels: this.history.labels, position: this.history.position };
  }

  /** Copies go into fresh groups that mirror the groups around the originals. */
  private cloneObjects(source: readonly SceneObject[], index: ReadonlyMap<GroupId, GroupNode>): { objects: SceneObject[]; groups: GroupNode[] } {
    const { map, nodes } = cloneGroups(index, source, newGroupId);
    const offset = [DUPLICATE_OFFSET, 0, DUPLICATE_OFFSET] as const;
    const objects = source.map((o) => ({
      ...o,
      id: newObjectId(),
      name: o.name.endsWith(COPY_SUFFIX) ? o.name : o.name + COPY_SUFFIX,
      groupId: o.groupId ? (map.get(o.groupId) ?? null) : null,
      locked: false,
      transform: { ...o.transform, position: add(o.transform.position, offset) },
    }));
    return { objects: relinkCopies(source, objects), groups: nodes };
  }

  private pose(kind: ChangeKind): void {
    const scene = poseAt(this.scene, this.playhead);
    this.history.amend(scene);
    this.events.emit('changed', { scene, kind });
  }

  /**
   * Records the new scene; false (and a `refused` event) when it would exceed the scene limits.
   * Edits are auto-keyed at the playhead; whole-scene swaps and timeline edits are not
   * (they arrive posed). An edit is first read through the groups: a whole group
   * moved is a move of the group (group-edits).
   */
  private commit(label: string, next: Scene, kind: ChangeKind, keyed = true): boolean {
    let scene = next;
    if (keyed) {
      const edit = settled(this.scene, next);
      scene = recordKeys(edit.before, edit.after, this.playhead, edit.keyed, this.selectedRig === Rig.Camera);
    }
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

const sameJson = <T>(a: T, b: T): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

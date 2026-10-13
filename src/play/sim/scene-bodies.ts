import { type Vec3, ZERO3, add, scale, sub } from '../../core/vec3';
import { BooleanMode, ShapeKind } from '../../model/scene.enums';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Key, Scene, SceneObject, Transform } from '../../model/scene.types';
import { bodyOf, groupBody, massOf } from '../../world/body-flags';
import { chain, groupIndex } from '../../world/group-tree';
import { sameTransform } from '../../world/group-transform';
import { movedByScript, shownByRules } from '../../world/play/scripts';
import { ALL_LAYERS, type BodyId, Layer, Motion, type Physics, type Pose } from './physics';
import { type Quat, conjQ, eulerOfQuat, mulQ, quatOfEuler, rotateQ } from './quat';
import { ShapeType, placedShapes, shapesOf } from './shapes';

/**
 * READ ME — the scene as bodies. Each solid object becomes a body: Fixed, or
 * Kinematic when keys move it (its group's or its own: platforms carry the
 * player), or Dynamic when it is Physical. A Physical group is one dynamic body
 * made of its members' shapes. Negative and Intersect members of a boolean
 * group do not collide (the carved solid is approximated by its positives);
 * hidden objects do not either, unless keys or a rule show them: an object
 * whose visibility is keyed collides while the keys show it (`drive`). Water
 * that is not solid has a floor half the player's height below it, so the
 * player wades. `transforms` turns body poses back into the objects' world
 * transforms for the picture and for keys.
 */

/** A body that stands for scene objects: one object, or a whole group's members. */
export interface BodyItem {
  readonly body: BodyId;
  readonly motion: Motion;
  /** The object or group id. */
  readonly tag: string;
  readonly group: GroupId | null;
  /** The body's pose when play began. */
  readonly start: Pose;
  /** The members and where each sits in the body's frame (a single object sits at its origin). */
  readonly members: readonly { readonly id: ObjectId; readonly offset: Vec3; readonly turn: Quat; readonly rotation: Vec3; readonly size: Vec3 }[];
}

/** The floor under water that is not solid: this share of the player's height down. */
export const WADE_DEPTH = 0.5;
const FRICTION = 0.7;
const RESTITUTION = { ball: 0.45, other: 0.2 } as const;
/** The physical bodies' collision margin of error: a frame of a fast prop is checked continuously. */
const CCD = true;

/** Whether keys move what they key: two of them hold different poses. Keys that change only a material, a light or the visibility do not. */
const moves = (keys: readonly Key<Transform>[] | undefined): boolean =>
  !!keys && keys.some((k) => !sameTransform(k.value, keys[0].value));

const keyedOf = (scene: Scene) => {
  const a = scene.animation;
  const index = groupIndex(scene);
  // A clip or a motion moves it as keys do (world/play/scripts.ts).
  const scripted = movedByScript(scene);
  return (o: SceneObject): boolean =>
    scripted(o) || (a.enabled && (moves(a.objects[o.id]) || chain(index, o.groupId).some((g) => moves(a.groups?.[g]))));
};

/** Objects whose visibility is keyed: they collide only while the keys show them. */
function keyedVisibility(scene: Scene): { readonly keyed: ReadonlySet<ObjectId>; readonly shown: ReadonlySet<ObjectId> } {
  const a = scene.animation;
  const tracks = a.enabled ? Object.entries(a.objects).filter(([, keys]) => keys.some((k) => k.value.hidden !== undefined)) : [];
  return {
    keyed: new Set(tracks.map(([id]) => id as ObjectId)),
    shown: new Set(tracks.filter(([, keys]) => keys.some((k) => k.value.hidden === false)).map(([id]) => id as ObjectId)),
  };
}

/** Whether an object takes part in collisions at all: never a trigger zone; a hidden one only when a rule or its keys show it (`shown`). */
const collides = (o: SceneObject, shown: ReadonlySet<ObjectId>): boolean =>
  !o.zone && (!o.hidden || shown.has(o.id)) && bodyOf(o).solid && !(o.groupId && (o.boolean === BooleanMode.Negative || o.boolean === BooleanMode.Intersect));

/** The outermost physical group around an object, or null. */
function physicalGroup(scene: Scene, o: SceneObject): GroupId | null {
  const index = groupIndex(scene);
  const groups = chain(index, o.groupId).filter((g) => groupBody(index.get(g)).physical);
  return groups.at(-1) ?? null;
}

const poseOf = (t: Transform): Pose => ({ position: t.position, rotation: quatOfEuler(t.rotation) });

export class SceneBodies {
  readonly items = new Map<BodyId, BodyItem>();
  private readonly byObject = new Map<ObjectId, BodyItem>();
  /** Bodies of objects with keyed visibility, and whether they collide now. */
  private readonly blinking = new Map<BodyId, boolean>();

  /** `skip`: objects that are not bodies at all (the plane a take recorded: it is the player's own). */
  constructor(private readonly physics: Physics, scene: Scene, playerHeight: number, private readonly skip?: ReadonlySet<ObjectId>) {
    for (const o of scene.objects) if (o.kind === ShapeKind.WaterPlane && !o.hidden && !bodyOf(o).solid) this.waterFloor(o, playerHeight);
    this.build(scene, scene.objects);
  }

  /**
   * The scene changed under play: the bodies of these objects, and of every object
   * that shared a body with one of them or is in its physical group now, are built
   * again from `scene`, at the objects' transforms there. The bodies taken away.
   */
  resync(scene: Scene, ids: ReadonlySet<ObjectId>): BodyId[] {
    const objects = new Map(scene.objects.map((o) => [o.id, o]));
    const index = groupIndex(scene);
    const affected = new Set<ObjectId>();
    for (const id of ids) {
      affected.add(id);
      for (const m of this.byObject.get(id)?.members ?? []) affected.add(m.id);
      const o = objects.get(id);
      const g = o ? physicalGroup(scene, o) : null;
      if (g) for (const m of scene.objects) if (chain(index, m.groupId).includes(g)) affected.add(m.id);
    }
    const dropped = new Set<BodyId>();
    for (const id of affected) {
      const item = this.byObject.get(id);
      if (!item) continue;
      dropped.add(item.body);
      for (const m of item.members) {
        this.byObject.delete(m.id);
        affected.add(m.id);
      }
    }
    for (const body of dropped) {
      this.physics.removeBody(body);
      this.items.delete(body);
      this.blinking.delete(body);
    }
    this.build(scene, [...affected].flatMap((id) => objects.get(id) ?? []));
    return [...dropped];
  }

  /** Bodies for these objects of `scene`: one each, or one per physical group, keyed ones kinematic. */
  private build(scene: Scene, objects: readonly SceneObject[]): void {
    const keyed = keyedOf(scene);
    const visibility = keyedVisibility(scene);
    const shown = new Set([...shownByRules(scene), ...visibility.shown]);
    const groups = new Map<GroupId, SceneObject[]>();
    const made: BodyId[] = [];
    for (const o of objects) {
      if (!collides(o, shown) || this.skip?.has(o.id)) continue;
      const g = keyed(o) ? null : physicalGroup(scene, o);
      if (g) groups.set(g, [...(groups.get(g) ?? []), o]);
      else made.push(...this.addObject(o, keyed(o) ? Motion.Kinematic : bodyOf(o).physical ? Motion.Dynamic : Motion.Fixed));
    }
    const index = groupIndex(scene);
    for (const [g, members] of groups) made.push(...this.addGroup(g, members, index.get(g)?.body?.mass));
    for (const body of made) if (this.items.get(body)?.members.some((m) => visibility.keyed.has(m.id))) this.blinking.set(body, true);
    this.blink(scene);
  }

  /** The body an object belongs to. */
  itemOf(id: ObjectId): BodyItem | null {
    return this.byObject.get(id) ?? null;
  }

  /** A body moves another way from now on (Sandbox: a fixed object picked up becomes a prop that is drawn moving). */
  setMotion(body: BodyId, motion: Motion): void {
    const item = this.items.get(body);
    if (item) this.remember({ ...item, motion });
  }

  /** Bodies that move by themselves (dynamic) or by keys (kinematic). */
  moving(): BodyItem[] {
    return [...this.items.values()].filter((i) => i.motion !== Motion.Fixed);
  }

  /** Kinematic bodies follow the keys: their next pose is the objects' pose in `posed` (the scene at the next step's time); keyed visibility turns collision on and off. */
  drive(posed: Scene): void {
    this.keyed(posed, (body, pose) => this.physics.setPose(body, pose));
    this.blink(posed);
  }

  /** Kinematic bodies jump to the objects' pose in `posed` (scene time went back). */
  place(posed: Scene): void {
    this.keyed(posed, (body, pose) => this.physics.teleport(body, pose));
    this.blink(posed);
  }

  /** Bodies with keyed visibility collide while one of their objects shows in `posed`; only a change is applied, so a rule's choice holds until the keys change. */
  private blink(posed: Scene): void {
    if (!this.blinking.size) return;
    const hidden = new Map(posed.objects.map((o) => [o.id, o.hidden]));
    for (const [body, was] of this.blinking) {
      const item = this.items.get(body);
      if (!item) continue;
      const solid = item.members.some((m) => hidden.get(m.id) === false);
      if (solid === was) continue;
      this.blinking.set(body, solid);
      this.physics.setLayer(body, item.motion === Motion.Dynamic ? Layer.Prop : Layer.World, solid ? ALL_LAYERS : 0);
    }
  }

  private keyed(posed: Scene, move: (body: BodyId, pose: Pose) => void): void {
    const objects = new Map(posed.objects.map((o) => [o.id, o]));
    for (const item of this.items.values()) {
      if (item.motion !== Motion.Kinematic) continue;
      const o = objects.get(item.members[0].id);
      if (o) move(item.body, poseOf(o.transform));
    }
  }

  /** World transforms of the objects of these bodies, at the given poses. */
  transforms(poses: ReadonlyMap<BodyId, Pose>): Map<ObjectId, Transform> {
    const out = new Map<ObjectId, Transform>();
    for (const [body, pose] of poses) {
      const item = this.items.get(body);
      if (!item) continue;
      for (const m of item.members) {
        out.set(m.id, {
          position: add(pose.position, rotateQ(pose.rotation, m.offset)),
          rotation: eulerOfQuat(mulQ(pose.rotation, m.turn), m.rotation),
          size: m.size,
        });
      }
    }
    return out;
  }

  private addObject(o: SceneObject, motion: Motion): BodyId[] {
    const shapes = shapesOf(o);
    if (!shapes.length) return [];
    const dynamic = motion === Motion.Dynamic;
    const body = this.physics.addBody({
      motion, ...poseOf(o.transform), shapes, tag: o.id,
      ...(dynamic ? { mass: massOf(o), ccd: CCD, restitution: o.kind === ShapeKind.Sphere ? RESTITUTION.ball : RESTITUTION.other } : { restitution: RESTITUTION.other }),
      friction: FRICTION,
    });
    this.remember({ body, motion, tag: o.id, group: null, start: poseOf(o.transform), members: [{ id: o.id, offset: ZERO3, turn: [0, 0, 0, 1], rotation: o.transform.rotation, size: o.transform.size }] });
    return [body];
  }

  /** One body for a physical group: its frame starts at the members' centre, unturned. */
  private addGroup(g: GroupId, members: readonly SceneObject[], mass: number | undefined): BodyId[] {
    const centre = scale(members.reduce((s, o) => add(s, o.transform.position), ZERO3), 1 / members.length);
    const parts = members.map((o) => ({ o, offset: sub(o.transform.position, centre), turn: quatOfEuler(o.transform.rotation) }));
    const shapes = parts.flatMap((p) => placedShapes(shapesOf(p.o), p.offset, p.turn));
    if (!shapes.length) return [];
    const body = this.physics.addBody({
      motion: Motion.Dynamic, position: centre, shapes, tag: g, ccd: CCD, friction: FRICTION, restitution: RESTITUTION.other,
      mass: mass ?? members.reduce((s, o) => s + massOf(o), 0),
    });
    this.remember({ body, motion: Motion.Dynamic, tag: g, group: g, start: { position: centre, rotation: [0, 0, 0, 1] }, members: parts.map((p) => ({ id: p.o.id, offset: p.offset, turn: p.turn, rotation: p.o.transform.rotation, size: p.o.transform.size })) });
    return [body];
  }

  private waterFloor(o: SceneObject, playerHeight: number): void {
    const position: Vec3 = [o.transform.position[0], o.transform.position[1] - playerHeight * WADE_DEPTH, o.transform.position[2]];
    this.physics.addBody({ motion: Motion.Fixed, position, shapes: [{ type: ShapeType.HalfSpace, normal: [0, 1, 0] }], tag: o.id });
  }

  private remember(item: BodyItem): void {
    this.items.set(item.body, item);
    for (const m of item.members) this.byObject.set(m.id, item);
  }
}

/** The turn that takes `from` to `to` (a platform's turn over one step). */
export const turnBetween = (from: Quat, to: Quat): Quat => mulQ(to, conjQ(from));

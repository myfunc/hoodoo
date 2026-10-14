import type { Rgb } from '../core/color';
import type { Vec3 } from '../core/vec3';
import type {
  BooleanMode,
  ChannelSource,
  ColorChannel,
  Ease,
  Family,
  JointKind,
  ShapeKind,
  SmartRuleKind,
  SkyMode,
  TextureKind,
  TextureMapping,
  ValueChannel,
  ViewKind,
} from './scene.enums';
import type { GroupId, JointId, ObjectId, SmartGroupId } from './scene.ids';
import type { PlayScript, TriggerZone } from './play.types';

export interface Transform {
  readonly position: Vec3;
  /** Euler degrees, X then Y then Z. */
  readonly rotation: Vec3;
  /** Half-extents of the unit primitive (-1..1) along each local axis. */
  readonly size: Vec3;
}

export interface ProceduralTexture {
  readonly kind: TextureKind;
  readonly mapping: TextureMapping;
  /** Feature frequency in cycles per unit. */
  readonly frequency: number;
  /** Fractal octaves, 1..8. */
  readonly detail: number;
  /** 0..100 sharpening of the scalar before the colour ramp. */
  readonly contrast: number;
  readonly colors: readonly [Rgb, Rgb, Rgb];
  readonly seed: number;
}

/** Values are integers on Bryce's 0..100 dials; refraction is 0..300 where 100 means IOR 1. */
export interface Material {
  readonly name: string;
  readonly colors: Readonly<Record<ColorChannel, Rgb>>;
  readonly colorSources: Readonly<Record<ColorChannel, ChannelSource>>;
  readonly values: Readonly<Record<ValueChannel, number>>;
  readonly valueSources: Readonly<Record<ValueChannel, ChannelSource>>;
  readonly textures: readonly [ProceduralTexture | null, ProceduralTexture | null, ProceduralTexture | null];
}

export interface TerrainData {
  readonly resolution: number;
  /** Row-major heights 0..1, resolution x resolution. */
  readonly heights: Float32Array;
}

export interface LightData {
  readonly color: Rgb;
  /** 0..100 dial. */
  readonly intensity: number;
  /** Spot cone half-angle in degrees. */
  readonly cone: number;
  /** 0..100: how fast the light fades with distance. */
  readonly falloff: number;
}

export interface SceneObject {
  readonly id: ObjectId;
  readonly name: string;
  readonly kind: ShapeKind;
  /** Where the object is in the world, posed at the playhead: what is drawn, picked and edited. */
  readonly transform: Transform;
  /**
   * Inside a moved group: the pose relative to the group (world = group ∘ local),
   * which the object's keys hold. Absent when the groups around it are where they
   * were built; then `transform` is the local pose too (world/group-pose).
   */
  readonly local?: Transform;
  readonly material: Material;
  readonly boolean: BooleanMode;
  readonly groupId: GroupId | null;
  readonly family: Family;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly showAsBox: boolean;
  readonly terrain: TerrainData | null;
  readonly light: LightData | null;
  /** Shape seed for stones; ratio of the tube for tori. */
  readonly shapeParam: number;
  /**
   * A portal's partner: what you see through one portal is what the other faces.
   * Only a mutual link counts (world/portals.ts); absent on everything else.
   */
  readonly pair?: ObjectId;
  /** Play mode's physics layer; absent: the defaults of its kind (world/body-flags.ts). */
  readonly body?: BodyFlags;
  /** Play mode: its own clip and behaviours (model/play.types.ts); absent: none. */
  readonly script?: PlayScript;
  /** Play mode: a trigger zone, never drawn in renders (a Cube or a Sphere); absent on everything else. */
  readonly zone?: TriggerZone;
}

/** How an object or a group takes part in Play mode's physics (docs/play-mode.md). */
export interface BodyFlags {
  /** The player and physical bodies collide with it. */
  readonly solid: boolean;
  /** A dynamic rigid body in Play: it falls, tumbles and is pushed (and is solid). A group: one body. */
  readonly physical: boolean;
  /** Kilograms; absent: from the size (world/body-flags.ts). */
  readonly mass?: number;
}

/**
 * A group in the Object Tree: groups nest, objects point at their innermost group.
 * A group objects point at that has no entry here is a plain top-level group,
 * as every group was before the tree.
 */
export interface GroupNode {
  readonly id: GroupId;
  readonly name: string;
  readonly parentId: GroupId | null;
  /** Folded in the scene list. */
  readonly collapsed: boolean;
  /**
   * The group's pivot inside its parent, posed at the playhead: position, rotation,
   * and `size` read as a scale factor (1 = as built). Absent: the identity.
   */
  readonly transform?: Transform;
  /** Play mode: a physical group is one rigid body (its members' own flags then wait). */
  readonly body?: BodyFlags;
  /** Play mode: the group's own clip and behaviours; absent: none. */
  readonly script?: PlayScript;
}

/** What makes an object a member of a smart group (world/smart-groups.ts). */
export type SmartRule =
  | { readonly by: SmartRuleKind.Kind; readonly kinds: readonly ShapeKind[] }
  | { readonly by: SmartRuleKind.Material; readonly material: string }
  | { readonly by: SmartRuleKind.Name; readonly text: string };

/** A saved rule in the Object Tree: members are found live, objects stay in their groups. */
export interface SmartGroup {
  readonly id: SmartGroupId;
  readonly name: string;
  readonly rule: SmartRule;
}

/**
 * A Sandbox joint (Weld, No-Collide, Ball Socket): two objects, or one and the
 * world, held as Play's physics holds them. Anchors are points in each object's
 * own frame (its position and turn, not its size), so they hold wherever play
 * leaves the objects.
 */
export interface SceneJoint {
  readonly id: JointId;
  readonly kind: JointKind;
  readonly a: ObjectId;
  /** Null: the world. */
  readonly b: ObjectId | null;
  readonly anchorA: Vec3;
  readonly anchorB: Vec3;
  /** Breaks under more than this force; absent: never (Garry's Mod's default). */
  readonly forceLimit?: number;
  /** The two still collide with each other. */
  readonly collide?: boolean;
}

export interface CloudSettings {
  readonly cumulus: boolean;
  readonly stratus: boolean;
  /** 0..100 */
  readonly cover: number;
  readonly height: number;
  readonly frequency: number;
  readonly amplitude: number;
  readonly color: Rgb;
}

export interface Sky {
  readonly mode: SkyMode;
  readonly skyColor: Rgb;
  readonly horizonColor: Rgb;
  readonly sunColor: Rgb;
  readonly ambientColor: Rgb;
  /** Degrees around Y, 0 = from +Z. */
  readonly sunAzimuth: number;
  /** Degrees above the horizon; below zero is night. */
  readonly sunAltitude: number;
  readonly sunVisible: boolean;
  /** 0..100 darkness of shadows. */
  readonly shadows: number;
  /** 0..100 size of the sun and lamps: 0 is Bryce 2's crisp shadows, 100 Bryce 3D's soft ones. */
  readonly softShadows: number;
  readonly fogAmount: number;
  readonly fogHeight: number;
  readonly fogColor: Rgb;
  readonly hazeAmount: number;
  readonly hazeColor: Rgb;
  readonly clouds: CloudSettings;
  readonly stars: boolean;
}

export interface Camera {
  readonly position: Vec3;
  /** Degrees: heading around Y, tilt, bank. */
  readonly yaw: number;
  readonly pitch: number;
  readonly bank: number;
  /** Vertical field of view, degrees. */
  readonly fov: number;
  /** Distance to the trackball pivot in front of the camera; also where the lens is sharp. */
  readonly focus: number;
  /** 0..100 depth-of-field dial; 0 is Bryce's pinhole camera (everything sharp). */
  readonly aperture: number;
}

export interface OrthoView {
  readonly center: Vec3;
  /** World units across the view height. */
  readonly span: number;
}

export interface DocumentSetup {
  readonly width: number;
  readonly height: number;
  /** Fit Window: the picture fills the scene window; width and height follow its size in screen pixels. */
  readonly fit?: boolean;
}

/** How the scene's final picture is traced (Render, Render to Image, movies; Render Options). */
export interface RenderSetup {
  /** Mirror and glass bounces, 1..16 (world/render-setup.ts). */
  readonly bounces: number;
}

/** One key of an animation track: the full value at a moment, in seconds. */
export interface Key<T> {
  readonly time: number;
  readonly value: T;
  /** How the motion meets this key; absent is Ease.Smooth. */
  readonly ease?: Ease;
}

/** What a material key can blend: the colours and the dials it changes, nothing else. */
export interface MaterialKey {
  readonly colors?: Partial<Readonly<Record<ColorChannel, Rgb>>>;
  readonly values?: Partial<Readonly<Record<ValueChannel, number>>>;
  /** What cannot blend: switched halfway to the next key that holds one (a preset change). */
  readonly look?: MaterialLook;
}

/** The parts of a material that switch rather than blend: its name, channel sources and textures. */
export type MaterialLook = Pick<Material, 'name' | 'colorSources' | 'valueSources' | 'textures'>;

/**
 * An object key: the pose inside its group, always, and only those material,
 * light and visibility values that change there (world/animation/prop-channels).
 */
export interface ObjectKey extends Transform {
  readonly material?: MaterialKey;
  readonly light?: Partial<LightData>;
  /** Stepped: hidden from this key until the next one that says otherwise. */
  readonly hidden?: boolean;
}

/**
 * The timeline, after Bryce 3D. Tracks hold keys sorted by time; values between keys
 * are interpolated (world/animation). Objects without a track stay where they are.
 * Switched off, the scene is a still: nothing is keyed or played, the keys wait.
 */
export interface Animation {
  readonly enabled: boolean;
  /** Seconds. */
  readonly duration: number;
  readonly fps: number;
  readonly loop: boolean;
  /** Object keys hold the pose inside the object's group (the world pose for an ungrouped object). */
  readonly objects: Readonly<Record<string, readonly Key<ObjectKey>[]>>;
  /** Group keys hold the group's pivot transform inside its parent; absent in older scenes. */
  readonly groups?: Readonly<Record<string, readonly Key<Transform>[]>>;
  readonly camera: readonly Key<Camera>[];
  readonly sky: readonly Key<Sky>[];
  /** Closed paths (`<track>:<id>`, world/animation/loops): the track flows from its last key back into its first. */
  readonly cyclic?: readonly string[];
}

/** The eye and the lock of the camera or the sun in the scene list. */
export interface RigFlags {
  /** Its glyph is not drawn in the scene window (the camera still films, the sun still shines). */
  readonly hidden: boolean;
  /** Orbit, walk, drags and typed values leave its place and aim (the sun's direction) alone. */
  readonly locked: boolean;
}

export interface Scene {
  /** With animation on, the animated values of `objects`, `camera` and `sky` are the pose at the playhead. */
  readonly animation: Animation;
  readonly objects: readonly SceneObject[];
  /** Named and nested groups (world/group-tree); absent when every group is plain. */
  readonly groups?: readonly GroupNode[];
  readonly smartGroups?: readonly SmartGroup[];
  readonly camera: Camera;
  readonly sky: Sky;
  readonly document: DocumentSetup;
  readonly views: Readonly<Record<ViewKind, OrthoView>>;
  readonly bookmarks: readonly (Camera | null)[];
  /** The camera's and the sun's eye and lock; absent while both are shown and free. */
  readonly rig?: { readonly camera?: RigFlags; readonly sun?: RigFlags };
  /** The final render's options; absent: the defaults (six bounces). */
  readonly render?: RenderSetup;
  /** Sandbox's welds and other joints; absent when there are none. */
  readonly joints?: readonly SceneJoint[];
}

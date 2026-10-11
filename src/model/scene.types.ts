import type { Rgb } from '../core/color';
import type { Vec3 } from '../core/vec3';
import type {
  BooleanMode,
  ChannelSource,
  ColorChannel,
  Family,
  ShapeKind,
  SkyMode,
  TextureKind,
  TextureMapping,
  ValueChannel,
  ViewKind,
} from './scene.enums';
import type { GroupId, ObjectId } from './scene.ids';

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
}

/** One key of an animation track: the full value at a moment, in seconds. */
export interface Key<T> {
  readonly time: number;
  readonly value: T;
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
  readonly objects: Readonly<Record<string, readonly Key<Transform>[]>>;
  /** Group keys hold the group's pivot transform inside its parent; absent in older scenes. */
  readonly groups?: Readonly<Record<string, readonly Key<Transform>[]>>;
  readonly camera: readonly Key<Camera>[];
  readonly sky: readonly Key<Sky>[];
  /** Closed paths (`<track>:<id>`, world/animation/loops): the track flows from its last key back into its first. */
  readonly cyclic?: readonly string[];
}

export interface Scene {
  /** With animation on, the animated values of `objects`, `camera` and `sky` are the pose at the playhead. */
  readonly animation: Animation;
  readonly objects: readonly SceneObject[];
  /** Named and nested groups (world/group-tree); absent when every group is plain. */
  readonly groups?: readonly GroupNode[];
  readonly camera: Camera;
  readonly sky: Sky;
  readonly document: DocumentSetup;
  readonly views: Readonly<Record<ViewKind, OrthoView>>;
  readonly bookmarks: readonly (Camera | null)[];
}

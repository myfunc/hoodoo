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
  readonly transform: Transform;
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

export interface Scene {
  readonly objects: readonly SceneObject[];
  readonly camera: Camera;
  readonly sky: Sky;
  readonly document: DocumentSetup;
  readonly views: Readonly<Record<ViewKind, OrthoView>>;
  readonly bookmarks: readonly (Camera | null)[];
}

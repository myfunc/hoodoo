import type { Vec3 } from '../../core/vec3';

/**
 * READ ME — what Hoodoo reads from a Source engine game the player owns
 * (Garry's Mod, Half-Life 2): its file system, materials, textures, sounds and
 * models. Nothing from those games ships with Hoodoo; the player points it at
 * their own install (docs/sandbox-mode.md, "Game files"). Values stay in the
 * game's own units and axes (inches; X forward, Y left, Z up) — the renderer
 * converts. Paths are lower case with '/' separators, relative to the game
 * root ("materials/sprites/physbeam.vmt").
 */

/** The bytes of one file, read on demand (a File from a folder, a VPK archive slice, or stored bytes). */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** A game's files as one tree: what was mounted first wins, as in the engine. */
export interface SourceFiles {
  has(path: string): boolean;
  /** The whole file, or null when no mount has it. */
  read(path: string): Promise<Uint8Array | null>;
  /** Every path under a prefix ("materials/sprites/"). */
  list(prefix: string): string[];
}

/** One KeyValues node: a leaf has a value, a block has children (keys keep their case; compare lower case). */
export interface KeyValues {
  readonly key: string;
  readonly value: string | null;
  readonly children: readonly KeyValues[];
}

/** A material (.vmt) with `include`/`patch` resolved: shader and parameters by lower-case name ("$basetexture"). */
export interface SourceMaterial {
  readonly path: string;
  /** Lower case: "vertexlitgeneric", "unlitgeneric", "sprite", "spritecard"… */
  readonly shader: string;
  readonly params: ReadonlyMap<string, string>;
  /** The Proxies block's entries ("playerweaponcolor", "texturescroll"…), as written. */
  readonly proxies: readonly KeyValues[];
}

/** A decoded texture (.vtf): every frame and face of the top mip as RGBA8, rows from the top. */
export interface SourceTexture {
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  /** 6 for a cube map (right, left, back, front, up, down as stored), else 1. */
  readonly faces: number;
  /** VTF flags (clamp, point sampling, normal map, additive…). */
  readonly flags: number;
  readonly reflectivity: Vec3;
  /** RGBA8, `width × height × 4` bytes. */
  rgba(frame?: number, face?: number): Uint8Array;
}

/** A decoded wave: samples per channel in −1…1, and the loop the file marks, if any. */
export interface SourceSound {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
  /** Sample frames, from a `cue ` or `smpl` chunk. */
  readonly loop: { readonly start: number; readonly end: number } | null;
}

/** One entry of a soundscript ("Weapon_Physgun.Off"): wave paths under sound/ without the engine's prefix marks. */
export interface SoundScript {
  readonly name: string;
  readonly channel: string;
  readonly volume: readonly [number, number];
  /** Percent, 100 is as recorded. */
  readonly pitch: readonly [number, number];
  readonly soundLevel: number;
  readonly waves: readonly string[];
}

/** A 3×4 matrix, rows of [r0 r1 r2 t]: Source's matrix3x4_t. */
export type Matrix3x4 = Float32Array;

export interface SourceBone {
  readonly name: string;
  /** −1 for a root. */
  readonly parent: number;
  /** Rest position and turn relative to the parent. */
  readonly position: Vec3;
  readonly quat: readonly [number, number, number, number];
  /** Model space to the bone's space at rest (for skinning). */
  readonly poseToBone: Matrix3x4;
  readonly flags: number;
}

export interface SourceAttachment {
  readonly name: string;
  readonly bone: number;
  /** The attachment's frame in its bone's space. */
  readonly local: Matrix3x4;
}

/** A material slot of the model: the material's name and the folders to look for it in (materials/<dir><name>.vmt). */
export interface SourceTextureSlot {
  readonly name: string;
  readonly candidates: readonly string[];
}

/** One drawable piece at LOD 0: triangles of one material slot, skinned to up to three bones per vertex. */
export interface SourceMesh {
  readonly bodyPart: number;
  readonly model: number;
  /** Index into `SourceModel.textures` after the skin family maps it. */
  readonly material: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** xyzw, w is the bitangent sign; empty when the file has none. */
  readonly tangents: Float32Array;
  readonly uvs: Float32Array;
  /** Three bone indices per vertex (unused slots 0 with weight 0). */
  readonly bones: Uint8Array;
  readonly weights: Float32Array;
  readonly indices: Uint32Array;
}

export interface SourcePoseParameter {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** 0 when it does not wrap, else the wrap range (360 for an angle). */
  readonly loop: number;
}

export interface SourceSequence {
  readonly name: string;
  /** The activity name ("ACT_VM_IDLE"), empty when none. */
  readonly activity: string;
  readonly fps: number;
  readonly frames: number;
  readonly looping: boolean;
  /** Indices of the pose parameters it blends over (−1 for none) and its grid of animations (row-major). */
  readonly blendParams: readonly [number, number];
  readonly blendSize: readonly [number, number];
  readonly animations: readonly number[];
  /** Events (muzzle flashes, sounds) by frame. */
  readonly events: readonly { readonly frame: number; readonly event: number; readonly options: string }[];
}

/** A bone's place relative to its parent at one moment. */
export interface BonePose {
  readonly position: Vec3;
  readonly quat: readonly [number, number, number, number];
}

export interface SourceModel {
  readonly name: string;
  readonly bones: readonly SourceBone[];
  readonly attachments: readonly SourceAttachment[];
  readonly textures: readonly SourceTextureSlot[];
  /** Skin families: each maps a texture slot index to the one it shows. */
  readonly skins: readonly (readonly number[])[];
  readonly meshes: readonly SourceMesh[];
  readonly poseParameters: readonly SourcePoseParameter[];
  readonly sequences: readonly SourceSequence[];
  /** Number of animations (`SourceSequence.animations` index them). */
  readonly animationCount: number;
  /** One animation's bone poses at a frame (fractional frames interpolate); bones it does not move keep their rest pose. */
  animationPose(animation: number, frame: number): BonePose[];
}

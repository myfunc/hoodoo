import type { Vec3 } from '../core/vec3';
import type { Camera, RigFlags, Scene, Sky } from '../model/scene.types';
import { Rig } from './world.enums';

/**
 * The camera and the sun as members of the scene: they sit above the objects in
 * the scene list, are selected, keyed, hidden and locked like objects, and show
 * as glyphs in the Top, Front and Side views. The sun is the sky's: its direction
 * is the sky's azimuth and altitude, and its keys are the sky's keys.
 */

export const RIG_NAMES: Readonly<Record<Rig, string>> = { [Rig.Camera]: 'Camera', [Rig.Sun]: 'Sun' };

const FREE: RigFlags = { hidden: false, locked: false };

export const rigFlags = (scene: Pick<Scene, 'rig'>, rig: Rig): RigFlags => scene.rig?.[rig] ?? FREE;

/** The scene with the camera's or the sun's eye or lock changed; the table goes when both are shown and free. */
export function withRigFlags(scene: Scene, rig: Rig, patch: Partial<RigFlags>): Scene {
  const flags = { ...rigFlags(scene, rig), ...patch };
  const table = { ...scene.rig, [rig]: flags };
  const plain = (f: RigFlags | undefined) => !f || (!f.hidden && !f.locked);
  const { rig: _old, ...rest } = scene;
  return plain(table.camera) && plain(table.sun) ? rest : { ...rest, rig: table };
}

/** A locked camera keeps its place and aim; its lens still changes. */
export const lockedCamera = (now: Camera, next: Camera): Camera => ({ ...next, position: now.position, yaw: now.yaw, pitch: now.pitch, bank: now.bank });

/** A locked sun keeps its direction; the rest of the sky still changes. */
export const lockedSun = (now: Sky, next: Sky): Sky => ({ ...next, sunAzimuth: now.sunAzimuth, sunAltitude: now.sunAltitude });

const DEG = Math.PI / 180;
const HALF_TURN = 180;
const FULL_TURN = 360;
/** The lowest the sun goes, as on the Sky & Fog palette's sun ball. */
export const SUN_ALTITUDE = { min: -60, max: 90 } as const;

/** Unit vector toward the sun (azimuth 0 = from +Z), as the renderer reads it. */
export function sunDirection(s: Pick<Sky, 'sunAzimuth' | 'sunAltitude'>): Vec3 {
  const az = s.sunAzimuth * DEG;
  const alt = s.sunAltitude * DEG;
  return [Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt)];
}

/** Degrees in -180..180. */
export const wrapDegrees = (deg: number): number => deg - Math.round(deg / FULL_TURN) * FULL_TURN;

/** Azimuth and altitude of a direction toward the sun; the altitude is kept inside the sun's range, straight up keeps `azimuth`. */
export function sunAngles(dir: Vec3, azimuth = 0): { sunAzimuth: number; sunAltitude: number } {
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const altitude = Math.asin(Math.max(-1, Math.min(1, dir[1] / len))) / DEG;
  const flat = Math.hypot(dir[0], dir[2]);
  return {
    sunAzimuth: flat > 0 ? Math.atan2(dir[0], dir[2]) / DEG : azimuth,
    sunAltitude: Math.max(SUN_ALTITUDE.min, Math.min(SUN_ALTITUDE.max, altitude)),
  };
}

/** Whole degrees as the hint names them, azimuth in -180..180. */
export function sunReadout(s: Pick<Sky, 'sunAzimuth' | 'sunAltitude'>): string {
  const az = Math.round(wrapDegrees(s.sunAzimuth));
  return `azimuth ${az === -HALF_TURN ? HALF_TURN : az}° · altitude ${Math.round(s.sunAltitude)}°`;
}

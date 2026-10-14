import { BooleanMode, ChannelSource, ShapeKind, ValueChannel } from '../model/scene.enums';
import type { Scene, SceneObject } from '../model/scene.types';
import { LIGHT_KINDS, TERRAIN_KINDS } from '../world/objects.factory';
import { MAX_LIGHTS, MAX_OBJECTS, MAX_TERRAIN_RES } from './gpu/render.constants';

/** Past this share of a limit the scene is getting heavy (the readout turns amber). */
export const LOAD_WARN = 0.75;
/** A terrain finer than this costs a lot to trace and to keep. */
const FINE_TERRAIN = MAX_TERRAIN_RES / 2;
/** More glass and mirrors than this make every pixel bounce: the dearest rays. */
const MANY_GLASSY = 12;
const PERCENT = 100;

/** What a scene asks of the tracer, against its limits (render/gpu/render.constants.ts). */
export interface SceneLoad {
  /** Objects the tracer draws, and those past the limit it leaves out. */
  readonly objects: number;
  readonly leftOut: number;
  readonly lights: number;
  readonly lightsLeftOut: number;
  readonly terrains: number;
  /** The finest terrain's resolution (0: none). */
  readonly finestTerrain: number;
  readonly booleans: number;
  readonly portals: number;
  /** Objects that reflect or let light through: each pixel on them traces more rays. */
  readonly glassy: number;
  /** The fullest limit, 0..1+ (objects or lights). */
  readonly share: number;
  /** What to do about it, worst first; empty when the scene is light. */
  readonly tips: readonly string[];
}

const valueOf = (o: SceneObject, c: ValueChannel) => (o.material.valueSources[c] === ChannelSource.Flat ? o.material.values[c] : 1);

/** Counts what the tracer draws (hidden objects and trigger zones are not drawn) and what is costly. */
export function sceneLoad(scene: Scene): SceneLoad {
  const drawn = scene.objects.filter((o) => !o.hidden && !o.zone);
  const lights = drawn.filter((o) => LIGHT_KINDS.has(o.kind));
  const solids = drawn.filter((o) => !LIGHT_KINDS.has(o.kind));
  const terrains = solids.filter((o) => TERRAIN_KINDS.has(o.kind));
  const finestTerrain = Math.max(0, ...terrains.map((o) => o.terrain?.resolution ?? 0));
  const glassy = solids.filter((o) => valueOf(o, ValueChannel.Reflection) > 0 || valueOf(o, ValueChannel.Transparency) > 0).length;
  const objects = Math.min(solids.length, MAX_OBJECTS);
  const leftOut = solids.length - objects;
  const lightsLeftOut = Math.max(0, lights.length - MAX_LIGHTS);
  const share = Math.max(solids.length / MAX_OBJECTS, lights.length / MAX_LIGHTS);
  const tips: string[] = [];
  if (leftOut > 0) tips.push(`${leftOut} objects past the ${MAX_OBJECTS} drawn at once are not drawn: hide what the camera does not see`);
  else if (solids.length / MAX_OBJECTS >= LOAD_WARN) tips.push(`Close to the ${MAX_OBJECTS} objects drawn at once: hide or delete far details`);
  if (lightsLeftOut > 0) tips.push(`${lightsLeftOut} lights past ${MAX_LIGHTS} give no light`);
  if (finestTerrain > FINE_TERRAIN) tips.push(`A terrain at ${finestTerrain}×${finestTerrain}: ${FINE_TERRAIN} in the Terrain Editor is quicker`);
  if (glassy > MANY_GLASSY) tips.push(`${glassy} glass and mirror objects: lower Reflections on the Render page`);
  return {
    objects, leftOut, lights: Math.min(lights.length, MAX_LIGHTS), lightsLeftOut, terrains: terrains.length, finestTerrain,
    booleans: solids.filter((o) => o.boolean !== BooleanMode.Neutral).length,
    portals: solids.filter((o) => o.kind === ShapeKind.Portal).length,
    glassy, share, tips,
  };
}

/** The readout's word: the fullest limit as a share. */
export const loadPercent = (l: SceneLoad): number => Math.round(l.share * PERCENT);

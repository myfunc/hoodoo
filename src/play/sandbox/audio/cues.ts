import { ShapeKind } from '../../../model/scene.enums';
import type { SceneObject } from '../../../model/scene.types';
import type { Cue } from './mixer';
import { Synth } from './synth';

/**
 * READ ME — what Garry's Mod mode plays for each thing that happens: the game's
 * soundscript or wave (Garry's Mod's own names: the sandbox gamemode's notice
 * sounds, gmod_tool's shot, weapon_physgun's hum) and Sandbox's stand-in. Steps,
 * knocks and scrapes go by surface, as Source does: each Hoodoo object is given
 * a Source surface from its material and shape (`surfaceOf`), and the game's
 * surfaceproperties name the sounds; without the files the surface's family
 * picks a stand-in.
 */

export const CUES = {
  /** The sandbox gamemode's notices (cl_init.lua, cl_hints.lua). */
  undo: { game: 'buttons/button15.wav', synth: Synth.Undo },
  limit: { game: 'buttons/button10.wav', synth: Synth.Limit },
  unfroze: { game: 'npc/roller/mine/rmine_chirp_answer1.wav', synth: Synth.Unfroze },
  hint: { game: 'ambient/water/drip2.wav', synth: Synth.Hint },
  /** gmod_tool's ShootSound. */
  toolShot: { game: 'Toolgun.Single', synth: Synth.ToolShot },
  physHum: { game: 'Weapon_PhysCannon.HoldSound', synth: Synth.PhysHum },
  physOff: { game: 'Weapon_Physgun.Off', synth: Synth.PhysOff },
  /** Garry's Mod's menus: a soft tick as Q or C opens. */
  menuOpen: { game: 'garrysmod/ui_hover.wav', synth: Synth.Click, volume: 0.35 },
  /** A spawn icon's click (ContentIcon: ui/buttonclickrelease). */
  spawn: { game: 'ui/buttonclickrelease.wav', synth: Synth.Spawn, volume: 0.8 },
  /** What the Remover takes fizzles away with its sparks (the game has no sound for it: Sandbox's own). */
  remove: { game: null, synth: Synth.Remove, volume: 0.6 },
  splash: { game: 'Physics.WaterSplash', synth: Synth.Splash },
  /** Half-Life 2's shotgun (weapon_shotgun's script). */
  shotgunFire: { game: 'Weapon_Shotgun.Single', synth: Synth.ShotgunFire },
  shotgunDouble: { game: 'Weapon_Shotgun.Double', synth: Synth.ShotgunFire, volume: 1 },
  shotgunReload: { game: 'Weapon_Shotgun.Reload', synth: Synth.ShotgunShell },
  shotgunPump: { game: 'Weapon_Shotgun.Special1', synth: Synth.ShotgunPump },
  shotgunEmpty: { game: 'Weapon_Shotgun.Empty', synth: Synth.DryFire },
} as const satisfies Record<string, Cue>;

/** A sound family: the stand-in a surface's steps, knocks and scrapes take without the game's files. */
export enum Family { Hard, Soft, Metal, Wood, Glass, Plastic, Rubber, Water }

const STEP: Readonly<Record<Family, Synth>> = {
  [Family.Hard]: Synth.StepHard, [Family.Soft]: Synth.StepSoft, [Family.Metal]: Synth.StepMetal, [Family.Wood]: Synth.StepWood,
  [Family.Glass]: Synth.StepHard, [Family.Plastic]: Synth.StepHard, [Family.Rubber]: Synth.StepSoft, [Family.Water]: Synth.StepWater,
};
const IMPACT: Readonly<Record<Family, Synth>> = {
  [Family.Hard]: Synth.ImpactHard, [Family.Soft]: Synth.ImpactSoft, [Family.Metal]: Synth.ImpactMetal, [Family.Wood]: Synth.ImpactWood,
  [Family.Glass]: Synth.ImpactGlass, [Family.Plastic]: Synth.ImpactPlastic, [Family.Rubber]: Synth.ImpactRubber, [Family.Water]: Synth.Splash,
};
/** Smooth surfaces squeal, rough ones grind. */
const SMOOTH: ReadonlySet<Family> = new Set([Family.Metal, Family.Glass, Family.Plastic, Family.Rubber]);

/** A Source surface and its family. */
export interface Surface {
  readonly name: string;
  readonly family: Family;
}

/** Material names to surfaces, first match wins; `prop`: the surface a loose object of it has (Source's *_box). */
const BY_MATERIAL: readonly { readonly match: RegExp; readonly world: string; readonly prop: string; readonly family: Family }[] = [
  { match: /water|lagoon|lake|sea\b|shallows|liquid/i, world: 'water', prop: 'water', family: Family.Water },
  { match: /snow|ice\b/i, world: 'snow', prop: 'snow', family: Family.Soft },
  { match: /sand(?!stone)|dune/i, world: 'sand', prop: 'sand', family: Family.Soft },
  { match: /grass|meadow|moss|lawn/i, world: 'grass', prop: 'grass', family: Family.Soft },
  { match: /soil|dirt|mud/i, world: 'dirt', prop: 'dirt', family: Family.Soft },
  { match: /wood|plank|crate/i, world: 'wood', prop: 'wood_box', family: Family.Wood },
  { match: /glass|crystal|amber|bubble|emerald|ruby|disc|hologram/i, world: 'glass', prop: 'glass', family: Family.Glass },
  { match: /chrome|gold|copper|steel|metal|mirror|anodized|iron|brass|silver/i, world: 'metal', prop: 'metal_box', family: Family.Metal },
  { match: /rubber|tyre|tire/i, world: 'rubber', prop: 'rubber', family: Family.Rubber },
  { match: /rock|stone|granite|marble|basalt|strata|canyon|lava|brick|concrete|checker/i, world: 'concrete', prop: 'concrete', family: Family.Hard },
];

/** The surface of a scene object: by its material's name, else by its shape (ground hard, terrain earthy, a loose shape plastic). */
export function surfaceOf(o: Pick<SceneObject, 'kind' | 'material'>, loose: boolean): Surface {
  if (o.kind === ShapeKind.WaterPlane) return { name: 'water', family: Family.Water };
  const m = BY_MATERIAL.find((x) => x.match.test(o.material.name));
  if (m) return { name: loose ? m.prop : m.world, family: m.family };
  if (o.kind === ShapeKind.Terrain) return { name: 'dirt', family: Family.Soft };
  if (o.kind === ShapeKind.Stone) return { name: 'concrete', family: Family.Hard };
  return loose ? { name: 'plastic_box', family: Family.Plastic } : { name: 'concrete', family: Family.Hard };
}

/** What a step on a surface plays: the game's left or right foot, the family's stand-in. */
export function stepCue(s: Surface, left: boolean, names: SurfaceNames | null): Cue {
  const n = names?.(s.name);
  return { game: n ? (left ? n.stepLeft : n.stepRight) : null, synth: STEP[s.family] };
}

/** What a knock on a surface plays, hard or soft. */
export function impactCue(s: Surface, hard: boolean, names: SurfaceNames | null): Cue {
  const n = names?.(s.name);
  return { game: n ? (hard ? n.impactHard : n.impactSoft) : null, synth: IMPACT[s.family] };
}

/** The scrape a surface makes as it slides: smooth surfaces squeal, rough ones grind. */
export function scrapeCue(s: Surface, names: SurfaceNames | null): Cue {
  const n = names?.(s.name);
  const smooth = SMOOTH.has(s.family);
  return { game: n ? (smooth ? n.scrapeSmooth : n.scrapeRough) : null, synth: smooth ? Synth.ScrapeSmooth : Synth.ScrapeRough };
}

/** A bullet's hit on a surface: the game's bulletimpact, else the surface's knock, small and high. */
export function bulletCue(s: Surface, names: SurfaceNames | null): Cue {
  return { game: names?.(s.name)?.bulletImpact ?? null, synth: IMPACT[s.family] };
}

/** The game's sounds of a surface by name (its "default" when it lacks the name), or null without the game's files. */
export type SurfaceNames = (name: string) => {
  readonly stepLeft: string; readonly stepRight: string; readonly impactHard: string; readonly impactSoft: string;
  readonly scrapeRough: string; readonly scrapeSmooth: string; readonly bulletImpact: string;
} | null;

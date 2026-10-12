import type { Vec3 } from '../../core/vec3';
import { BehaviourKind, ClipMode, ClipStart, ZoneAction, ZoneEdge, ZoneWho } from '../../model/play.enums';
import type { BehaviourSpec, Clip, Param, PlayScript, TriggerZone, ZoneRule } from '../../model/play.types';
import type { SceneObject } from '../../model/scene.types';
import { SCRIPT_LIMITS, ZONE_KINDS, behaviourDef } from './behaviour-catalog';
import { FORMULA_LIMITS, compileFormula } from './formula';

/**
 * Guards for Play scripts that arrive from outside (files, links, autosave):
 * known kinds and parameters only, numbers in range, formulas that parse
 * (world/play/formula.ts never runs code), short event names, ids that exist.
 * Anything else is dropped; a script that is left empty goes.
 */

const LIMIT = 1e6;
const CLIP_TIME = 600;
const EVENT_CHARS = /[^A-Za-z0-9 _\-.]/g;
const ID_MAX = 64;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < LIMIT;
const clampTo = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const members = <T extends string>(e: Record<string, T>): ReadonlySet<unknown> => new Set(Object.values(e));
const MODES = members(ClipMode);
const STARTS = members(ClipStart);
const KINDS = members(BehaviourKind);
const WHO = members(ZoneWho);
const EDGES = members(ZoneEdge);
const ACTIONS = members(ZoneAction);

/** Ids that may be referred to; absent: any short id passes (the editor's own data). */
export type KnownIds = ReadonlySet<string> | null;

/** An event name: printable, short, trimmed; null when nothing is left. */
export function eventName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const out = v.replace(EVENT_CHARS, '').trim().slice(0, SCRIPT_LIMITS.event);
  return out || null;
}

function idRef(v: unknown, known: KnownIds): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= ID_MAX && (!known || known.has(v)) ? v : null;
}

export function clip(v: unknown): Clip | null {
  const r = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof Clip, unknown>>;
  if (!isNum(r.from) || !isNum(r.to) || !MODES.has(r.mode) || !STARTS.has(r.start)) return null;
  const [a, b] = [clampTo(r.from, 0, CLIP_TIME), clampTo(r.to, 0, CLIP_TIME)];
  if (a === b) return null;
  const on = eventName(r.on);
  return {
    from: Math.min(a, b),
    to: Math.max(a, b),
    mode: r.mode as ClipMode,
    speed: isNum(r.speed) ? clampTo(r.speed, SCRIPT_LIMITS.speed.min, SCRIPT_LIMITS.speed.max) : 1,
    start: r.start as ClipStart,
    ...(on ? { on } : {}),
  };
}

/** A parameter of a known behaviour: a number in its range, one of its choices, or a formula that parses. */
function param(v: unknown, def: { min: number; max: number; formula?: boolean; choices?: readonly { value: number }[] }): Param | null {
  if (isNum(v)) {
    if (def.choices) return def.choices.some((c) => c.value === v) ? v : null;
    return clampTo(v, def.min, def.max);
  }
  if (typeof v !== 'string' || !def.formula) return null;
  const text = v.trim().slice(0, FORMULA_LIMITS.length);
  return text && compileFormula(text).ok ? text : null;
}

export function behaviour(v: unknown, known: KnownIds = null): BehaviourSpec | null {
  const r = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof BehaviourSpec, unknown>>;
  if (!KINDS.has(r.kind)) return null;
  const def = behaviourDef(r.kind as BehaviourKind);
  if (!def) return null;
  const raw = (r.params && typeof r.params === 'object' ? r.params : {}) as Record<string, unknown>;
  const params: Record<string, Param> = {};
  for (const p of def.params) {
    if (!Object.prototype.hasOwnProperty.call(raw, p.key)) continue;
    const value = param(raw[p.key], p);
    if (value !== null) params[p.key] = value;
  }
  const target = def.target ? idRef(r.target, known) : null;
  const on = def.listens ? eventName(r.on) : null;
  const send = def.sends ? eventName(r.send) : null;
  return { kind: def.kind, params, ...(target ? { target } : {}), ...(on ? { on } : {}), ...(send ? { send } : {}) };
}

/** An object's or a group's script; null when nothing usable is in it. */
export function playScript(v: unknown, known: KnownIds = null): PlayScript | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<Record<keyof PlayScript, unknown>>;
  const c = clip(r.clip);
  const list = Array.isArray(r.behaviours) ? r.behaviours.slice(0, SCRIPT_LIMITS.behaviours).map((b) => behaviour(b, known)).filter((b): b is BehaviourSpec => b !== null) : [];
  if (!c && !list.length) return null;
  return { ...(c ? { clip: c } : {}), ...(list.length ? { behaviours: list } : {}) };
}

function vector(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) return null;
  const m = SCRIPT_LIMITS.impulse;
  return [clampTo(v[0], -m, m), clampTo(v[1], -m, m), clampTo(v[2], -m, m)];
}

export function zoneRule(v: unknown, known: KnownIds = null): ZoneRule | null {
  const r = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof ZoneRule, unknown>>;
  if (!WHO.has(r.who) || !EDGES.has(r.edge) || !ACTIONS.has(r.action)) return null;
  const name = r.who === ZoneWho.Named ? idRef(r.name, known) : null;
  const target = idRef(r.target, known);
  const vec = r.action === ZoneAction.Impulse ? vector(r.vector) : null;
  const event = r.action === ZoneAction.Send ? eventName(r.event) : null;
  return {
    who: r.who as ZoneWho,
    ...(name ? { name } : {}),
    edge: r.edge as ZoneEdge,
    action: r.action as ZoneAction,
    ...(target ? { target } : {}),
    ...(vec ? { vector: vec } : {}),
    ...(event ? { event } : {}),
  };
}

/** A trigger zone's rules; a zone with no rules is still a zone (it waits for some). */
export function triggerZone(v: unknown, known: KnownIds = null): TriggerZone | null {
  if (!v || typeof v !== 'object') return null;
  const rules = (v as { rules?: unknown }).rules;
  const list = Array.isArray(rules) ? rules.slice(0, SCRIPT_LIMITS.rules).map((x) => zoneRule(x, known)).filter((x): x is ZoneRule => x !== null) : [];
  return { rules: list };
}

/** A revived object with its Play script and zone from the file (a zone only on a Cube or a Sphere). */
export function revivePlay(o: SceneObject, raw: { readonly script?: unknown; readonly zone?: unknown }): SceneObject {
  const script = playScript(raw.script);
  const zone = ZONE_KINDS.has(o.kind) ? triggerZone(raw.zone) : null;
  if (!script && !zone) return o;
  return { ...o, ...(script ? { script } : {}), ...(zone ? { zone } : {}) };
}

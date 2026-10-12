import { type Vec3, scale } from '../../core/vec3';
import { ZoneAction, ZoneEdge, ZoneWho } from '../../model/play.enums';
import type { ZoneRule } from '../../model/play.types';
import type { ObjectId } from '../../model/scene.ids';
import type { Scene } from '../../model/scene.types';
import type { ScriptWorld } from './behaviours-world';
import type { BodyId } from './physics';
import { hullOf } from './pmove';
import { type ZoneShape, boxInZone, pointInZone, zoneShape } from './triggers-geometry';

/**
 * READ ME — trigger zones at play: after every physics step each zone finds
 * who is inside (the player by its hull, physical bodies and named objects by
 * their centre), compares with the step before, and runs its rules: When
 * [Player | Any physical | the named one] [enters | leaves | stays], then
 * [play a clip forward or back, toggle it, make solid or not, push, teleport,
 * show, hide, send an event]. Clip, solid, show and event actions run once per
 * rule and step however many came in; push and teleport act on each of them.
 */

const PLAYER = 'player';
const BODY = 'b:';
const NAMED = 'n:';

interface Zone {
  readonly id: ObjectId;
  readonly rules: readonly ZoneRule[];
  readonly player: boolean;
  readonly physical: boolean;
  readonly named: readonly string[];
  inside: Set<string>;
}

const matches = (rule: ZoneRule, key: string): boolean =>
  rule.who === ZoneWho.Player ? key === PLAYER : rule.who === ZoneWho.Physical ? key.startsWith(BODY) : key === NAMED + rule.name;

export class TriggerZones {
  private readonly zones: Zone[];

  constructor(scene: Scene) {
    this.zones = scene.objects.filter((o) => o.zone?.rules.length).map((o) => {
      const rules = o.zone?.rules ?? [];
      return {
        id: o.id,
        rules,
        player: rules.some((r) => r.who === ZoneWho.Player),
        physical: rules.some((r) => r.who === ZoneWho.Physical),
        named: [...new Set(rules.flatMap((r) => (r.who === ZoneWho.Named && r.name ? [r.name] : [])))],
        inside: new Set(),
      };
    });
  }

  get count(): number {
    return this.zones.length;
  }

  /** Who is inside each zone now (for checks and the HUD). */
  occupants(id: ObjectId): ReadonlySet<string> {
    return this.zones.find((z) => z.id === id)?.inside ?? new Set();
  }

  afterPhysics(w: ScriptWorld): void {
    for (const zone of this.zones) {
      const o = w.object(zone.id);
      if (!o) continue;
      const now = this.inside(zone, zoneShape(o.kind, o.transform), w);
      const entered = [...now].filter((k) => !zone.inside.has(k));
      const left = [...zone.inside].filter((k) => !now.has(k));
      zone.inside = now;
      for (const rule of zone.rules) {
        const keys = rule.edge === ZoneEdge.Enter ? entered : rule.edge === ZoneEdge.Leave ? left : [...now];
        const who = keys.filter((k) => matches(rule, k));
        if (who.length) act(rule, who, w, zone.id);
      }
    }
  }

  private inside(zone: Zone, shape: ZoneShape, w: ScriptWorld): Set<string> {
    const out = new Set<string>();
    if (zone.player) {
      const walker = w.walker();
      const inside = walker ? boxInZone(shape, walker.state.origin, hullOf(walker.state, walker.tuning)) : pointInZone(shape, w.eye());
      if (inside) out.add(PLAYER);
    }
    if (zone.physical) for (const body of w.allDynamic()) if (pointInZone(shape, w.physics.pose(body).position)) out.add(BODY + body);
    for (const id of zone.named) {
      const c = w.centre(id);
      if (c && pointInZone(shape, c)) out.add(NAMED + id);
    }
    return out;
  }
}

/** The dynamic bodies a key stands for. */
function bodiesOf(key: string, w: ScriptWorld): BodyId[] {
  if (key.startsWith(BODY)) return [Number(key.slice(BODY.length))];
  if (key.startsWith(NAMED)) return w.dynamicBodies(key.slice(NAMED.length));
  return [];
}

function act(rule: ZoneRule, who: readonly string[], w: ScriptWorld, from: string): void {
  const target = rule.target ?? '';
  switch (rule.action) {
    case ZoneAction.Forward: w.clip(target)?.forward(); return;
    case ZoneAction.Backward: w.clip(target)?.backward(); return;
    case ZoneAction.Toggle: w.clip(target)?.toggle(); return;
    case ZoneAction.Solid: w.setSolid(target, true); return;
    case ZoneAction.NotSolid: w.setSolid(target, false); return;
    case ZoneAction.Show: w.setShown(target, true); return;
    case ZoneAction.Hide: w.setShown(target, false); return;
    case ZoneAction.Send: if (rule.event) w.send(rule.event, from); return;
    case ZoneAction.Impulse: for (const k of who) push(k, rule.vector ?? [0, 0, 0], w); return;
    case ZoneAction.Teleport: {
      const marker = w.centre(target);
      if (marker) for (const k of who) teleport(k, marker, w);
    }
  }
}

/** A velocity change: the player's speed, or a body's momentum by its mass. */
function push(key: string, v: Vec3, w: ScriptWorld): void {
  if (key === PLAYER) w.walker()?.kick(v);
  for (const body of bodiesOf(key, w)) w.physics.applyImpulse(body, scale(v, w.physics.mass(body)));
}

function teleport(key: string, to: Vec3, w: ScriptWorld): void {
  if (key === PLAYER) w.walker()?.teleport(to);
  for (const body of bodiesOf(key, w)) {
    w.physics.teleport(body, { position: to, rotation: w.physics.pose(body).rotation });
    w.physics.setVelocity(body, [0, 0, 0], [0, 0, 0]);
  }
}

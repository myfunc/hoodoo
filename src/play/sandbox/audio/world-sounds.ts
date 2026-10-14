import { type Vec3, length, sub } from '../../../core/vec3';
import type { ObjectId } from '../../../model/scene.ids';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { type BodyId, Motion } from '../../sim/physics';
import type { PlaySim } from '../../sim/play-sim';
import { ShapeKind } from '../../../model/scene.enums';
import { bodyOf } from '../../../world/body-flags';
import { CUES, Family, type Surface, type SurfaceNames, bulletCue, impactCue, scrapeCue, stepCue, surfaceOf } from './cues';
import type { MixLoop, Mixer } from './mixer';

/**
 * READ ME — the world's sounds in Garry's Mod mode, as Source makes them:
 * the player's steps on what they stand on (every 0.4 s walking, 0.3 s running,
 * louder running; one on a jump and on landing, louder after a long fall), and
 * the props' knocks and scrapes (a knock when two bodies meet, soft or hard by
 * how fast; a scrape loop while they slide on each other, louder and higher the
 * faster). Speeds are judged in Half-Life's units, so a small player hears the
 * same as a big one. Each sound is played at its place in the world.
 */

const ZERO: Vec3 = [0, 0, 0];
/** CBasePlayer::UpdateStepSound: below `walk` no steps, under `run` walking. Units a second. */
const STEPS = { walk: 90, run: 220, walkSeconds: 0.4, runSeconds: 0.3, walkVolume: 0.2, runVolume: 0.5, jumpVolume: 1 } as const;
/** A fall this fast lands at full volume (PLAYER_FALL_PUNCH_THRESHOLD); slower ones softer, down to `least`. */
const LAND = { full: 350, least: 0.3 } as const;
/** Knocks: quieter than `min` units a second are not heard, from `hard` they are hard, at `full` full volume; one a body per `gap` seconds. */
const KNOCK = { min: 60, hard: 250, full: 700, gap: 0.08 } as const;
/** Scrapes: from `min` units a second, full at `full`; a quiet one stops after `linger` seconds; at most `most` at once. */
const SCRAPE = { min: 25, full: 400, linger: 0.5, ramp: 0.08, fade: 0.2, pitchFrom: 80, pitchBy: 50, volume: 0.7, most: 6 } as const;
/** A body falling into water faster than this (units a second) splashes, at full volume from `full`. */
const SPLASH = { min: 80, full: 600 } as const;
/** A bullet's hit without the game's files: the surface's knock, quieter and higher. */
const BULLET = { volume: 0.45, pitch: 1.7 } as const;
/** Underfoot when nothing is known of it. */
const GROUND: Surface = { name: 'concrete', family: Family.Hard };

interface Scraping {
  readonly loop: MixLoop;
  quiet: number;
}

export class WorldSounds {
  /** Each moving body's velocity after the last step: a knock is judged by how fast they met. */
  private before = new Map<BodyId, Vec3>();
  private readonly touching = new Map<string, readonly [BodyId, BodyId]>();
  private readonly scrapes = new Map<BodyId, Scraping>();
  private readonly lastKnock = new Map<BodyId, number>();
  private stepClock = 0;
  private left = false;
  private readonly off: (() => void)[] = [];
  /** The scene's objects by id, built again when the scene changes. */
  private index: { scene: Scene | null; byId: Map<ObjectId, SceneObject>; water: number[] } = { scene: null, byId: new Map(), water: [] };
  /** Each moving body's height after the last step: crossing a water surface downward splashes. */
  private heights = new Map<BodyId, number>();

  /** `scene`: the editor's scene, for what each body is made of; `names`: the game's surfaces, or null without its files. */
  constructor(
    private readonly sim: PlaySim,
    private readonly mixer: Mixer,
    private readonly scene: () => Scene,
    private readonly names: () => SurfaceNames | null,
  ) {
    const e = sim.events;
    this.off.push(
      e.on('contact', (c) => this.contact(c.a, c.b, c.started)),
      e.on('tick', ({ dt }) => this.tick(dt)),
      e.on('jump', ({ actor }) => { if (actor === sim.player.id) this.step(STEPS.jumpVolume); }),
      e.on('land', ({ actor, speed }) => {
        if (actor === sim.player.id) this.step(Math.min(1, Math.max(LAND.least, speed / this.unit / LAND.full)));
      }),
    );
  }

  /** Every display frame: the scrapes follow how fast things slide now. */
  frame(dt: number): void {
    const loudest = new Map<BodyId, { speed: number; at: Vec3; surface: Surface }>();
    for (const [key, [a, b]] of this.touching) {
      if (!this.sim.bodies.items.has(a) || (!this.sim.bodies.items.has(b) && this.sim.physics.tag(b) === null)) {
        this.touching.delete(key);
        continue;
      }
      const speed = length(sub(this.velocity(a), this.velocity(b))) / this.unit;
      for (const body of [a, b]) {
        const s = this.surface(body);
        if (!s || !this.moves(body) || (loudest.get(body)?.speed ?? 0) >= speed) continue;
        loudest.set(body, { speed, at: this.sim.physics.pose(body).position, surface: s });
      }
    }
    const heard = [...loudest].filter(([, v]) => v.speed > SCRAPE.min).sort((x, y) => y[1].speed - x[1].speed).slice(0, SCRAPE.most);
    const now = new Set(heard.map(([b]) => b));
    for (const [body, v] of heard) {
      let s = this.scrapes.get(body);
      if (!s) {
        s = { loop: this.mixer.loop(scrapeCue(v.surface, this.names())), quiet: 0 };
        this.scrapes.set(body, s);
      }
      const level = Math.min(1, (v.speed - SCRAPE.min) / (SCRAPE.full - SCRAPE.min));
      s.quiet = 0;
      s.loop.at(v.at);
      s.loop.change(level * SCRAPE.volume, SCRAPE.pitchFrom + level * SCRAPE.pitchBy, SCRAPE.ramp);
    }
    for (const [body, s] of this.scrapes) {
      if (now.has(body)) continue;
      if (s.quiet === 0) s.loop.change(0, SCRAPE.pitchFrom, SCRAPE.fade);
      s.quiet += dt;
      if (s.quiet > SCRAPE.linger) {
        s.loop.stop();
        this.scrapes.delete(body);
      }
    }
  }

  /** A bullet hit a body at a point: the surface's bullet impact there. */
  bullet(body: BodyId, at: Vec3): void {
    const s = this.surface(body) ?? GROUND;
    const own = !this.names()?.(s.name);
    this.mixer.play(bulletCue(s, this.names()), own ? { at, volume: BULLET.volume, pitch: BULLET.pitch } : { at });
  }

  dispose(): void {
    for (const f of this.off) f();
    for (const s of this.scrapes.values()) s.loop.stop();
    this.scrapes.clear();
  }

  private get unit(): number {
    return this.sim.player.tuning.unit;
  }

  /** After each step: the steps' clock, and the moving bodies' velocities for the next step's knocks. */
  private tick(dt: number): void {
    const next = new Map<BodyId, Vec3>();
    const heights = new Map<BodyId, number>();
    const water = this.indexed().water;
    for (const [body, item] of this.sim.bodies.items) {
      if (item.motion !== Motion.Dynamic) continue;
      const v = this.sim.physics.velocity(body).linear;
      next.set(body, v);
      const at = this.sim.physics.pose(body).position;
      heights.set(body, at[1]);
      const was = this.heights.get(body);
      const fall = -v[1] / this.unit;
      if (was !== undefined && fall > SPLASH.min && water.some((y) => was >= y && at[1] < y)) {
        this.mixer.play(CUES.splash, { volume: Math.min(1, fall / SPLASH.full), at });
      }
    }
    this.before = next;
    this.heights = heights;
    const p = this.sim.player;
    if (this.sim.driver !== p || p.noclip || p.state.ground === null) {
      this.stepClock = 0;
      return;
    }
    const v = p.state.velocity;
    const speed = Math.hypot(v[0], v[2]) / this.unit;
    if (speed < STEPS.walk) {
      this.stepClock = 0;
      return;
    }
    this.stepClock -= dt;
    if (this.stepClock > 0) return;
    const walking = speed < STEPS.run;
    this.stepClock = walking ? STEPS.walkSeconds : STEPS.runSeconds;
    this.step(walking ? STEPS.walkVolume : STEPS.runVolume);
  }

  /** One footfall on what the player stands on, the feet taking turns. */
  private step(volume: number): void {
    const p = this.sim.player;
    const ground = p.state.ground;
    const s = (ground === null ? null : this.surface(ground)) ?? GROUND;
    this.left = !this.left;
    const feet = p.state.origin;
    this.mixer.play(stepCue(s, this.left, this.names()), { volume, at: feet });
  }

  private contact(a: BodyId, b: BodyId, started: boolean): void {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!started) {
      this.touching.delete(key);
      return;
    }
    if (this.moves(a) || this.moves(b)) this.touching.set(key, [a, b]);
    const speed = length(sub(this.before.get(a) ?? ZERO, this.before.get(b) ?? ZERO)) / this.unit;
    if (speed < KNOCK.min) return;
    // The faster of the two sounds, with its own surface, as a prop knocks on what it hits.
    const body = length(this.before.get(a) ?? ZERO) >= length(this.before.get(b) ?? ZERO) ? a : b;
    const time = this.sim.time;
    if (time - (this.lastKnock.get(body) ?? -Infinity) < KNOCK.gap) return;
    this.lastKnock.set(body, time);
    const s = this.surface(body);
    // Under water a knock is not heard (the splash was).
    if (!s || this.surface(body === a ? b : a)?.family === Family.Water) return;
    const volume = Math.min(1, (speed - KNOCK.min) / (KNOCK.full - KNOCK.min) + KNOCK.min / KNOCK.full);
    this.mixer.play(impactCue(s, speed >= KNOCK.hard, this.names()), { volume, at: this.sim.physics.pose(body).position });
  }

  /** The scene's objects by id and its open water's heights, built again when the scene changes. */
  private indexed(): { byId: Map<ObjectId, SceneObject>; water: number[] } {
    const scene = this.scene();
    if (this.index.scene !== scene) {
      const water = scene.objects.filter((o) => o.kind === ShapeKind.WaterPlane && !o.hidden && !bodyOf(o).solid).map((o) => o.transform.position[1]);
      this.index = { scene, byId: new Map(scene.objects.map((o) => [o.id, o])), water };
    }
    return this.index;
  }

  private moves(body: BodyId): boolean {
    return this.sim.bodies.items.get(body)?.motion === Motion.Dynamic;
  }

  private velocity(body: BodyId): Vec3 {
    return this.moves(body) ? this.sim.physics.velocity(body).linear : ZERO;
  }

  /** The surface of what a body stands for: its first member's, or the scene object its tag names (the ground). */
  private surface(body: BodyId): Surface | null {
    const item = this.sim.bodies.items.get(body);
    const id = item?.members[0]?.id ?? this.sim.physics.tag(body);
    if (!id) return null;
    const o = this.indexed().byId.get(id as ObjectId);
    return o ? surfaceOf(o, item?.motion === Motion.Dynamic) : null;
  }
}

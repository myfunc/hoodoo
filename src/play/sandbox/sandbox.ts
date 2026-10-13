import type { Scene } from '../../model/scene.types';
import { ScrollClassifier, ScrollDevice } from '../../input/scroll-device';
import type { Frame } from '../../render/wire/wireframe';
import type { Hl2HudState, Hl2Weapon } from '../../ui/sandbox/hl2/hl2-hud';
import { SandboxHud } from '../../ui/sandbox/hud';
import { type ActorInput, Button } from '../sim/actor';
import { SIM_DT } from '../sim/clock';
import type { PlayFrame, PlaySim } from '../sim/play-sim';
import { SANDBOX_KEYS, isSnapKey, slotOfKey } from './binds';
import { GameFiles } from './game-files';
import { Loadout } from './loadout';
import { type Notice, Notices } from './notices';
import { Overlay } from './overlay';
import { Props } from './props';
import { SANDBOX_SOUNDS } from './sandbox-sounds';
import { NoticeKind, WeaponId } from './sandbox.enums';
import { UndoStack } from './undo';
import { aimOf } from './weapons/grip';
import { PhysicsGun } from './weapons/physgun';
import type { Weapon, WeaponContext } from './weapons/weapon';

/** What the play session lends Sandbox. */
export interface SandboxHost {
  /** Play's heads-up layer over the picture: Sandbox's HUD and beam go in it. */
  readonly layer: HTMLElement;
  readonly sim: PlaySim;
  /** The scene play started from. */
  readonly scene: Scene;
  /** Where the picture is in the layer. */
  picture(): Frame | null;
  /** Play runs (not paused). */
  active(): boolean;
  /** A menu takes the pointer (true) or gives it back. */
  freePointer(on: boolean): void;
  toast(message: string): void;
  /** Adds a section to the Play panel (Tab), above its buttons. */
  addPanelSection(section: HTMLElement): void;
}

/** The slot strip stays this long after a switch. */
const SLOTS_MS = 1500;
/** A trackpad swipe of this many pixels is one wheel step; a line of a line-mode wheel is this many pixels. */
const WHEEL = { pxPerStep: 50, linePx: 16, lineMode: 1 } as const;

/** Health is not played yet: Half-Life 2's HUD shows it full, as Garry's Mod does. */
const FULL_HEALTH = 100;
const MS_PER_S = 1000;

/** Z joins the hint once something can be undone (the spawn menu). */
const COMMON_HINT = 'Tab setup · Esc exit';

/** What scripted checks may drive (window.__hoodooSandbox): they cannot lock the pointer or click for real. */
export interface SandboxAutomation {
  readonly state: () => { weapon: string; holding: string | null; undo: readonly string[]; notices: readonly string[] };
  /** The game's sounds played lately and the mix's level now (null without game files). */
  readonly heard: () => { recent: readonly string[]; level: number } | null;
  /** Holds or lets go of a button as if the mouse or R did. */
  readonly button: (b: Button, down: boolean) => void;
  readonly key: (code: string) => void;
  /** Wheel steps (+ toward the player). */
  readonly wheel: (steps: number) => void;
  /** Turns the player to look this way (degrees). */
  readonly aim: (yaw: number, pitch: number) => void;
  /** Mouse motion as E-turning or looking. */
  readonly look: (dx: number, dy: number) => void;
  readonly hold: (code: string, down: boolean) => void;
}

/**
 * READ ME — Sandbox (docs/sandbox-mode.md): Garry's Mod's weapons and tools in
 * Play. The session hands it keys and the wheel first (it keeps the ones it
 * uses), the mouse when a weapon wants it, every fixed step's input (the weapon
 * acts before the world moves) and every display frame (HUD and beam). It owns
 * the loadout, the props' state, the session's undo list and the notices.
 */
export class Sandbox {
  private readonly props: Props;
  private readonly undo = new UndoStack();
  private readonly notices = new Notices();
  private readonly loadout = new Loadout();
  private readonly weapons: ReadonlyMap<WeaponId, Weapon> = new Map([[WeaponId.PhysicsGun, new PhysicsGun()]]);
  private readonly hud = new SandboxHud();
  private readonly overlay = new Overlay();
  private readonly classifier = new ScrollClassifier();
  /** Keys Sandbox answers to (the rest move the player as in Play). */
  private readonly taken: ReadonlySet<string> = new Set([SANDBOX_KEYS.undo, ...SANDBOX_KEYS.slots]);
  private wheelPx = 0;
  private reach = 0;
  private use = false;
  private snap = false;
  private prev: ReadonlySet<Button> = new Set();
  private readonly forced = new Set<Button>();
  private slotsUntil = 0;
  /** When the weapon last changed (performance.now), for Half-Life 2's selection. */
  private switchedAt: number | null = null;
  /** The player's Garry's Mod: its hands, guns and sounds once its files are read. */
  private readonly game: GameFiles;

  constructor(private readonly host: SandboxHost) {
    this.props = new Props(host.sim, host.scene);
    host.layer.classList.add('is-sandbox');
    host.layer.append(this.overlay.canvas, this.hud.el);
    this.game = new GameFiles({ mount: (cs) => this.overlay.canvas.after(...cs), notify: (text) => this.notify(text, NoticeKind.Hint) });
    host.addPanelSection(this.game.section.el);
    this.automate();
    void this.game.start();
  }

  get weapon(): Weapon {
    return this.weapons.get(this.loadout.current.weapon) as Weapon;
  }

  /** A key went down or up; true keeps it from the player's moves. */
  key(code: string, down: boolean): boolean {
    if (code === SANDBOX_KEYS.use) this.use = down;
    if (isSnapKey(code)) this.snap = down;
    if (!this.taken.has(code)) return false;
    if (!down || !this.host.active()) return true;
    if (code === SANDBOX_KEYS.undo) this.undoLast();
    const slot = slotOfKey(code);
    if (slot) this.switchWeapon(() => this.loadout.pick(slot));
    return true;
  }

  /** The wheel: the held body's distance while the Physics Gun holds one, else the next or previous weapon. */
  wheel(e: WheelEvent): boolean {
    if (!this.host.active()) return true;
    const px = e.deltaMode === WHEEL.lineMode ? e.deltaY * WHEEL.linePx : e.deltaY;
    const notched = this.classifier.classify(e) === ScrollDevice.Wheel;
    if (this.weapon.wantsWheel?.()) {
      this.reach += notched ? Math.sign(px) : px / WHEEL.pxPerStep;
      return true;
    }
    this.wheelPx = notched ? Math.sign(px) * WHEEL.pxPerStep : this.wheelPx + px;
    const steps = Math.trunc(this.wheelPx / WHEEL.pxPerStep);
    if (steps) {
      this.wheelPx -= steps * WHEEL.pxPerStep;
      this.switchWeapon(() => this.loadout.step(Math.sign(steps)));
    }
    return true;
  }

  /** Mouse motion; true when the weapon took it (E turns what the Physics Gun holds). */
  look(dx: number, dy: number): boolean {
    return this.host.active() && (this.weapon.look?.(dx, dy, this.context()) ?? false);
  }

  /** One fixed step's input: the weapon acts on it, the player gets it without the wheel. */
  input(raw: ActorInput): ActorInput {
    const held = new Set([...raw.buttons, ...this.forced]);
    const pressed = new Set([...held].filter((b) => !this.prev.has(b)));
    this.prev = held;
    const reach = this.reach;
    this.reach = 0;
    this.weapon.step({ held, pressed, reach }, this.context());
    return { ...raw, wheel: 0 };
  }

  /** Every display frame: the HUD's text and the gun's sound (the canvases draw in `paint`). */
  frame(): void {
    const now = performance.now();
    const visible = this.notices.visible(now);
    const hl2 = this.game.hud;
    this.host.layer.classList.toggle('is-hl2', !!hl2);
    this.hud.el.classList.toggle('is-hl2', !!hl2);
    this.hud.update({
      weapon: this.loadout.current.name,
      hint: `${this.weapon.hint} · ${COMMON_HINT}`,
      slots: now < this.slotsUntil ? this.loadout.slots() : null,
      notices: visible.map(({ notice, opacity }) => ({ id: notice.id, text: notice.text, kind: notice.kind, opacity })),
    });
    this.game.sounds?.weapon(this.weapon.id, this.weapon.view(), this.host.active());
  }

  /** The canvases (beam and halos, the guns, Half-Life 2's HUD) for a picture of frame `f`. */
  paint(f: PlayFrame): void {
    const picture = this.host.picture();
    const view = this.weapon.view();
    const hands = this.game.hands?.has(this.weapon.id) ? this.game.hands : null;
    this.overlay.draw(f, picture, view, this.host.sim, !hands);
    if (hands && picture) hands.draw(f, picture, view, this.weapon.id, this.host.sim);
    const hl2 = this.game.hud;
    const now = performance.now();
    if (hl2 && picture) hl2.draw(picture, this.hl2State(now, this.notices.visible(now).map((v) => v.notice)));
  }

  /** What Half-Life 2's HUD shows: full health, the loadout by slot, the notices with their ages. */
  private hl2State(now: number, notices: readonly Notice[]): Hl2HudState {
    const slots = new Map<number, Hl2Weapon[]>();
    for (const w of this.loadout.weapons) slots.set(w.slot, [...(slots.get(w.slot) ?? []), { id: w.weapon, name: w.name }]);
    return {
      health: FULL_HEALTH,
      selection: { slots, current: this.loadout.current.weapon, since: this.switchedAt === null ? null : (now - this.switchedAt) / MS_PER_S },
      notices: notices.map((n) => ({ id: n.id, text: n.text, kind: n.kind, age: (now - n.at) / MS_PER_S, life: n.life / MS_PER_S })),
    };
  }

  dispose(): void {
    this.game.dispose();
    this.weapon.holster(this.context());
    this.hud.el.remove();
    this.overlay.canvas.remove();
    this.host.layer.classList.remove('is-sandbox', 'is-hl2');
    delete (window as unknown as Record<string, unknown>).__hoodooSandbox;
  }

  private notify(text: string, kind: NoticeKind, sound?: string): void {
    this.notices.push(text, kind, performance.now());
    if (sound) this.game.sounds?.play(sound);
  }

  private undoLast(): void {
    const label = this.undo.undo();
    this.notify(label ? `Undone ${label}` : 'Nothing to undo', NoticeKind.Undo, label ? SANDBOX_SOUNDS.undo : undefined);
  }

  /** Changes the weapon (the old one lets go) and shows the slot strip. */
  private switchWeapon(change: () => boolean): void {
    const before = this.weapon;
    if (change()) before.holster(this.context());
    this.switchedAt = performance.now();
    this.slotsUntil = this.switchedAt + SLOTS_MS;
  }

  private context(): WeaponContext {
    const sim = this.host.sim;
    const eye = sim.driver.eye();
    return {
      physics: sim.physics, props: this.props, unit: sim.player.tuning.unit, dt: SIM_DT, time: sim.time,
      eye, aim: aimOf(eye.yaw, eye.pitch), use: this.use, snap: this.snap,
      notify: (text, kind, sound) => this.notify(text, kind, sound),
    };
  }

  private automate(): void {
    const hook: SandboxAutomation = {
      state: () => {
        const held = this.weapon.view().held;
        return {
          weapon: this.loadout.current.name,
          holding: held ? this.host.sim.physics.tag(held.body) : null,
          undo: this.undo.labels,
          notices: this.notices.visible(performance.now()).map((n) => n.notice.text),
        };
      },
      heard: () => this.game.sounds?.heard() ?? null,
      button: (b, down) => (down ? this.forced.add(b) : this.forced.delete(b)),
      key: (code) => { this.key(code, true); this.key(code, false); },
      wheel: (steps) => { this.reach += this.weapon.wantsWheel?.() ? steps : 0; },
      aim: (yaw, pitch) => { this.host.sim.player.yaw = yaw; this.host.sim.player.pitch = pitch; },
      look: (dx, dy) => { if (!this.look(dx, dy)) this.host.sim.driver.look(dx, dy); },
      hold: (code, down) => { this.key(code, down); },
    };
    (window as unknown as Record<string, unknown>).__hoodooSandbox = hook;
  }
}

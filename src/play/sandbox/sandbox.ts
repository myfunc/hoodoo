import { BooleanMode } from '../../model/scene.enums';
import type { Scene } from '../../model/scene.types';
import { ScrollClassifier, ScrollDevice } from '../../input/scroll-device';
import type { Thumbnailer } from '../../render/thumbs';
import type { Frame } from '../../render/wire/wireframe';
import type { Hl2HudState, Hl2Weapon } from '../../ui/sandbox/hl2/hl2-hud';
import { type HudTool, SandboxHud } from '../../ui/sandbox/hud';
import { SpawnMenu } from '../../ui/sandbox/spawn-menu';
import { HistoryList } from '../../ui/sandbox/history-list';
import { SkyPage } from '../../ui/sandbox/sky-page';
import { SKY_LIBRARY } from '../../assets/sky.presets';
import { ToolMenu } from '../../ui/sandbox/tool-menu';
import { contraption } from '../../world/joints';
import type { World } from '../../world/world';
import { type ActorInput, Button } from '../sim/actor';
import { SIM_DT } from '../sim/clock';
import type { PlayFrame, PlaySim } from '../sim/play-sim';
import { SANDBOX_KEYS, isSnapKey, slotOfKey } from './binds';
import { GameFiles } from './game-files';
import { SandboxJoints } from './joints';
import { objectMenu } from './object-menu';
import { Loadout } from './loadout';
import { type Notice, Notices } from './notices';
import { Overlay } from './overlay';
import { Props } from './props';
import { SANDBOX_SOUNDS } from './sandbox-sounds';
import { NoticeKind, WeaponId } from './sandbox.enums';
import { SceneEdits } from './scene-edits';
import { SPAWN_LIMIT, tracedCount } from './spawn';
import { SpawnCategory, findSpawnItem, listOf, spawnLists } from './spawn-lists';
import { itemOf, onMyObjectsChanged, removeMyObject, saveMyObject } from '../../io/my-objects';
import type { ObjectId } from '../../model/scene.ids';
import { ToolButton, type ToolId } from './tools/tool';
import { ToolHost } from './tool-host';
import { ContextMenu } from './context-menu';
import type { SandboxAutomation } from './sandbox-automation';
import { createTools } from './tools/tools';
import { aimOf } from './weapons/grip';
import { PhysicsGun } from './weapons/physgun';
import { ToolGun } from './weapons/toolgun';
import type { Weapon, WeaponContext } from './weapons/weapon';

/** What the play session lends Sandbox. */
export interface SandboxHost {
  /** Play's heads-up layer over the picture: Sandbox's HUD and beam go in it. */
  readonly layer: HTMLElement;
  readonly sim: PlaySim;
  /** The scene play started from. */
  readonly scene: Scene;
  /** The editor's scene: Sandbox's spawns and edits go into it (scene-edits.ts). */
  readonly world: World;
  /** The app's ray-traced icon maker (the spawn menu's icons). */
  readonly thumbs: Thumbnailer;
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

const SKY_TAB = 'Sky';
/** The slot strip stays this long after a switch. */
const SLOTS_MS = 1500;
/** A trackpad swipe of this many pixels is one wheel step; a line of a line-mode wheel is this many pixels. */
const WHEEL = { pxPerStep: 50, linePx: 16, lineMode: 1 } as const;

/** Health is not played yet: Half-Life 2's HUD shows it full, as Garry's Mod does. */
const FULL_HEALTH = 100;
const MS_PER_S = 1000;
/** Garry's Mod's tool help box flashes on a shot and fades this fast (seconds). */
const TOOL_FLASH_S = 0.3;

/** Z joins the hint once something can be undone (the spawn menu). */
const COMMON_HINT = 'Tab setup · Esc exit';

/**
 * READ ME — Sandbox (docs/sandbox-mode.md): Garry's Mod's weapons and tools in
 * Play. The session hands it keys and the wheel first (it keeps the ones it
 * uses), the mouse when a weapon wants it, every fixed step's input (the weapon
 * acts before the world moves) and every display frame (HUD and beam). It owns
 * the loadout with the Physics Gun and the Tool Gun, the spawn menu and its Tools
 * column, the props' state, the scene edits and the notices.
 */
export class Sandbox {
  private readonly props: Props;
  /** The scene's welds and other joints in physics. */
  private readonly joints: SandboxJoints;
  /** The context menu (C) and its world clicking. */
  private readonly contextMenu: ContextMenu;
  /** What the Tool Gun's tools see: the traced aim and the scene. */
  private readonly tools: ToolHost;
  private readonly edits: SceneEdits;
  private readonly menu: SpawnMenu;
  /** The context menu's History of this play session, on the left. */
  private readonly history: HistoryList;
  private readonly offHistory: () => void;
  /** Q › My Objects follows the list, saved here, in the editor or in another window. */
  private readonly offMine: () => void;
  private readonly notices = new Notices();
  private readonly loadout = new Loadout();
  private readonly toolgun = new ToolGun(createTools(), {
    trace: (eye, aim) => this.tools.trace(eye, aim),
    context: () => this.tools.context(),
  });
  private readonly weapons: ReadonlyMap<WeaponId, Weapon> = new Map<WeaponId, Weapon>([[WeaponId.PhysicsGun, new PhysicsGun()], [WeaponId.ToolGun, this.toolgun]]);
  private readonly toolMenu: ToolMenu;
  private readonly hud = new SandboxHud();
  private readonly overlay = new Overlay();
  private readonly classifier = new ScrollClassifier();
  /** Keys Sandbox answers to (the rest move the player as in Play). */
  private readonly taken: ReadonlySet<string> = new Set([SANDBOX_KEYS.undo, SANDBOX_KEYS.spawnMenu, SANDBOX_KEYS.contextMenu, ...SANDBOX_KEYS.slots]);
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
    this.joints = new SandboxJoints(host.sim);
    this.joints.sync(host.world.scene);
    this.edits = new SceneEdits(host.world, host.sim);
    // What the Remover (or an object's menu) takes away dissolves where play shows it; a carved object's hollow does not show.
    this.edits.removing = (ids) => this.overlay.dissolve(host.sim.frame(1).scene.objects.filter((o) => ids.has(o.id) && o.boolean !== BooleanMode.Negative), host.sim.time);
    this.tools = new ToolHost(host.world, host.sim, this.edits, this.joints);
    this.menu = new SpawnMenu(host.thumbs, spawnLists((id) => this.forgetMine(id)), (key) => void this.spawn(key));
    this.contextMenu = new ContextMenu({
      menu: this.menu, layer: host.layer, picture: () => host.picture(), camera: () => host.sim.frame(1).camera,
      active: () => host.active(), freePointer: (on) => host.freePointer(on), opened: () => this.toolMenu.show(this.toolgun.tool.id),
      fire: (eye, aim) => { if (this.weapon === this.toolgun) this.toolgun.shootAt(ToolButton.Primary, eye, aim, host.sim.time); },
      objectMenu: (eye, aim) => {
        const hit = this.tools.trace(eye, aim);
        return hit ? objectMenu(hit.object, { sim: host.sim, props: this.props, edits: this.edits, whole: (id) => this.tools.context().whole(id), save: (id) => this.saveMine(id) }) : [];
      },
    });
    this.toolMenu = new ToolMenu(host.thumbs, this.toolgun.tools, (id) => this.pickTool(id as ToolId));
    this.menu.dock(this.toolMenu.el);
    this.history = new HistoryList((position) => {
      this.edits.jumpTo(position);
      this.menu.setCount(tracedCount(host.world.scene), SPAWN_LIMIT);
    });
    this.menu.dockLeft(this.history.el);
    this.history.show(this.edits.steps());
    this.offHistory = host.world.events.on('history', () => this.history.show(this.edits.steps()));
    this.offMine = onMyObjectsChanged(() => this.menu.setList(listOf(SpawnCategory.Mine, (x) => this.forgetMine(x))));
    this.menu.addTab(SKY_TAB, () => {
      const page = new SkyPage(host.thumbs, SKY_LIBRARY, (p) => this.edits.setSky(p.sky, `Sky ${p.name}`));
      page.mark(SKY_LIBRARY.find((p) => p.sky === host.world.scene.sky)?.name ?? null);
      return page.el;
    });
    host.layer.classList.add('is-sandbox');
    host.layer.append(this.overlay.canvas, this.hud.el, this.menu.el, this.menu.cursor);
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
    if (code === SANDBOX_KEYS.spawnMenu) {
      this.spawnMenu(down && this.host.active());
      return true;
    }
    if (code === SANDBOX_KEYS.contextMenu) {
      this.contextMenu.key(down);
      return true;
    }
    if (!down || !this.host.active()) return true;
    if (code === SANDBOX_KEYS.undo) this.undoLast(this.snap);
    const slot = slotOfKey(code);
    if (slot) this.switchWeapon(() => this.loadout.pick(slot));
    return true;
  }

  /** The wheel: the held body's distance while the Physics Gun holds one, else the next or previous weapon. */
  wheel(e: WheelEvent): boolean {
    if (!this.host.active()) return true;
    const px = e.deltaMode === WHEEL.lineMode ? e.deltaY * WHEEL.linePx : e.deltaY;
    if (this.menu.open) {
      this.menu.scroll(px);
      return true;
    }
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
    if (!this.host.active()) return false;
    if (this.menu.open) {
      this.menu.moveCursor(dx, dy);
      return true;
    }
    return this.weapon.look?.(dx, dy, this.context()) ?? false;
  }

  /** One fixed step's input: the weapon acts on it, the player gets it without the wheel. */
  input(raw: ActorInput): ActorInput {
    const held = new Set([...raw.buttons, ...this.forced]);
    const pressed = new Set([...held].filter((b) => !this.prev.has(b)));
    this.prev = held;
    // The spawn menu has the mouse: its button clicks there, the gun rests.
    if (this.menu.open) {
      this.contextMenu.buttons(pressed.has(Button.Attack), pressed.has(Button.Attack2));
      this.weapon.step({ held: new Set(), pressed: new Set(), reach: 0 }, this.context());
      return { ...raw, buttons: new Set([...raw.buttons].filter((b) => b !== Button.Attack && b !== Button.Attack2)), wheel: 0 };
    }
    const reach = this.reach;
    this.reach = 0;
    this.weapon.step({ held, pressed, reach }, this.context());
    const body = this.weapon.view().held?.body;
    // What it holds and all joined to it move: they stay where play leaves them.
    if (body !== undefined) this.edits.touch(contraption(this.host.world.scene, this.host.sim.bodies.items.get(body)?.members.map((m) => m.id) ?? []));
    return { ...raw, wheel: 0 };
  }

  /** The editor's scene changed during play: the props follow it (PlaySim.sync has the bodies). */
  sync(scene: Scene): void {
    this.props.sync(scene);
    this.joints.sync(scene);
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
      // The spawn menu covers the tool's help, as Garry's Mod's does.
      tool: this.weapon === this.toolgun && !this.menu.open ? this.hudTool() : null,
      picture: this.host.picture(),
    });
    this.game.sounds?.weapon(this.weapon.id, this.weapon.view(), this.host.active());
  }

  /** The Tool Gun's tool for the info panel, flashing after a shot. */
  private hudTool(): HudTool {
    const t = this.toolgun.tool;
    const at = this.toolgun.firedAt;
    const flash = at === null ? 0 : Math.max(0, 1 - (this.host.sim.time - at) / TOOL_FLASH_S);
    return { name: t.name, about: t.about, lines: t.lines.map((l) => ({ chip: l.button, text: l.text })), flash };
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

  /** Play ends: what was spawned or picked up stays where it came to rest (one History step). */
  keep(): void {
    this.edits.keep();
  }

  dispose(): void {
    this.contextMenu.dispose();
    this.offHistory();
    this.offMine();
    this.joints.dispose();
    this.game.dispose();
    this.weapon.holster(this.context());
    this.hud.el.remove();
    this.menu.el.remove();
    this.menu.cursor.remove();
    this.overlay.canvas.remove();
    this.host.layer.classList.remove('is-sandbox', 'is-hl2');
    delete (window as unknown as Record<string, unknown>).__hoodooSandbox;
  }

  private notify(text: string, kind: NoticeKind, sound?: string): void {
    this.notices.push(text, kind, performance.now());
    if (sound) this.game.sounds?.play(sound);
  }

  /** Z takes back the newest step; Shift+Z puts back the one undone last. */
  private undoLast(redo: boolean): void {
    const label = redo ? this.edits.redo() : this.edits.undo();
    const text = label ? `${redo ? 'Redone' : 'Undone'} ${label}` : redo ? 'Nothing to redo' : 'Nothing to undo';
    this.notify(text, NoticeKind.Undo, label ? SANDBOX_SOUNDS.undo : undefined);
    this.menu.setCount(tracedCount(this.host.world.scene), SPAWN_LIMIT);
  }

  /** Q held opens the spawn menu (the mouse moves its cursor); let go, the mouse aims again. */
  private spawnMenu(open: boolean): void {
    if (open === this.menu.open) return;
    this.menu.setOpen(open);
    if (!open) return;
    this.menu.setCount(tracedCount(this.host.world.scene), SPAWN_LIMIT);
    this.toolMenu.show(this.toolgun.tool.id);
  }

  /** The pointer is caught again: a pinned context menu closes. */
  pointerCaught(): void {
    this.contextMenu.pointerCaught();
  }

  /** A tool from the Tools column: into the Tool Gun, and the Tool Gun out. */
  private pickTool(id: ToolId): void {
    this.toolgun.select(id);
    this.toolMenu.show(this.toolgun.tool.id);
    if (this.weapon !== this.toolgun) this.switchWeapon(() => this.loadout.take(WeaponId.ToolGun));
  }

  /** A spawn list's item where the player aims; past the tracer's limit, Garry's Mod's notice instead. */
  private spawn(key: string): boolean {
    const item = findSpawnItem(key);
    if (!item) return false;
    const done = this.edits.spawn(item);
    if (!done) this.notify(`Props limit reached (${SPAWN_LIMIT})`, NoticeKind.Limit, SANDBOX_SOUNDS.limit);
    this.menu.setCount(tracedCount(this.host.world.scene), SPAWN_LIMIT);
    return done;
  }

  /** The object as the player sees it (its groups, what is welded to it) into My Objects. */
  private saveMine(id: ObjectId): void {
    const scene = this.host.world.scene;
    const part = itemOf(scene, id);
    const o = scene.objects.find((x) => x.id === id);
    const top = o?.groupId ? part.groups.find((g) => g.parentId === null) : null;
    const saved = saveMyObject(top?.name ?? o?.name ?? 'Object', part);
    this.notify(saved ? `Saved ${saved.name} to My Objects` : 'Could not save: the browser\'s storage is full', saved ? NoticeKind.Info : NoticeKind.Limit);
  }

  private forgetMine(id: string): void {
    removeMyObject(id);
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
          undo: this.edits.labels,
          notices: this.notices.visible(performance.now()).map((n) => n.notice.text),
        };
      },
      heard: () => this.game.sounds?.heard() ?? null,
      button: (b, down) => (down ? this.forced.add(b) : this.forced.delete(b)),
      key: (code) => { this.key(code, true); this.key(code, false); },
      wheel: (steps) => { this.reach += this.weapon.wantsWheel?.() ? steps : 0; },
      aim: (yaw, pitch) => { this.host.sim.player.yaw = yaw; this.host.sim.player.pitch = pitch; },
      spawn: (key) => this.spawn(key),
      tool: (id) => this.pickTool(id as ToolId),
      aimed: () => {
        const eye = this.host.sim.driver.eye();
        return this.tools.trace(eye.position, aimOf(eye.yaw, eye.pitch))?.object.id ?? null;
      },
      look: (dx, dy) => { if (!this.look(dx, dy)) this.host.sim.driver.look(dx, dy); },
      hold: (code, down) => { this.key(code, down); },
    };
    (window as unknown as Record<string, unknown>).__hoodooSandbox = hook;
  }
}

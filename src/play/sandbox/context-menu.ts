import type { MenuItem } from '../../ui/kit/controls';
import type { SpawnMenu } from '../../ui/sandbox/spawn-menu';
import type { Frame } from '../../render/wire/wireframe';
import type { Camera } from '../../model/scene.types';
import type { Vec3 } from '../../core/vec3';
import { ContextWorld } from './context-world';

/**
 * READ ME — Garry's Mod's context menu (C): the chosen tool's panel over the
 * world, the menu's cursor working it. Held, it closes when C is let go; a tap
 * pins it open and frees the real pointer (drag a slider, type a number) until
 * the next C or a click that catches the pointer again. On the world, Mouse 1
 * fires the Tool Gun at the cursor and Mouse 2 opens an object's menu
 * (context-world.ts).
 */

/** A press of C shorter than this pins the context menu open. */
const TAP_MS = 250;

export interface ContextMenuHost {
  readonly menu: SpawnMenu;
  readonly layer: HTMLElement;
  picture(): Frame | null;
  camera(): Camera;
  /** Play runs (not paused). */
  active(): boolean;
  /** A menu takes the pointer (true) or gives it back. */
  freePointer(on: boolean): void;
  /** The menu opened: the tool's panel shows the tool in the gun. */
  opened(): void;
  fire(eye: Vec3, aim: Vec3): void;
  objectMenu(eye: Vec3, aim: Vec3): readonly MenuItem[];
}

export class ContextMenu {
  private openedAt = 0;
  private pinned = false;
  private readonly world: ContextWorld;

  constructor(private readonly host: ContextMenuHost) {
    this.world = new ContextWorld({
      layer: host.layer, picture: () => host.picture(), camera: () => host.camera(),
      inMenu: (t) => host.menu.contains(t), fire: (eye, aim) => host.fire(eye, aim), menu: (eye, aim) => host.objectMenu(eye, aim),
    });
  }

  /** C went down or up. */
  key(down: boolean): void {
    const menu = this.host.menu;
    if (down) {
      if (this.pinned) return this.close();
      if (!this.host.active() || menu.open) return;
      this.openedAt = performance.now();
      menu.setOpen(true, true);
      this.host.opened();
      return;
    }
    if (!menu.open || this.pinned) return;
    if (performance.now() - this.openedAt < TAP_MS) this.pin();
    else menu.setOpen(false);
  }

  /** A fixed step's mouse buttons while the menu is open with its own cursor (C held). */
  buttons(attack: boolean, attack2: boolean): void {
    const menu = this.host.menu;
    const at = menu.isContext ? menu.cursorPoint() : null;
    if (attack && !menu.clickAtCursor() && at) this.world.click(0, ...at);
    if (attack2 && at) {
      this.pin();
      this.world.click(2, ...at);
    }
  }

  /** The pointer is caught again: a pinned context menu closes. */
  pointerCaught(): void {
    if (!this.pinned) return;
    this.pinned = false;
    this.world.stop();
    this.host.menu.setOpen(false);
  }

  dispose(): void {
    this.world.stop();
  }

  /** The menu stays open with the real pointer; its clicks on the world fire or open an object's menu. */
  private pin(): void {
    if (this.pinned) return;
    this.pinned = true;
    this.host.menu.hideCursor();
    this.host.freePointer(true);
    this.world.listen();
  }

  private close(): void {
    const freed = this.pinned;
    this.pointerCaught();
    this.host.menu.setOpen(false);
    if (freed) this.host.freePointer(false);
  }
}

import { type Vec3, add, normalize, scale } from '../../core/vec3';
import type { Frame } from '../../render/wire/wireframe';
import { type MenuItem, openMenu } from '../../ui/kit/controls';
import { cameraBasis } from '../../world/camera-math';
import type { Camera } from '../../model/scene.types';

/**
 * READ ME — the world under the context menu (C), as Garry's Mod's: Mouse 1 on
 * the world fires the Tool Gun at the point under the cursor (its world
 * clicking), Mouse 2 on an object opens that object's menu. Held, the menu's
 * own cursor says where; pinned, the real pointer does, and its clicks on the
 * world are taken here before they would catch the pointer again.
 */

export interface ContextWorldHost {
  /** The play layer (its clicks), the picture's place in it, and the camera of the frame shown. */
  readonly layer: HTMLElement;
  picture(): Frame | null;
  camera(): Camera;
  /** The menu's panels, whose clicks are theirs. */
  inMenu(target: EventTarget | null): boolean;
  /** Mouse 1 on the world: fire the Tool Gun along this ray. */
  fire(eye: Vec3, aim: Vec3): void;
  /** Mouse 2 on the world: what the object under this ray offers, or nothing. */
  menu(eye: Vec3, aim: Vec3): readonly MenuItem[];
}

const LEFT = 0;
const RIGHT = 2;

export class ContextWorld {
  private readonly off: (() => void)[] = [];

  constructor(private readonly host: ContextWorldHost) {}

  /** The ray from the eye through a point of the page (client pixels), or null off the picture. */
  rayAt(clientX: number, clientY: number): { eye: Vec3; aim: Vec3 } | null {
    const picture = this.host.picture();
    if (!picture) return null;
    const r = this.host.layer.getBoundingClientRect();
    const nx = ((clientX - r.left - picture.x) / picture.w) * 2 - 1;
    const ny = 1 - ((clientY - r.top - picture.y) / picture.h) * 2;
    if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return null;
    const b = cameraBasis(this.host.camera(), picture.w / picture.h);
    const aim = normalize(add(b.forward, add(scale(b.right, nx * b.halfHeight * b.aspect), scale(b.up, ny * b.halfHeight))));
    return { eye: b.origin, aim };
  }

  /** A click at a page point: Mouse 1 fires, Mouse 2 opens the object's menu there. True when it was the world's. */
  click(button: number, clientX: number, clientY: number): boolean {
    const ray = this.rayAt(clientX, clientY);
    if (!ray) return false;
    if (button === LEFT) this.host.fire(ray.eye, ray.aim);
    else if (button === RIGHT) {
      const items = this.host.menu(ray.eye, ray.aim);
      if (items.length) openMenu(clientX, clientY, items);
    }
    return true;
  }

  /** The real pointer works the menu (pinned): its clicks on the world come here instead of catching the pointer. */
  listen(): void {
    this.stop();
    const take = (e: MouseEvent) => {
      if (this.host.inMenu(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'mousedown') this.click(e.button, e.clientX, e.clientY);
    };
    const swallow = (e: Event) => {
      if (this.host.inMenu(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const layer = this.host.layer;
    layer.addEventListener('mousedown', take, true);
    layer.addEventListener('click', swallow, true);
    layer.addEventListener('contextmenu', swallow, true);
    this.off.push(
      () => layer.removeEventListener('mousedown', take, true),
      () => layer.removeEventListener('click', swallow, true),
      () => layer.removeEventListener('contextmenu', swallow, true),
    );
  }

  stop(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }
}

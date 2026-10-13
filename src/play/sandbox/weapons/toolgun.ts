import type { Vec3 } from '../../../core/vec3';
import { Button } from '../../sim/actor';
import { WeaponId } from '../sandbox.enums';
import { type Tool, ToolButton, type ToolContext, type ToolHit, type ToolId } from '../tools/tool';
import type { Weapon, WeaponContext, WeaponInput, WeaponView } from './weapon';

/**
 * READ ME — Garry's Mod's Tool Gun (docs/sandbox-mode.md › Tool Gun): one tool at
 * a time, chosen in the spawn menu's Tools column. Mouse 1, Mouse 2 and R each
 * fire once per press: the aim is traced without a range limit through the
 * picture's objects, and the tool acts on the object it meets. A shot that did
 * something shows (the tracer, the rings at the hit, the gun's kick and sound).
 */

/** What the session lends the gun: the trace along the aim and the tools' access to the scene. */
export interface ToolGunHost {
  trace(eye: Vec3, aim: Vec3): ToolHit | null;
  context(): ToolContext;
}

const PRESSES: readonly (readonly [Button, ToolButton])[] = [
  [Button.Attack, ToolButton.Primary],
  [Button.Attack2, ToolButton.Secondary],
  [Button.Reload, ToolButton.Reload],
];
const IDLE: WeaponView = { firing: false, end: null, held: null, flash: null, shot: null };

export class ToolGun implements Weapon {
  readonly id = WeaponId.ToolGun;
  readonly hint = 'Hold Q to pick a tool';
  private current: Tool;
  private shot: WeaponView['shot'] = null;

  constructor(readonly tools: readonly Tool[], private readonly host: ToolGunHost) {
    this.current = tools[0];
  }

  get tool(): Tool {
    return this.current;
  }

  select(id: ToolId): void {
    this.current = this.tools.find((t) => t.id === id) ?? this.current;
  }

  /** When the last shot that did something was fired (simulation seconds), or null. */
  get firedAt(): number | null {
    return this.shot?.time ?? null;
  }

  step(input: WeaponInput, ctx: WeaponContext): void {
    const button = PRESSES.find(([b]) => input.pressed.has(b))?.[1];
    if (!button) return;
    const hit = this.host.trace(ctx.eye.position, ctx.aim);
    if (hit && this.current.use(button, hit, this.host.context())) this.shot = { end: hit.point, time: ctx.time };
  }

  view(): WeaponView {
    return { ...IDLE, shot: this.shot };
  }

  holster(): void {
    this.shot = null;
  }
}

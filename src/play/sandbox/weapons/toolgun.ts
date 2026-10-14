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
const MS_PER_S = 1000;
const IDLE: WeaponView = { firing: false, end: null, held: null, flash: null, shot: null };

export class ToolGun implements Weapon {
  readonly id = WeaponId.ToolGun;
  readonly hint = 'Hold Q to pick a tool';
  private current: Tool;
  private shot: WeaponView['shot'] = null;
  /** A brush stroke under way: its button and when it dabs next (simulation seconds). */
  private stroke: { readonly button: ToolButton; next: number } | null = null;
  /** The stroke under way has been heard (its first shot that did something). */
  private heard = false;
  /** A press a tool holds and drags (Resize): its button and where it was pressed. */
  private drag: { readonly button: ToolButton; readonly point: Vec3 } | null = null;

  constructor(readonly tools: readonly Tool[], private readonly host: ToolGunHost) {
    this.current = tools[0];
  }

  get tool(): Tool {
    return this.current;
  }

  select(id: ToolId): void {
    if (this.stroke) this.endStroke();
    this.cancelDrag();
    this.current = this.tools.find((t) => t.id === id) ?? this.current;
  }

  /** When the last shot that did something was fired (simulation seconds), or null. */
  get firedAt(): number | null {
    return this.shot?.time ?? null;
  }

  step(input: WeaponInput, ctx: WeaponContext): void {
    // A dragged press acts once, when it is let go.
    if (this.drag) {
      const held = PRESSES.find(([, t]) => t === this.drag?.button)?.[0];
      if (held && input.held.has(held)) return;
      const point = this.drag.point;
      this.drag = null;
      this.heard = false;
      if (this.current.end?.(this.host.context())) this.shot = { end: point, time: ctx.time };
      return;
    }
    // A brush (a tool that repeats) keeps going while its button is held: one stroke, one History step.
    if (this.stroke) {
      const held = PRESSES.find(([, t]) => t === this.stroke?.button)?.[0];
      if (!held || !input.held.has(held)) return this.endStroke();
      if (ctx.time < this.stroke.next) return;
      this.stroke.next = ctx.time + (this.current.repeat ?? 0) / MS_PER_S;
      this.shootAt(this.stroke.button, ctx.eye.position, ctx.aim, ctx.time, true);
      return;
    }
    const button = PRESSES.find(([b]) => input.pressed.has(b))?.[1];
    if (!button) return;
    if (this.current.begin) {
      const hit = this.host.trace(ctx.eye.position, ctx.aim);
      if (hit && this.current.begin(button, hit, this.host.context())) {
        this.drag = { button, point: hit.point };
        return;
      }
    }
    const repeat = this.current.repeat;
    this.heard = false;
    if (repeat && button !== ToolButton.Reload) {
      this.host.context().edits.beginStroke(this.current.name);
      this.stroke = { button, next: ctx.time + repeat / MS_PER_S };
    }
    this.fire(button, ctx);
  }

  private fire(button: ToolButton, ctx: WeaponContext): void {
    this.shootAt(button, ctx.eye.position, ctx.aim, ctx.time);
  }

  /** One use along any ray (the context menu fires at the point under its cursor); `repeat`: a brush's later dab. */
  shootAt(button: ToolButton, eye: Vec3, aim: Vec3, time: number, repeat = false): void {
    const hit = this.host.trace(eye, aim);
    if (!hit || !this.current.use(button, hit, this.host.context())) return;
    // A stroke is heard once: a dab after a quiet start still counts as its first.
    this.shot = { end: hit.point, time, repeat: repeat && this.heard };
    this.heard = true;
  }

  private cancelDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.current.cancel?.();
  }

  private endStroke(): void {
    this.stroke = null;
    this.host.context().edits.endStroke();
  }

  /** The tool may take the mouse (Easy Weld turning its prop). */
  look(dx: number, dy: number, ctx: WeaponContext): boolean {
    return this.current.look?.(dx, dy, this.host.context(), ctx.snap) ?? false;
  }

  view(): WeaponView {
    const ghost = this.drag ? this.current.preview?.(this.host.context()) ?? null : null;
    return { ...IDLE, shot: this.shot, screen: this.current.name, ghost };
  }

  holster(): void {
    this.shot = null;
    this.cancelDrag();
    if (this.stroke) this.endStroke();
  }
}

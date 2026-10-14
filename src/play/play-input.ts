import { KEY, TEXT_TAGS } from '../core/keys';
import type { Vec3 } from '../core/vec3';
import { LookFilter } from './look-filter';
import { type ActorInput, Button } from './sim/actor';

/** Play's keys (layout-independent codes); the hint line names them. */
export const PLAY_KEYS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  duck: ['ControlLeft', 'ControlRight', 'KeyC'],
  use: 'KeyE',
  reload: 'KeyR',
  /** The plane: throttle up and down beside W and S, the view, and the arrows' stick. */
  throttleUp: ['ShiftLeft', 'ShiftRight'],
  throttleDown: ['ControlLeft', 'ControlRight'],
  /** The plane's view; the walker's noclip (Garry's Mod's V). */
  view: 'KeyV',
  /** Faster: the walker's noclip (Shift is the plane's throttle too). */
  speed: ['ShiftLeft', 'ShiftRight'],
  arrows: { right: 'ArrowRight', left: 'ArrowLeft', up: 'ArrowUp', down: 'ArrowDown' },
  record: 'KeyK',
  setup: 'Tab',
  exit: KEY.Escape,
} as const;

const MOUSE_BUTTONS: Readonly<Record<number, Button>> = { 0: Button.Attack, 2: Button.Attack2 };
const DUCK: ReadonlySet<string> = new Set(PLAY_KEYS.duck);
const SPEED: ReadonlySet<string> = new Set(PLAY_KEYS.speed);
const UP_KEYS: ReadonlySet<string> = new Set(PLAY_KEYS.throttleUp);
const DOWN_KEYS: ReadonlySet<string> = new Set(PLAY_KEYS.throttleDown);

export interface PlayInputHooks {
  /** Mouse motion while the pointer is locked, in pixels. */
  look(dx: number, dy: number): void;
  record(): void;
  /** Tab: free the pointer for the setup panel. */
  setup(): void;
  exit(): void;
  /** Another part of play takes a key first (Sandbox: menus, weapons, undo); true keeps it from the player's moves. */
  key?(code: string, down: boolean): boolean;
  /** Another part of play takes the wheel (Sandbox: weapons, the Physics Gun's reach); true keeps it from jumping. */
  wheel?(e: WheelEvent): boolean;
  /** The pointer was locked or let go (by the browser, a click, Tab or Esc). */
  locked(on: boolean, byUser: boolean): void;
}

/**
 * Keys, buttons and the mouse while playing. Every key goes to play first (a
 * capturing listener on the window), so the editor's shortcuts and walk keys
 * stay quiet until Play ends; typing in the setup panel still works. The mouse
 * looks only while the pointer is locked to the play layer.
 */
export class PlayInput {
  private readonly held = new Set<string>();
  private readonly buttons = new Set<Button>();
  private wheel = 0;
  private releasing = false;
  private readonly lookFilter = new LookFilter();
  private readonly off: (() => void)[] = [];
  /** The game runs: held keys and buttons count (the session turns it off while paused). */
  active = false;

  constructor(private readonly layer: HTMLElement, private readonly hooks: PlayInputHooks) {
    this.listen(window, 'keydown', (e) => this.key(e as KeyboardEvent, true), true, false);
    this.listen(window, 'keyup', (e) => this.key(e as KeyboardEvent, false), true, false);
    this.listen(window, 'blur', () => this.clear());
    this.listen(document, 'mousemove', (e) => {
      const m = e as MouseEvent;
      if (this.isLocked && this.lookFilter.accept(m.movementX, m.movementY, m.timeStamp)) hooks.look(m.movementX, m.movementY);
    });
    this.listen(document, 'pointerlockchange', () => {
      const on = this.isLocked;
      if (on) this.lookFilter.restart();
      if (!on) this.clear();
      hooks.locked(on, !this.releasing);
      this.releasing = false;
    });
    // Browsers that refuse the lock without a promise (older Safari) say so here.
    this.listen(document, 'pointerlockerror', () => hooks.locked(false, false));
    this.listen(layer, 'mousedown', (e) => {
      const b = MOUSE_BUTTONS[(e as MouseEvent).button];
      if (this.active && b) this.buttons.add(b);
    });
    this.listen(window, 'mouseup', (e) => {
      const b = MOUSE_BUTTONS[(e as MouseEvent).button];
      if (b) this.buttons.delete(b);
    });
    this.listen(layer, 'wheel', (e) => {
      e.preventDefault();
      if (this.hooks.wheel?.(e as WheelEvent)) return;
      const dy = (e as WheelEvent).deltaY;
      if (this.active && dy) this.wheel += Math.sign(dy);
    }, false, false);
  }

  get isLocked(): boolean {
    return document.pointerLockElement === this.layer;
  }

  /**
   * Locks the pointer to the play layer (needs a click or a key press just before). Raw
   * mouse moves where the browser has them (Chrome on Windows): no pointer acceleration,
   * as Garry's Mod reads the mouse, and none of the cursor's jumps at the screen's edge.
   */
  lock(): void {
    const refused = () => this.hooks.locked(false, false);
    const raw = this.layer.requestPointerLock({ unadjustedMovement: true }) as unknown as Promise<void> | undefined;
    // Without raw moves (macOS) the plain lock; a refused one (no recent click) leaves play paused with "Click to play".
    raw?.catch?.((e: unknown) => {
      if (e instanceof DOMException && e.name === 'NotSupportedError') (this.layer.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(refused);
      else refused();
    });
  }

  /** Lets the pointer go without ending play (Tab, the setup panel). */
  release(): void {
    if (!this.isLocked) return;
    this.releasing = true;
    document.exitPointerLock();
  }

  /** This step's input; wheel notches go to the first step after them. */
  sample(): ActorInput {
    const axis = (plus: string, minus: string) => (this.held.has(plus) ? 1 : 0) - (this.held.has(minus) ? 1 : 0);
    const held = [...this.held];
    const up = (held.some((k) => UP_KEYS.has(k)) ? 1 : 0) - (held.some((k) => DOWN_KEYS.has(k)) ? 1 : 0);
    const move: Vec3 = [axis(PLAY_KEYS.right, PLAY_KEYS.left), up, axis(PLAY_KEYS.forward, PLAY_KEYS.back)];
    const arrows = [axis(PLAY_KEYS.arrows.right, PLAY_KEYS.arrows.left), axis(PLAY_KEYS.arrows.up, PLAY_KEYS.arrows.down)] as const;
    const buttons = new Set(this.buttons);
    if (this.held.has(PLAY_KEYS.jump)) buttons.add(Button.Jump);
    if ([...this.held].some((k) => DUCK.has(k))) buttons.add(Button.Duck);
    if (this.held.has(PLAY_KEYS.use)) buttons.add(Button.Use);
    if (this.held.has(PLAY_KEYS.reload)) buttons.add(Button.Reload);
    if (this.held.has(PLAY_KEYS.view)) buttons.add(Button.View);
    if (held.some((k) => SPEED.has(k))) buttons.add(Button.Speed);
    const wheel = this.wheel;
    this.wheel = 0;
    return { move, buttons, wheel, arrows };
  }

  dispose(): void {
    for (const f of this.off) f();
    this.release();
  }

  private key(e: KeyboardEvent, down: boolean): void {
    const t = e.target as HTMLElement | null;
    const typing = !!t && TEXT_TAGS.has(t.tagName) && !this.isLocked;
    if (typing && e.code !== PLAY_KEYS.exit) return;
    // Play owns the keyboard: nothing reaches the editor's shortcuts while it runs.
    e.stopImmediatePropagation();
    if (e.metaKey) return;
    e.preventDefault();
    if (!down) {
      this.held.delete(e.code);
      this.hooks.key?.(e.code, false);
      return;
    }
    if (e.repeat) return;
    if (this.hooks.key?.(e.code, true)) return;
    if (e.code === PLAY_KEYS.exit) this.hooks.exit();
    else if (e.code === PLAY_KEYS.record) this.hooks.record();
    else if (e.code === PLAY_KEYS.setup) this.hooks.setup();
    else if (this.active) this.held.add(e.code);
  }

  /** Holds or lets go of a key as if pressed (scripted checks, which cannot lock the pointer). */
  hold(code: string, down: boolean): void {
    if (down) this.held.add(code);
    else this.held.delete(code);
  }

  private clear(): void {
    this.held.clear();
    this.buttons.clear();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, capture = false, passive = true): void {
    const opts = { capture, passive };
    target.addEventListener(type, fn, opts);
    this.off.push(() => target.removeEventListener(type, fn, opts));
  }
}

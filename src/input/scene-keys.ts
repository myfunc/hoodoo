import { KEY, TEXT_TAGS } from '../core/keys';
import type { EditorStore, Hint } from '../world/editor-store';
import { FLY_KEYS, RESIZE_KEY, WALK_KEYS, isTyping, matchKey } from './bindings';
import type { CameraWalk } from './camera-walk';
import type { KeyTransform } from './key-transform';
import type { QuickResize } from './quick-resize';

/** Shown the first time the pointer enters the scene window; each line fits the hint area unwrapped. */
const WALK_HINT: Hint = { title: 'Drag empty space: orbit', text: 'W A S D walk · Shift+drag selects' };
/** Open modal windows own the keyboard; tool windows (docked or floating, ui/kit/tool-window.ts) do not. */
const MODAL = '[role="dialog"]:not(.tool-window)';

export interface SceneKeysHost {
  /** The right button is down in a perspective view: held keys fly. */
  flying(): boolean;
  /** The resize key was pressed or let go: refresh the cursor. */
  resizeChanged(): void;
}

/**
 * Held keys of the scene window, read before the editor shortcuts (the listener is added first and
 * stops a key it takes): Space for panning, the walk and fly keys (camera-walk.ts) and the resize
 * key (quick-resize.ts). Keys belong to the scene while the pointer is over it or it has focus.
 * A keyboard Move, Rotate or Size (key-transform.ts) reads every key first while it runs: then
 * R, S and digits are its own and W A S D C do nothing.
 */
export class SceneKeys {
  spaceHeld = false;
  /** The pointer is over the scene window. */
  inside = false;
  private introduced = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly editor: EditorStore,
    private readonly walk: CameraWalk,
    private readonly resize: QuickResize,
    private readonly host: SceneKeysHost,
    private readonly transform: KeyTransform,
  ) {
    // Focusable, so a click in the scene keeps the walk keys here after the pointer leaves it.
    el.tabIndex = -1;
    el.style.outline = 'none';
    el.addEventListener('pointerenter', () => this.enter());
    el.addEventListener('pointerleave', () => { this.inside = false; });
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keyUp(e));
    window.addEventListener('blur', () => {
      this.walk.releaseAll();
      this.resize.release();
      this.transform.cancel();
    });
  }

  /** The keyboard reaches the scene without the pointer: it was clicked last. */
  get focused(): boolean {
    return this.el.contains(document.activeElement);
  }

  /** The first visit of the scene window shows the walk keys in the hint line. */
  private enter(): void {
    this.inside = true;
    if (this.introduced) return;
    this.introduced = true;
    this.editor.setHint(WALK_HINT);
  }

  /** No text field or modal window has the keys, and the pointer or the focus is in the scene. */
  private inScene(e: KeyboardEvent): boolean {
    if (isTyping(e) || document.querySelector(MODAL)) return false;
    return this.inside || this.focused;
  }

  /**
   * Fly keys while the right button is held; otherwise plain walk keys in the scene. A walk key whose
   * Shift chord is a shortcut (Shift+A: Animation) starts nothing, but in a walk Shift only speeds up.
   */
  private steers(e: KeyboardEvent): boolean {
    if (this.host.flying()) return !!FLY_KEYS[e.code];
    if (!WALK_KEYS[e.code] || e.altKey || e.ctrlKey || e.metaKey || !this.inScene(e)) return false;
    return this.walk.active || !matchKey(e);
  }

  private keyDown(e: KeyboardEvent): void {
    if (!isTyping(e) && !document.querySelector(MODAL) && this.transform.keyDown(e, this.inScene(e))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === KEY.Space && !TEXT_TAGS.has((e.target as HTMLElement).tagName)) this.spaceHeld = true;
    this.walk.fast = e.shiftKey;
    if (e.code === RESIZE_KEY && !e.altKey && !e.ctrlKey && !e.metaKey && !isTyping(e)) {
      this.resize.hold(this.inScene(e));
      this.host.resizeChanged();
    }
    if (!this.steers(e)) return;
    this.walk.press(e.code);
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private keyUp(e: KeyboardEvent): void {
    this.transform.keyUp(e);
    if (e.key === KEY.Space) this.spaceHeld = false;
    this.walk.fast = e.shiftKey;
    this.walk.release(e.code);
    if (e.code !== RESIZE_KEY) return;
    this.resize.release();
    this.host.resizeChanged();
  }
}

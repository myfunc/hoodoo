import './material-menu.css';
import { MATERIAL_LIBRARY } from '../../assets/materials.presets';
import { KEY } from '../../core/keys';
import { Action } from '../../input/actions';
import type { ObjectId } from '../../model/scene.ids';
import type { Material, SceneObject } from '../../model/scene.types';
import { materialPreview } from '../../render/icons';
import { LIGHT_KINDS } from '../../world/objects.factory';
import type { UiContext } from '../context';
import { iconCanvas } from '../chrome/icon-canvas';
import { el } from '../kit/dom';

const BALL_PX = 40;
const BALL_SAMPLES = 9;
/** Hovering previews only once the pointer rests, so sweeping across the grid does not flicker the render. */
const HOVER_MS = 90;
/** A menu command clicked this recently opens the menu where it was clicked. */
const POINTER_FRESH_MS = 600;
const EDGE_PX = 6;
const ANCHOR_GAP_PX = 4;
const LABEL = 'Material';
const NO_TARGET = 'Select objects first to apply a material';
const HINT = 'Hover previews · click applies · ↑ ↓ step · Esc closes';

export enum StepDirection {
  Previous = -1,
  Next = 1,
}

export interface PresetEntry {
  readonly material: Material;
  readonly family: string;
}

/** Every preset in the menu's order: family by family, as the library lists them. */
export const PRESET_ORDER: readonly PresetEntry[] = MATERIAL_LIBRARY.flatMap((c) => c.materials.map((material) => ({ material, family: c.name })));

/** The preset before or after `name`, wrapping at the ends; a custom material steps onto the first or last preset. */
export function presetStep(name: string, dir: StepDirection): PresetEntry {
  const n = PRESET_ORDER.length;
  const at = PRESET_ORDER.findIndex((p) => p.material.name === name);
  if (at < 0) return PRESET_ORDER[dir === StepDirection.Next ? 0 : n - 1];
  return PRESET_ORDER[(at + dir + n) % n];
}

/** Selected objects that take a material (lights do not). */
const paintable = (ctx: UiContext): SceneObject[] => ctx.world.selectedObjects().filter((o) => !LIGHT_KINDS.has(o.kind));

const lastPointer = { x: 0, y: 0, at: -Infinity };
if (typeof window !== 'undefined') {
  window.addEventListener('pointerup', (e) => Object.assign(lastPointer, { x: e.clientX, y: e.clientY, at: performance.now() }), true);
}

/** Rendered balls are kept: the menu reuses its canvases every time it opens. */
const balls = new Map<string, HTMLCanvasElement>();

function ball(ctx: UiContext, m: Material): HTMLCanvasElement {
  let c = balls.get(m.name);
  if (!c) {
    c = iconCanvas(ctx.thumbs, materialPreview(m, false), BALL_PX, BALL_SAMPLES);
    c.className = 'mm-ball';
    balls.set(m.name, c);
  }
  return c;
}

// ---------- ↑ / ↓ ----------

let stepHeld = false;

/**
 * Held arrows make one undo step: the step opens a gesture that the next key
 * release, click or lost focus closes.
 */
function holdStep(ctx: UiContext): void {
  if (stepHeld || ctx.world.inGesture) return;
  ctx.world.beginGesture(LABEL);
  stepHeld = true;
  const release = () => {
    window.removeEventListener('keyup', release, true);
    window.removeEventListener('pointerdown', release, true);
    window.removeEventListener('blur', release);
    ctx.world.endGesture();
    stepHeld = false;
  };
  window.addEventListener('keyup', release, true);
  window.addEventListener('pointerdown', release, true);
  window.addEventListener('blur', release);
}

/** ↑ / ↓: every selected object takes the preset before or after the first one's material. */
export function stepMaterial(ctx: UiContext, dir: StepDirection): void {
  const targets = paintable(ctx);
  if (!targets.length) {
    ctx.toast(NO_TARGET);
    return;
  }
  const next = presetStep(targets[0].material.name, dir);
  holdStep(ctx);
  ctx.world.setMaterial(new Set(targets.map((o) => o.id)), next.material, LABEL);
  ctx.toast(`${next.material.name} · ${next.family} · ↑ ↓ for more`);
}

// ---------- the menu ----------

let current: MaterialMenu | null = null;

/**
 * The material menu: a non-modal pop-up of rendered preset balls grouped by
 * family. Hover previews on the selection without touching history, click
 * applies (one undo step), an outside click or Esc closes and puts the old
 * materials back.
 * `anchor` places it under an element; without one it opens where a menu
 * command was just clicked, under the Attributes ball, or mid-window.
 */
export function openMaterialMenu(ctx: UiContext, anchor?: HTMLElement): void {
  current?.close();
  const targets = paintable(ctx);
  if (!targets.length) {
    ctx.toast(NO_TARGET);
    return;
  }
  current = new MaterialMenu(ctx, targets, anchor);
}

export const isMaterialMenuOpen = (): boolean => current !== null;

class MaterialMenu {
  private readonly node: HTMLElement;
  private readonly ids: ReadonlySet<ObjectId>;
  private readonly cells: { entry: PresetEntry; node: HTMLElement }[] = [];
  private readonly offs: (() => void)[] = [];
  private previewing = false;
  private active = -1;
  private hoverTimer = 0;

  constructor(private readonly ctx: UiContext, targets: readonly SceneObject[], anchor?: HTMLElement) {
    this.ids = new Set(targets.map((o) => o.id));
    const name = targets[0].material.name;
    const grid = el('div', { cls: 'mm-grid' });
    for (const family of MATERIAL_LIBRARY) {
      const row = el('div', { cls: 'mm-row' });
      for (const material of family.materials) row.append(this.cell({ material, family: family.name }, name));
      grid.append(el('div', { cls: 'mm-family', text: family.name }), row);
    }
    grid.addEventListener('pointerleave', () => this.unpreview());
    const lab = el('button', { cls: 'mm-lab', text: 'Materials Lab…', attrs: { type: 'button' } });
    lab.addEventListener('click', () => {
      this.close();
      ctx.dispatch(Action.EditMaterial);
    });
    this.node = el('div', { cls: 'mm', attrs: { role: 'menu', 'aria-label': 'Materials' } }, [
      el('div', { cls: 'mm-head' }, [el('span', { cls: 'mm-title', text: 'Materials' }), el('span', { cls: 'mm-current', text: name })]),
      grid,
      el('div', { cls: 'mm-foot' }, [el('span', { cls: 'mm-hint', text: HINT }), lab]),
    ]);
    document.body.append(this.node);
    this.place(anchor);
    this.listen();
    this.active = this.cells.findIndex((c) => c.entry.material.name === name);
    this.cells[this.active]?.node.scrollIntoView({ block: 'nearest' });
  }

  private cell(entry: PresetEntry, currentName: string): HTMLElement {
    const node = el('div', { cls: 'mm-cell', title: `${entry.material.name} · ${entry.family}`, attrs: { role: 'menuitem' } }, [
      ball(this.ctx, entry.material),
      el('span', { cls: 'mm-name', text: entry.material.name }),
    ]);
    node.classList.toggle('is-current', entry.material.name === currentName);
    const index = this.cells.length;
    node.addEventListener('pointerenter', () => {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => this.focus(index), HOVER_MS);
    });
    node.addEventListener('click', () => this.apply(entry.material));
    this.cells.push({ entry, node });
    return node;
  }

  private place(anchor?: HTMLElement): void {
    const r = this.node.getBoundingClientRect();
    const fresh = performance.now() - lastPointer.at < POINTER_FRESH_MS;
    const home = anchor ?? (fresh ? null : document.querySelector<HTMLElement>('.props-ball'));
    let x: number;
    let y: number;
    if (home && home.isConnected) {
      const a = home.getBoundingClientRect();
      // Under the anchor, its right edges lined up (the Attributes panel sits at the window's right);
      // in a short window, beside it on the left, so the anchor stays in sight.
      const below = a.bottom + ANCHOR_GAP_PX + r.height <= window.innerHeight - EDGE_PX;
      x = below ? a.right - r.width : a.left - r.width - ANCHOR_GAP_PX;
      y = below ? a.bottom + ANCHOR_GAP_PX : a.top;
    } else if (fresh) {
      x = lastPointer.x;
      y = lastPointer.y;
      if (x + r.width > window.innerWidth - EDGE_PX) x -= r.width;
    } else {
      x = (window.innerWidth - r.width) / 2;
      y = (window.innerHeight - r.height) / 2;
    }
    this.node.style.left = `${Math.max(EDGE_PX, Math.min(x, window.innerWidth - r.width - EDGE_PX))}px`;
    this.node.style.top = `${Math.max(EDGE_PX, Math.min(y, window.innerHeight - r.height - EDGE_PX))}px`;
  }

  private listen(): void {
    const away = (e: Event) => {
      if (!this.node.contains(e.target as Node)) this.close();
    };
    const keys = (e: KeyboardEvent) => this.key(e);
    const resize = () => this.close();
    // Registered after this click finishes, so the click that opened the menu does not close it.
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', away, true);
      document.addEventListener('wheel', away, true);
    });
    window.addEventListener('keydown', keys, true);
    window.addEventListener('resize', resize);
    this.offs.push(
      () => window.clearTimeout(timer),
      () => document.removeEventListener('pointerdown', away, true),
      () => document.removeEventListener('wheel', away, true),
      () => window.removeEventListener('keydown', keys, true),
      () => window.removeEventListener('resize', resize),
      this.ctx.world.events.on('selection', () => this.close()),
    );
  }

  /** Arrows walk the balls and preview, Enter applies, Esc puts the old material back; any other key closes first. */
  private key(e: KeyboardEvent): void {
    const step = e.key === KEY.ArrowUp || e.key === KEY.ArrowLeft ? -1 : e.key === KEY.ArrowDown || e.key === KEY.ArrowRight ? 1 : 0;
    if (step || e.key === KEY.Enter || e.key === KEY.Escape) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    if (step) {
      const n = this.cells.length;
      this.focus(this.active < 0 ? (step > 0 ? 0 : n - 1) : (this.active + step + n) % n);
      this.cells[this.active].node.scrollIntoView({ block: 'nearest' });
    } else if (e.key === KEY.Enter) {
      if (this.active >= 0) this.apply(this.cells[this.active].entry.material);
    } else {
      this.close();
    }
  }

  private focus(index: number): void {
    this.active = index;
    this.cells.forEach((c, i) => c.node.classList.toggle('is-active', i === index));
    this.preview(this.cells[index].entry.material);
  }

  /** The hovered material on the selection, shown but not recorded: history and Redo stay as they were. */
  private preview(m: Material): void {
    this.ctx.world.previewMaterial(this.ids, m);
    this.previewing = true;
  }

  /** Back to the materials the selection had. */
  private unpreview(): void {
    window.clearTimeout(this.hoverTimer);
    this.cells.forEach((c) => c.node.classList.remove('is-active'));
    if (!this.previewing) return;
    this.previewing = false;
    this.ctx.world.endPreview();
  }

  private apply(m: Material): void {
    this.unpreview();
    this.ctx.world.setMaterial(this.ids, m, LABEL);
    this.close();
  }

  close(): void {
    this.unpreview();
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.node.remove();
    if (current === this) current = null;
  }
}

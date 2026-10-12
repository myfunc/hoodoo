import { type Vec3, scale, withAxis } from '../core/vec3';
import type { SceneObject } from '../model/scene.types';
import type { ViewCell } from '../render/viewport';
import { EVEN_AXIS, type GizmoFrame, type GizmoGrip, type GizmoHandles, GizmoKind, type GizmoPart, gizmoFrame, nearestRingPoint } from '../render/wire/gizmo';
import { type EditorStore, type Hint, IDLE_HINT } from '../world/editor-store';
import { moved, turned } from '../world/transform-ops';
import type { World } from '../world/world';
import { DEG_PER_RAD, type ScreenPoint, anchorOf, resizedFrom, slideAlong, snapTurn, stretchFactor, sweep, tangentTurn, travelFactor, winding } from './gizmo-math';

const AXIS_NAMES = ['X', 'Y', 'Z'] as const;
const LABELS: Readonly<Record<GizmoKind, string>> = { [GizmoKind.Move]: 'Move', [GizmoKind.Resize]: 'Resize', [GizmoKind.Rotate]: 'Rotate' };
/** Shift turns in whole steps of this many degrees. */
export const TURN_SNAP_DEG = 15;
/** A ring facing the eye at least this squarely follows the pointer round; flatter rings read the drag along their tangent. */
const SWEEP_FACING = 0.5;
const PERCENT = 100;
/** A pebble (a handle set apart from the axes): this many pixels of travel double the size, or turn one radian. */
const PEBBLE_DOUBLE_PX = 120;
const PEBBLE_RADIAN_PX = 90;
const MOVE_TEXT = 'Drag along the axis';
const RESIZE_TEXT = 'Shift: even · Alt: far side';
const EVEN_TEXT = 'Drag out · Alt: keep base';
const ROTATE_TEXT = 'Drag round · Shift: 15°';
/** The two-way resize cursors by the handle's screen direction, every 45° anticlockwise from left-right. */
const RESIZE_CURSORS = ['ew-resize', 'nesw-resize', 'ns-resize', 'nwse-resize'] as const;
const OCTANT = Math.PI / 4;
const ROTATE_CURSOR = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Cg fill='none' stroke-linecap='round'%3E%3Cpath d='M17.1 13.2A6.5 6.5 0 1 1 15.2 6' stroke='white' stroke-width='4'/%3E%3Cpath d='M17.1 13.2A6.5 6.5 0 1 1 15.2 6' stroke='black' stroke-width='1.6'/%3E%3C/g%3E%3Cpath d='M17.6 8.1L12.5 8L16.6 3.1Z' fill='black' stroke='white' stroke-width='1' stroke-linejoin='round'/%3E%3C/svg%3E\") 11 11, grab";

/** The hint line for a handle: what a drag on it does. */
export function gizmoHint(part: GizmoPart): Hint {
  const name = AXIS_NAMES[part.axis] ?? '';
  if (part.kind === GizmoKind.Move) return { title: `Move ${name}`, text: MOVE_TEXT };
  if (part.kind === GizmoKind.Rotate) return { title: `Rotate ${name}`, text: ROTATE_TEXT };
  return part.axis === EVEN_AXIS ? { title: 'Resize', text: EVEN_TEXT } : { title: `Stretch ${name}`, text: RESIZE_TEXT };
}

/** The cursor over a handle: a two-way arrow along a resize handle, a turning arrow on a ring, the move cross on a tip. */
export function gizmoCursor(part: GizmoPart, g: GizmoHandles | null): string {
  if (part.kind === GizmoKind.Move) return 'move';
  if (part.kind === GizmoKind.Rotate) return ROTATE_CURSOR;
  const grip = gripOf(part, g);
  const h = grip && !grip.detached ? grip.at : part.axis === EVEN_AXIS ? null : g?.cubes[part.axis];
  if (!g || !h) return RESIZE_CURSORS[0];
  // Screen y runs down: a handle up-right of the centre wants the ↗↙ arrow.
  const a = Math.atan2(g.origin[1] - h[1], h[0] - g.origin[0]);
  const k = ((Math.round(a / OCTANT) % RESIZE_CURSORS.length) + RESIZE_CURSORS.length) % RESIZE_CURSORS.length;
  return RESIZE_CURSORS[k];
}

/** The grip a part was taken by, when it has one (rings have none). */
const gripOf = (part: GizmoPart, g: GizmoHandles | null): GizmoGrip | null => (part.grip === undefined ? null : g?.grips[part.grip] ?? null);

interface Grab {
  readonly part: GizmoPart;
  readonly g: GizmoHandles;
  readonly grip: GizmoGrip | null;
  readonly press: ScreenPoint;
  readonly start: readonly SceneObject[];
  readonly frame: GizmoFrame;
  /** Rotate: the ring point grabbed, which way the ring runs, the pointer last seen and the turn so far (radians). */
  readonly ringIndex: number;
  readonly winding: number;
  last: ScreenPoint;
  turn: number;
}

/**
 * READ ME — drags on the selection's handles (drawn by render/wire/gizmo.ts):
 * a move tip slides along its axis, a resize cube stretches along its axis and
 * the even square resizes evenly, a ring turns about its axis. A drag edits the
 * selection as it stood at the press through the Edit palette's own operations
 * (transform-ops), so groups move as groups (World reads every edit through
 * group-edits `settled`), edits are auto-keyed and a drag is one undo step.
 */
export class GizmoDrag {
  private grab: Grab | null = null;
  private hinted = false;

  constructor(private readonly world: World, private readonly editor: EditorStore) {}

  /** A press on a resize or rotate handle of `cell`: true when the press belongs to it. */
  begin(part: GizmoPart, cell: ViewCell, x: number, y: number): boolean {
    const g = cell.gizmo;
    const start = this.world.selectedObjects();
    const frame = gizmoFrame(start);
    if (!g || !frame) return false;
    const grip = gripOf(part, g);
    const ring = part.kind === GizmoKind.Rotate ? g.rings[part.axis] : null;
    if (part.kind === GizmoKind.Rotate && !ring && !grip?.detached) return false;
    this.grab = {
      part, g, grip, press: [x, y], start, frame, last: [x, y], turn: 0,
      ringIndex: ring ? nearestRingPoint(ring, x, y).index : 0,
      winding: ring ? winding(ring, g.origin) : 1,
    };
    this.world.beginGesture(LABELS[part.kind]);
    return true;
  }

  drag(x: number, y: number, shift: boolean, alt: boolean): void {
    const grab = this.grab;
    if (!grab) return;
    if (grab.part.kind === GizmoKind.Move) this.move(grab, [x, y]);
    else if (grab.part.kind === GizmoKind.Resize) this.resize(grab, [x, y], shift, alt);
    else this.rotate(grab, [x, y], shift);
  }

  end(): void {
    this.grab = null;
  }

  /** Hovering a handle names it in the hint line; leaving it clears the hint again. */
  hover(part: GizmoPart | null): void {
    if (part) this.say(gizmoHint(part));
    else if (this.hinted) {
      this.editor.setHint({ title: IDLE_HINT.title, text: '' });
      this.hinted = false;
    }
  }

  private say(hint: Hint): void {
    this.hinted = true;
    this.editor.setHint(hint);
  }

  /** Snap (the display bar's grid snap) rounds the moved positions as a drag on the object does. */
  private move(grab: Grab, now: ScreenPoint): void {
    const axis = grab.part.axis;
    const tip = grab.g.tips[axis];
    if (!tip) return;
    const delta = scale(grab.g.worldAxes[axis], slideAlong(grab.g.origin, tip, grab.press, now) * grab.g.axisLength);
    const byId = new Map(grab.start.map((o) => [o.id, o]));
    const snap = this.editor.state.snap;
    this.world.updateObjects(new Set(byId.keys()), LABELS[GizmoKind.Move], (o) => moved(byId.get(o.id) ?? o, delta, snap, this.editor.state.settings.snapGrid));
  }

  private resize(grab: Grab, now: ScreenPoint, shift: boolean, alt: boolean): void {
    const axis = grab.part.axis;
    const { g, grip } = grab;
    const along = axis === EVEN_AXIS ? null : g.cubes[axis];
    let k: number;
    if (grip?.detached) {
      k = travelFactor(along ? [along[0] - g.origin[0], along[1] - g.origin[1]] : null, grab.press, now, PEBBLE_DOUBLE_PX);
    } else {
      const handle = grip?.at ?? (axis === EVEN_AXIS ? g.even : along);
      if (!handle) return;
      k = stretchFactor(g.origin, handle, grab.press, now);
    }
    const factor: Vec3 = axis === EVEN_AXIS || shift ? [k, k, k] : withAxis([1, 1, 1], axis, k);
    const next = resizedFrom(grab.start, grab.frame, factor, alt ? anchorOf(grab.frame, axis, grip?.side) : null);
    this.world.updateObjects(new Set(next.keys()), LABELS[GizmoKind.Resize], (o) => next.get(o.id) ?? o);
    this.say({ title: gizmoHint(grab.part).title, text: `${Math.round(k * PERCENT)}%` });
  }

  private rotate(grab: Grab, now: ScreenPoint, shift: boolean): void {
    const axis = grab.part.axis;
    const ring = grab.g.rings[axis];
    if (grab.grip?.detached) grab.turn = (now[0] - grab.press[0]) / PEBBLE_RADIAN_PX;
    else if (!ring) return;
    else if (grab.g.facing[axis] >= SWEEP_FACING) {
      grab.turn += sweep(grab.g.origin, grab.last, now) * grab.winding;
      grab.last = now;
    } else grab.turn = tangentTurn(ring, grab.ringIndex, grab.g.ringRadius, grab.press, now);
    // One object turns its own Euler angle, so snapping lands on whole angles; several turn as a body from where they were.
    const from = grab.start.length === 1 ? grab.start[0].transform.rotation[axis] : 0;
    const raw = grab.turn * DEG_PER_RAD;
    const degrees = shift ? snapTurn(from, raw, TURN_SNAP_DEG) : raw;
    const next = turned(grab.start, axis, degrees);
    this.world.updateObjects(new Set(next.keys()), LABELS[GizmoKind.Rotate], (o) => next.get(o.id) ?? o);
    this.say({ title: gizmoHint(grab.part).title, text: `${Math.round(degrees)}°` });
  }
}

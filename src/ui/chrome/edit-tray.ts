import { type Vec3, withAxis } from '../../core/vec3';
import { Action } from '../../input/actions';
import { ControlIcon, controlIcon } from '../../render/icons';
import type { ObjectId } from '../../model/scene.ids';
import type { SceneObject } from '../../model/scene.types';
import { AlignMode, aligned, moved, resized, rotated } from '../../world/transform-ops';
import { type UiContext, hintOn } from '../context';
import { el, onDrag } from '../kit/dom';
import { openMenu } from '../kit/controls';
import { HINTS } from '../strings';
import { iconCanvas } from './icon-canvas';

const ICON_PX = 40;
const AXES = ['X', 'Y', 'Z'] as const;
const ALL = -1;
const RESIZE_PER_PX = 0.008;
const ROTATE_DEG_PER_PX = 0.6;
const MOVE_UNITS_PER_PX = 0.04;

type DragFn = (start: readonly SceneObject[], axis: number, dx: number) => Map<ObjectId, SceneObject>;

const dragResize: DragFn = (start, axis, dx) => {
  const k = Math.exp(dx * RESIZE_PER_PX);
  const f: Vec3 = axis === ALL ? [k, k, k] : withAxis([1, 1, 1], axis, k);
  return resized(start, f);
};
const dragRotate: DragFn = (start, axis, dx) => new Map(start.map((o) => [o.id, rotated(o, axis === ALL ? 1 : axis, dx * ROTATE_DEG_PER_PX)]));
const dragMove: DragFn = (start, axis, dx) =>
  new Map(start.map((o) => [o.id, moved(o, axis === ALL ? [dx * MOVE_UNITS_PER_PX, 0, 0] : withAxis([0, 0, 0], axis, dx * MOVE_UNITS_PER_PX), false)]));

/** Drags on a tool icon or its axis chips edit the selection as one undo step. */
function dragTool(ctx: UiContext, label: string, icon: ControlIcon, hint: { title: string; text: string }, fn: DragFn): HTMLElement {
  const chips = el('div', { cls: 'axes' });
  const tool = el('div', { cls: 'tray-tool' }, [iconCanvas(ctx.thumbs, controlIcon(icon), ICON_PX), el('span', { cls: 'tray-tool-label', text: label }), chips]);
  const bind = (target: HTMLElement, axis: number) => {
    let start: SceneObject[] = [];
    onDrag(target, {
      start: (e) => {
        e.stopPropagation();
        start = ctx.world.selectedObjects();
        ctx.world.beginGesture(label);
      },
      move: (dx) => {
        const next = fn(start, axis, dx);
        ctx.world.updateObjects(new Set(next.keys()), label, (o) => next.get(o.id) ?? o);
      },
      end: () => ctx.world.endGesture(),
    });
  };
  AXES.forEach((name, axis) => {
    const chip = el('div', { cls: 'axis', text: name, title: `${label} along ${name}` });
    bind(chip, axis);
    chips.append(chip);
  });
  bind(tool.querySelector('canvas') as unknown as HTMLElement, ALL);
  hintOn(ctx, tool, hint);
  return tool;
}

function clickTool(ctx: UiContext, label: string, icon: ControlIcon, hint: { title: string; text: string }, run: (anchor: HTMLElement) => void): HTMLElement {
  const tool = el('div', { cls: 'tray-tool', attrs: { role: 'button' } }, [iconCanvas(ctx.thumbs, controlIcon(icon), ICON_PX), el('span', { cls: 'tray-tool-label', text: label })]);
  tool.style.cursor = 'pointer';
  tool.addEventListener('click', () => run(tool));
  hintOn(ctx, tool, hint);
  return tool;
}

function alignMenu(ctx: UiContext, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const items = AXES.flatMap((name, axis) =>
    [AlignMode.Min, AlignMode.Center, AlignMode.Max].map((mode) => ({
      label: `${name} ${mode === AlignMode.Min ? 'minimum' : mode === AlignMode.Max ? 'maximum' : 'centre'}`,
      run: () => {
        const next = aligned(ctx.world.selectedObjects(), axis, mode);
        ctx.world.updateObjects(new Set(next.keys()), 'Align', (o) => next.get(o.id) ?? o);
      },
    })),
  );
  openMenu(r.left, r.bottom, items);
}

export function editTray(ctx: UiContext): HTMLElement {
  return el('div', { cls: 'tray' }, [
    clickTool(ctx, 'Materials', ControlIcon.Materials, HINTS.materials, () => ctx.dispatch(Action.EditMaterial)),
    el('div', { cls: 'tray-gap' }),
    dragTool(ctx, 'Resize', ControlIcon.Resize, HINTS.resize, dragResize),
    dragTool(ctx, 'Rotate', ControlIcon.Rotate, HINTS.rotate, dragRotate),
    dragTool(ctx, 'Reposition', ControlIcon.Reposition, HINTS.reposition, dragMove),
    el('div', { cls: 'tray-gap' }),
    clickTool(ctx, 'Align', ControlIcon.Align, HINTS.align, (a) => alignMenu(ctx, a)),
    clickTool(ctx, 'Randomize', ControlIcon.Randomize, HINTS.randomize, () => ctx.dispatch(Action.Randomize)),
    clickTool(ctx, 'Land', ControlIcon.Land, HINTS.land, () => ctx.dispatch(Action.Land)),
    el('div', { cls: 'tray-gap' }),
    clickTool(ctx, 'Edit Terrain', ControlIcon.EditTerrain, HINTS.editTerrain, () => ctx.dispatch(Action.EditObject)),
    clickTool(ctx, 'Library', ControlIcon.Library, HINTS.library, () => ctx.dispatch(Action.ObjectLibrary)),
  ]);
}

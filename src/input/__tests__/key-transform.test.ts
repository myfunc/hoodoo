import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import type { Vec3 } from '../../core/vec3';
import { ViewKind } from '../../model/scene.enums';
import type { Scene, SceneObject } from '../../model/scene.types';
import type { SceneView, ViewCell } from '../../render/viewport';
import type { AxisGuide } from '../../render/wire/axis-guide';
import { GizmoKind, gizmoFrame } from '../../render/wire/gizmo';
import { WireProjector } from '../../render/wire/wireframe';
import { cameraBasis, orthoBasis } from '../../world/camera-math';
import { EditorStore } from '../../world/editor-store';
import { createObject } from '../../world/objects.factory';
import { DEFAULT_CAMERA, EMPTY_ANIMATION, emptyScene } from '../../world/scene.defaults';
import { SelectMode, World } from '../../world/world';
import type { CameraWalk } from '../camera-walk';
import { type DragLock, KeyTransform } from '../key-transform';
import {
  FREE_LOCK, axisTurn, factorFor, lockName, snappedFactor, snappedMove, snappedTurn, toggledLock, towardViewer, transformed, turnSense, typedAfter, typedValue,
} from '../key-transform-math';
import type { QuickResize } from '../quick-resize';
import { SceneKeys } from '../scene-keys';
import { Action } from '../actions';
import { matchKey } from '../bindings';

const W = 800;
const H = 600;
const FRAME = { x: 0, y: 0, w: W, h: H };
const top = (): ViewCell => ({
  kind: ViewKind.Top, rect: FRAME, frame: FRAME, basis: orthoBasis(ViewKind.Top, { center: [0, 0, 0], span: 20 }, W / H),
  segments: new Map(), gizmo: null, keys: [], rig: null,
});
const perspective = (): ViewCell => ({ ...top(), kind: ViewKind.Camera, basis: cameraBasis(DEFAULT_CAMERA, W / H) });

const thing = (id: 'sphere' | 'cube', position: Vec3, size: Vec3 = [1, 1, 1]): SceneObject => {
  const o = createObject(createEntry(id), { seed: 1, position, size });
  return { ...o, transform: { position, rotation: [0, 0, 0], size } };
};

/** A key as the browser sends it: `code` for letters, `key` for what it types. */
const key = (code: string, k = '', mods: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ code, key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...mods }) as KeyboardEvent;
const KEYS: Record<string, KeyboardEvent> = {
  G: key('KeyG', 'g'), R: key('KeyR', 'r'), S: key('KeyS', 's'), X: key('KeyX', 'x'), Y: key('KeyY', 'y'), Z: key('KeyZ', 'z'),
  Enter: key('Enter', 'Enter'), Esc: key('Escape', 'Escape'), Back: key('Backspace', 'Backspace'), Minus: key('Minus', '-'), Dot: key('Period', '.'),
};
const digit = (d: number) => key(`Digit${d}`, String(d));
const NO_MODS = { ctrlKey: false, metaKey: false, altKey: false };

interface Rig {
  world: World;
  editor: EditorStore;
  kt: KeyTransform;
  guide: () => AxisGuide | null;
  drag: { value: DragLock | null };
  pointer: { value: [number, number] | null };
}

function rig(objects: readonly SceneObject[], cell: ViewCell = top(), scene: Scene = emptyScene()): Rig {
  const world = new World({ ...scene, objects: [...objects] });
  world.select(objects.map((o) => o.id), SelectMode.Replace);
  const editor = new EditorStore();
  let guide: AxisGuide | null = null;
  const view = { set guide(g: AxisGuide | null) { guide = g; }, cellAt: () => cell, mainCell: () => cell } as unknown as SceneView;
  const el = { style: {}, contains: () => true } as unknown as HTMLElement;
  const drag = { value: null as DragLock | null };
  const pointer = { value: [W / 2, H / 2] as [number, number] | null };
  const kt = new KeyTransform(el, world, editor, view, { pointer: () => pointer.value, drag: () => drag.value, idle: () => !drag.value, ended: () => undefined });
  return { world, editor, kt, guide: () => guide, drag, pointer };
}

const press = (r: Rig, ...keys: KeyboardEvent[]) => { for (const k of keys) r.kt.keyDown(k, true); };
const pos = (r: Rig, i = 0) => r.world.scene.objects[i].transform.position;

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { querySelector: () => null, activeElement: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('keyboard Move, Rotate and Size: the pure parts', () => {
  it('locks an axis, unlocks it with the same key, and Shift takes the plane without it', () => {
    const x = toggledLock(FREE_LOCK, 0, false);
    expect(x).toEqual({ axis: 0, plane: false });
    expect(toggledLock(x, 0, false)).toEqual(FREE_LOCK);
    const notZ = toggledLock(x, 2, true);
    expect(lockName(notZ)).toBe('XY');
    expect(factorFor(notZ, 2)).toEqual([2, 2, 1]);
    expect(factorFor({ axis: 1, plane: false }, 2)).toEqual([1, 2, 1]);
  });

  it('types digits, one point, a sign that flips and Backspace', () => {
    let t = '';
    for (const k of ['1', '.', '5', '.', '-']) t = typedAfter(t, k) ?? t;
    expect(t).toBe('-1.5');
    expect(typedValue(t)).toBe(-1.5);
    expect(typedAfter(t, 'Backspace')).toBe('-1.');
    expect(typedAfter('-', 'Backspace')).toBe('');
    expect(typedAfter('', 'w')).toBeNull();
    expect(typedValue('-')).toBeNull();
    expect(typedValue('.')).toBeNull();
  });

  it('snaps a move to the grid step, a turn to 15° and a size to 0.1', () => {
    expect(snappedMove([0.7, 0.2, -1.3], { axis: 0, plane: false }, 0.5)).toEqual([0.5, 0, 0]);
    expect(snappedMove([0.7, 0.2, -1.3], FREE_LOCK, 0.5)).toEqual([0.5, 0, -1.5]);
    const turnedOne = { ...thing('cube', [0, 0, 0]), transform: { position: [0, 0, 0] as Vec3, rotation: [0, 10, 0] as Vec3, size: [1, 1, 1] as Vec3 } };
    // One object lands on whole angles, as the rings do: 10 + 37 → 45.
    expect(snappedTurn([turnedOne], { axis: 1, plane: false }, 37)).toBeCloseTo(35, 9);
    expect(snappedTurn([turnedOne, thing('cube', [3, 0, 0])], { axis: 1, plane: false }, 37)).toBeCloseTo(30, 9);
    expect(snappedFactor(1.234)).toBeCloseTo(1.2, 9);
    expect(snappedFactor(0.01)).toBeCloseTo(0.1, 9);
  });

  it('turns about the view so a typed angle runs anticlockwise on screen', () => {
    const cell = top();
    const toward = towardViewer(cell.basis, [0, 0, 0]);
    expect(toward.map((v) => v + 0)).toEqual([0, 1, 0]);
    const egg = thing('sphere', [0, 0, 0]);
    const far = thing('sphere', [4, 0, 0]);
    const frame = gizmoFrame([egg, far])!;
    const next = transformed([egg, far], frame, { job: GizmoKind.Rotate, lock: FREE_LOCK, delta: [0, 0, 0], degrees: 90, view: toward, factor: 1 }, false, 1);
    const proj = new WireProjector(cell.basis, cell.frame);
    const before = proj.screen(proj.view(far.transform.position));
    const after = proj.screen(proj.view(next.get(far.id)!.transform.position));
    const centre = proj.screen(proj.view(frame.pivot));
    // Right of the centre before, above it after: a quarter turn anticlockwise.
    expect(before[0]).toBeGreaterThan(centre[0]);
    expect(after[1]).toBeLessThan(centre[1]);
    expect(Math.abs(after[0] - centre[0])).toBeLessThan(1e-6);
    // The pointer going round clockwise (screen angles grow) is a negative turn about the eye.
    expect(turnSense(toward, toward, cell.basis.right)).toBe(-1);
    const m = axisTurn([0, 0, 1], 90);
    expect(m[1]).toBeCloseTo(1, 9);
  });
});

describe('keyboard Move, Rotate and Size: the session', () => {
  it('G X 2 Enter moves 2 m along X as one undo step named Move', () => {
    const egg = thing('sphere', [1, 0.5, -2]);
    const r = rig([egg]);
    const steps = r.world.historyState().labels.length;
    press(r, KEYS.G);
    expect(r.kt.active).toBe(true);
    press(r, KEYS.X, digit(2));
    expect(r.guide()?.lines).toEqual([{ axis: 0, dir: [1, 0, 0] }]);
    expect(r.editor.state.doing?.line).toBe('Move · X · 2 · Enter apply · Esc cancel');
    // Shown, not recorded yet.
    expect(r.world.historyState().labels.length).toBe(steps);
    press(r, KEYS.Enter);
    expect(r.kt.active).toBe(false);
    expect(pos(r)).toEqual([3, 0.5, -2]);
    const h = r.world.historyState();
    expect(h.labels.length).toBe(steps + 1);
    expect(h.labels[h.position]).toBe('Move');
    expect(r.guide()).toBeNull();
    r.world.undo();
    expect(pos(r)).toEqual([1, 0.5, -2]);
  });

  it('a pointer move along a locked axis stays on it, and Ctrl snaps it to the grid step', () => {
    const r = rig([thing('sphere', [0, 0, 0])]);
    press(r, KEYS.G, KEYS.Y);
    // Top view: screen up is -Z; locked to Y (pointing at the eye) the pointer's height moves along it.
    r.kt.pointer(W / 2 + 40, H / 2 - 70, NO_MODS);
    const p = pos(r);
    expect(p[0]).toBe(0);
    expect(p[2]).toBe(0);
    expect(p[1]).toBeGreaterThan(0);
    press(r, KEYS.Y, KEYS.X);
    r.kt.pointer(W / 2 + 77, H / 2 - 30, { ...NO_MODS, ctrlKey: true });
    const step = r.editor.state.settings.snapGrid;
    const x = pos(r)[0];
    expect(Math.abs(x / step - Math.round(x / step))).toBeLessThan(1e-9);
    expect(x).toBeGreaterThan(0);
    expect(pos(r)[1]).toBe(0);
  });

  it('Shift+axis moves in the plane without that axis', () => {
    const r = rig([thing('cube', [0, 0, 0])], perspective());
    press(r, KEYS.G, key('KeyY', 'Y', { shiftKey: true }));
    expect(r.guide()?.lines.map((l) => l.axis)).toEqual([0, 2]);
    r.kt.pointer(W / 2 + 60, H / 2 + 40, NO_MODS);
    const p = pos(r);
    expect(p[1]).toBe(0);
    expect(Math.hypot(p[0], p[2])).toBeGreaterThan(0.01);
    expect(r.editor.state.doing?.title).toBe('Move · XZ');
  });

  it('G R then X, Y or Z with a typed 45 turns 45° about that axis', () => {
    for (const [axis, k] of [[0, KEYS.X], [1, KEYS.Y], [2, KEYS.Z]] as const) {
      const r = rig([thing('cube', [2, 0, 1])]);
      press(r, KEYS.G, KEYS.R, k, digit(4), digit(5));
      expect(r.editor.state.doing?.line).toBe(`Rotate · ${'XYZ'[axis]} · 45° · Enter apply · Esc cancel`);
      press(r, KEYS.Enter);
      const t = r.world.scene.objects[0].transform;
      expect(t.rotation[axis]).toBeCloseTo(45, 9);
      expect(t.position).toEqual([2, 0, 1]);
      const h = r.world.historyState();
      expect(h.labels[h.position]).toBe('Rotate');
    }
  });

  it('several objects turn about their common centre, as the rings turn them', () => {
    const r = rig([thing('cube', [-2, 0, 0]), thing('cube', [2, 0, 0])]);
    press(r, KEYS.G, KEYS.R, KEYS.Y, digit(9), digit(0), KEYS.Enter);
    expect(pos(r, 0)[0]).toBeCloseTo(0, 9);
    expect(pos(r, 0)[2]).toBeCloseTo(2, 9);
    expect(pos(r, 1)[2]).toBeCloseTo(-2, 9);
  });

  it('G S Y 2 stretches a box twice as tall, and only that axis', () => {
    const r = rig([thing('cube', [0, 1, 0], [1, 2, 1])]);
    press(r, KEYS.G, KEYS.S, KEYS.Y, digit(2), KEYS.Enter);
    const t = r.world.scene.objects[0].transform;
    expect(t.size).toEqual([1, 4, 1]);
    expect(t.position).toEqual([0, 1, 0]);
    const h = r.world.historyState();
    expect(h.labels[h.position]).toBe('Size');
  });

  it('Escape and a right click put back the exact start, with no undo step and no redo', () => {
    const egg = thing('sphere', [1, 0, 1]);
    const r = rig([egg]);
    const scene = r.world.scene;
    const steps = r.world.historyState().labels.length;
    press(r, KEYS.G, KEYS.Z);
    r.kt.pointer(W / 2 + 33, H / 2 + 81, NO_MODS);
    press(r, KEYS.R);
    r.kt.pointer(W / 2 + 130, H / 2 - 20, NO_MODS);
    expect(r.world.scene).not.toBe(scene);
    press(r, KEYS.Esc);
    expect(r.world.scene).toBe(scene);
    expect(r.world.historyState().labels.length).toBe(steps);
    expect(r.world.canRedo()).toBe(false);
    press(r, KEYS.G, KEYS.S, digit(3));
    expect(r.kt.press(2)).toBe(true);
    expect(r.world.scene).toBe(scene);
    expect(r.editor.state.doing).toBeNull();
  });

  it('a whole session is one undo step, whatever happened in it', () => {
    const r = rig([thing('cube', [0, 0, 0])]);
    const steps = r.world.historyState().labels.length;
    press(r, KEYS.G, KEYS.X);
    for (let i = 1; i <= 10; i++) r.kt.pointer(W / 2 + i * 9, H / 2, NO_MODS);
    press(r, KEYS.S, KEYS.Y, digit(3), KEYS.Back, digit(2));
    expect(r.kt.press(0)).toBe(true);
    const h = r.world.historyState();
    expect(h.labels.length).toBe(steps + 1);
    expect(h.labels[h.position]).toBe('Size');
    expect(r.world.scene.objects[0].transform.position).toEqual([0, 0, 0]);
    r.world.undo();
    expect(r.world.scene.objects[0].transform.size).toEqual([1, 1, 1]);
  });

  it('keys the edit at the playhead when animation is on', () => {
    const scene: Scene = { ...emptyScene(), animation: { ...EMPTY_ANIMATION, enabled: true } };
    const egg = thing('sphere', [0, 0, 0]);
    const r = rig([egg], top(), scene);
    r.world.setTime(2);
    press(r, KEYS.G, KEYS.X, digit(4), KEYS.Enter);
    expect(r.world.scene.animation.objects[egg.id]?.some((k) => Math.abs(k.time - 2) < 1e-9)).toBe(true);
    r.world.setTime(0);
    expect(pos(r)[0]).toBeCloseTo(0, 9);
    r.world.setTime(2);
    expect(pos(r)[0]).toBeCloseTo(4, 9);
  });

  it('starts nothing without a selection and says so', () => {
    const r = rig([]);
    press(r, KEYS.G);
    expect(r.kt.active).toBe(false);
    expect(r.editor.state.hint.text).toBe('Select an object first');
  });

  it('X, Y or Z during a drag locks the drag and writes into its own undo step', () => {
    const egg = thing('sphere', [0, 0, 0]);
    const r = rig([egg]);
    r.world.beginGesture('Move');
    r.drag.value = { cell: top(), x: W / 2, y: H / 2, start: [egg], job: GizmoKind.Move, objects: true, now: [W / 2 + 50, H / 2 + 50] };
    press(r, KEYS.X);
    expect(r.kt.active).toBe(true);
    r.kt.pointer(W / 2 + 80, H / 2 + 120, NO_MODS);
    expect(pos(r)[0]).toBeGreaterThan(0);
    expect(pos(r)[2]).toBe(0);
    // Enter and Escape keep their meaning during a drag; the button ends it.
    expect(r.kt.keyDown(KEYS.Esc, true)).toBe(false);
    r.kt.endDrag();
    r.world.endGesture();
    expect(r.kt.active).toBe(false);
    const h = r.world.historyState();
    expect(h.labels[h.position]).toBe('Move');
  });
});

describe('keyboard Move, Rotate and Size: the keys of the scene window', () => {
  it('G is the Move shortcut; R and S stay free for the walk outside a session', () => {
    expect(matchKey(KEYS.G)?.action).toBe(Action.MoveSelection);
    expect(matchKey(KEYS.R)).toBeNull();
    expect(matchKey(KEYS.S)).toBeNull();
  });

  function sceneKeys(r: Rig) {
    const el = Object.assign(new EventTarget(), { style: {}, tabIndex: 0, contains: () => true }) as unknown as HTMLElement;
    const walk = { press: vi.fn(), release: vi.fn(), releaseAll: vi.fn(), active: false, fast: false } as unknown as CameraWalk;
    const resize = { hold: vi.fn(), release: vi.fn(), isHeld: false } as unknown as QuickResize;
    new SceneKeys(el, r.editor, walk, resize, { flying: () => false, resizeChanged: () => undefined }, r.kt);
    el.dispatchEvent(new Event('pointerenter'));
    // What bootstrap adds after the scene's keys: the editor shortcuts (digits recall bookmarks).
    const shortcuts = vi.fn();
    window.addEventListener('keydown', shortcuts);
    const send = (k: KeyboardEvent, type = 'keydown') => window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), k));
    return { walk, shortcuts, send };
  }

  it('digits type the amount and never reach the bookmarks while a session runs', () => {
    const r = rig([thing('sphere', [0, 0, 0])]);
    const { shortcuts, send } = sceneKeys(r);
    send(digit(1));
    expect(shortcuts).toHaveBeenCalledTimes(1);
    send(KEYS.G);
    send(KEYS.X);
    send(digit(1));
    send(digit(5));
    expect(shortcuts).toHaveBeenCalledTimes(1);
    expect(r.editor.state.doing?.line).toBe('Move · X · 15 · Enter apply · Esc cancel');
    send(KEYS.Enter);
    expect(pos(r)[0]).toBe(15);
  });

  it('the walk keys do nothing during a session; R and S switch the job instead of rising', () => {
    const r = rig([thing('sphere', [0, 0, 0])]);
    const { walk, shortcuts, send } = sceneKeys(r);
    send(KEYS.G);
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR']) send(key(code, code.slice(3).toLowerCase()));
    expect(walk.press).not.toHaveBeenCalled();
    expect(shortcuts).not.toHaveBeenCalled();
    expect(r.editor.state.doing?.title).toBe('Rotate');
    send(KEYS.Esc);
    expect(r.kt.active).toBe(false);
    send(key('KeyW', 'w'));
    expect(walk.press).toHaveBeenCalledWith('KeyW');
  });
});

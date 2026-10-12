import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Scene } from '../../../model/scene.types';
import { createObject } from '../../../world/objects.factory';
import { EMPTY_ANIMATION, emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { Rig } from '../../../world/world.enums';
import { KeyTrack } from '../../../world/animation/key-selection';
import { RowFilter, RowKind, SUN_ROW_NAME, isRowSelected, ledgerRows } from '../timeline-rows';
import { MIN_FRAMES, clampWindow, followWindow, isFitted, panWindow, rulerSteps, zoomWindow } from '../timeline-window';

/** A planet, two moons in a group "Moons" and a still rock; the planet and one moon keyed. */
function orrery(): { scene: Scene; ids: Record<string, string>; group: string } {
  const named = (name: string, seed: number) => ({ ...createObject(createEntry('sphere'), { seed }), name });
  const objects = [named('Planet', 1), named('Snow Moon', 2), named('Marble Moon', 3), named('Rock', 4)];
  const world = new World({ ...emptyScene(), objects, animation: { ...EMPTY_ANIMATION, enabled: true } });
  const ids = Object.fromEntries(objects.map((o) => [o.name, o.id as string]));
  const group = world.group(new Set([ids['Snow Moon'], ids['Marble Moon']] as never), true) as string;
  world.renameGroup(group as never, 'Moons');
  const a = world.scene.animation;
  const key = (id: string) => [{ time: 0, value: world.object(id as never)?.transform as never }];
  world.setAnimation({ ...a, objects: { [ids.Planet]: key(ids.Planet), [ids['Snow Moon']]: key(ids['Snow Moon']) } }, 'Keys');
  return { scene: world.scene, ids, group };
}

const options = (filter: RowFilter, patch: Partial<Parameters<typeof ledgerRows>[1]> = {}) => ({ filter, selection: new Set<never>(), rig: null, folded: new Set<string>(), ...patch });
const names = (rows: ReturnType<typeof ledgerRows>) => rows.map((r) => `${'  '.repeat(r.depth)}${r.name}`);

describe('ledger rows', () => {
  it('Animated: the camera, the sun, the keyed objects and the groups around them, as a tree', () => {
    const { scene } = orrery();
    const rows = ledgerRows(scene, options(RowFilter.Animated));
    expect(names(rows)).toEqual(['Camera', SUN_ROW_NAME, 'Planet', 'Moons', '  Snow Moon']);
    expect(rows.map((r) => r.kind)).toEqual([RowKind.Camera, RowKind.Sun, RowKind.Object, RowKind.Group, RowKind.Object]);
    expect(rows[1].track).toBe(KeyTrack.Sky);
    expect(rows[3].parent).toBe(true);
  });

  it('All: every object and group, still ones too', () => {
    const { scene } = orrery();
    expect(names(ledgerRows(scene, options(RowFilter.All)))).toEqual(['Camera', SUN_ROW_NAME, 'Planet', 'Moons', '  Snow Moon', '  Marble Moon', 'Rock']);
  });

  it('Selected: the selection only; a whole group with what it holds; the camera when it is the selection', () => {
    const { scene, ids } = orrery();
    expect(names(ledgerRows(scene, options(RowFilter.Selected, { selection: new Set([ids.Rock]) as never })))).toEqual(['Rock']);
    const moons = new Set([ids['Snow Moon'], ids['Marble Moon']]) as never;
    expect(names(ledgerRows(scene, options(RowFilter.Selected, { selection: moons })))).toEqual(['Moons', '  Snow Moon', '  Marble Moon']);
    expect(names(ledgerRows(scene, options(RowFilter.Selected, { rig: Rig.Camera })))).toEqual(['Camera']);
  });

  it('a folded group hides its rows and marks the keyed tracks inside', () => {
    const { scene, ids, group } = orrery();
    const rows = ledgerRows(scene, options(RowFilter.All, { folded: new Set([`group:${group}`]) }));
    expect(names(rows)).toEqual(['Camera', SUN_ROW_NAME, 'Planet', 'Moons', 'Rock']);
    expect(rows[3].folded).toBe(true);
    expect(rows[3].inside).toEqual([{ track: KeyTrack.Object, id: ids['Snow Moon'] }]);
  });

  it('a row is selected with its item, a group row when all it holds is', () => {
    const { scene, ids } = orrery();
    const rows = ledgerRows(scene, options(RowFilter.All));
    const moons = rows.find((r) => r.name === 'Moons');
    if (!moons) throw new Error('no Moons row');
    expect(isRowSelected(moons, new Set([ids['Snow Moon']]) as never, null)).toBe(false);
    expect(isRowSelected(moons, new Set([ids['Snow Moon'], ids['Marble Moon']]) as never, null)).toBe(true);
    expect(isRowSelected(rows[0], new Set(), Rig.Camera)).toBe(true);
  });
});

describe('the shown time', () => {
  const total = 30;
  const min = MIN_FRAMES / 15;

  it('zooms about a time that stays put, never narrower than a few frames nor wider than the scene', () => {
    const w = zoomWindow({ t0: 0, t1: 30 }, 0.5, 10, total, min);
    expect(w.t1 - w.t0).toBeCloseTo(15, 9);
    expect((10 - w.t0) / (w.t1 - w.t0)).toBeCloseTo(10 / 30, 9);
    expect(zoomWindow(w, 1e-6, 10, total, min).t1 - zoomWindow(w, 1e-6, 10, total, min).t0).toBeCloseTo(min, 9);
    expect(zoomWindow(w, 100, 10, total, min)).toEqual({ t0: 0, t1: 30 });
  });

  it('scrolls inside the scene and pages along with the playhead', () => {
    expect(panWindow({ t0: 20, t1: 25 }, 10, total, min)).toEqual({ t0: 25, t1: 30 });
    expect(clampWindow({ t0: -3, t1: 2 }, total, min)).toEqual({ t0: 0, t1: 5 });
    expect(followWindow({ t0: 0, t1: 5 }, 7, total, min)).toEqual({ t0: 7, t1: 12 });
    expect(followWindow({ t0: 0, t1: 5 }, 3, total, min)).toEqual({ t0: 0, t1: 5 });
    expect(isFitted({ t0: 0, t1: 30 }, total, 15)).toBe(true);
  });

  it('labels seconds when zoomed out and frame numbers when zoomed in', () => {
    // 8 s across 440 px at 15 fps: a label every second, a tick every 3 frames.
    expect(rulerSteps(55, 15)).toEqual({ label: 15, tick: 3 });
    // Zoomed to 2 s: a label every 3 frames, a tick on each.
    expect(rulerSteps(220, 15)).toEqual({ label: 3, tick: 1 });
    // Five minutes across 440 px: labels every 30 seconds.
    expect(rulerSteps(440 / 300, 15).label).toBe(30 * 15);
  });
});

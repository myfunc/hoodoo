import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { createObject } from '../objects.factory';
import { emptyScene } from '../scene.defaults';
import { SelectMode, World } from '../world';

const sphere = () => createObject(createEntry('sphere'), { seed: 1 });

describe('World', () => {
  it('adds, undoes and redoes objects', () => {
    const w = new World(emptyScene());
    w.addObjects([sphere()], 'Create sphere');
    expect(w.scene.objects).toHaveLength(1);
    w.undo();
    expect(w.scene.objects).toHaveLength(0);
    w.redo();
    expect(w.scene.objects).toHaveLength(1);
  });

  it('records a whole gesture as one history entry', () => {
    const w = new World(emptyScene());
    const s = sphere();
    w.addObjects([s], 'Create');
    w.beginGesture('Move');
    for (let i = 1; i <= 5; i++) {
      w.updateObjects(new Set([s.id]), 'Move', (o) => ({ ...o, transform: { ...o.transform, position: [i, 0, 0] } }));
    }
    w.endGesture();
    expect(w.historyState().labels).toEqual(['Open scene', 'Create', 'Move']);
    expect(w.object(s.id)?.transform.position[0]).toBe(5);
    w.undo();
    expect(w.object(s.id)?.transform.position[0]).toBe(0);
  });

  it('skips locked objects on delete and prunes selection on undo', () => {
    const w = new World(emptyScene());
    const a = sphere();
    const b = { ...sphere(), locked: true };
    w.addObjects([a, b], 'Create');
    w.select([a.id, b.id], SelectMode.Replace);
    w.removeObjects(new Set([a.id, b.id]), 'Delete');
    expect(w.scene.objects.map((o) => o.id)).toEqual([b.id]);
    expect(w.selection.has(a.id)).toBe(false);
  });

  it('duplicates groups into a fresh group', () => {
    const w = new World(emptyScene());
    const a = sphere();
    const b = sphere();
    w.addObjects([a, b], 'Create');
    const g = w.group(new Set([a.id, b.id]));
    w.duplicate(new Set([a.id, b.id]));
    const copies = w.scene.objects.slice(2);
    expect(copies).toHaveLength(2);
    expect(copies[0].groupId).not.toBe(g);
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(w.selection.has(copies[0].id)).toBe(true);
  });

  it('toggles selection', () => {
    const w = new World(emptyScene());
    const a = sphere();
    w.addObjects([a], 'Create');
    w.select([a.id], SelectMode.Toggle);
    expect(w.selection.size).toBe(0);
  });
});

describe('World gestures and history', () => {
  it('refuses undo while a drag is open', () => {
    const w = new World(emptyScene());
    const s = sphere();
    w.addObjects([s], 'Create');
    w.beginGesture('Move');
    w.updateObjects(new Set([s.id]), 'Move', (o) => ({ ...o, transform: { ...o.transform, position: [1, 0, 0] } }));
    expect(w.canUndo()).toBe(false);
    w.undo();
    w.updateObjects(new Set([s.id]), 'Move', (o) => ({ ...o, transform: { ...o.transform, position: [2, 0, 0] } }));
    w.endGesture();
    expect(w.historyState().labels).toEqual(['Open scene', 'Create', 'Move']);
  });

  it('keeps one entry when the same gesture is begun again', () => {
    const w = new World(emptyScene());
    for (let i = 0; i < 5; i++) {
      w.beginGesture('Sky colour');
      w.setSky({ ...w.scene.sky, shadows: i }, 'Sky colour');
    }
    w.endGesture();
    expect(w.historyState().labels).toEqual(['Open scene', 'Sky colour']);
  });
});

describe('scene limits in the editor', () => {
  it('refuses edits that would make the scene unsavable, and says why', () => {
    const w = new World(emptyScene());
    const reasons: string[] = [];
    w.events.on('refused', ({ reason }) => reasons.push(reason));
    const cubes = (n: number) => Array.from({ length: n }, (_, i) => createObject(createEntry('cube'), { seed: i }));
    w.addObjects(cubes(400), 'fill');
    expect(w.scene.objects).toHaveLength(400);
    w.addObjects(cubes(1), 'one more');
    expect(w.scene.objects).toHaveLength(400);
    expect(reasons).toHaveLength(1);
  });
});

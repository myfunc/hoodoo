import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { createObject } from '../../../world/objects.factory';
import { emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { LiveEdit, type PointerSource } from '../live-edit';
import { halfDistance, reachText, sameLight } from '../light-fields';

type Listener = () => void;

/** A pointer that the test presses and lets go; deferred work runs when the test says. */
function rig() {
  const listeners = new Map<string, Listener[]>();
  const source: PointerSource = { addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]) };
  const later: Listener[] = [];
  const world = new World(emptyScene());
  const lamp = createObject(createEntry('spot'), { seed: 1 });
  world.addObjects([lamp], 'Create');
  const live = new LiveEdit(world, source, (fn) => later.push(fn));
  const fire = (type: string) => { for (const fn of listeners.get(type) ?? []) fn(); };
  const settle = () => { while (later.length) later.shift()?.(); };
  const intensity = (v: number) => live.apply('Light intensity', () => world.updateObjects(new Set([lamp.id]), 'Light intensity', (o) => ({ ...o, light: o.light && { ...o.light, intensity: v } })));
  const labels = () => world.historyState().labels;
  return { world, lamp, fire, settle, intensity, labels };
}

describe('live edits from tool windows', () => {
  it('make a whole drag one undo step, its final value included', () => {
    const t = rig();
    t.fire('pointerdown');
    for (const v of [61, 64, 70]) t.intensity(v);
    t.fire('pointerup');
    t.intensity(72);
    t.settle();
    expect(t.labels()).toEqual(['Open scene', 'Create', 'Light intensity']);
    expect(t.world.object(t.lamp.id)?.light?.intensity).toBe(72);
    t.world.undo();
    expect(t.world.object(t.lamp.id)?.light?.intensity).toBe(60);
  });

  it('make each click or typed value a step of its own', () => {
    const t = rig();
    t.intensity(10);
    t.intensity(20);
    t.settle();
    expect(t.labels()).toEqual(['Open scene', 'Create', 'Light intensity', 'Light intensity']);
    expect(t.world.inGesture).toBe(false);
  });

  it('leave other gestures alone when nothing was edited here', () => {
    const t = rig();
    t.world.beginGesture('Move');
    t.fire('pointerdown');
    t.fire('pointerup');
    t.settle();
    expect(t.world.inGesture).toBe(true);
  });
});

describe('light settings', () => {
  it('tell how far a light reaches before it is half as bright', () => {
    expect(halfDistance(0)).toBeNull();
    expect(halfDistance(40)).toBeCloseTo(5);
    expect(halfDistance(100)).toBeCloseTo(2);
    expect(reachText(0)).toBe('Never fades with distance');
    expect(reachText(40)).toBe('Half as bright 5.0 away');
  });

  it('see an unchanged light as no change', () => {
    const l = { color: [1, 0.5, 0] as const, intensity: 60, cone: 25, falloff: 40 };
    expect(sameLight(l, { ...l, color: [1, 0.5, 0] })).toBe(true);
    expect(sameLight(l, { ...l, cone: 26 })).toBe(false);
  });
});

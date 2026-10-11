import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentBackend } from '../../io/recent-scenes';
import { RecentScenes } from '../../io/recent-scenes';
import { timeAgo } from '../../ui/chrome/start-window';
import { demoScene } from '../../world/demo-scene';
import { emptyScene } from '../../world/scene.defaults';
import { serializeScene } from '../../world/scene.serialize';
import { World } from '../../world/world';
import { RecentTracker } from '../recent-ops';

const THUMB = 'data:image/jpeg;base64,/9j/4AAQ';
const textOf = (w: World) => JSON.stringify(serializeScene(w.scene));
const memory = (): RecentBackend => ({ readAll: async () => [], put: async () => undefined, remove: async () => undefined });

function stubStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  return data;
}

describe('recent scene tracking', () => {
  let world: World;
  let store: RecentScenes;
  let tracker: RecentTracker;
  beforeEach(async () => {
    stubStorage();
    world = new World(demoScene());
    store = new RecentScenes(memory());
    await store.ready;
    tracker = new RecentTracker(store, world, () => THUMB);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('lists an example only once it was changed, then keeps updating that one entry', () => {
    world.load(emptyScene(), 'Open Example');
    tracker.begin('Golden Dunes');
    tracker.autosaved(textOf(world), null);
    expect(store.list).toEqual([]);
    world.replaceScene(demoScene(), 'Change');
    tracker.autosaved(textOf(world), THUMB);
    tracker.autosaved(textOf(world), null);
    expect(store.list.map((e) => [e.name, e.thumb])).toEqual([['Golden Dunes', THUMB]]);
  });

  it('lists a file at once, a saved scene at once, and a reopened entry goes back on top', () => {
    tracker.begin('canyon', true);
    tracker.begin('Untitled scene');
    tracker.saved();
    expect(store.list.map((e) => e.name)).toEqual(['Untitled scene', 'canyon']);
    const canyon = store.list[1];
    tracker.reopened(canyon);
    expect(tracker.currentId).toBe(canyon.id);
    expect(store.list.map((e) => e.name)).toEqual(['canyon', 'Untitled scene']);
  });

  it('gives a listed scene the first finished render as its picture', () => {
    tracker.begin('canyon', true);
    expect(store.list[0].thumb).toBeNull();
    tracker.rendered();
    expect(store.list[0].thumb).toBe(THUMB);
  });

  it('continues the autosaved entry after a reload and lists an older autosave once', () => {
    tracker.begin('Moon Waltz');
    const id = tracker.currentId;
    const again = new RecentTracker(store, world, () => THUMB);
    again.resume('Last scene', null);
    expect(again.currentId).toBe(id);
    expect(store.list).toEqual([]);
    vi.unstubAllGlobals();
    stubStorage();
    const old = new RecentTracker(store, world, () => THUMB);
    old.resume('Last scene', THUMB);
    expect(store.list.map((e) => [e.name, e.thumb])).toEqual([['Last scene', THUMB]]);
  });

  it('names a scene without a usable name', () => {
    tracker.begin('   ', true);
    expect(store.list[0].name).toBe('Untitled scene');
  });
});

describe('time on recent cards', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  const MIN = 60_000;
  it('reads like a person would say it', () => {
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * MIN, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 60 * MIN, now)).toBe('3 h ago');
    expect(timeAgo(now - 30 * 60 * MIN, now)).toBe('yesterday');
    expect(timeAgo(now - 4 * 24 * 60 * MIN, now)).toBe('4 days ago');
    expect(timeAgo(Date.UTC(2026, 8, 3, 12), now)).toBe('Sep 3');
  });
});

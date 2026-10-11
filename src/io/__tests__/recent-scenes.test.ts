import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoScene } from '../../world/demo-scene';
import { emptyScene } from '../../world/scene.defaults';
import { serializeScene } from '../../world/scene.serialize';
import type { RecentBackend, RecentScene } from '../recent-scenes';
import { RECENT_LIMITS, RecentScenes, isRecentScene, recentsFrom, withRecent, withinLimits } from '../recent-scenes';

const EMPTY = JSON.stringify(serializeScene(emptyScene()));
const DEMO = JSON.stringify(serializeScene(demoScene()));
const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

const entry = (id: string, time: number, over: Partial<RecentScene> = {}): RecentScene =>
  ({ id, name: `Scene ${id}`, time, thumb: THUMB, text: EMPTY, ...over });

/** A Map standing in for IndexedDB. */
function memoryBackend(seed: readonly unknown[] = []): RecentBackend & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(seed.map((e, i) => [String((e as { id?: unknown } | null)?.id ?? `bad-${i}`), e]));
  return {
    data,
    readAll: async () => [...data.values()],
    put: async (e) => { data.set(e.id, e); },
    remove: async (ids) => { for (const id of ids) data.delete(id); },
  };
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('recent scenes list', () => {
  it('puts the newest on top and moves a known id up instead of adding it twice', () => {
    let list: RecentScene[] = [];
    list = withRecent(list, entry('a', 1));
    list = withRecent(list, entry('b', 2));
    list = withRecent(list, entry('c', 3));
    expect(list.map((e) => e.id)).toEqual(['c', 'b', 'a']);
    list = withRecent(list, entry('a', 4, { text: DEMO }));
    expect(list.map((e) => e.id)).toEqual(['a', 'c', 'b']);
    expect(list[0].text).toBe(DEMO);
  });

  it('keeps one entry per name and content, whatever the id', () => {
    let list = withRecent([], entry('a', 1, { name: 'Dunes' }));
    list = withRecent(list, entry('b', 2, { name: 'Dunes' }));
    expect(list.map((e) => e.id)).toEqual(['b']);
    // Same name with other content, or the same content under another name, are different scenes.
    list = withRecent(list, entry('c', 3, { name: 'Dunes', text: DEMO }));
    list = withRecent(list, entry('d', 4, { name: 'Arch' }));
    expect(list.map((e) => e.id)).toEqual(['d', 'c', 'b']);
  });

  it('keeps eight scenes at most, dropping the oldest', () => {
    let list: RecentScene[] = [];
    for (let i = 0; i < 10; i++) list = withRecent(list, entry(`s${i}`, i, { name: `S${i}`, text: i % 2 ? DEMO : EMPTY }));
    expect(list).toHaveLength(RECENT_LIMITS.count);
    expect(list[0].id).toBe('s9');
    expect(list.at(-1)?.id).toBe('s2');
  });

  it('drops the oldest once the budget is spent, and does not keep a scene too big alone', () => {
    const size = EMPTY.length + THUMB.length + 'Scene x'.length;
    const limits = { count: 8, budget: size * 2 };
    const list = withinLimits([entry('c', 3), entry('b', 2), entry('a', 1)], limits);
    expect(list.map((e) => e.id)).toEqual(['c', 'b']);
    expect(withRecent(list, entry('big', 4, { text: DEMO }), { count: 8, budget: size })).toEqual([]);
  });

  it('drops corrupt or hostile entries and sorts the rest newest first', () => {
    const good = [entry('old', 1), entry('new', 5, { name: 'Other', thumb: null })];
    const bad: unknown[] = [
      null, 42, 'text', [],
      { ...entry('x1', 2), id: '' },
      { ...entry('x2', 2), id: 'i'.repeat(200) },
      { ...entry('x3', 2), name: 7 },
      { ...entry('x4', 2), name: 'n'.repeat(500) },
      { ...entry('x5', 2), time: Number.NaN },
      { ...entry('x6', 2), time: -1 },
      { ...entry('x7', 2), thumb: 'javascript:alert(1)' },
      { ...entry('x8', 2), thumb: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { ...entry('x9', 2), text: '{not json' },
      { ...entry('x10', 2), text: '{"format":"something else"}' },
      { ...entry('x11', 2), text: 12 },
    ];
    expect(bad.some(isRecentScene)).toBe(false);
    expect(recentsFrom([...bad, ...good]).map((e) => e.id)).toEqual(['new', 'old']);
  });

  it('collapses duplicates found in storage to the newest copy', () => {
    const list = recentsFrom([entry('a', 1), entry('a', 3, { name: 'A again' }), entry('b', 2, { name: 'A again' })]);
    expect(list.map((e) => [e.id, e.time])).toEqual([['a', 3]]);
  });
});

describe('recent scenes store', () => {
  it('loads valid entries and deletes the unusable ones from storage', async () => {
    const backend = memoryBackend([entry('a', 1), { ...entry('bad', 2), text: 'nope' }]);
    const store = new RecentScenes(backend);
    await store.ready;
    await store.flushed();
    expect(store.list.map((e) => e.id)).toEqual(['a']);
    expect([...backend.data.keys()]).toEqual(['a']);
  });

  it('writes remembered, re-pictured and removed scenes through', async () => {
    const backend = memoryBackend();
    const store = new RecentScenes(backend);
    store.remember(entry('a', 1));
    store.remember(entry('b', 2, { thumb: null, name: 'B' }));
    await store.flushed();
    expect(store.list.map((e) => e.id)).toEqual(['b', 'a']);
    store.setThumb('b', THUMB);
    expect(store.list.map((e) => e.id)).toEqual(['b', 'a']);
    // Remembering without a picture keeps the one it had.
    store.remember(entry('b', 3, { thumb: null, name: 'B' }));
    expect(store.list[0].thumb).toBe(THUMB);
    store.remove('a');
    await store.flushed();
    expect([...backend.data.keys()]).toEqual(['b']);
    expect((backend.data.get('b') as RecentScene).thumb).toBe(THUMB);
  });

  it('keeps what was remembered while it was still loading', async () => {
    const backend = memoryBackend([entry('stored', 1)]);
    const store = new RecentScenes(backend);
    store.remember(entry('early', Date.now(), { name: 'Early' }));
    await store.ready;
    expect(store.list.map((e) => e.id)).toEqual(['early', 'stored']);
  });

  it('starts empty when storage cannot be read', async () => {
    const store = new RecentScenes({ readAll: () => Promise.reject(new Error('blocked')), put: async () => undefined, remove: async () => undefined });
    await store.ready;
    expect(store.list).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { KeptFiles, RecordingFiles } from '../kept-files';
import type { SourceFiles } from '../source.types';

const bytes = (s: string) => new TextEncoder().encode(s);

/** A small game tree in memory. */
const game = (files: Record<string, string>): SourceFiles => ({
  has: (p) => p in files,
  read: async (p) => (p in files ? bytes(files[p]) : null),
  list: (prefix) => Object.keys(files).filter((p) => p.startsWith(prefix)),
});

describe('kept files', () => {
  it('answer again what the loaders were told, without the folder', async () => {
    const rec = new RecordingFiles(game({ 'models/a.mdl': 'A', 'sound/b.wav': 'B', 'sound/c.wav': 'C' }));
    expect(rec.has('Models\\A.mdl')).toBe(true);
    expect(rec.has('models/missing.mdl')).toBe(false);
    expect(await rec.read('models/a.mdl')).toEqual(bytes('A'));
    expect(rec.list('sound/')).toEqual(['sound/b.wav', 'sound/c.wav']);
    const kept = new KeptFiles(rec);
    expect(kept.has('MODELS/a.mdl')).toBe(true);
    expect(kept.has('models/missing.mdl')).toBe(false);
    expect(await kept.read('models/a.mdl')).toEqual(bytes('A'));
    expect(kept.list('sound/')).toEqual(['sound/b.wav', 'sound/c.wav']);
    // Never read: there, but not kept.
    expect(await kept.read('sound/b.wav')).toBeNull();
  });

  it('say when a file is read for the first time', async () => {
    const rec = new RecordingFiles(game({ 'sound/b.wav': 'B' }));
    let changes = 0;
    rec.changed = () => changes++;
    await rec.read('sound/b.wav');
    await rec.read('sound/b.wav');
    await rec.read('sound/none.wav');
    expect(changes).toBe(1);
  });
});

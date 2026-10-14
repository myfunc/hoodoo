import { describe, expect, it } from 'vitest';
import type { Spawnlist } from '../../../io/source/spawnlists';
import { keepHeld } from '../game-props';

const m = (value: string) => ({ kind: 'model' as const, value, skin: 0 });
const h = (value: string) => ({ kind: 'header' as const, value, skin: 0 });

describe('the game\'s props for the spawn menu', () => {
  it('keeps the models the files hold, headers over them, and lists with models or lists under them', () => {
    const lists: Spawnlist[] = [
      { id: 1, parent: 0, name: 'Half-Life 2', icon: '', entries: [] },
      { id: 2, parent: 1, name: 'Junk', icon: '', entries: [h('Crates'), m('models/a.mdl'), h('Gone'), m('models/missing.mdl'), m('models/b.mdl')] },
      { id: 3, parent: 0, name: 'Episode Two', icon: '', entries: [h('Rocks'), m('models/ep2.mdl')] },
    ];
    const held = keepHeld(lists, (p) => p === 'models/a.mdl' || p === 'models/b.mdl');
    expect(held.map((l) => l.name)).toEqual(['Half-Life 2', 'Junk']);
    expect(held[1].entries.map((e) => e.value)).toEqual(['Crates', 'models/a.mdl', 'Gone', 'models/b.mdl']);
  });
});

import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { createObject } from '../objects.factory';
import { raycast } from '../raycast';
import { emptyScene } from '../scene.defaults';

const RES = 8;
const OPTS = { includePlanes: true, includeLights: false } as const;

/** A terrain at the origin with every height at `h` (0..1). */
function flatTerrain(h: number) {
  const o = createObject(createEntry('terrain'), { seed: 1 });
  return { ...o, terrain: { ...o.terrain!, resolution: RES, heights: new Float32Array(RES * RES).fill(h) } };
}

describe('ray cast on a terrain', () => {
  it('meets a terrain flat at height 0, on the floor of its box', () => {
    const t = flatTerrain(0);
    const hit = raycast({ ...emptyScene(), objects: [t] }, [0, 50, 0], [0, -1, 0], OPTS);
    expect(hit?.id).toBe(t.id);
  });

  it('meets a raised one on its surface, not on its box', () => {
    const t = flatTerrain(0.5);
    const low = raycast({ ...emptyScene(), objects: [flatTerrain(0)] }, [0, 50, 0], [0, -1, 0], OPTS);
    const high = raycast({ ...emptyScene(), objects: [t] }, [0, 50, 0], [0, -1, 0], OPTS);
    expect(high && low && high.t < low.t).toBe(true);
  });
});

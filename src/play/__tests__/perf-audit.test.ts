import { describe, expect, it } from 'vitest';
import { PerfAudit } from '../perf-audit';
import type { PlaySim } from '../sim/play-sim';

/** A simulation with no bodies, as far as the auditor looks. */
const sim = {
  events: { on: () => () => undefined },
  bodies: { items: new Map() },
  physics: {},
  frame: () => ({ scene: { objects: [] } }),
} as unknown as PlaySim;

/** The browser's storage, in memory. */
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe('Play slowdown auditor', () => {
  it('keeps a snapshot of the last seconds when a frame takes far too long, not while paused or starting', () => {
    const audit = new PerfAudit(sim, memory());
    let t = performance.now();
    // Starting: a slow frame is not judged.
    audit.frame(t += 16, 1, 1, false, 1, 60);
    audit.frame(t += 120, 1, 1, false, 1, 60);
    expect(audit.kept()).toHaveLength(0);
    for (let i = 0; i < 200; i++) audit.frame(t += 16, 2, 0.5, false, 1, 60);
    audit.frame(t += 120, 2, 0.5, false, 1, 60);
    const kept = audit.kept();
    expect(kept).toHaveLength(1);
    expect(kept[0].reason).toBe('frame 120 ms');
    expect(kept[0].samples.at(-1)?.frameMs).toBe(120);
    // Paused: the gap after it is not a slowdown.
    audit.frame(t += 6000, 0, 0, true, 1, 0);
    audit.frame(t += 16, 0, 0, false, 1, 60);
    for (let i = 0; i < 10; i++) audit.frame(t += 16, 2, 9, false, 1, 60);
    expect(audit.kept().at(-1)?.reason).toBe('simulation 9 ms');
    audit.dispose();
  });
});

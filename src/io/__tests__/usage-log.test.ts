import { describe, expect, it } from 'vitest';
import { bump, emptyUsage, usageFrom } from '../usage-log';

const NOW = new Date('2026-10-14T10:00:00Z');

describe('usage log', () => {
  it('counts into named tables', () => {
    const log = emptyUsage(NOW);
    bump(log.actions, 'render');
    bump(log.actions, 'render');
    bump(log.minutes, 'Play', 0.25);
    expect(log.actions).toEqual({ render: 2 });
    expect(log.minutes).toEqual({ Play: 0.25 });
  });

  it('reads a stored log back, and starts anew from nothing or a broken one', () => {
    const log = emptyUsage(NOW);
    log.sessions = 3;
    bump(log.clicks, 'Bottom bar › Play');
    const back = usageFrom(JSON.stringify(log), new Date());
    expect(back.sessions).toBe(3);
    expect(back.since).toBe(NOW.toISOString());
    expect(back.clicks).toEqual({ 'Bottom bar › Play': 1 });
    expect(usageFrom(null, NOW)).toEqual(emptyUsage(NOW));
    expect(usageFrom('{oops', NOW)).toEqual(emptyUsage(NOW));
    expect(usageFrom(JSON.stringify({ keys: { KeyR: 'many' } }), NOW).keys).toEqual({});
  });
});

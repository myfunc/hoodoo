import { describe, expect, it } from 'vitest';
import { formatClock, parseClock, tickLabel } from '../timeline-time';

describe('timeline times', () => {
  it('shows minutes, seconds and tenths', () => {
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(3.2)).toBe('0:03.2');
    expect(formatClock(8)).toBe('0:08.0');
    expect(formatClock(30)).toBe('0:30.0');
    expect(formatClock(59.97)).toBe('1:00.0');
    expect(formatClock(90.5)).toBe('1:30.5');
    expect(formatClock(300)).toBe('5:00.0');
  });

  it('reads typed lengths in the usual forms', () => {
    expect(parseClock('30')).toBe(30);
    expect(parseClock(' 30s ')).toBe(30);
    expect(parseClock('12.5')).toBe(12.5);
    expect(parseClock('.5')).toBe(0.5);
    expect(parseClock('1:30')).toBe(90);
    expect(parseClock('0:08.0')).toBe(8);
    expect(parseClock('2m')).toBe(120);
    expect(parseClock('2m 30s')).toBe(150);
    expect(parseClock('1m30')).toBe(90);
  });

  it('rejects what is not a time', () => {
    for (const t of ['', 'abc', '1:2:3', '-5', 's', '1,5']) expect(parseClock(t), t).toBeNull();
  });

  it('labels the ruler in seconds, then in minutes', () => {
    expect(tickLabel(5)).toBe('5s');
    expect(tickLabel(60)).toBe('1:00');
    expect(tickLabel(90)).toBe('1:30');
  });
});

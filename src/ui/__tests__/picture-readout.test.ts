import { describe, expect, it } from 'vitest';
import { formatPass, formatTime, pictureLine, speedLine } from '../chrome/picture-readout';

const live = { samples: 3, target: 16, scale: 0.5, fps: 60, moving: false };
const final = { passMs: 41, remainingMs: 1100, elapsedMs: 5300 };

describe('picture readouts', () => {
  it('write times short', () => {
    expect(formatTime(400)).toBe('0.4 s');
    expect(formatTime(12300)).toBe('12 s');
    expect(formatTime(125000)).toBe('2:05');
    expect(formatPass(0.8)).toBe('0.8 ms');
    expect(formatPass(41.4)).toBe('41 ms');
    expect(formatPass(1200)).toBe('1.2 s');
  });

  it('keep the live preview lines', () => {
    expect(pictureLine({ ...live, moving: true })).toBe('Live · 60 fps · 50% res');
    expect(pictureLine(live)).toBe('Live · refining 3/16');
    expect(pictureLine({ ...live, samples: 16 })).toBe('Live · converged 16 rays/px');
  });

  it('name Render View and say how far it is', () => {
    const s = { ...live, target: 64, final };
    expect(pictureLine({ ...s, moving: true, fps: 24 })).toBe('Render View · 24 fps');
    expect(pictureLine({ ...s, samples: 37 })).toBe('Render View · 37/64 · 1.1 s left');
    expect(pictureLine({ ...s, samples: 64 })).toBe('Render View · 64 rays in 5.3 s');
    expect(speedLine({ ...s, samples: 37 })).toBe('37/64 rays · 1.1 s left · 41 ms a pass');
    expect(speedLine({ ...s, final: { ...final, passMs: 0 } })).toBe('Measuring…');
  });
});

import { describe, expect, it } from 'vitest';
import { ScrollClassifier, ScrollDevice, ScrollPreference } from '../scroll-device';

const ev = (o: Partial<{ deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; timeStamp: number; wheelDeltaY: number }>) =>
  ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, timeStamp: 0, ...o });

describe('scroll device', () => {
  it('tells a trackpad swipe from a wheel notch', () => {
    const c = new ScrollClassifier();
    expect(c.classify(ev({ deltaY: 100, wheelDeltaY: -120, timeStamp: 0 }))).toBe(ScrollDevice.Wheel);
    expect(c.classify(ev({ deltaY: 3, wheelDeltaY: -9, timeStamp: 1000 }))).toBe(ScrollDevice.Trackpad);
    expect(c.classify(ev({ deltaX: 2, timeStamp: 3000 }))).toBe(ScrollDevice.Trackpad);
    expect(c.classify(ev({ deltaY: 1.5, timeStamp: 5000 }))).toBe(ScrollDevice.Trackpad);
  });

  it('keeps the device for a whole swipe and reads Ctrl+wheel as a pinch', () => {
    const c = new ScrollClassifier();
    expect(c.classify(ev({ deltaY: 4, deltaX: 1, timeStamp: 0 }))).toBe(ScrollDevice.Trackpad);
    expect(c.classify(ev({ deltaY: 120, wheelDeltaY: -360, timeStamp: 50 }))).toBe(ScrollDevice.Trackpad);
    expect(c.classify(ev({ deltaY: 2.5, ctrlKey: true, timeStamp: 60 }))).toBe(ScrollDevice.Pinch);
  });

  it('obeys a fixed preference', () => {
    const c = new ScrollClassifier(ScrollPreference.Wheel);
    expect(c.classify(ev({ deltaX: 5 }))).toBe(ScrollDevice.Wheel);
    c.preference = ScrollPreference.Trackpad;
    expect(c.classify(ev({ deltaY: 120, wheelDeltaY: -120 }))).toBe(ScrollDevice.Trackpad);
  });
});

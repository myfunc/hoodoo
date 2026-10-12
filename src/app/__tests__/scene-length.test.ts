import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Animation } from '../../model/scene.types';
import { EndDrag, LENGTH_LABEL, setSceneLength } from '../../ui/chrome/timeline-length';
import type { UiContext } from '../../ui/context';
import { showOffer } from '../../ui/panels/offer-toast';
import { EditorStore } from '../../world/editor-store';
import { DEFAULT_CAMERA, EMPTY_ANIMATION, emptyScene } from '../../world/scene.defaults';
import { World } from '../../world/world';
import { setTimeline } from '../timeline-ops';

vi.mock('../../ui/panels/offer-toast', () => ({ showOffer: vi.fn(() => () => undefined) }));
const offer = vi.mocked(showOffer);

const animated: Animation = {
  ...EMPTY_ANIMATION,
  enabled: true,
  duration: 8,
  camera: [{ time: 0, value: DEFAULT_CAMERA }, { time: 4, value: { ...DEFAULT_CAMERA, yaw: 45 } }, { time: 8, value: { ...DEFAULT_CAMERA, yaw: 90 } }],
};

function setup() {
  const world = new World({ ...emptyScene(), animation: animated });
  const ctx = { world, editor: new EditorStore(), toast: () => undefined } as unknown as UiContext;
  return { world, ctx, steps: () => world.historyState().labels.length };
}

describe('the length of the scene', () => {
  beforeEach(() => offer.mockClear());

  it('grows to 30 s in one undo step, keys where they were, nothing asked', () => {
    const { world, ctx, steps } = setup();
    const before = steps();
    setSceneLength(ctx, 30);
    expect(world.scene.animation.duration).toBe(30);
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([0, 4, 8]);
    expect(steps()).toBe(before + 1);
    expect(world.historyState().labels.at(-1)).toBe(LENGTH_LABEL);
    expect(offer).not.toHaveBeenCalled();
    world.undo();
    expect(world.scene.animation.duration).toBe(8);
  });

  it('shortened, keeps the keys past the end and offers to scale them in', () => {
    const { world, ctx } = setup();
    world.setTime(7);
    setSceneLength(ctx, 6);
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([0, 4, 8]);
    expect(world.time).toBe(6);
    expect(offer).toHaveBeenCalledOnce();
    const [message, action, run] = offer.mock.calls[0];
    expect(message).toBe('1 key lies past the end');
    expect(action).toBe('Scale keys to fit');
    run();
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([0, 3, 6]);
    expect(world.historyState().labels.at(-1)).toBe('Scale keys to fit');
    world.undo();
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([0, 4, 8]);
  });

  it('dragging the end flag back and forth is one undo step', () => {
    const { world, ctx, steps } = setup();
    const before = steps();
    const drag = new EndDrag(ctx, 8, () => undefined);
    for (const t of [7, 5.03, 6, 12.04]) drag.move(t, 0, 100);
    drag.end();
    expect(world.scene.animation.duration).toBe(12);
    expect(steps()).toBe(before + 1);
    expect(drag.view).toBe(12);
    world.undo();
    expect(world.scene.animation.duration).toBe(8);
  });

  it('Animation Setup keeps the keys too', () => {
    const { world, ctx } = setup();
    setTimeline(ctx, { duration: 6, fps: 24 });
    expect(world.scene.animation.duration).toBe(6);
    expect(world.scene.animation.fps).toBe(24);
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([0, 4, 8]);
    expect(offer).toHaveBeenCalledOnce();
  });
});

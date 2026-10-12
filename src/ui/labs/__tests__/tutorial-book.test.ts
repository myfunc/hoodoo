import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPrefs, savePrefs } from '../../../io/prefs';
import { TagSide, TutorialStart, tagSide } from '../tutorial-book-recipe';
import { TUTORIAL_RECIPES, TUTORIAL_SHOT } from '../tutorial-recipes';

const ASPECT = TUTORIAL_SHOT.width / TUTORIAL_SHOT.height;
/** What fits on one line beside a step number, docked in the left panel too. */
const LINE_CHARS = 48;

describe('the Tutorial Book recipes', () => {
  it('have their own ids, a start, and four to seven steps each', () => {
    expect(new Set(TUTORIAL_RECIPES.map((r) => r.id)).size).toBe(TUTORIAL_RECIPES.length);
    for (const r of TUTORIAL_RECIPES) {
      expect(Object.values(TutorialStart)).toContain(r.start);
      expect(r.steps.length, r.id).toBeGreaterThanOrEqual(4);
      expect(r.steps.length, r.id).toBeLessThanOrEqual(7);
    }
  });

  it('say every step and result in one short line, without long dashes', () => {
    const lines = TUTORIAL_RECIPES.flatMap((r) => [r.title, r.goal, r.result, ...r.steps.map((s) => s.text)]);
    for (const line of lines) {
      expect(line.length, line).toBeLessThanOrEqual(LINE_CHARS);
      expect(line, line).not.toMatch(/[—\n]/);
    }
  });

  it('mark at least one place on every step, inside the picture', () => {
    for (const r of TUTORIAL_RECIPES) {
      for (const s of r.steps) {
        expect(s.marks.length, s.text).toBeGreaterThan(0);
        for (const m of s.marks) {
          expect(m.x >= 0 && m.y >= 0 && m.w > 0 && m.h > 0 && m.x + m.w <= 1 && m.y + m.h <= 1, s.text).toBe(true);
        }
      }
    }
  });
});

describe('where a mark carries its number', () => {
  const icon = { x: 0.4, y: 0.1, w: 0.03, h: 0.05 };
  const menuLine = { x: 0.3, y: 0.2, w: 0.12, h: 0.025 };

  it('puts it above a box and beside a long thin line', () => {
    expect(tagSide(icon, [], ASPECT)).toBe(TagSide.Above);
    expect(tagSide(menuLine, [], ASPECT)).toBe(TagSide.Left);
  });

  it('finds another side at the edge of the picture', () => {
    expect(tagSide({ ...icon, y: 0 }, [], ASPECT)).toBe(TagSide.Left);
    expect(tagSide({ ...menuLine, x: 0 }, [], ASPECT)).toBe(TagSide.Right);
  });

  it('keeps clear of the step’s other marks', () => {
    const below = { x: 0.4, y: 0.16, w: 0.03, h: 0.05 };
    const leftOf = { x: 0.36, y: 0.16, w: 0.03, h: 0.05 };
    expect(tagSide(below, [icon], ASPECT)).toBe(TagSide.Left);
    expect(tagSide(below, [icon, leftOf], ASPECT)).toBe(TagSide.Below);
  });
});

describe('the first-visit hint in prefs', () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('is due on a first visit and remembered once shown', () => {
    expect(loadPrefs().tutorialSeen).toBe(false);
    savePrefs({ tutorialSeen: true });
    expect(loadPrefs().tutorialSeen).toBe(true);
  });
});

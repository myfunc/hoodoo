import { describe, expect, it } from 'vitest';
import { DEFAULT_DOCUMENT, emptyScene } from '../scene.defaults';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { World } from '../world';

const WINDOW = { width: 2216, height: 1480 } as const;

describe('Fit Window', () => {
  it('is how a new scene starts, and the document takes the window size without an undo step', () => {
    const w = new World(emptyScene());
    expect(w.scene.document.fit).toBe(true);
    expect(w.fitDocument(WINDOW.width, WINDOW.height)).toBe(true);
    expect(w.scene.document).toEqual({ ...WINDOW, fit: true });
    expect(w.fitDocument(WINDOW.width, WINDOW.height)).toBe(false);
    expect(w.historyState().labels).toEqual(['Open scene']);
  });

  it('leaves a fixed document alone', () => {
    const w = new World({ ...emptyScene(), document: DEFAULT_DOCUMENT });
    expect(w.fitDocument(WINDOW.width, WINDOW.height)).toBe(false);
    expect(w.scene.document).toEqual(DEFAULT_DOCUMENT);
  });

  it('travels in the scene file; a file without it keeps its fixed size', () => {
    const fit = { ...emptyScene(), document: { ...WINDOW, fit: true } };
    expect(deserializeScene(JSON.parse(JSON.stringify(serializeScene(fit)))).document).toEqual({ ...WINDOW, fit: true });
    const fixed = { ...emptyScene(), document: DEFAULT_DOCUMENT };
    expect(deserializeScene(JSON.parse(JSON.stringify(serializeScene(fixed)))).document.fit).toBeUndefined();
  });
});

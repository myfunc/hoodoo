import { describe, expect, it } from 'vitest';
import { ViewKind } from '../../model/scene.enums';
import { EditorStore, INITIAL_EDITOR, PaneMode, paneMode } from '../../world/editor-store';
import { combineStatus, paneViewport } from '../gpu/quad-live';

describe('Four Views panes', () => {
  it('starts with the Camera pane rendered and the others as wires', () => {
    expect(paneMode(INITIAL_EDITOR, ViewKind.Camera)).toBe(PaneMode.Render);
    for (const kind of [ViewKind.Top, ViewKind.Front, ViewKind.Side]) expect(paneMode(INITIAL_EDITOR, kind)).toBe(PaneMode.Wire);
  });

  it('keeps each pane its own mode for the session', () => {
    const editor = new EditorStore();
    editor.update({ quadModes: { ...editor.state.quadModes, [ViewKind.Top]: PaneMode.Render } });
    editor.update({ quad: false });
    editor.update({ quad: true, quadModes: { ...editor.state.quadModes, [ViewKind.Camera]: PaneMode.Wire } });
    expect(paneMode(editor.state, ViewKind.Top)).toBe(PaneMode.Render);
    expect(paneMode(editor.state, ViewKind.Camera)).toBe(PaneMode.Wire);
    expect(paneMode(editor.state, ViewKind.Side)).toBe(PaneMode.Wire);
  });

  it('places a pane in canvas pixels with rows counted from the bottom', () => {
    // A 400×300 CSS canvas at 2 pixels per CSS pixel is 800×600.
    expect(paneViewport({ x: 210, y: 10, w: 180, h: 120 }, 2, 600)).toEqual({ left: 420, bottom: 340, width: 360, height: 240 });
    expect(paneViewport({ x: 0, y: 150, w: 200, h: 150 }, 1, 300)).toEqual({ left: 0, bottom: 0, width: 200, height: 150 });
  });

  it('tiles neighbouring panes without gaps or overlaps after rounding', () => {
    const a = paneViewport({ x: 0.4, y: 0, w: 100.3, h: 50 }, 1.5, 100);
    const b = paneViewport({ x: 100.7, y: 0, w: 100.3, h: 50 }, 1.5, 100);
    expect(a.left + a.width).toBe(b.left);
  });

  it('reports the slowest pane in the live readout', () => {
    const s = combineStatus([
      { samples: 12, target: 16, scale: 1, fps: 40, moving: false },
      { samples: 3, target: 16, scale: 0.5, fps: 22, moving: true },
    ]);
    expect(s).toEqual({ samples: 3, target: 16, scale: 0.5, fps: 22, moving: true });
    expect(combineStatus([]).samples).toBe(0);
  });
});

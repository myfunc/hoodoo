import { liveBounces } from '../../render/gpu/live-quality';
import type { EditorState, EditorStore } from '../../world/editor-store';
import { BOUNCES, finalBounces } from '../../world/render-setup';
import { changeSetting } from '../../world/settings';
import type { World } from '../../world/world';
import { LiveQuality } from '../../world/world.enums';
import { Dial } from '../kit/controls';
import { el } from '../kit/dom';
import type { RowView } from './setting-row';
import './render-options.css';

const DIAL_TITLE = 'Drag, Shift for fine steps, double-click to type';
export const FINAL_DEPTH_ABOUT = 'This scene: Render, Render to Image and movies; saved with it';

/** The scene's final-render depth as Settings and Render Options edit it: each change is one undo step. */
export interface SceneDepth {
  get(): number;
  set(bounces: number): void;
}

export function sceneDepth(world: World): SceneDepth {
  return {
    get: () => finalBounces(world.scene),
    // A dial also commits its unchanged value (on blur when a window closes): no undo step for that.
    set: (bounces) => { if (bounces !== finalBounces(world.scene)) world.setRenderSetup({ ...world.scene.render, bounces }, 'Render reflections'); },
  };
}

/** What the live depth means for each quality, in one line. */
export const liveDepthAbout = (base: number): string => `While you edit; Detailed traces ${liveBounces(LiveQuality.Detailed, base)}`;

/**
 * A depth dial, 1 to 16 bounces. `eager`: every step applies while dragging (a
 * personal setting); otherwise only the value let go of (one undo step).
 */
export function depthDial(value: number, apply: (n: number) => void, eager: boolean): Dial {
  const dial = new Dial({
    label: '', min: BOUNCES.min, max: BOUNCES.max, step: 1, value, title: DIAL_TITLE,
    onInput: (n) => { if (eager) apply(n); }, onCommit: apply,
  });
  dial.el.classList.add('depth-dial');
  return dial;
}

function dialRow(name: string, dial: Dial, about: HTMLElement, sync: (s: EditorState) => void, editor: EditorStore): RowView {
  sync(editor.state);
  return { el: el('div', { cls: 'setting-row' }, [el('span', { cls: 'setting-name', text: name }), dial.el, about]), sync };
}

/** Settings › Render › Live reflections: the live picture's depth, a personal setting. */
export function liveDepthRow(editor: EditorStore): RowView {
  const about = el('span', { cls: 'setting-about' });
  const dial = depthDial(editor.state.settings.liveBounces, (n) => changeSetting(editor, 'liveBounces', n), true);
  return dialRow('Live reflections', dial, about, (s) => {
    dial.set(s.settings.liveBounces);
    about.textContent = liveDepthAbout(s.settings.liveBounces);
  }, editor);
}

/** Settings › Render › Render reflections: the scene's final-render depth. */
export function finalDepthRow(editor: EditorStore, depth: SceneDepth): RowView {
  const about = el('span', { cls: 'setting-about', text: FINAL_DEPTH_ABOUT });
  const dial = depthDial(depth.get(), (n) => depth.set(n), false);
  // Only a new stored value moves the dial: a drag in progress keeps its place until let go.
  let shown = depth.get();
  return dialRow('Render reflections', dial, about, () => {
    if (depth.get() === shown) return;
    shown = depth.get();
    dial.set(shown);
  }, editor);
}

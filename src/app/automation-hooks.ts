import { presetMaterial } from '../assets/materials.presets';
import { createEntry } from '../assets/object.catalog';
import { SKY_LIBRARY } from '../assets/sky.presets';
import type { Vec3 } from '../core/vec3';
import type { SceneView } from '../render/viewport';
import { benchFrames } from '../render/bench';
import { exportPrefs } from '../io/prefs';
import { APP_VERSION } from '../ui/strings';
import type { Thumbnailer } from '../render/thumbs';
import { setDarkVariant } from '../ui/theme';
import type { DarkVariant } from '../ui/theme-variants';
import { ViewKind } from '../model/scene.enums';
import { createObject } from '../world/objects.factory';
import { emptyScene } from '../world/scene.defaults';
import type { World } from '../world/world';
import { worldBox } from '../world/bounds';
import { WireProjector } from '../render/wire/wireframe';

const BENCH_W = 1280;
const BENCH_H = 960;
const BENCH_FRAMES = 12;
const BENCH_IDLE_POLL_MS = 100;
/** Corners of a box as 0/1 picks of min and max per axis. */
const BOX_CORNERS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1] as const);

interface Spec {
  readonly entry: string;
  readonly position: Vec3;
  readonly size?: Vec3;
  readonly material?: string;
}

interface PageRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Page CSS pixels of world points as the main view draws them; null before the view is laid out or when one is behind the eye. */
function pagePoints(view: SceneView, points: readonly Vec3[]): [number, number][] | null {
  const cell = view.mainCell();
  if (!cell) return null;
  const at = view.root.getBoundingClientRect();
  const proj = new WireProjector(view.basisFor(cell.kind, cell.frame.w / cell.frame.h), cell.frame);
  const local = points.map((p) => proj.view(p));
  if (!proj.basis.ortho && local.some((v) => v[2] <= 0)) return null;
  return local.map((v) => {
    const [x, y] = proj.screen(v);
    return [at.left + x, at.top + y];
  });
}

/**
 * window.__hoodoo for scripted checks (tools/*.mjs, benchmarks): ready flag, render
 * status, scene summary, a GPU benchmark, a test-scene builder, and where objects
 * and the move handles sit on the page (tools/make-tutorials.mjs clicks them).
 */
export function installAutomationHooks(world: World, view: SceneView, thumbs: Thumbnailer): void {
  const w = window as unknown as Record<string, unknown>;
  w.__hoodoo = {
    world,
    view,
    /** Every setting as the Settings window exports it (Export…), for reading from the browser. */
    settings: () => exportPrefs(APP_VERSION),
    /** Shows another dark look (ui/theme-variants.ts) while the theme is Dark, to compare them. */
    darkVariant: (variant: DarkVariant) => setDarkVariant({ root: document.documentElement, titleBar: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]') }, variant),
    summary: () => ({ objects: world.scene.objects.length, rendering: view.isRendering, picture: view.hasPicture }),
    /** GPU ms of full 1-sample frames of the current scene from the camera. */
    bench: async (width = BENCH_W, height = BENCH_H, frames = BENCH_FRAMES) => {
      while (view.isRendering || thumbs.pending > 0) await new Promise((r) => setTimeout(r, BENCH_IDLE_POLL_MS));
      return benchFrames(thumbs.engine, thumbs.target(width, height), world.scene, view.basisFor(ViewKind.Camera, width / height), frames);
    },
    /** The page rectangle (CSS px) of the first object called `name`, from its world box; null if none or behind the eye. */
    screenBox: (name: string): PageRect | null => {
      const o = world.scene.objects.find((x) => x.name === name);
      if (!o) return null;
      const b = worldBox(o);
      const pts = pagePoints(view, BOX_CORNERS.map(([i, j, k]) => [i ? b.max[0] : b.min[0], j ? b.max[1] : b.min[1], k ? b.max[2] : b.min[2]]));
      if (!pts) return null;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    },
    /** Page points (CSS px) of the selection's move handles: the centre and the X, Y, Z arrow tips (null when edge-on). */
    gizmo: () => {
      const cell = view.mainCell();
      const g = cell?.gizmo;
      if (!cell || !g) return null;
      const at = view.root.getBoundingClientRect();
      const page = (p: readonly [number, number] | null) => (p ? [at.left + p[0], at.top + p[1]] : null);
      return { origin: page(g.origin), tips: g.tips.map(page) };
    },
    /** Builds a test scene from plain specs and a sky preset name. */
    stage: (specs: readonly Spec[], sky: string) => {
      const objects = specs.map((sp, i) => {
        const o = createObject(createEntry(sp.entry), { seed: i + 1, position: sp.position, size: sp.size });
        return sp.material ? { ...o, material: presetMaterial(sp.material) } : o;
      });
      const base = emptyScene();
      world.replaceScene({ ...base, objects, sky: SKY_LIBRARY.find((s) => s.name === sky)?.sky ?? base.sky }, 'Test stage');
      w.__hoodooReady = false;
      view.render(true);
    },
  };
  view.events.on('live', (st) => {
    if (!st.moving && st.samples >= st.target) {
      w.__hoodooInfo = { liveSamples: st.samples, fps: st.fps, objects: world.scene.objects.length };
      w.__hoodooReady = true;
    }
  });
  view.events.on('progress', (p) => {
    if (!p.active && p.elapsedMs > 0) {
      w.__hoodooInfo = { renderMs: Math.round(p.elapsedMs), objects: world.scene.objects.length };
      w.__hoodooReady = true;
    }
  });
}

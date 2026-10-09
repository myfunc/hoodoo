import { presetMaterial } from '../assets/materials.presets';
import { createEntry } from '../assets/object.catalog';
import { SKY_LIBRARY } from '../assets/sky.presets';
import type { Vec3 } from '../core/vec3';
import type { SceneView } from '../render/viewport';
import { benchFrames } from '../render/bench';
import type { Thumbnailer } from '../render/thumbs';
import { ViewKind } from '../model/scene.enums';
import { createObject } from '../world/objects.factory';
import { emptyScene } from '../world/scene.defaults';
import type { World } from '../world/world';

const BENCH_W = 1280;
const BENCH_H = 960;
const BENCH_FRAMES = 12;
const BENCH_IDLE_POLL_MS = 100;

interface Spec {
  readonly entry: string;
  readonly position: Vec3;
  readonly size?: Vec3;
  readonly material?: string;
}

/**
 * window.__hoodoo for scripted checks (tools/*.mjs, benchmarks): ready flag, render
 * status, scene summary, a GPU benchmark and a test-scene builder.
 */
export function installAutomationHooks(world: World, view: SceneView, thumbs: Thumbnailer): void {
  const w = window as unknown as Record<string, unknown>;
  w.__hoodoo = {
    world,
    view,
    summary: () => ({ objects: world.scene.objects.length, rendering: view.isRendering, picture: view.hasPicture }),
    /** GPU ms of full 1-sample frames of the current scene from the camera. */
    bench: async (width = BENCH_W, height = BENCH_H, frames = BENCH_FRAMES) => {
      while (view.isRendering || thumbs.pending > 0) await new Promise((r) => setTimeout(r, BENCH_IDLE_POLL_MS));
      return benchFrames(thumbs.engine, thumbs.target(width, height), world.scene, view.basisFor(ViewKind.Camera, width / height), frames);
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

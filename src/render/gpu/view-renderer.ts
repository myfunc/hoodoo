import type { Scene } from '../../model/scene.types';
import type { ViewBasis } from '../../world/camera-math';

/** What the picture readouts show (display bar, Render Options, automation hooks). */
export interface RealtimeStatus {
  readonly samples: number;
  readonly target: number;
  readonly scale: number;
  readonly fps: number;
  readonly moving: boolean;
  /** Render View only (final-view.ts): the time a pass takes and how far the picture is from its target. */
  readonly final?: FinalProgress;
  /** The game renderer's picture (game-renderer.ts): `scale` is its traced size per side. */
  readonly game?: boolean;
}

/** Render View's readout: one pass of rays over the picture, the time left to the target, the time so far. */
export interface FinalProgress {
  readonly passMs: number;
  readonly remainingMs: number;
  readonly elapsedMs: number;
}

/** The scene and view a picture on screen was traced with: the wires draw these, so they lag with the picture. */
export interface ShownFrame {
  readonly scene: Scene;
  readonly basis: ViewBasis;
}

/**
 * A renderer that redraws the single view by itself while its picture mode is on
 * (SceneView picks one per world.enums PictureMode): the live preview (realtime.ts)
 * and Render View (final-view.ts). Another mode, such as a game renderer, plugs in
 * by implementing this, adding its PictureMode and one case in SceneView.continuous.
 */
export interface ViewRenderer {
  /** Rays per pixel to refine to while nothing changes. */
  target: number;
  readonly imageReady: boolean;
  /** The view's size in device pixels; the renderer sizes the canvas it draws. */
  resize(width: number, height: number): void;
  /** The scene or the camera changed; the same pair again keeps refining. */
  update(scene: Scene, basis: ViewBasis): void;
  /** One animation frame of work (`now`: the frame's time, ms); false once there is nothing left to do until the next change. */
  tick(now?: number): boolean;
  /** Draws the current picture again (before the canvas is copied). */
  present(): void;
  /** Forgets the picture: the next update starts afresh. */
  reset(): void;
  status(): RealtimeStatus;
  /** What the picture on screen shows; null or missing: the wires follow the editor at once. */
  readonly shown?: ShownFrame | null;
  /** Pictures drawn so far (the game renderer): Play's own layers redraw with each new one. */
  readonly pictures?: number;
}

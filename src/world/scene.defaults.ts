import { DEFAULT_SKY } from '../assets/sky.presets';
import { ViewKind } from '../model/scene.enums';
import type { Camera, DocumentSetup, OrthoView, Scene } from '../model/scene.types';

/** Bryce 2's default document: 640 x 480. */
export const DEFAULT_DOCUMENT: DocumentSetup = { width: 640, height: 480 };

export const DEFAULT_CAMERA: Camera = {
  position: [0, 2.4, 18],
  yaw: 0,
  pitch: -5,
  bank: 0,
  fov: 52,
  focus: 18,
  aperture: 0,
};

const ORTHO_SPAN = 30;
const ortho = (): OrthoView => ({ center: [0, 0, 0], span: ORTHO_SPAN });

export const DEFAULT_VIEWS: Readonly<Record<ViewKind, OrthoView>> = {
  [ViewKind.Camera]: ortho(),
  [ViewKind.Top]: ortho(),
  [ViewKind.Front]: ortho(),
  [ViewKind.Side]: ortho(),
  [ViewKind.Director]: ortho(),
};

export const BOOKMARK_SLOTS = 9;

export function emptyScene(): Scene {
  return {
    objects: [],
    camera: DEFAULT_CAMERA,
    sky: DEFAULT_SKY,
    document: DEFAULT_DOCUMENT,
    views: DEFAULT_VIEWS,
    bookmarks: Array.from({ length: BOOKMARK_SLOTS }, () => null),
  };
}

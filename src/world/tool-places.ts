import type { ObjectId } from '../model/scene.ids';
import type { SceneObject } from '../model/scene.types';
import { LIGHT_KINDS, TERRAIN_KINDS } from './objects.factory';

/**
 * The tool windows: Object Attributes, the Materials Lab and the Terrain Editor.
 * Each floats over the scene or docks in the left column (ui/chrome/tool-windows.ts),
 * follows the selection, and remembers where it lives (`EditorState.toolPlaces`, io/prefs.ts).
 */
export enum ToolId {
  Attributes = 'attributes',
  Materials = 'materials',
  Terrain = 'terrain',
  /**
   * The Render page of the left panel (ui/labs/render-options.ts). Its id changed from
   * 'render-options' when it became the panel's default page: places kept for the old floating window drop.
   */
  RenderOptions = 'render',
  /** View › Preview Features… (ui/labs/preview-window.ts). */
  PreviewFeatures = 'preview-features',
}

/** Where a tool window lives: docked in the left column, or floating with its top-left corner at x, y (CSS px). */
export interface ToolPlace {
  readonly docked: boolean;
  /** Open when last seen: a docked window that was open comes back with the next visit. */
  readonly open?: boolean;
  readonly x?: number;
  readonly y?: number;
}

export type ToolPlaces = Readonly<Partial<Record<ToolId, ToolPlace>>>;

/** A first visit: the Render page sits docked and open in the left panel, under the camera controls. */
export const DEFAULT_TOOL_PLACES: ToolPlaces = { [ToolId.RenderOptions]: { docked: true, open: true } };

export interface Box {
  readonly width: number;
  readonly height: number;
}

const IDS: ReadonlySet<unknown> = new Set(Object.values(ToolId));
const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Remembered places from stored or exported prefs: known windows only, anything malformed left out. */
export function toolPlacesFrom(raw: unknown): ToolPlaces {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Record<ToolId, ToolPlace>> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!IDS.has(id) || !value || typeof value !== 'object') continue;
    const p = value as Record<string, unknown>;
    if (typeof p.docked !== 'boolean') continue;
    const spot = isCoord(p.x) && isCoord(p.y) ? { x: Math.round(p.x), y: Math.round(p.y) } : {};
    out[id as ToolId] = { docked: p.docked, ...(typeof p.open === 'boolean' ? { open: p.open } : {}), ...spot };
  }
  return out;
}

export const isDocked = (places: ToolPlaces, id: ToolId): boolean => places[id]?.docked === true;

/** Docks or floats a window; where it last floated is kept for the next time it floats. */
export function withDocked(places: ToolPlaces, id: ToolId, docked: boolean): ToolPlaces {
  return { ...places, [id]: { ...places[id], docked } };
}

/** A floating window let go at x, y. */
export function withSpot(places: ToolPlaces, id: ToolId, x: number, y: number): ToolPlaces {
  return { ...places, [id]: { ...places[id], docked: false, x: Math.round(x), y: Math.round(y) } };
}

/** A window opened or closed; unchanged places come back as they were (no needless store). */
export function withOpen(places: ToolPlaces, id: ToolId, open: boolean): ToolPlaces {
  if ((places[id]?.open ?? false) === open) return places;
  return { ...places, [id]: { docked: false, ...places[id], open } };
}

/** The windows to bring back at start: docked ones that were open, in `order`. */
export const reopened = (places: ToolPlaces, order: readonly ToolId[]): ToolId[] => order.filter((id) => places[id]?.docked && places[id]?.open);

/**
 * Where a floating window opens on a page of `page` size: where it was left, moved
 * back inside the page if the browser got smaller; the first time centred, as the
 * dialogs open. Nothing goes above `top` (the menu bar).
 */
export function floatSpot(place: ToolPlace | undefined, win: Box, page: Box, top: number): { x: number; y: number } {
  const maxX = Math.max(0, page.width - win.width);
  const maxY = Math.max(top, page.height - win.height);
  if (place?.x === undefined || place.y === undefined) return { x: Math.round(maxX / 2), y: Math.round(clamp((page.height - win.height) / 2, top, maxY)) };
  return { x: clamp(place.x, 0, maxX), y: clamp(place.y, top, maxY) };
}

/** What Object Attributes shows: the first selected object, as the Attributes command always opened. */
export const attributesTarget = (selected: readonly SceneObject[]): SceneObject | null => selected[0] ?? null;

/** What the Materials Lab dresses: the selected objects that wear a material (lights do not). */
export const materialTargets = (selected: readonly SceneObject[]): SceneObject[] => selected.filter((o) => !LIGHT_KINDS.has(o.kind));

/** What the Terrain Editor shapes: the first selected terrain or lattice. */
export const terrainTarget = (selected: readonly SceneObject[]): SceneObject | null => selected.find((o) => TERRAIN_KINDS.has(o.kind)) ?? null;

/** What a window that follows the selection does after a change. */
export enum FollowStep {
  /** Another object (or none): build the window for it. */
  Show = 'show',
  /** The same object changed (an edit, undo, the playhead): refresh the values in place. */
  Refresh = 'refresh',
  /** Nothing it shows changed. */
  Stay = 'stay',
}

/** `shown` is the object the window was built or last refreshed for; `target` is what it should show now. */
export function followStep(shown: SceneObject | null, target: SceneObject | null): FollowStep {
  const shownId: ObjectId | null = shown?.id ?? null;
  if ((target?.id ?? null) !== shownId) return FollowStep.Show;
  return target && target !== shown ? FollowStep.Refresh : FollowStep.Stay;
}

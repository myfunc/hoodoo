import { hexToRgb as h } from '../core/color';
import type { Vec3 } from '../core/vec3';
import { presetMaterial } from '../assets/materials.presets';
import { type CreateEntry, createEntry } from '../assets/object.catalog';
import type { LibraryObject } from '../assets/object.library';
import { DEFAULT_SKY } from '../assets/sky.presets';
import { material } from '../model/material.factory';
import { ShapeKind, SkyMode } from '../model/scene.enums';
import type { Material, Scene, SceneObject, Sky } from '../model/scene.types';
import { type ViewBasis, cameraBasis, lookAt } from '../world/camera-math';
import { createObject } from '../world/objects.factory';
import { DEFAULT_CAMERA, emptyScene } from '../world/scene.defaults';
import {
  CLOUD_ICON, CONTROL_ICON_DATA, ICON_FIT, type IconData, ICON_FOV, ICON_SEED, ICON_TERRAIN_SIZE, LATTICE_ICON_SIZE, LIBRARY_FIT,
  LIGHT_ICON, PLANE_ICON_SIZE, PREVIEW_FLOOR_Y, PREVIEW_FOV, type PieceData, SKY_ASPECT, SKY_FOV, SKY_LOOK_AT,
  SPOT_ICON, TEAL, TERRAIN_SEED, TRACKBALL, VIEW_FROM,
} from './icon-data';

/** Mini scenes for everything the interface draws with the ray tracer. */
export interface IconSpec {
  readonly scene: Scene;
  readonly basis: ViewBasis;
}

export enum ControlIcon {
  Trackball = 'trackball',
  CrossXY = 'cross-xy',
  CrossXZ = 'cross-xz',
  CrossYZ = 'cross-yz',
  View = 'view',
  Render = 'render',
  Stop = 'stop',
  Clear = 'clear',
  Materials = 'materials',
  Resize = 'resize',
  Rotate = 'rotate',
  Reposition = 'reposition',
  Align = 'align',
  Randomize = 'randomize',
  EditTerrain = 'edit-terrain',
  Land = 'land',
  Library = 'library',
}

const ICON_SKY: Sky = {
  ...DEFAULT_SKY,
  mode: SkyMode.AtmosphereOff,
  skyColor: h('#c9cdd2'),
  sunAzimuth: -40,
  sunAltitude: 50,
  shadows: 0,
  hazeAmount: 0,
  ambientColor: h('#9aa4b0'),
  clouds: { ...DEFAULT_SKY.clouds, cover: 0 },
};

const PREVIEW_SKY: Sky = { ...DEFAULT_SKY, sunAzimuth: -35, sunAltitude: 40, hazeAmount: 10 };
const LIBRARY_SKY: Sky = { ...DEFAULT_SKY, sunAzimuth: -40, sunAltitude: 40, hazeAmount: 0 };

const OWN_MATERIALS: Readonly<Record<string, Material>> = {
  [TEAL]: material({
    name: 'Icon Teal',
    colors: { diffuse: h('#2f9c9c'), ambient: h('#1f6a6a'), specular: h('#ffffff') },
    values: { diffusion: 85, ambience: 30, specularity: 70 },
  }),
  [TRACKBALL]: material({
    name: 'Trackball',
    colors: { diffuse: h('#e0956a'), ambient: h('#8a4a2a'), specular: h('#ffffff') },
    values: { diffusion: 85, ambience: 35, specularity: 60 },
  }),
};

const materialOf = (key: string): Material => OWN_MATERIALS[key] ?? presetMaterial(key);

function camera(from: Vec3, fov: number) {
  return lookAt({ ...DEFAULT_CAMERA, position: from, fov, focus: Math.hypot(from[0], from[1], from[2]) }, [0, 0, 0]);
}

function spec(objects: SceneObject[], from: Vec3, sky: Sky = ICON_SKY, fov = ICON_FOV): IconSpec {
  return { scene: { ...emptyScene(), objects, sky }, basis: cameraBasis(camera(from, fov), 1) };
}

function build(p: PieceData): SceneObject {
  const isTerrain = p.entry === 'terrain' || p.entry === 'lattice';
  const o = createObject(createEntry(p.entry), { seed: isTerrain ? TERRAIN_SEED : ICON_SEED, position: p.position ?? [0, 0, 0], size: p.size });
  return { ...o, material: materialOf(p.mat), transform: { ...o.transform, rotation: p.rotation ?? [0, 0, 0] } };
}

export function controlIcon(kind: ControlIcon): IconSpec {
  const data: IconData = CONTROL_ICON_DATA[kind];
  return spec(data.pieces.map(build), data.from, data.studio ? PREVIEW_SKY : ICON_SKY);
}

const PLANE_ICON_MATERIAL: Partial<Record<ShapeKind, string>> = {
  [ShapeKind.WaterPlane]: 'Blue Lagoon',
  [ShapeKind.GroundPlane]: 'Grassy Plain',
};

/** Create-palette icon: planes show as tilted squares, terrains small, the rest in teal. */
export function createIcon(e: CreateEntry): IconSpec {
  const from = VIEW_FROM.angled;
  const planeMat = PLANE_ICON_MATERIAL[e.kind];
  if (planeMat) return spec([build({ entry: 'square', size: PLANE_ICON_SIZE, mat: planeMat })], from);
  if (e.kind === ShapeKind.CloudPlane) return spec(CLOUD_ICON.map(build), from);
  if (e.kind === ShapeKind.Terrain) return spec([build({ entry: 'terrain', size: ICON_TERRAIN_SIZE, mat: 'Default' })], from);
  if (e.kind === ShapeKind.Lattice) return spec([build({ entry: 'lattice', size: LATTICE_ICON_SIZE, mat: TEAL })], from);
  if (e.kind === ShapeKind.RadialLight) return spec(LIGHT_ICON.map(build), from);
  if (e.kind === ShapeKind.SpotLight) return spec(SPOT_ICON.map(build), from);
  const s = e.size;
  const k = ICON_FIT / Math.max(s[0], s[1], s[2]);
  return spec([build({ entry: e.id, size: [s[0] * k, s[1] * k, s[2] * k], mat: e.kind === ShapeKind.Stone ? 'Granite' : TEAL })], from);
}

/** Materials Lab preview: the material on a sphere over a checker floor under a soft sky. */
export function materialPreview(m: Material, floor = true): IconSpec {
  const ball = { ...build({ entry: 'sphere', mat: TEAL }), material: m };
  const objects = [ball];
  if (floor) {
    const g = createObject(createEntry('ground'), { seed: 1, position: [0, PREVIEW_FLOOR_Y, 0], material: 'Chrome Checkers' });
    objects.push({ ...g, material: { ...g.material, values: { ...g.material.values, reflection: 0 } } });
  }
  return spec(objects, VIEW_FROM.preview, PREVIEW_SKY, PREVIEW_FOV);
}

/** Sky thumbnail: the atmosphere above a plain ground, camera looking slightly up. */
export function skyPreview(sky: Sky): IconSpec {
  const g = createObject(createEntry('ground'), { seed: 1, position: [0, 0, 0], material: 'Grassy Plain' });
  const cam = lookAt({ ...DEFAULT_CAMERA, position: VIEW_FROM.sky, fov: SKY_FOV }, SKY_LOOK_AT);
  return { scene: { ...emptyScene(), objects: [g], sky }, basis: cameraBasis(cam, SKY_ASPECT) };
}

export function libraryPreview(lib: LibraryObject, terrain: SceneObject): IconSpec {
  const k = LIBRARY_FIT / Math.max(lib.size[0], lib.size[2]);
  const t: SceneObject = { ...terrain, transform: { position: [0, 0, 0], rotation: [0, 0, 0], size: [lib.size[0] * k, lib.size[1] * k, lib.size[2] * k] } };
  return spec([t], VIEW_FROM.library, LIBRARY_SKY);
}

import { hexToRgb as h } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import { TEXTURED_COLOR, material, texture } from '../../model/material.factory';
import { BooleanMode, SkyMode, TextureKind, TextureMapping } from '../../model/scene.enums';
import { type GroupId, newGroupId } from '../../model/scene.ids';
import type { GroupNode, Scene, SceneObject } from '../../model/scene.types';
import { type BustPlacement, type Point, bustFacing, bustPoint, bustSurface, marbleBust } from './bust';
import { TAU, aimed, loopKeys, place, showcase, skyPreset } from './kit';

/**
 * "Marble Dream": a vaporwave still life. A white marble head on a fluted
 * pedestal stands on an endless lavender checkerboard, a ring of glass arches
 * round it, a streaky pink and violet sky over pale dunes, a green glow low in
 * the west. A little framed window in the cheek shows a cactus. The camera
 * sways gently in front.
 */

const FLOOR = material({
  name: 'Lavender Checkers',
  textures: [texture(TextureKind.Checker, 0.36, [h('#03041a'), h('#8a7ab8'), h('#fff4ff')], { detail: 1 })],
  colorSources: TEXTURED_COLOR,
  colors: { specular: h('#ffffff') },
  values: { diffusion: 92, ambience: 50, specularity: 50, reflection: 22 },
});
const DUNES = material({
  name: 'Lilac Dunes',
  textures: [texture(TextureKind.Ripples, 0.2, [h('#8a64b8'), h('#c8a2e0'), h('#f4d8f4')], { detail: 4 })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 85, ambience: 45, specularity: 10 },
});
/** A huge veil far off in the west, bright at its foot: the sky's green glow. */
const GLOW = material({
  name: 'Green Glow',
  textures: [texture(TextureKind.Beam, 1, [h('#38b818'), h('#68e838'), h('#c8ff88')], { detail: 1, mapping: TextureMapping.Object })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 0, ambience: 100, specularity: 0, transparency: 100 },
  valueSources: { transparency: 1 },
});

/** The window's pane, a pale sky glowing on its own, and the cactus in it. */
const PANE = material({ name: 'Window Sky', colors: { diffuse: h('#a8eef0'), ambient: h('#8ae0ea') }, values: { diffusion: 50, ambience: 70, specularity: 20 } });
const CACTUS = material({ name: 'Cactus Green', colors: { diffuse: h('#2fae3a'), ambient: h('#1a7a26') }, values: { diffusion: 80, ambience: 40, specularity: 30 } });

const PEDESTAL = { step: [1.75, 0.25, 1.75] as Vec3, drum: [1.35, 0.88, 1.35] as Vec3, plate: [1.52, 0.08, 1.52] as Vec3 };
const HEAD = { scale: 0.14, turn: [8, -84, 7] as Vec3, sink: 0.08 };
/** The window on the left cheek, found from inside the head along `yaw` (degrees from forward), and its cactus. */
const WINDOW = {
  from: [2, -0.6, 2] as Point, yaw: 38, half: [2.2, 1.9, 0.3] as Point, pane: [1.8, 1.5, 0.3] as Point,
  cactus: { trunk: [0.38, 1.2, 0.38] as Point, arm: [0.22, 0.5, 0.22] as Point, armAt: [0.75, 0.25] as const },
};

/** The arches: glass slabs round a circle about the bust, each cut by a round-topped opening. */
const ARCHES = {
  radius: 19,
  /** Angles of the slabs about the bust, degrees (0 = +X, 90 = away from the camera). */
  from: 20,
  to: 250,
  count: 22,
  half: [1.75, 5, 0.1] as Vec3,
  /** The opening: its half-width and the height where its round top starts. */
  open: 1.15,
  spring: 6.4,
};
const DEG = Math.PI / 180;
/** A slab's face turned this far from its angle round the ring faces the bust. */
const FACE_IN = 90;
/** The opening's round top: a cylinder tipped onto its side, through the slab. */
const TIPPED = 90;

const DUNE_FIELD = { at: [10, -0.8, -110] as Vec3, size: [220, 6, 50] as Vec3, seed: 17 };
const GLOW_VEIL = { at: [45, 8, -185] as Vec3, size: [110, 160, 30] as Vec3, turn: [0, 20, 0] as Vec3 };

const SKY = {
  preset: 'Vapor Sunset',
  patch: {
    mode: SkyMode.SoftSky,
    skyColor: h('#2414d8'), horizonColor: h('#b088ff'), hazeColor: h('#d0a0ff'), hazeAmount: 8,
    sunColor: h('#fffaff'), ambientColor: h('#7a5ae0'), sunAzimuth: -85, sunAltitude: 44,
  },
  clouds: { cover: 48, color: h('#ff30b8'), stratus: true, cumulus: true, frequency: 30, amplitude: 80 },
};

/** The camera looks at the bust from the front left, so the checkerboard runs diagonally; it sways a little. */
const CAMERA = { from: [-6.9, 4.2, 8.4] as Vec3, aim: [0.1, 3.7, 0.1] as Vec3, sway: 0.6, rise: 0.2, lens: { fov: 46 }, keys: 12 };

function arch(angle: number, n: number): { objects: SceneObject[]; group: GroupNode } {
  const a = angle * DEG;
  const at: Vec3 = [ARCHES.radius * Math.cos(a), ARCHES.half[1], -ARCHES.radius * Math.sin(a)];
  const turn: Vec3 = [0, angle - FACE_IN, 0];
  const id: GroupId = newGroupId();
  const member = (o: SceneObject, mode: BooleanMode): SceneObject => ({ ...o, groupId: id, boolean: mode });
  const half = ARCHES.half;
  const slab = place({ entry: 'cube', name: 'Glass Slab', material: 'Tinted Glass', position: at, size: half, rotation: turn });
  const gap = place({ entry: 'cube', name: 'Opening', material: 'Default', position: [at[0], ARCHES.spring / 2, at[2]], size: [ARCHES.open, ARCHES.spring / 2 + half[2], half[2] * 2], rotation: turn });
  const top = place({ entry: 'cylinder', name: 'Round Top', material: 'Default', position: [at[0], ARCHES.spring, at[2]], size: [ARCHES.open, half[2] * 2, ARCHES.open], rotation: [TIPPED, angle - FACE_IN, 0] });
  return {
    objects: [member(slab, BooleanMode.Positive), member(gap, BooleanMode.Negative), member(top, BooleanMode.Negative)],
    group: { id, name: `Glass Arch ${n}`, parentId: null, collapsed: true },
  };
}

function pedestal(): SceneObject[] {
  const P = PEDESTAL;
  const stepTop = P.step[1] * 2;
  const drumTop = stepTop + P.drum[1] * 2;
  return [
    place({ entry: 'lathe-pedestal', name: 'Pedestal Step', material: 'White Marble', position: [0, P.step[1], 0], size: P.step }),
    place({ entry: 'lathe-pedestal', name: 'Pedestal', material: 'Grey Marble', position: [0, stepTop + P.drum[1], 0], size: P.drum }),
    place({ entry: 'cylinder', name: 'Pedestal Plate', material: 'White Marble', position: [0, drumTop + P.plate[1], 0], size: P.plate }),
  ];
}

/** A teal frame on the cheek, a pale pane in it and a little green cactus standing in the pane. */
function cheekWindow(head: BustPlacement): SceneObject[] {
  const W = WINDOW;
  const k = head.scale;
  const turn = bustFacing(head, W.yaw);
  const n: Point = [Math.sin(W.yaw * DEG), 0, Math.cos(W.yaw * DEG)];
  const skin = bustSurface(W.from, n);
  const out = (d: number, du = 0, dv = 0): Vec3 => bustPoint(head, [skin[0] + d * n[0] + du * n[2], skin[1] + dv, skin[2] + d * n[2] - du * n[0]]);
  const sized = (s: Point): Vec3 => [s[0] * k, s[1] * k, s[2] * k];
  const C = W.cactus;
  const front = W.half[2] + W.pane[2];
  return [
    place({ entry: 'cube', name: 'Window Frame', material: 'Anodized Teal', position: out(W.half[2]), size: sized(W.half), rotation: turn }),
    { ...place({ entry: 'cube', name: 'Window Pane', material: 'Default', position: out(front), size: sized(W.pane), rotation: turn }), material: PANE },
    { ...place({ entry: 'cylinder', name: 'Cactus', material: 'Default', position: out(front + W.pane[2] + C.trunk[2]), size: sized(C.trunk), rotation: turn }), material: CACTUS },
    ...[-1, 1].map((side, i) => ({
      ...place({ entry: 'cylinder', name: `Cactus Arm ${i + 1}`, material: 'Default', position: out(front + W.pane[2] + C.trunk[2], side * C.armAt[0], side * C.armAt[1]), size: sized(C.arm), rotation: turn }),
      material: CACTUS,
    })),
  ];
}

export function marbleDream(): Scene {
  const P = PEDESTAL;
  const top = P.step[1] * 2 + P.drum[1] * 2 + P.plate[1] * 2;
  const head: BustPlacement = { base: [0, top - HEAD.sink, 0], scale: HEAD.scale, turn: HEAD.turn, material: 'White Marble' };
  const arches = Array.from({ length: ARCHES.count }, (_, i) => arch(ARCHES.from + ((ARCHES.to - ARCHES.from) * i) / (ARCHES.count - 1), i + 1));
  const objects: SceneObject[] = [
    { ...place({ entry: 'ground', name: 'Checkerboard', material: 'Default', position: [0, 0, 0] }), material: FLOOR },
    { ...place({ entry: 'terrain', name: 'Lilac Dunes', material: 'Default', position: DUNE_FIELD.at, size: DUNE_FIELD.size, seed: DUNE_FIELD.seed, landform: 'Dune Field' }), material: DUNES },
    { ...place({ entry: 'sphere', name: 'Green Glow', material: 'Default', position: GLOW_VEIL.at, size: GLOW_VEIL.size, rotation: GLOW_VEIL.turn }), material: GLOW },
    ...pedestal(),
    marbleBust(head),
    ...cheekWindow(head),
    ...arches.flatMap((a) => a.objects),
  ];
  const C = CAMERA;
  const camera = loopKeys(C.keys, (u) => aimed([C.from[0] + C.sway * Math.sin(TAU * u), C.from[1] + C.rise * Math.sin(2 * TAU * u), C.from[2] + C.sway * Math.sin(TAU * u)], C.aim, C.lens));
  const base = skyPreset(SKY.preset, SKY.patch);
  const sky = { ...base, clouds: { ...base.clouds, ...SKY.clouds } };
  return showcase({ objects, groups: arches.map((a) => a.group), sky, camera: camera[0].value }, { camera });
}

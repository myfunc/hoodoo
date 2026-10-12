import { hexToRgb as h } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import type { Camera, Scene, SceneObject } from '../../model/scene.types';
import { TAU, aimed, loopKeys, place, showcase, skyPreset } from './kit';

/**
 * "Hoodoo Run": camera animation. The camera flies a figure of eight low over a
 * lake at golden hour — round a stack of hoodoo spires, through a stone arch,
 * under a mirror ball, round the other stack, through the second arch — banking
 * into each turn. A figure of eight turns as far left as right, so the camera
 * ends facing where it began and the loop has no seam.
 */

const PATH = {
  centre: [0, 0, -24] as Vec3,
  /** Half-width of the eight and the depth of its lobes. */
  across: 24,
  deep: 30,
  height: 3.2,
  bob: 1.1,
  /** How far ahead along the path the camera looks (radians of the loop) and how much lower. */
  ahead: 0.22,
  dip: 0.8,
  /** Degrees of bank per degree of turn ahead. */
  bank: 0.4,
  keys: 30,
  /** Where in the eight the loop starts: heading into the east arch. */
  start: 0.19,
};
const LENS = { fov: 58 };

/** Arches stand across the path where the eight is widest, so the camera flies through them. */
const ARCH = { size: 6.5, tube: 0.18, lift: 0.6 };
const SPIRES: readonly { at: Vec3; size: Vec3; seed: number }[] = [
  { at: [-13, 5.4, -24], size: [7, 9, 7], seed: 5 },
  { at: [13, 5.4, -24], size: [7, 9, 7], seed: 9 },
  { at: [-44, 7, -40], size: [9, 12, 9], seed: 14 },
  { at: [44, 7, -12], size: [9, 12, 9], seed: 22 },
  { at: [0, 9, -70], size: [14, 15, 12], seed: 31 },
  { at: [-36, 6, 6], size: [8, 10, 8], seed: 41 },
  { at: [34, 6, -58], size: [8, 10, 8], seed: 48 },
  { at: [-12, 6, 6], size: [7, 10, 7], seed: 53 },
  { at: [16, 7.5, 10], size: [8, 12, 8], seed: 61 },
  { at: [40, 5, 14], size: [7, 9, 7], seed: 72 },
  { at: [-30, 8, 22], size: [9, 13, 9], seed: 83 },
];
const MIRROR_BALL = { at: [0, 8.2, -24] as Vec3, r: 2.2 };
const SKY = {
  preset: 'Golden Hour',
  patch: { sunAzimuth: 120, sunAltitude: 11, hazeAmount: 32, skyColor: h('#3a68b0'), horizonColor: h('#ffd2a0') },
};

/** The figure of eight at phase u. */
function pathAt(u: number): Vec3 {
  const P = PATH;
  const a = TAU * (u + P.start);
  return [P.centre[0] + P.across * Math.sin(a), P.height + P.bob * Math.sin(2 * a), P.centre[2] + (P.deep / 2) * Math.sin(2 * a)];
}

const HALF_TURN = 180;
const yawTo = (from: Vec3, to: Vec3): number => (Math.atan2(-(to[0] - from[0]), -(to[2] - from[2])) * HALF_TURN) / Math.PI;
const FULL_TURN = 360;
const wrap = (deg: number): number => ((deg + HALF_TURN) % FULL_TURN + FULL_TURN) % FULL_TURN - HALF_TURN;

function cameraAt(u: number): Camera {
  const P = PATH;
  const here = pathAt(u);
  const step = P.ahead / TAU;
  const ahead = pathAt(u + step);
  const further = pathAt(u + 2 * step);
  const look = aimed(here, [ahead[0], ahead[1] - P.dip, ahead[2]], LENS);
  // Bank into the turn: how much the heading still has to swing.
  const turn = wrap(yawTo(ahead, further) - yawTo(here, ahead));
  return { ...look, bank: -turn * P.bank };
}

export function hoodooRun(): Scene {
  const arch = (x: number): SceneObject => ({
    ...place({ entry: 'torus', name: x < 0 ? 'West Arch' : 'East Arch', material: 'Red Rock', position: [x, ARCH.lift, PATH.centre[2]], size: [ARCH.size, ARCH.size, ARCH.size], rotation: [HALF_TURN / 2, 0, 0] }),
    shapeParam: ARCH.tube,
  });
  const objects: SceneObject[] = [
    place({ entry: 'water', name: 'Lake', material: 'Mirror Lake', position: [0, 0, 0] }),
    ...SPIRES.map((s, i) => place({ entry: 'terrain', name: `Hoodoo ${i + 1}`, material: 'Canyon Strata', position: s.at, size: s.size, seed: s.seed, landform: 'Hoodoo Spires' })),
    arch(PATH.centre[0] - PATH.across),
    arch(PATH.centre[0] + PATH.across),
    place({ entry: 'sphere', name: 'Mirror Ball', material: 'Mirror', position: MIRROR_BALL.at, size: [MIRROR_BALL.r, MIRROR_BALL.r, MIRROR_BALL.r] }),
  ];
  const camera = loopKeys(PATH.keys, cameraAt);
  return showcase({ objects, sky: skyPreset(SKY.preset, SKY.patch), camera: camera[0].value }, { camera });
}

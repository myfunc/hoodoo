import type { Vec3 } from '../../core/vec3';
import type { Scene, SceneObject } from '../../model/scene.types';
import { withBody } from '../body-flags';
import { emptyScene } from '../scene.defaults';
import { aimed, place, skyPreset } from './kit';

/**
 * "Mini City", to play in and try physics: three by three blocks of buildings with
 * windows (the Buildings materials), streets and pavements between them, rolling hills
 * from height maps around, and a square of crates, barrels and balls to push about in
 * Play. The same city at night lights some of its windows.
 */

/** Blocks: their count each way, their width and the street between. */
const GRID = { blocks: 3, block: 14, street: 6 } as const;
/** A building's footprint inside its block, the pavement's margin and the storey height. */
const LOT = { inset: 1.2, gap: 1, storey: 2.6 } as const;
const PAVEMENT = { height: 0.15 } as const;
const ROAD = { height: 0.04 } as const;
const STYLES = ['Office Tower', 'Brick Houses', 'Warehouse'] as const;
/** Storeys by style: low and high, chosen per lot from a fixed hash so the city is the same each time. */
const STOREYS: Readonly<Record<(typeof STYLES)[number], readonly [number, number]>> = {
  'Office Tower': [5, 11],
  'Brick Houses': [2, 5],
  Warehouse: [1, 2],
};
/** Hills start past the city's edge (it reaches 36 from the centre): their centres this far out. */
const HILLS = { size: [40, 6, 40] as Vec3, ring: 82 } as const;
/** The square in the middle block: no buildings, physics props to push. */
const SQUARE = { crates: 9, crate: 0.5, crateStep: 2.05, barrels: 4, barrel: [0.45, 0.6, 0.45] as Vec3, barrelStep: 1.2, balls: 3, ball: 0.45, ballStep: 1.4 } as const;
/** Spreads the two lots' hashes apart. */
const LOT_SALT = 5;
/** Down the avenue between the blocks, at eye height: where Play starts. */
const CAMERA = { from: [-10, 2.2, 34] as Vec3, aim: [-10, 4, -12] as Vec3, lens: { fov: 62 } };
const NIGHT_CAMERA = { from: [-30, 14, 38] as Vec3, aim: [0, 5, 0] as Vec3, lens: { fov: 55 } };
const HASH = { a: 12.9898, b: 78.233, scale: 43758.5453 } as const;

/** 0..1 from two whole numbers, the same every build. */
const hash = (i: number, j: number) => {
  const x = Math.sin(i * HASH.a + j * HASH.b) * HASH.scale;
  return x - Math.floor(x);
};

/** The centre of block (i, j), the city centred on the origin. */
const blockAt = (i: number, j: number): [number, number] => {
  const pitch = GRID.block + GRID.street;
  const start = -((GRID.blocks - 1) * pitch) / 2;
  return [start + i * pitch, start + j * pitch];
};

/** Two buildings side by side on a block, each its style and height. */
function block(i: number, j: number): SceneObject[] {
  const [cx, cz] = blockAt(i, j);
  const half = GRID.block / 2;
  const out: SceneObject[] = [
    place({ entry: 'cube', name: `Pavement ${i + 1}-${j + 1}`, material: 'Concrete', position: [cx, PAVEMENT.height, cz], size: [half, PAVEMENT.height, half] }),
  ];
  const width = (GRID.block - LOT.inset * 2 - LOT.gap) / 2;
  for (let k = 0; k < 2; k++) {
    const style = STYLES[Math.floor(hash(i * 3 + k, j) * STYLES.length)];
    const [low, high] = STOREYS[style];
    const storeys = low + Math.floor(hash(j * LOT_SALT + k, i + 1) * (high - low + 1));
    const h = (storeys * LOT.storey) / 2;
    const x = cx - half + LOT.inset + width / 2 + k * (width + LOT.gap);
    const depth = half - LOT.inset;
    out.push(place({ entry: 'cube', name: `${style} ${i + 1}-${j + 1}${k ? 'b' : 'a'}`, material: style, position: [x, PAVEMENT.height * 2 + h, cz], size: [width / 2, h, depth] }));
  }
  return out;
}

/** Crates stacked in a pyramid, barrels and balls on the middle square: physical, so Play can push them. */
function square(): SceneObject[] {
  const [cx, cz] = blockAt(1, 1);
  const s = SQUARE.crate;
  const top = PAVEMENT.height * 2;
  const out: SceneObject[] = [place({ entry: 'cube', name: 'Square', material: 'Concrete', position: [cx, PAVEMENT.height, cz], size: [GRID.block / 2, PAVEMENT.height, GRID.block / 2] })];
  let n = 0;
  for (let row = 0; row < 3; row++) for (let c = 0; c < 3 - row; c++) {
    if (n++ >= SQUARE.crates) break;
    const crate = place({ entry: 'cube', name: `Crate ${n}`, material: 'Polished Wood', position: [cx - 2 + c * s * SQUARE.crateStep + row * s, top + s + row * s * 2, cz + 2], size: [s, s, s] });
    out.push(withBody(crate, { physical: true }));
  }
  for (let b = 0; b < SQUARE.barrels; b++) {
    const barrel = place({ entry: 'cylinder', name: `Barrel ${b + 1}`, material: 'Red Plastic', position: [cx + 3, top + SQUARE.barrel[1], cz - 3 + b * SQUARE.barrelStep], size: SQUARE.barrel });
    out.push(withBody(barrel, { physical: true }));
  }
  for (let b = 0; b < SQUARE.balls; b++) {
    const r = SQUARE.ball;
    const ball = place({ entry: 'sphere', name: `Ball ${b + 1}`, material: 'Bryce Teal', position: [cx - 3 + b * SQUARE.ballStep, top + r, cz - 3], size: [r, r, r] });
    out.push(withBody(ball, { physical: true }));
  }
  return out;
}

function city(): SceneObject[] {
  const roadSize = (GRID.blocks * (GRID.block + GRID.street)) / 2 + GRID.street;
  const objects: SceneObject[] = [
    place({ entry: 'ground', name: 'Ground', material: 'Grassy Plain', position: [0, 0, 0] }),
    place({ entry: 'cube', name: 'Streets', material: 'Asphalt', position: [0, ROAD.height, 0], size: [roadSize, ROAD.height, roadSize] }),
  ];
  for (let i = 0; i < GRID.blocks; i++) for (let j = 0; j < GRID.blocks; j++) {
    if (i === 1 && j === 1) objects.push(...square());
    else objects.push(...block(i, j));
  }
  // Hills from height maps round the city, one on each side.
  const sides: Vec3[] = [[HILLS.ring, 0, 0], [-HILLS.ring, 0, 0], [0, 0, HILLS.ring], [0, 0, -HILLS.ring]];
  sides.forEach((p, k) => objects.push(place({ entry: 'terrain', name: `Hills ${k + 1}`, material: 'Alpine Meadow', landform: 'Rolling Hills', position: [p[0], HILLS.size[1], p[2]], size: HILLS.size, seed: k + 1 })));
  return objects;
}

/** A still example's sky: hard shadows, as the other stills (soft ones are the animations' look). */
const still = (name: string) => ({ ...skyPreset(name), softShadows: 0 });

export function miniCity(): Scene {
  return { ...emptyScene(), objects: city(), sky: still('Trapper Keeper'), camera: aimed(CAMERA.from, CAMERA.aim, CAMERA.lens) };
}

export function miniCityNight(): Scene {
  return { ...emptyScene(), objects: city(), sky: still('Moonlit Night'), camera: aimed(NIGHT_CAMERA.from, NIGHT_CAMERA.aim, NIGHT_CAMERA.lens) };
}

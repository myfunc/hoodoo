import { hexToRgb as h } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import { LatheProfile } from '../../model/scene.enums';
import type { SceneObject, Sky } from '../../model/scene.types';
import { Side, chessPiece, lacquerTable, place, skyPreset } from './kit';

/**
 * The terrace the chess and billiards showcases share: a black lacquered table
 * high over a calm sea, far hills, a low sun and a warm lamp in front so the
 * backlit pieces keep their faces. Each scene turns the sun where it needs it.
 */

const TABLE_HALF: Vec3 = [40, 0.8, 30];
const LAMP = { at: [-6, 14, 20] as Vec3, color: h('#ffc890'), intensity: 60, falloff: 20 };
const SEA_LEVEL = -14;
const HILLS = { at: [-90, -12, -330] as Vec3, size: [360, 20, 80] as Vec3, seed: 211 };

/** Low sun over the sea behind the table: long shadows toward the camera. */
const SUNSET = {
  preset: 'Golden Hour',
  patch: {
    sunAzimuth: 157, sunAltitude: 4, hazeAmount: 30,
    skyColor: h('#2c3f78'), horizonColor: h('#ff9a4a'), sunColor: h('#ffb060'), hazeColor: h('#ffb070'), ambientColor: h('#8a7470'),
  },
  clouds: { cover: 30, color: h('#ffc090') },
};

export interface Terrace {
  readonly objects: SceneObject[];
  readonly sky: Sky;
}

/** The terrace, its sun moved by `sun` (azimuth and altitude, degrees). */
export function sunsetTerrace(sun: Partial<Pick<Sky, 'sunAzimuth' | 'sunAltitude'>> = {}): Terrace {
  const lamp = place({ entry: 'radial', name: 'Warm Lamp', material: 'Glow White', position: LAMP.at });
  const base = skyPreset(SUNSET.preset, { ...SUNSET.patch, ...sun });
  return {
    objects: [
      place({ entry: 'water', name: 'Sea', material: 'Mirror Lake', position: [0, SEA_LEVEL, 0] }),
      place({ entry: 'terrain', name: 'Far Hills', material: 'Volcanic Basalt', position: HILLS.at, size: HILLS.size, seed: HILLS.seed, landform: 'Rolling Hills' }),
      lacquerTable(TABLE_HALF),
      { ...lamp, light: { ...lamp.light!, color: LAMP.color, intensity: LAMP.intensity, falloff: LAMP.falloff } },
    ],
    sky: { ...base, clouds: { ...base.clouds, ...SUNSET.clouds } },
  };
}

const PROFILE: Readonly<Record<string, LatheProfile>> = {
  p: LatheProfile.Pawn, n: LatheProfile.Knight, b: LatheProfile.Bishop, r: LatheProfile.Rook, q: LatheProfile.Queen, k: LatheProfile.King,
};
const FILES = 'abcdefgh';
const RANKS = 8;
const SQUARE = 2;
const DECIMAL = 10;

/**
 * Pieces set out from the board part of a FEN (rank 8 first; upper case white,
 * digits empty squares) on a board centred at (x, z) whose squares are at `top`.
 */
export function position(fen: string, centre: Vec3, top: number): SceneObject[] {
  const out: SceneObject[] = [];
  fen.split('/').forEach((row, r) => {
    const rank = RANKS - r;
    let file = 0;
    for (const ch of row) {
      const skip = Number.parseInt(ch, DECIMAL);
      if (Number.isFinite(skip)) {
        file += skip;
        continue;
      }
      const side = ch === ch.toUpperCase() ? Side.White : Side.Black;
      const x = centre[0] + (file - (RANKS - 1) / 2) * SQUARE;
      const z = centre[2] + ((RANKS - 1) / 2 - (rank - 1)) * SQUARE;
      out.push(chessPiece(side, PROFILE[ch.toLowerCase()], [x, top, z], `${FILES[file]}${rank}`));
      file++;
    }
  });
  return out;
}

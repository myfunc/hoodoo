// Written by tools/make-tutorials.mjs with the pictures in public/tutorials/: change the recipes there and run it again.
import { type TutorialRecipe, TutorialStart } from './tutorial-book-recipe';

/** The size of every step picture, CSS px of the app it was taken from. */
export const TUTORIAL_SHOT = { width: 1280, height: 800 } as const;
/** The size of every result picture. */
export const TUTORIAL_RESULT = { width: 960, height: 720 } as const;

export const TUTORIAL_RECIPES: readonly TutorialRecipe[] = [
  {
    id: 'first-steps', title: 'First steps', goal: 'Orbit, select, move, gild and render an egg', start: TutorialStart.Demo,
    steps: [
      { text: 'Drag the trackball right: the camera circles', marks: [{ x: 0.1801, y: 0.17, w: 0.1047, h: 0.1675 }] },
      { text: 'Click the big purple egg to select it', marks: [{ x: 0.5736, y: 0.424, w: 0.0649, h: 0.1036 }] },
      { text: 'Drag the green arrow up: the egg rises', marks: [{ x: 0.5932, y: 0.3571, w: 0.025, h: 0.04 }] },
      { text: 'Material list in Attributes: pick Gold Mirror', marks: [{ x: 0.8547, y: 0.2433, w: 0.0902, h: 0.035 }, { x: 0.5992, y: 0.7063, w: 0.075, h: 0.0888 }] },
      { text: 'Click the big Render ball', marks: [{ x: 0.1488, y: 0.3325, w: 0.0359, h: 0.0575 }] },
    ],
    result: 'It worked if a gold egg floats above its cup',
  },
  {
    id: 'sunset-water', title: 'Sunset over water', goal: 'A low sun over a calm mirror sea', start: TutorialStart.Empty,
    steps: [
      { text: 'Click the Water Plane icon', marks: [{ x: 0.3023, y: 0.0613, w: 0.0438, h: 0.075 }] },
      { text: 'Material list in Attributes: pick Mirror Lake', marks: [{ x: 0.8547, y: 0.2433, w: 0.0804, h: 0.035 }, { x: 0.2555, y: 0.3762, w: 0.075, h: 0.0888 }] },
      { text: 'Click the triangle beside Sky&Fog: presets', marks: [{ x: 0.4806, y: 0.0356, w: 0.0172, h: 0.0275 }] },
      { text: 'Double-click Vapor Sunset', marks: [{ x: 0.5, y: 0.3213, w: 0.0828, h: 0.1254 }] },
      { text: 'Click Sun in the Scene list, drag Azimuth right', marks: [{ x: 0.8172, y: 0.3425, w: 0.182, h: 0.0388 }, { x: 0.8172, y: 0.0988, w: 0.182, h: 0.0304 }] },
    ],
    result: 'It worked if the sun glitters on the water ahead',
  },
  {
    id: 'rock-on-hill', title: 'Rock on a hill', goal: 'A granite stone resting on a grassy hill', start: TutorialStart.Empty,
    steps: [
      { text: 'Click the Terrain icon', marks: [{ x: 0.4297, y: 0.0613, w: 0.0438, h: 0.075 }] },
      { text: 'Material list: pick Alpine Meadow', marks: [{ x: 0.8547, y: 0.2433, w: 0.0797, h: 0.035 }, { x: 0.2555, y: 0.2938, w: 0.075, h: 0.0888 }] },
      { text: 'Click the Stone icon: it sits inside the hill', marks: [{ x: 0.5031, y: 0.0613, w: 0.0438, h: 0.075 }] },
      { text: 'Material list: pick Granite', marks: [{ x: 0.8547, y: 0.2433, w: 0.0797, h: 0.035 }, { x: 0.393, y: 0.2113, w: 0.075, h: 0.0888 }] },
      { text: 'Click the down arrow: Land sets it on the slope', marks: [{ x: 0.5844, y: 0.5794, w: 0.0211, h: 0.0313 }] },
    ],
    result: 'It worked if the stone sits on the grass',
  },
  {
    id: 'chess-focus', title: 'Chess in soft focus', goal: 'One sharp king, the rest of the board melts away', start: TutorialStart.Empty,
    steps: [
      { text: 'Click the triangle beside Create: the library', marks: [{ x: 0.3431, y: 0.0356, w: 0.0172, h: 0.0275 }] },
      { text: 'Chess & Billiards, then double-click Chess Set', marks: [{ x: 0.2899, y: 0.22, w: 0.0824, h: 0.0325 }, { x: 0.2367, y: 0.2537, w: 0.0672, h: 0.1063 }] },
      { text: 'Click Camera in the Scene list', marks: [{ x: 0.8172, y: 0.3162, w: 0.182, h: 0.0388 }] },
      { text: 'Drag Depth of field to about 70', marks: [{ x: 0.8172, y: 0.2129, w: 0.182, h: 0.0304 }] },
      { text: 'Click Pick focus point, then the white king', marks: [{ x: 0.9006, y: 0.2357, w: 0.0986, h: 0.0354 }, { x: 0.5741, y: 0.4543, w: 0.0343, h: 0.1134 }] },
      { text: 'Click the big Render ball', marks: [{ x: 0.1488, y: 0.3325, w: 0.0359, h: 0.0575 }] },
    ],
    result: 'It worked if the king is sharp and the rest soft',
  },
  {
    id: 'glass-ball', title: 'Glass ball on checkers', goal: 'A glass ball on a chrome checker floor', start: TutorialStart.Close,
    steps: [
      { text: 'Click the Ground Plane icon', marks: [{ x: 0.3844, y: 0.0613, w: 0.0438, h: 0.075 }] },
      { text: 'Material list: pick Chrome Checkers', marks: [{ x: 0.8547, y: 0.2433, w: 0.0797, h: 0.035 }, { x: 0.393, y: 0.2938, w: 0.075, h: 0.0888 }] },
      { text: 'Click the Sphere icon', marks: [{ x: 0.5484, y: 0.0613, w: 0.0438, h: 0.075 }] },
      { text: 'Click M beside the ball: the Materials Lab', marks: [{ x: 0.6334, y: 0.4711, w: 0.0211, h: 0.0313 }] },
      { text: 'Presets: switch to Glass, click Clear Glass', marks: [{ x: 0.1922, y: 0.5136, w: 0.1953, h: 0.035 }, { x: 0.1922, y: 0.5461, w: 0.0422, h: 0.0675 }] },
      { text: 'Drag Reflection to about 40', marks: [{ x: 0.4953, y: 0.3946, w: 0.2547, h: 0.0304 }] },
    ],
    result: 'It worked if the checkers bend through the ball',
  },
  {
    id: 'camera-flyby', title: 'Camera fly-by', goal: 'Eight seconds of the camera swinging round', start: TutorialStart.Demo,
    steps: [
      { text: 'Animation menu: click Animation', marks: [{ x: 0.2403, y: 0.025, w: 0.2168, h: 0.0375 }] },
      { text: 'Click the scene length, type 8, press Enter', marks: [{ x: 0.4831, y: 0.7431, w: 0.0531, h: 0.0338 }] },
      { text: 'Click the key on the Camera row', marks: [{ x: 0.4141, y: 0.8, w: 0.0195, h: 0.0313 }] },
      { text: 'Click Go to end: the playhead jumps to 8 s', marks: [{ x: 0.407, y: 0.7419, w: 0.0297, h: 0.0363 }] },
      { text: 'Drag the trackball right: the end pose is keyed', marks: [{ x: 0.1801, y: 0.17, w: 0.1047, h: 0.1675 }] },
      { text: 'Click Play: the camera flies for 8 s', marks: [{ x: 0.3648, y: 0.7394, w: 0.0344, h: 0.0413 }] },
    ],
    result: 'It worked if the view swings round the spires',
  },
  {
    id: 'boolean-cut', title: 'Cut a hole', goal: 'A cube with a round bite taken out by a sphere', start: TutorialStart.Close,
    steps: [
      { text: 'Click the Cube icon', marks: [{ x: 0.7688, y: 0.0613, w: 0.0438, h: 0.075 }] },
      { text: 'Click Positive in Attributes: the solid', marks: [{ x: 0.8883, y: 0.1788, w: 0.0313, h: 0.0425 }] },
      { text: 'Click the Sphere icon', marks: [{ x: 0.5484, y: 0.0613, w: 0.0438, h: 0.075 }] },
      { text: 'Click Negative: the sphere becomes a cutter', marks: [{ x: 0.9141, y: 0.1788, w: 0.0313, h: 0.0425 }] },
      { text: 'Type 1 in the Z box, press Enter', marks: [{ x: 0.9427, y: 0.0813, w: 0.0565, h: 0.035 }] },
      { text: 'Shift-click Cube in the Scene list, then + Group', marks: [{ x: 0.8172, y: 0.3775, w: 0.182, h: 0.0388 }, { x: 0.9488, y: 0.2888, w: 0.0489, h: 0.0325 }] },
    ],
    result: 'It worked if a round bite is cut from the cube',
  },
  {
    id: 'render-export', title: 'Render and save', goal: 'The finished render as a PNG, twice the size', start: TutorialStart.Demo,
    steps: [
      { text: 'Render menu: click Render View', marks: [{ x: 0.1951, y: 0.1338, w: 0.218, h: 0.0375 }] },
      { text: 'File menu: click Render to Image…', marks: [{ x: 0.05, y: 0.2175, w: 0.2492, h: 0.0375 }] },
      { text: 'Open Size, pick 2× document', marks: [{ x: 0.4688, y: 0.4467, w: 0.1406, h: 0.035 }, { x: 0.4695, y: 0.5242, w: 0.1469, h: 0.0375 }] },
      { text: 'Click the check mark: the PNG is saved', marks: [{ x: 0.5797, y: 0.5396, w: 0.0313, h: 0.05 }] },
    ],
    result: 'It worked if a 1280 × 960 PNG is in Downloads',
  },
];

import header from './glsl/00-header.glsl?raw';
import noise from './glsl/10-noise.glsl?raw';
import sheen from './glsl/15-sheen.glsl?raw';
import textures from './glsl/20-textures.glsl?raw';
import shapes from './glsl/30-shapes.glsl?raw';
import terrain from './glsl/35-terrain.glsl?raw';
import lathe from './glsl/36-lathe.glsl?raw';
import portalShape from './glsl/38-portal-shape.glsl?raw';
import sceneGlsl from './glsl/40-scene.glsl?raw';
import sky from './glsl/50-sky.glsl?raw';
import shade from './glsl/60-shade.glsl?raw';
import portals from './glsl/70-portals.glsl?raw';
import main from './glsl/90-main.glsl?raw';

/** The ray tracer: one fragment shader, the files of glsl/ in order. */
export const TRACE_SOURCE = [header, noise, sheen, textures, shapes, terrain, lathe, portalShape, sceneGlsl, sky, shade, portals, main].join('\n');

/** The line of 00-header.glsl after which a variant's #defines go: before anything reads them. */
export const DEFINES_AT = "// engine.ts inserts a variant's #defines (FAST_PREVIEW, GAME_TRACE) after this line.";

/** The interaction preview of the live view (90-main.glsl). */
export const FAST_DEFINE = '#define FAST_PREVIEW';
/** The game renderer's tracer (game-renderer.ts): noiseless and deep, HDR, the first hit in a second target. */
export const GAME_DEFINE = '#define GAME_TRACE';

/** `source` with `lines` (defines, constants) inserted where variants put theirs. */
export function withDefines(source: string, lines: string): string {
  if (!source.includes(DEFINES_AT)) throw new Error('The trace shader lost the line its variants insert their defines after');
  return source.replace(DEFINES_AT, `${DEFINES_AT}\n${lines}`);
}

/** Layout shared with the GLSL (keep in sync with 00-header.glsl). */
export const OBJ_TEXELS = 8;
export const MAT_TEXELS = 20;
export const MAX_OBJECTS = 160;
export const MAX_LIGHTS = 8;
export const TEXEL_FLOATS = 4;
export const MAX_TERRAIN_RES = 512;
export const MIN_TERRAIN_RES = 16;
/** Texels per side of one cell of the terrain max-height grid (empty-space skipping). */
export const TERRAIN_CELL = 8;

export const FLAG_HAS_MODIFIERS = 1;
export const FLAG_NO_SHADOW = 2;
export const FLAG_OPAQUE = 4;

/** Dial scales: Bryce dials are 0..100, the shader wants 0..1. */
export const DIAL = 100;
export const REFRACTION_UNIT = 100;
export const LIGHT_INTENSITY_SCALE = 2.5;
export const LIGHT_FALLOFF_SCALE = 0.25;
export const CLOUD_BASE_HEIGHT = 18;
export const CLOUD_HEIGHT_RANGE = 120;
export const DEG = Math.PI / 180;

/** Progressive rendering: Bryce's coarse-to-fine block passes, then anti-aliasing samples. */
export const BLOCK_PASSES = [16, 8, 4, 2] as const;
export const PREVIEW_SAMPLES = 6;
export const FINAL_SAMPLES = 24;
export const PREVIEW_BOUNCES = 3;
export const FINAL_BOUNCES = 6;
export const FRAME_BUDGET_MS = 24;
export const FRAME_FAST_MS = 18;
/** GPU time a frame may spend tracing when timer queries are available. */
export const GPU_FRAME_MS = 8;
export const START_PIXEL_BUDGET = 12000;
export const MIN_PIXEL_BUDGET = 1500;
/** Ceiling of one strip, also when timers are missing: about one 1280×960 frame. */
export const MAX_PIXEL_BUDGET = 1200000;
export const BUDGET_GROWTH = 1.3;
export const BUDGET_SHRINK = 0.6;

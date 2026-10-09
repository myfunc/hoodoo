/** Every enum of the scene domain in one place (canon C3). Numeric values are the GPU codes. */

export enum ShapeKind {
  Sphere = 1,
  Cube = 2,
  Cylinder = 3,
  Cone = 4,
  Torus = 5,
  Pyramid = 6,
  Disk = 7,
  Square = 8,
  Stone = 9,
  Terrain = 10,
  Lattice = 11,
  WaterPlane = 12,
  GroundPlane = 13,
  CloudPlane = 14,
  RadialLight = 15,
  SpotLight = 16,
}

/** Bryce 2 object attributes: neutral objects ignore booleans; the rest act inside a group. */
export enum BooleanMode {
  Neutral = 0,
  Positive = 1,
  Negative = 2,
  Intersect = 3,
}

export enum TextureKind {
  Fbm = 1,
  Strata = 2,
  Marble = 3,
  Granite = 4,
  Ripples = 5,
  Clouds = 6,
  Wood = 7,
  Checker = 8,
  Spots = 9,
  Psychedelic = 10,
  Altitude = 11,
  Slope = 12,
  Ridged = 13,
}

export enum TextureMapping {
  World = 0,
  Object = 1,
  Parametric = 2,
}

/** Which source drives a material channel: the flat value/colour or texture A, B or C. */
export enum ChannelSource {
  Flat = 0,
  TexA = 1,
  TexB = 2,
  TexC = 3,
}

export enum SkyMode {
  SoftSky = 0,
  DarkerSky = 1,
  CustomSky = 2,
  AtmosphereOff = 3,
}

export enum ViewKind {
  Camera = 0,
  Top = 1,
  Front = 2,
  Side = 3,
  Director = 4,
}

/** Bryce "families": the wireframe colour groups of objects. */
export enum Family {
  Gray = 0,
  Blue = 1,
  Green = 2,
  Orange = 3,
  Purple = 4,
  Teal = 5,
  Brown = 6,
}

export enum ColorChannel {
  Diffuse = 'diffuse',
  Ambient = 'ambient',
  Specular = 'specular',
  Transparent = 'transparent',
}

export enum ValueChannel {
  Diffusion = 'diffusion',
  Ambience = 'ambience',
  Specularity = 'specularity',
  Metallicity = 'metallicity',
  Transparency = 'transparency',
  Reflection = 'reflection',
  Refraction = 'refraction',
  Bump = 'bump',
}

/** Terrain editor operations; recipes in assets name them, world/terrain executes them. */
export enum TerrainOp {
  Fractal = 'fractal',
  Ridges = 'ridges',
  Erode = 'erode',
  Smooth = 'smooth',
  Sharpen = 'sharpen',
  Invert = 'invert',
  Spikes = 'spikes',
  Mounds = 'mounds',
  Plateaus = 'plateaus',
  Raise = 'raise',
  Lower = 'lower',
  Clip = 'clip',
  Mesa = 'mesa',
  Canyon = 'canyon',
  Crater = 'crater',
  Cone = 'cone',
  Flatten = 'flatten',
  Normalize = 'normalize',
  Island = 'island',
}

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
  /** Preview feature Portals: an oval that leads to its partner (world/portals.ts). */
  Portal = 17,
  /** A turned solid: a profile from assets/lathe.profiles.ts spun about Y (`shapeParam` picks it). */
  Lathe = 18,
}

/** The profiles of Lathe objects (their `shapeParam`): saved in files, so append only. */
export enum LatheProfile {
  Pawn = 0,
  Rook = 1,
  Knight = 2,
  Bishop = 3,
  Queen = 4,
  King = 5,
  Column = 6,
  Pedestal = 7,
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
  /** A billiard ball: its colour, the white caps of a stripe and the number disc; the seed is the number. */
  PoolBall = 14,
  /** A rainbow sheen that turns about Y and shifts with the viewing angle: compact discs, holograms. */
  Iridescent = 15,
  /** Bright where it faces the eye, fading to the silhouette and up Y: drive transparency for a light beam. */
  Beam = 16,
  /** Spectrum bands near the rim about Y, 1 / frequency of the radius wide (on a disc, a rainbow); its scalar is the band's opacity. */
  Rainbow = 17,
  /** Windows on the walls: wall 0, frame 0.5, glass 1; Detail picks the style (1 office, 2 houses, 3 warehouse). */
  Facade = 18,
  /** The same windows' glass alone (1 on the panes): drive reflection, so glass mirrors the sky and walls stay matt. */
  FacadeGlass = 19,
  /** About a third of the panes (1 where lit): drive ambience for windows lit at night. Keep its seed the Facade's: a seed shifts the windows. */
  FacadeLit = 20,
}

export enum TextureMapping {
  World = 0,
  Object = 1,
  Parametric = 2,
  /** Moves and turns with its object, at world size: a stretched object does not stretch the pattern. */
  Follows = 3,
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

/** How the motion meets a key (world/animation/interpolate): absent on a key means Smooth. */
export enum Ease {
  /** Flows through the key (the spline of the keys around it). */
  Smooth = 'smooth',
  /** Straight at a steady speed into and out of the key. */
  Linear = 'linear',
  /** Slows down into the key. */
  In = 'in',
  /** Starts slowly out of the key. */
  Out = 'out',
}

/** Saved membership rules for smart groups. */
export enum SmartRuleKind {
  Kind = 'kind',
  Material = 'material',
  Name = 'name',
}

/** Sandbox's joints between objects (docs/sandbox-mode.md › Tool Gun), kept with the scene. */
export enum JointKind {
  /** Glued together where they are. */
  Weld = 'weld',
  /** The two pass through each other. */
  NoCollide = 'nocollide',
  /** Turning freely about a pivot. */
  BallSocket = 'ballsocket',
}

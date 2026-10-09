#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
precision highp sampler3D;

#define PI 3.14159265359
#define TAU 6.28318530718
#define INF 1e20
#define EPS 1e-3
#define MAX_LIGHTS 8
#define MAX_OBJECTS 160

// Shape codes: keep in sync with ShapeKind in model/scene.enums.ts.
#define K_SPHERE 1
#define K_CUBE 2
#define K_CYLINDER 3
#define K_CONE 4
#define K_TORUS 5
#define K_PYRAMID 6
#define K_DISK 7
#define K_SQUARE 8
#define K_STONE 9
#define K_TERRAIN 10
#define K_LATTICE 11
#define K_WATER 12
#define K_GROUND 13
#define K_CLOUDPLANE 14

#define B_NEUTRAL 0
#define B_POSITIVE 1
#define B_NEGATIVE 2
#define B_INTERSECT 3

#define OBJ_TEXELS 8
#define MAT_TEXELS 20

uniform sampler2D uObjects;
uniform sampler2D uMaterials;
uniform sampler2DArray uTerrains;
// Max height per TERRAIN_CELL² block of each terrain, for empty-space skipping.
uniform sampler2DArray uTerrainMax;
// Baked tileable gradient noise (render/gpu/noise-texture.ts), period NOISE_PERIOD cells.
uniform sampler3D uNoise;
#define NOISE_PERIOD 16.0
uniform int uObjectCount;
// Always 0. Added to loop bounds so drivers cannot unroll the loops: unrolled,
// this shader took over 10 s to compile on a cold cache and froze the page.
uniform int uLoopGuard;
#define SHADOW_DEPTH 4
#define SDF_STEPS 96
#define VORONOI_CELLS 27

uniform int uLightCount;
uniform vec4 uLightPos[MAX_LIGHTS];
uniform vec4 uLightColor[MAX_LIGHTS];
uniform vec4 uLightDir[MAX_LIGHTS];

uniform vec3 uCamPos;
uniform vec3 uCamFwd;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uHalfH;
uniform float uAspect;
uniform int uOrtho;
// Thin lens: aperture radius and focus distance in world units; radius 0 is a pinhole.
uniform vec2 uLens;

uniform vec2 uResolution;
uniform vec2 uOffset;
uniform float uBlock;
uniform vec2 uJitter;
uniform int uSample;
uniform int uMaxBounces;
uniform int uTransparentBg;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uAmbientColor;
uniform vec3 uFogColor;
uniform vec3 uHazeColor;
uniform vec3 uCloudColor;
// mode, shadows 0..1, haze 0..1, stars 0/1
uniform vec4 uSkyParams;
// fog amount 0..1, fog height, sun visible, night 0..1
uniform vec4 uFogParams;
// cover 0..1, height, frequency, amplitude
uniform vec4 uCloudParams;
// cumulus, stratus
uniform vec2 uCloudKinds;

out vec4 fragColor;

uint rngState;

float rand() {
  rngState = rngState * 747796405u + 2891336453u;
  uint w = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  return float((w >> 22u) ^ w) / 4294967295.0;
}

void seedRng(vec2 pixel, int sampleIndex) {
  rngState = uint(pixel.x) * 1973u + uint(pixel.y) * 9277u + uint(sampleIndex) * 26699u | 1u;
  rand();
}

float luminance(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Procedural 3D textures. Codes follow TextureKind in model/scene.enums.ts.
#define T_FBM 1
#define T_STRATA 2
#define T_MARBLE 3
#define T_GRANITE 4
#define T_RIPPLES 5
#define T_CLOUDS 6
#define T_WOOD 7
#define T_CHECKER 8
#define T_SPOTS 9
#define T_PSYCHEDELIC 10
#define T_ALTITUDE 11
#define T_SLOPE 12
#define T_RIDGED 13
#define T_POOLBALL 14

// Strata's fine lines and grain, ripples' waves, in texture units (faded when a pixel covers them).
#define STRATA_LINE 0.17
#define STRATA_GRAIN 0.25
#define RIPPLE_WAVE 2.0

#define MAP_WORLD 0
#define MAP_OBJECT 1
#define MAP_PARAMETRIC 2

struct Surface {
  vec3 wp;   // world position
  vec3 lp;   // object-space position
  vec3 n;    // world normal (geometric)
  vec2 uv;   // parametric coordinates
};

vec4 matTexel(int mat, int t) { return texelFetch(uMaterials, ivec2(t, mat), 0); }

#ifdef GAME_TRACE
// Texture level of detail (the game variant): what is finer than a traced pixel fades to its
// mean instead of flickering from frame to frame, and costs nothing. radiance() sets the
// footprint, the world size of a pixel at the hit (wider where the surface turns away);
// surfaceAt sets how many local units one world unit along the surface is, and the local normal.
#define DETAIL_CELL 0.5
#define DETAIL_OCTAVE 1.02
#define PARAMETRIC_UNITS 2.0
#define CHECKER_MIN_WIDTH 1e-3
float gFoot = 0.0;
// How much wider the footprint is along the surface than across it (1 / cos of the view angle).
float gStretch = 1.0;
// How far the eye is from the current ray's origin along the path (terrain LOD too, 35-terrain.glsl).
float gPathT = 0.0;
float gLocalScale = 1.0;
vec3 gLocalNormal = vec3(0, 1, 0);
// The current pattern's footprint in its own units, overall and along each axis (evalTexture).
float gTexFoot = 0.0;
vec3 gTexAxes = vec3(0);

// Octaves a fractal keeps when a texture unit is `foot` wide: a cell of octave i is 2.03^-i
// wide, and one narrower than two footprints would alias.
float detailFor(float foot) { return clamp(log2(DETAIL_CELL / max(foot, 1e-6)) / DETAIL_OCTAVE + 1.0, 0.0, 8.0); }

// 1 while a feature `size` texture units wide spans two footprints or more, 0 once it spans one.
float featureKeep(float size) { return clamp(size / max(gTexFoot, 1e-6) - 1.0, 0.0, 1.0); }

// A checkerboard box-filtered over `w` along each axis (after Inigo Quilez): squares smaller
// than a pixel turn grey instead of flickering. An axis the surface does not move along
// (w about 0, often exactly on a square's edge) keeps its plain sign.
float checkerFiltered(vec3 p, vec3 w) {
  vec3 plain = 1.0 - 2.0 * mod(floor(p), 2.0);
  vec3 wide = max(w, vec3(CHECKER_MIN_WIDTH));
  vec3 box = 2.0 * (abs(fract((p - 0.5 * wide) * 0.5) - 0.5) - abs(fract((p + 0.5 * wide) * 0.5) - 0.5)) / wide;
  vec3 i = mix(plain, clamp(box, -1.0, 1.0), step(vec3(CHECKER_MIN_WIDTH), w));
  return 0.5 - 0.5 * i.x * i.y * i.z;
}
#else
float featureKeep(float size) { return 1.0; }
#endif

// One fractal and at most one cellular evaluation per call: each kind only picks
// the input point and shapes the result (keeps the compiled shader small).
float textureScalar(int kind, vec3 p, int octaves, Surface s) {
  // The fractal's input is the point stretched by k.
  vec3 k = vec3(1.0);
  int oct = octaves;
  if (kind == T_STRATA) { k = vec3(0.35, 0.08, 0.35); oct = 3; }
  else if (kind == T_GRANITE) k = vec3(2.0);
  else if (kind == T_RIPPLES) k = vec3(2.5);
  else if (kind == T_CLOUDS) k = vec3(1.0, 0.3, 1.0);
  else if (kind == T_WOOD) k = vec3(0.5, 2.0, 0.5);
  else if (kind == T_SPOTS) oct = 2;
  else if (kind == T_ALTITUDE || kind == T_SLOPE) k = vec3(3.0);
#ifdef GAME_TRACE
  gDetail = detailFor(gTexFoot * max(k.x, max(k.y, k.z)));
#endif
  float n = fractal(p * k, oct, kind == T_RIDGED);
  vec2 v = vec2(0.0);
  if (kind == T_GRANITE || kind == T_SPOTS) v = voronoi(kind == T_SPOTS ? p + n * 0.3 : p);

  if (kind == T_FBM) return n * 0.5 + 0.5;
  if (kind == T_STRATA) {
    float y = p.y + n * 0.35;
    float band = hash11(floor(y * 3.0));
    float fine = 0.5 + 0.5 * sin(y * 37.0 + gnoise(p * 2.0) * 2.0) * featureKeep(STRATA_LINE);
    return clamp(band * 0.7 + fine * 0.18 + gnoise(p * 4.0) * 0.15 * featureKeep(STRATA_GRAIN) + 0.05, 0.0, 1.0);
  }
  if (kind == T_MARBLE) return 0.5 + 0.5 * sin(p.x * 3.0 + n * 5.0);
  if (kind == T_GRANITE) return clamp((v.y - v.x) * 0.6 + n * 0.3 + hash13(floor(p * 9.0)) * 0.25, 0.0, 1.0);
  if (kind == T_RIPPLES) {
    float w = (sin(p.x * 3.1 + gnoise(p * 0.7) * 3.0) + sin(p.z * 2.3 + p.x * 0.9)) * featureKeep(RIPPLE_WAVE);
    return clamp(0.5 + w * 0.2 + n * 0.25, 0.0, 1.0);
  }
  if (kind == T_CLOUDS) return smoothstep(0.42, 0.85, n * 0.5 + 0.5);
  if (kind == T_WOOD) return smoothstep(0.0, 0.8, fract(length(p.xz) + n * 0.3));
#ifdef GAME_TRACE
  if (kind == T_CHECKER) return checkerFiltered(p, gTexAxes);
#else
  if (kind == T_CHECKER) return mod(floor(p.x) + floor(p.y) + floor(p.z), 2.0);
#endif
  if (kind == T_SPOTS) return 1.0 - smoothstep(0.15, 0.55, v.x);
  if (kind == T_PSYCHEDELIC) return fract(n * 2.2 + p.y * 0.15);
  if (kind == T_ALTITUDE) return clamp(s.lp.y * 0.5 + 0.5 + n * 0.12, 0.0, 1.0);
  if (kind == T_SLOPE) return clamp((1.0 - s.n.y) * 2.2 + n * 0.15, 0.0, 1.0);
  if (kind == T_RIDGED) return n;
  return 0.5;
}

// Billiard balls (T_POOLBALL): 0 = the ball's colour, 0.5 = white, 1 = the number's ink.
// Digits are strokes in a glyph box x -0.5..0.5, y -1..1; the number sits in a white
// disc on +Z and again on -Z, stripes (9-15) have white caps about Y.
float pbSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// Arc about c from angle a0, counterclockwise through `sweep` radians.
float pbArc(vec2 p, vec2 c, float r, float a0, float sweep) {
  vec2 q = p - c;
  if (mod(atan(q.y, q.x) - a0, TAU) <= sweep) return abs(length(q) - r);
  vec2 e0 = c + r * vec2(cos(a0), sin(a0));
  vec2 e1 = c + r * vec2(cos(a0 + sweep), sin(a0 + sweep));
  return min(length(p - e0), length(p - e1));
}

float pbRing(vec2 p, vec2 c, float r) { return abs(length(p - c) - r); }

float pbDigit(int d, vec2 p) {
  if (d == 9) { p = -p; d = 6; }
  if (d == 0) return abs(length(vec2(p.x, max(abs(p.y) - 0.46, 0.0))) - 0.4);
  if (d == 1) return min(pbSeg(p, vec2(0.06, -0.86), vec2(0.06, 0.86)), pbSeg(p, vec2(0.06, 0.86), vec2(-0.28, 0.58)));
  if (d == 2) return min(pbArc(p, vec2(0.0, 0.44), 0.4, -0.7, 3.49), min(pbSeg(p, vec2(0.306, 0.183), vec2(-0.4, -0.86)), pbSeg(p, vec2(-0.4, -0.86), vec2(0.42, -0.86))));
  if (d == 3) return min(pbArc(p, vec2(0.0, 0.45), 0.4, -1.571, 4.19), pbArc(p, vec2(0.0, -0.43), 0.43, -2.618, 4.19));
  if (d == 4) return min(pbSeg(p, vec2(0.2, -0.86), vec2(0.2, 0.86)), min(pbSeg(p, vec2(0.2, 0.86), vec2(-0.44, -0.3)), pbSeg(p, vec2(-0.44, -0.3), vec2(0.44, -0.3))));
  if (d == 5) return min(min(pbSeg(p, vec2(0.38, 0.86), vec2(-0.3, 0.86)), pbSeg(p, vec2(-0.3, 0.86), vec2(-0.36, 0.06))), pbArc(p, vec2(0.0, -0.36), 0.46, -2.618, 4.887));
  if (d == 6) return min(pbRing(p, vec2(0.0, -0.4), 0.44), pbArc(p, vec2(0.76, -0.4), 1.2, 1.92, 1.22));
  if (d == 7) return min(pbSeg(p, vec2(-0.42, 0.86), vec2(0.42, 0.86)), pbSeg(p, vec2(0.42, 0.86), vec2(-0.12, -0.86)));
  return min(pbRing(p, vec2(0.0, 0.46), 0.36), pbRing(p, vec2(0.0, -0.4), 0.44));
}

float poolBall(vec3 lp, float seed) {
  int n = int(mod(floor(seed + 0.5), 16.0));
  vec3 q = normalize(lp);
  float v = n >= 9 ? 0.5 * smoothstep(0.5, 0.53, abs(q.y)) : 0.0;
  vec2 uv = vec2(q.z >= 0.0 ? q.x : -q.x, q.y) / 0.44;
  float disc = 1.0 - smoothstep(0.95, 1.0, length(uv));
  if (n == 0 || disc <= 0.0) return n == 0 ? 0.5 : v;
  float d = n < 10 ? pbDigit(n, uv / 0.56) : min(pbDigit(1, uv / 0.5 + vec2(0.52, 0.0)), pbDigit(n - 10, uv / 0.5 - vec2(0.42, 0.0)));
  float ink = 1.0 - smoothstep(0.15, 0.19, d);
  return mix(mix(v, 0.5, disc), 1.0, ink * disc);
}

vec3 ramp(float v, vec3 c0, vec3 c1, vec3 c2) {
  return v < 0.5 ? mix(c0, c1, v * 2.0) : mix(c1, c2, v * 2.0 - 1.0);
}

vec3 texturePoint(int mapping, float freq, float seed, Surface s) {
  vec3 base = mapping == MAP_WORLD ? s.wp : (mapping == MAP_OBJECT ? s.lp : vec3(s.uv * 4.0, 0.0));
  return base * freq + seed * vec3(17.13, 31.71, 7.37);
}

// rgb = colour from the ramp, a = scalar for value channels.
vec4 evalTexture(int mat, int slot, Surface s) {
  int base = 8 + slot * 4;
  vec4 t0 = matTexel(mat, base);
  int kind = int(t0.x + 0.5);
  if (kind == 0) return vec4(1.0);
  vec4 t1 = matTexel(mat, base + 1);
  vec4 t2 = matTexel(mat, base + 2);
  vec4 t3 = matTexel(mat, base + 3);
  int mapping = int(t0.w + 0.5);
  vec3 p = texturePoint(mapping, t0.y, t1.w, s);
#ifdef GAME_TRACE
  float unit = mapping == MAP_WORLD ? 1.0 : (mapping == MAP_OBJECT ? gLocalScale : PARAMETRIC_UNITS * gLocalScale);
  gTexFoot = gFoot * t0.y * unit;
  vec3 axisN = mapping == MAP_WORLD ? s.n : gLocalNormal;
  // A flat pattern changes only along the surface: no blur across it.
  gTexAxes = mapping == MAP_PARAMETRIC ? vec3(gTexFoot, gTexFoot, 0.0) : gTexFoot * sqrt(max(1.0 - axisN * axisN, 0.0));
#endif
  float v = kind == T_POOLBALL ? poolBall(s.lp, t1.w) : (isSheen(kind) ? sheenScalar(kind, t0.y, s.wp, s.lp, s.n) : textureScalar(kind, p, int(t0.z + 0.5), s));
  v = clamp((v - 0.5) * (1.0 + t2.w * 0.04) + 0.5, 0.0, 1.0);
  vec3 col = isSheen(kind) ? sheenColor(kind, v, t0.y, s.lp, t1.rgb, t2.rgb, t3.rgb) : ramp(v, t1.rgb, t2.rgb, t3.rgb);
  if (kind == T_PSYCHEDELIC) col = v < 0.333 ? mix(t1.rgb, t2.rgb, v * 3.0) : (v < 0.666 ? mix(t2.rgb, t3.rgb, v * 3.0 - 1.0) : mix(t3.rgb, t1.rgb, v * 3.0 - 2.0));
  return vec4(col, v);
}

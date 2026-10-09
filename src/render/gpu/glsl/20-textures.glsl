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

// One fractal and at most one cellular evaluation per call: each kind only picks
// the input point and shapes the result (keeps the compiled shader small).
float textureScalar(int kind, vec3 p, int octaves, Surface s) {
  vec3 q = p;
  int oct = octaves;
  if (kind == T_STRATA) { q = p * vec3(0.35, 0.08, 0.35); oct = 3; }
  else if (kind == T_GRANITE) q = p * 2.0;
  else if (kind == T_RIPPLES) q = p * 2.5;
  else if (kind == T_CLOUDS) q = vec3(p.x, p.y * 0.3, p.z);
  else if (kind == T_WOOD) q = p * vec3(0.5, 2.0, 0.5);
  else if (kind == T_SPOTS) oct = 2;
  else if (kind == T_ALTITUDE || kind == T_SLOPE) q = p * 3.0;
  float n = fractal(q, oct, kind == T_RIDGED);
  vec2 v = vec2(0.0);
  if (kind == T_GRANITE || kind == T_SPOTS) v = voronoi(kind == T_SPOTS ? p + n * 0.3 : p);

  if (kind == T_FBM) return n * 0.5 + 0.5;
  if (kind == T_STRATA) {
    float y = p.y + n * 0.35;
    float band = hash11(floor(y * 3.0));
    float fine = 0.5 + 0.5 * sin(y * 37.0 + gnoise(p * 2.0) * 2.0);
    return clamp(band * 0.7 + fine * 0.18 + gnoise(p * 4.0) * 0.15 + 0.05, 0.0, 1.0);
  }
  if (kind == T_MARBLE) return 0.5 + 0.5 * sin(p.x * 3.0 + n * 5.0);
  if (kind == T_GRANITE) return clamp((v.y - v.x) * 0.6 + n * 0.3 + hash13(floor(p * 9.0)) * 0.25, 0.0, 1.0);
  if (kind == T_RIPPLES) {
    float w = sin(p.x * 3.1 + gnoise(p * 0.7) * 3.0) + sin(p.z * 2.3 + p.x * 0.9);
    return clamp(0.5 + w * 0.2 + n * 0.25, 0.0, 1.0);
  }
  if (kind == T_CLOUDS) return smoothstep(0.42, 0.85, n * 0.5 + 0.5);
  if (kind == T_WOOD) return smoothstep(0.0, 0.8, fract(length(p.xz) + n * 0.3));
  if (kind == T_CHECKER) return mod(floor(p.x) + floor(p.y) + floor(p.z), 2.0);
  if (kind == T_SPOTS) return 1.0 - smoothstep(0.15, 0.55, v.x);
  if (kind == T_PSYCHEDELIC) return fract(n * 2.2 + p.y * 0.15);
  if (kind == T_ALTITUDE) return clamp(s.lp.y * 0.5 + 0.5 + n * 0.12, 0.0, 1.0);
  if (kind == T_SLOPE) return clamp((1.0 - s.n.y) * 2.2 + n * 0.15, 0.0, 1.0);
  if (kind == T_RIDGED) return n;
  return 0.5;
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
  vec3 p = texturePoint(int(t0.w + 0.5), t0.y, t1.w, s);
  float v = textureScalar(kind, p, int(t0.z + 0.5), s);
  v = clamp((v - 0.5) * (1.0 + t2.w * 0.04) + 0.5, 0.0, 1.0);
  vec3 col = ramp(v, t1.rgb, t2.rgb, t3.rgb);
  if (kind == T_PSYCHEDELIC) col = v < 0.333 ? mix(t1.rgb, t2.rgb, v * 3.0) : (v < 0.666 ? mix(t2.rgb, t3.rgb, v * 3.0 - 1.0) : mix(t3.rgb, t1.rgb, v * 3.0 - 2.0));
  return vec4(col, v);
}

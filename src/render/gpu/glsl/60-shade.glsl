// Materials and direct lighting in the Bryce 2 model: ambient + diffuse + specular,
// then reflection and transparency handled by the path loop in main.
struct Mat {
  vec3 diffuse;
  vec3 ambient;
  vec3 specular;
  vec3 transColor;
  float diffusion;
  float ambience;
  float specularity;
  float metal;
  float transparency;
  float reflection;
  float ior;
  float bump;
};

int src(float v) { return int(v + 0.5); }

#ifdef GAME_TRACE
// Toon bands: half the width of a step between bands, and where the highlight's edge sits.
#define TOON_STEP 0.08
#define TOON_SPEC 0.5
// The finest of a bump pattern, as a multiple of its texture unit (ripples stretch 2.5×),
// and how much bump the far surface keeps.
#define BUMP_DETAIL 2.5
#define BUMP_CALM 0.45
#endif

vec3 pickColor(vec3 flat_, int s, vec4 t0, vec4 t1, vec4 t2) {
  if (s == 1) return t0.rgb;
  if (s == 2) return t1.rgb;
  if (s == 3) return t2.rgb;
  return flat_;
}

float pickValue(float flat_, int s, vec4 t0, vec4 t1, vec4 t2) {
  if (s == 1) return flat_ * t0.a;
  if (s == 2) return flat_ * t1.a;
  if (s == 3) return flat_ * t2.a;
  return flat_;
}

bool slotUsed(int slot, vec4 cs, vec4 vs0, vec4 vs1) {
  float k = float(slot + 1);
  return any(equal(cs, vec4(k))) || any(equal(vs0, vec4(k))) || any(equal(vs1, vec4(k)));
}

// All texture work runs in one loop with a single evalTexture call site:
// k = 0..2 are slots A, B, C; k = 3..5 are the bump-gradient taps (+x, +y, +z).
// Shadow rays only need transparency, so they skip the bump taps (full = false).
Mat evalMaterial(int m, Surface s, inout vec3 n, bool full) {
  vec4 d = matTexel(m, 0);
  vec4 a = matTexel(m, 1);
  vec4 sp = matTexel(m, 2);
  vec4 tr = matTexel(m, 3);
  vec4 ex = matTexel(m, 4);
  vec4 cs = matTexel(m, 5);
  vec4 vs0 = matTexel(m, 6);
  vec4 vs1 = matTexel(m, 7);
  int bs = src(vs1.w);
  bool bumped = full && bs > 0 && ex.w > 0.0;
  float freq = bumped ? max(matTexel(m, 8 + (bs - 1) * 4).y, 0.02) : 1.0;
  float h = 0.06 / freq;
  vec4 tex[3];
  tex[0] = vec4(1);
  tex[1] = vec4(1);
  tex[2] = vec4(1);
  vec3 taps = vec3(0);
#ifdef LAB_NO_TEX
  for (int k = 0; k < 0; k++) {
#else
  for (int k = 0; k < 6 + uLoopGuard; k++) {
#endif
    Surface q = s;
    int slot = k;
    if (k < 3) {
      if (!slotUsed(k, cs, vs0, vs1)) continue;
    } else {
      if (!bumped) break;
      slot = bs - 1;
      vec3 off = vec3(k == 3 ? h : 0.0, k == 4 ? h : 0.0, k == 5 ? h : 0.0);
      q.wp += off;
      q.lp += off;
    }
    vec4 r = evalTexture(m, slot, q);
    if (k == 0) tex[0] = r;
    else if (k == 1) tex[1] = r;
    else if (k == 2) tex[2] = r;
    else if (k == 3) taps.x = r.a;
    else if (k == 4) taps.y = r.a;
    else taps.z = r.a;
  }
  vec4 t0 = tex[0];
  vec4 t1 = tex[1];
  vec4 t2 = tex[2];
  Mat mt;
  mt.diffuse = pickColor(d.rgb, src(cs.x), t0, t1, t2);
  mt.ambient = pickColor(a.rgb, src(cs.y), t0, t1, t2);
  mt.specular = pickColor(sp.rgb, src(cs.z), t0, t1, t2);
  mt.transColor = pickColor(tr.rgb, src(cs.w), t0, t1, t2);
  mt.diffusion = pickValue(d.a, src(vs0.x), t0, t1, t2);
  mt.ambience = pickValue(a.a, src(vs0.y), t0, t1, t2);
  mt.specularity = pickValue(sp.a, src(vs0.z), t0, t1, t2);
  mt.metal = pickValue(ex.x, src(vs0.w), t0, t1, t2);
  // A texture on transparency marks the opaque parts: dense cloud = solid.
  int ts = src(vs1.x);
  mt.transparency = ts == 0 ? tr.a : tr.a * (1.0 - (ts == 1 ? t0.a : (ts == 2 ? t1.a : t2.a)));
  mt.reflection = pickValue(ex.y, src(vs1.y), t0, t1, t2);
  mt.ior = ex.z;
  mt.bump = ex.w;
  // A mesh's own picture tints its colours; the mip level from how many texels a pixel covers.
  if (gMeshNow.z >= 0.0) {
    vec3 pic = meshPicture(gMeshNow, log2(max(gFoot * gLocalScale * gMeshNow.w, 1.0))).rgb;
    mt.diffuse *= pic;
    mt.ambient *= pic;
  }
  if (bumped) {
    float v0 = bs == 1 ? t0.a : (bs == 2 ? t1.a : t2.a);
    vec3 g = (taps - v0) / h / freq;
#ifdef GAME_TRACE
    // Ripples finer than a pixel would sparkle: the far surface calms toward a mirror, but never
    // all the way, or the sun's glitter on the sea would shrink to a disc.
    mt.bump *= mix(BUMP_CALM, 1.0, clamp(detailFor(gTexFoot * BUMP_DETAIL) - 1.0, 0.0, 1.0));
#endif
    n = normalize(n - mt.bump * 0.55 * (g - n * dot(g, n)));
  }
  return mt;
}

vec2 parametricUv(int kind, vec3 lp) {
  if (kind == K_SPHERE || kind == K_STONE) {
    vec3 q = normalize(lp);
    return vec2(atan(q.z, q.x) / TAU + 0.5, acos(clamp(q.y, -1.0, 1.0)) / PI);
  }
  if (kind == K_PORTAL) return lp.xy * 0.5 + 0.5;
  if (kind == K_MESH) return gMeshNow.xy;
  return lp.xz * 0.5 + 0.5;
}

Surface surfaceAt(int obj, vec3 wp, vec3 n) {
  Obj o = loadObj(obj);
  vec3 lp = toLocalPoint(o, wp);
  // Local units per world unit along the surface, for the texture footprint (20-textures.glsl).
  vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
  gLocalScale = max(length(toLocalDir(o, t1)), length(toLocalDir(o, cross(n, t1))));
  gLocalNormal = normalize(toLocalDir(o, n));
  // Each inverse row's length is one over the object's half-size on that axis: undo it for world-sized units.
  vec3 fp = lp / vec3(length(o.r0.xyz), length(o.r1.xyz), length(o.r2.xyz));
  return Surface(wp, lp, n, parametricUv(o.kind, lp), fp);
}

bool isThin(int kind) {
  return kind == K_DISK || kind == K_SQUARE || kind == K_WATER || kind == K_GROUND || kind == K_CLOUDPLANE || kind == K_PORTAL;
}

vec3 lightTerm(Mat mt, vec3 n, vec3 v, vec3 l, vec3 lc) {
  float ndl = dot(n, l);
  if (ndl <= 0.0) return vec3(0);
  vec3 h = normalize(l + v);
  float shininess = mix(12.0, 90.0, mt.specularity);
  float spec = pow(max(dot(n, h), 0.0), shininess) * mt.specularity * 1.4;
#ifdef GAME_TRACE
  // The toon look: light in flat bands with soft steps, and a highlight with a crisp edge.
  if (uToonBands > 0.0) {
    float b = ndl * uToonBands;
    ndl = (floor(b) + smoothstep(0.5 - TOON_STEP, 0.5 + TOON_STEP, fract(b))) / uToonBands;
    spec = smoothstep(TOON_SPEC - TOON_STEP, TOON_SPEC + TOON_STEP, spec) * mt.specularity * 1.4;
  }
#endif
  vec3 specCol = mix(mt.specular, mt.diffuse, mt.metal);
  return lc * (mt.diffuse * mt.diffusion * ndl * (1.0 - mt.metal * 0.5) + specCol * spec);
}

vec3 ambientTerm(Mat mt) {
  return mt.ambient * mt.ambience * mix(uAmbientColor, vec3(1), mt.ambience * mt.ambience) * 1.4;
}

// A random offset in the disc of radius r around direction d (soft shadows: each sample sees another part of the light).
vec3 discJitter(vec3 d, float r) {
  vec3 a = abs(d.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  vec3 u = normalize(cross(a, d));
  vec3 v = cross(d, u);
  float rr = r * sqrt(rand());
  float phi = TAU * rand();
  return (u * cos(phi) + v * sin(phi)) * rr;
}

// Light i as seen from wp (i = -1 is the sun or moon): direction l, distance (INF for the sun), colour.
// Soft shadows give the lights a size: shadows get soft edges as samples add up
// (not in the noiseless variants, which have one sample).
vec3 lightAt(int i, vec3 wp, out vec3 l, out float dist) {
  if (i < 0) {
    l = keyLightDir();
#ifndef NOISELESS
    if (uStyle.x > 0.0) l = normalize(l + discJitter(l, uStyle.x));
#endif
    dist = INF;
    return keyLightColor();
  }
  vec3 toL = uLightPos[i].xyz - wp;
#ifndef NOISELESS
  if (uStyle.y > 0.0) toL += discJitter(normalize(toL), uStyle.y);
#endif
  dist = length(toL);
  l = toL / dist;
  float atten = 1.0 / (1.0 + uLightColor[i].w * dist * dist);
  if (uLightPos[i].w > 0.5) atten *= smoothstep(uLightDir[i].w, mix(uLightDir[i].w, 1.0, 0.25), dot(-l, uLightDir[i].xyz));
  return uLightColor[i].rgb * atten;
}

float maxOf(vec3 c) { return max(c.r, max(c.g, c.b)); }

// Scene traversal: object records, boolean groups and the nearest-hit search.
#define F_HAS_MODIFIERS 1
#define F_NO_SHADOW 2
#define F_OPAQUE 4

struct Obj {
  vec4 r0;
  vec4 r1;
  vec4 r2;
  int kind;
  int mode;
  int group;
  int flags;
  vec4 params; // terrain layer, shape param, terrain resolution, unused
  vec4 bound;  // world bounding sphere; radius < 0 means infinite
};

Obj loadObj(int i) {
  Obj o;
  o.r0 = texelFetch(uObjects, ivec2(0, i), 0);
  o.r1 = texelFetch(uObjects, ivec2(1, i), 0);
  o.r2 = texelFetch(uObjects, ivec2(2, i), 0);
  vec4 h = texelFetch(uObjects, ivec2(3, i), 0);
  o.kind = int(h.x + 0.5);
  o.mode = int(h.y + 0.5);
  o.group = int(h.z + 0.5);
  o.flags = int(h.w + 0.5);
  o.params = texelFetch(uObjects, ivec2(4, i), 0);
  o.bound = texelFetch(uObjects, ivec2(5, i), 0);
  return o;
}

vec3 toLocalPoint(Obj o, vec3 p) {
  return vec3(dot(o.r0.xyz, p) + o.r0.w, dot(o.r1.xyz, p) + o.r1.w, dot(o.r2.xyz, p) + o.r2.w);
}

vec3 toLocalDir(Obj o, vec3 d) {
  return vec3(dot(o.r0.xyz, d), dot(o.r1.xyz, d), dot(o.r2.xyz, d));
}

// Inverse-transpose: rows of the inverse weighted by the local normal.
vec3 toWorldNormal(Obj o, vec3 n) {
  return normalize(o.r0.xyz * n.x + o.r1.xyz * n.y + o.r2.xyz * n.z);
}

bool boundHit(vec4 bound, vec3 ro, vec3 rd, float tmax) {
  if (bound.w < 0.0) return true;
  vec3 oc = ro - bound.xyz;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - bound.w * bound.w;
  if (c < 0.0) return true;
  if (b > 0.0) return false;
  float d = b * b - c;
  return d >= 0.0 && -b - sqrt(d) < tmax;
}

// The one call site of the heavy intersections (terrain, SDF): FXC (Windows) inlines
// every call, so a second site would double the compile time.
Span shapeSpan(Obj o, vec3 ro, vec3 rd) {
  vec3 lo = toLocalPoint(o, ro);
  vec3 ld = toLocalDir(o, rd);
  int k = o.kind;
  if (k == K_SPHERE) return sphereSpan(lo, ld);
  if (k == K_CUBE) return cubeSpan(lo, ld);
  if (k == K_CYLINDER) return cylinderSpan(lo, ld);
  if (k == K_CONE) return coneSpan(lo, ld);
  if (k == K_PYRAMID) return pyramidSpan(lo, ld);
  if (k == K_DISK) return flatSpan(lo, ld, true, false);
  if (k == K_SQUARE) return flatSpan(lo, ld, false, false);
  if (k == K_WATER || k == K_GROUND || k == K_CLOUDPLANE) return flatSpan(lo, ld, false, true);
  if (k == K_TORUS || k == K_STONE) return marchSdf(k, lo, ld, o.params.y);
  if (k == K_TERRAIN || k == K_LATTICE) return terrainSpan(k == K_LATTICE, lo, ld, o.params.x, o.params.z);
  return NO_SPAN;
}

// Boolean cutters are convex primitives; terrains, tori and stones never cut.
Span convexSpan(Obj o, vec3 ro, vec3 rd) {
  vec3 lo = toLocalPoint(o, ro);
  vec3 ld = toLocalDir(o, rd);
  int k = o.kind;
  if (k == K_SPHERE) return sphereSpan(lo, ld);
  if (k == K_CYLINDER) return cylinderSpan(lo, ld);
  if (k == K_CONE) return coneSpan(lo, ld);
  if (k == K_PYRAMID) return pyramidSpan(lo, ld);
  return cubeSpan(lo, ld);
}

// A Negative member cuts the span, an Intersect member clips it; false when nothing is left.
bool cutSpan(inout Span s, Span c, int mode) {
  if (mode == B_INTERSECT) {
    if (c.t0 > s.t0) { s.t0 = c.t0; s.n0 = c.n0; }
    if (c.t1 < s.t1) { s.t1 = c.t1; s.n1 = c.n1; }
    if (c.t0 > c.t1) return false;
  } else if (c.t0 <= c.t1) {
    if (c.t0 <= s.t0 && c.t1 > s.t0) { s.t0 = c.t1; s.n0 = -c.n1; }
    else if (c.t0 > s.t0 && c.t0 < s.t1) {
      // Starting inside the hole: the solid resumes where the hole ends.
      if (c.t0 <= EPS) { s.t0 = c.t1; s.n0 = -c.n1; }
      else { s.t1 = c.t0; s.n1 = -c.n0; }
    }
  }
  return s.t0 <= s.t1;
}

// Next boolean member of `group` at or after `cursor`; the list is walked twice so
// cuts that expose another member's region are applied. -1 when there is none.
int nextMember(int group, int self, int cursor) {
  for (int c = cursor; c < uObjectCount * 2; c++) {
    int j = c < uObjectCount ? c : c - uObjectCount;
    if (j == self) continue;
    vec4 h = texelFetch(uObjects, ivec2(3, j), 0);
    if (int(h.z + 0.5) == group && int(h.y + 0.5) >= B_NEGATIVE) return c;
  }
  return -1;
}

struct Hit {
  float t;
  int obj;
  vec3 n;      // world normal facing the ray's side as computed
  bool inside;
};

// Nearest surface hit closer than tmax. With anyOpaque, the first opaque hit ends the
// search (shadow rays only need to know the light is blocked).
// One flat loop visits each object and then its boolean members (no nested loop for
// FXC to compile into every object visit); the bounding sphere is tested from one texel before the record is read.
bool traceScene(vec3 ro, vec3 rd, float tmax, out Hit hit, bool anyOpaque) {
  hit.t = tmax;
  hit.obj = -1;
  hit.n = vec3(0.0, 1.0, 0.0);
  hit.inside = false;
  int base = 0;
  int cursor = -1;
  Obj o;
  Span s = NO_SPAN;
  int steps = uObjectCount * (uObjectCount * 2 + 1);
  for (int step = 0; step < steps + uLoopGuard; step++) {
    if (base >= uObjectCount) break;
    bool cutting = cursor >= 0;
    if (!cutting) {
      vec4 head = texelFetch(uObjects, ivec2(3, base), 0);
      bool member = int(head.y + 0.5) >= B_NEGATIVE && int(head.z + 0.5) > 0;
      if (member || !boundHit(texelFetch(uObjects, ivec2(5, base), 0), ro, rd, hit.t)) {
        base++;
        continue;
      }
      o = loadObj(base);
    }
    bool alive;
    if (cutting) {
      Obj m = loadObj(cursor < uObjectCount ? cursor : cursor - uObjectCount);
      alive = cutSpan(s, convexSpan(m, ro, rd), m.mode);
      cursor = alive ? nextMember(o.group, base, cursor + 1) : -1;
      if (cursor >= 0) continue;
    } else {
      s = shapeSpan(o, ro, rd);
      alive = spanValid(s);
#ifndef LAB_NO_BOOL
      if (alive && (o.flags & F_HAS_MODIFIERS) != 0) {
        cursor = nextMember(o.group, base, 0);
        if (cursor >= 0) continue;
      }
#endif
    }
    base++;
    if (!alive || !spanValid(s)) continue;
    bool inside = s.t0 <= EPS;
    float t = inside ? s.t1 : s.t0;
    if (t > EPS && t < hit.t) {
      hit.t = t;
      hit.obj = base - 1;
      hit.inside = inside && s.t0 < s.t1;
      hit.n = toWorldNormal(o, inside ? s.n1 : s.n0);
      if (anyOpaque && (o.flags & F_OPAQUE) != 0) return true;
    }
  }
  return hit.obj >= 0;
}

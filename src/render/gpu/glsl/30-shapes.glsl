// Local-space intersections. Rays are not normalised: t is shared with world space.
// Each convex test returns the inside interval [t0, t1] and the normals at both ends.
struct Span {
  float t0;
  float t1;
  vec3 n0;
  vec3 n1;
};

const Span NO_SPAN = Span(INF, -INF, vec3(0), vec3(0));

bool spanValid(Span s) { return s.t0 <= s.t1 && s.t1 > EPS; }

Span sphereSpan(vec3 ro, vec3 rd) {
  float a = dot(rd, rd);
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float d = b * b - a * c;
  if (d < 0.0) return NO_SPAN;
  d = sqrt(d);
  float t0 = (-b - d) / a;
  float t1 = (-b + d) / a;
  return Span(t0, t1, ro + rd * t0, ro + rd * t1);
}

// Convex polyhedron from half-spaces dot(n, p) <= d.
void clipPlane(vec3 ro, vec3 rd, vec3 n, float d, inout Span s) {
  float denom = dot(n, rd);
  float dist = d - dot(n, ro);
  if (abs(denom) < 1e-9) {
    if (dist < 0.0) s = NO_SPAN;
    return;
  }
  float t = dist / denom;
  if (denom < 0.0) {
    if (t > s.t0) { s.t0 = t; s.n0 = n; }
  } else {
    if (t < s.t1) { s.t1 = t; s.n1 = n; }
  }
}

Span cubeSpan(vec3 ro, vec3 rd) {
  Span s = Span(-INF, INF, vec3(0), vec3(0));
  clipPlane(ro, rd, vec3(1, 0, 0), 1.0, s);
  clipPlane(ro, rd, vec3(-1, 0, 0), 1.0, s);
  clipPlane(ro, rd, vec3(0, 1, 0), 1.0, s);
  clipPlane(ro, rd, vec3(0, -1, 0), 1.0, s);
  clipPlane(ro, rd, vec3(0, 0, 1), 1.0, s);
  clipPlane(ro, rd, vec3(0, 0, -1), 1.0, s);
  return s;
}

// Square base -1..1 at y = -1, apex at (0, 1, 0).
Span pyramidSpan(vec3 ro, vec3 rd) {
  Span s = Span(-INF, INF, vec3(0), vec3(0));
  clipPlane(ro, rd, vec3(0, -1, 0), 1.0, s);
  clipPlane(ro, rd, normalize(vec3(2, 1, 0)), 1.0 / sqrt(5.0), s);
  clipPlane(ro, rd, normalize(vec3(-2, 1, 0)), 1.0 / sqrt(5.0), s);
  clipPlane(ro, rd, normalize(vec3(0, 1, 2)), 1.0 / sqrt(5.0), s);
  clipPlane(ro, rd, normalize(vec3(0, 1, -2)), 1.0 / sqrt(5.0), s);
  return s;
}

Span cylinderSpan(vec3 ro, vec3 rd) {
  Span s = Span(-INF, INF, vec3(0), vec3(0));
  clipPlane(ro, rd, vec3(0, 1, 0), 1.0, s);
  clipPlane(ro, rd, vec3(0, -1, 0), 1.0, s);
  float a = dot(rd.xz, rd.xz);
  float b = dot(ro.xz, rd.xz);
  float c = dot(ro.xz, ro.xz) - 1.0;
  if (a < 1e-12) {
    if (c > 0.0) return NO_SPAN;
    return s;
  }
  float d = b * b - a * c;
  if (d < 0.0) return NO_SPAN;
  d = sqrt(d);
  float t0 = (-b - d) / a;
  float t1 = (-b + d) / a;
  if (t0 > s.t0) { s.t0 = t0; vec3 p = ro + rd * t0; s.n0 = vec3(p.x, 0, p.z); }
  if (t1 < s.t1) { s.t1 = t1; vec3 p = ro + rd * t1; s.n1 = vec3(p.x, 0, p.z); }
  return s;
}

// Apex at y = 1, base of radius 1 at y = -1: x² + z² <= ((1 - y) / 2)².
Span coneSpan(vec3 ro, vec3 rd) {
  Span s = Span(-INF, INF, vec3(0), vec3(0));
  clipPlane(ro, rd, vec3(0, -1, 0), 1.0, s);
  clipPlane(ro, rd, vec3(0, 1, 0), 1.0, s);
  float k = 0.25;
  float oy = 1.0 - ro.y;
  float a = dot(rd.xz, rd.xz) - k * rd.y * rd.y;
  float b = dot(ro.xz, rd.xz) + k * oy * rd.y;
  float c = dot(ro.xz, ro.xz) - k * oy * oy;
  float d = b * b - a * c;
  if (abs(a) < 1e-12 || d < 0.0) {
    if (c > 0.0) return NO_SPAN;
    return s;
  }
  d = sqrt(d);
  float r0 = (-b - d) / a;
  float r1 = (-b + d) / a;
  float lo = min(r0, r1);
  float hi = max(r0, r1);
  // Only the lower nappe (y <= 1) is the solid; a < 0 means the ray crosses between nappes.
  if (a > 0.0) {
    if (lo > s.t0) { s.t0 = lo; vec3 p = ro + rd * lo; s.n0 = vec3(p.x, 0.5 * length(p.xz), p.z); }
    if (hi < s.t1) { s.t1 = hi; vec3 p = ro + rd * hi; s.n1 = vec3(p.x, 0.5 * length(p.xz), p.z); }
  } else {
    float yLo = ro.y + rd.y * lo;
    if (yLo <= 1.0) {
      if (lo < s.t1) { s.t1 = lo; vec3 p = ro + rd * lo; s.n1 = vec3(p.x, 0.5 * length(p.xz), p.z); }
    } else {
      if (hi > s.t0) { s.t0 = hi; vec3 p = ro + rd * hi; s.n0 = vec3(p.x, 0.5 * length(p.xz), p.z); }
    }
  }
  return s;
}

// Flat shapes have no volume: entry and exit coincide.
Span flatSpan(vec3 ro, vec3 rd, bool round, bool infinite) {
  if (abs(rd.y) < 1e-9) return NO_SPAN;
  float t = -ro.y / rd.y;
  vec3 p = ro + rd * t;
  if (!infinite) {
    if (round && dot(p.xz, p.xz) > 1.0) return NO_SPAN;
    if (!round && (abs(p.x) > 1.0 || abs(p.z) > 1.0)) return NO_SPAN;
  }
  vec3 n = vec3(0, rd.y < 0.0 ? 1.0 : -1.0, 0);
  return Span(t, t, n, n);
}

float sdTorus(vec3 p, float tube) {
  vec2 q = vec2(length(p.xz) - (1.0 - tube), p.y);
  return length(q) - tube;
}

float stoneField(vec3 p, float seed) {
  vec3 q = p + seed * vec3(3.7, 1.9, 5.3);
  return length(p) - 0.82 - gnoise(q * 1.6) * 0.22 - gnoise(q * 3.7) * 0.06;
}

float sdfShape(int kind, vec3 p, float param) {
  return kind == K_TORUS ? sdTorus(p, param) : stoneField(p, param);
}

// Sphere tracing inside the unit bounding box; the step is scaled by |rd| in local units.
Span marchSdf(int kind, vec3 ro, vec3 rd, float param) {
#ifdef LAB_NO_SDF
  return NO_SPAN;
#endif
  Span box = cubeSpan(ro, rd);
  if (!spanValid(box)) return NO_SPAN;
  float len = length(rd);
  float t = max(box.t0, 0.0);
  bool hit = false;
  for (int i = 0; i < SDF_STEPS + uLoopGuard; i++) {
    float d = sdfShape(kind, ro + rd * t, param) * 0.8;
    if (d < 1e-4 * (1.0 + t * len)) { hit = true; break; }
    t += d / len;
    if (t > box.t1) break;
  }
  if (!hit) return NO_SPAN;
  // Tetrahedral normal: four taps in one loop instead of six inlined calls.
  vec3 p = ro + rd * t;
  vec3 n = vec3(0);
  for (int k = 0; k < 4 + uLoopGuard; k++) {
    vec3 e = vec3(float(((k + 3) >> 1) & 1), float((k >> 1) & 1), float(k & 1)) * 2.0 - 1.0;
    n += e * sdfShape(kind, p + e * 5e-4, param);
  }
  return Span(t, box.t1, n, -n);
}

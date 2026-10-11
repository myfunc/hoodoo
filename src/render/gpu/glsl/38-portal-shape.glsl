// Portals (a preview feature, world/portals.ts): the oval in the local XY plane.
// Inside PORTAL_WINDOW of its radius it is a window onto its partner (70-portals.glsl),
// outside it is the rim, shaded with the portal's material.
#define K_PORTAL 17
#define PORTAL_WINDOW 0.84

Span portalSpan(vec3 ro, vec3 rd) {
  if (abs(rd.z) < 1e-9) return NO_SPAN;
  float t = -ro.z / rd.z;
  vec2 p = ro.xy + rd.xy * t;
  if (dot(p, p) > 1.0) return NO_SPAN;
  vec3 n = vec3(0, 0, rd.z < 0.0 ? 1.0 : -1.0);
  return Span(t, t, n, n);
}

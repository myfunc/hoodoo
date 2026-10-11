// Portals: a path ray that meets a portal's window goes on from its partner.
// Object texel PORTAL_TEXEL holds the partner's index + 1 (0: the portal leads nowhere).
// Passes are counted per pixel; the last PORTAL_FADE of PORTAL_DEPTH fade into the
// dim window, so a hall of mirrors ends softly instead of in a hard edge.
#define PORTAL_TEXEL 6
#ifdef FAST_PREVIEW
#define PORTAL_DEPTH 4
#else
#define PORTAL_DEPTH 10
#endif
#define PORTAL_FADE 3.0
// A window that leads nowhere shows the rim colour this dark.
#define PORTAL_DIM 0.12

// How much of the view is left after `passes` passes: 1, then down to 0 at PORTAL_DEPTH.
float portalKeep(int passes) {
  return clamp(float(PORTAL_DEPTH - passes) / PORTAL_FADE, 0.0, 1.0);
}

// The ray (ro, rd) met portal `obj` at wp, with fog atm on the way. On the window it
// moves to the partner and returns true; a window that leads nowhere (or the last
// pass) is drawn dim and ends the path (done). false: the rim, shaded as a surface.
bool portalPass(int obj, vec3 wp, vec4 atm, vec3 rim, inout vec3 ro, inout vec3 rd, inout vec3 thr, inout vec3 col, inout int passes, inout bool done) {
  Obj a = loadObj(obj);
  vec3 lp = toLocalPoint(a, wp);
  if (dot(lp.xy, lp.xy) > PORTAL_WINDOW * PORTAL_WINDOW) return false;
  col += thr * atm.a * atm.rgb;
  thr *= 1.0 - atm.a;
  int partner = int(texelFetch(uObjects, ivec2(PORTAL_TEXEL, obj), 0).x + 0.5) - 1;
  passes++;
  float keep = partner < 0 ? 0.0 : portalKeep(passes) / portalKeep(passes - 1);
  col += thr * (1.0 - keep) * rim * PORTAL_DIM;
  thr *= keep;
  if (keep <= 0.0) {
    done = true;
    return true;
  }
  // Half a turn about the local up axis: in at one portal's front, out at the other's.
  vec3 ld = toLocalDir(a, rd);
  Obj b = loadObj(partner);
  mat3 fromB = inverse(transpose(mat3(b.r0.xyz, b.r1.xyz, b.r2.xyz)));
  vec3 p = fromB * (vec3(-lp.x, lp.y, -lp.z) - vec3(b.r0.w, b.r1.w, b.r2.w));
  rd = normalize(fromB * vec3(-ld.x, ld.y, -ld.z));
  ro = p + rd * 2e-3;
  return true;
}

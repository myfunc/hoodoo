// Lathe objects (ShapeKind.Lathe): an outline spun about Y, one uLathe row per
// profile (render/gpu/lathe-pack.ts). The work happens in profile space: the unit
// box with X and Z multiplied by the profile's aspect, so the piece has its true
// proportions and t stays the world t. Cone frustums are solved exactly; cuts
// (crenellations, a slit) are subtracted and blocks (a cross) joined by keeping
// only surface points outside the other parts; a knight's head is sphere-traced.
#define K_LATHE 18
#define LATHE_CHUNKS_AT 16
#define LATHE_CHUNK 8
#define LATHE_HEAD_STEPS 64
#define LATHE_SEARCH_STEPS 8

uniform sampler2D uLathe;

vec4 latheTexel(int row, int i) { return texelFetch(uLathe, ivec2(i, row), 0); }

// The two nearest surfaces ahead: xyz the outward normal, w the distance.
struct LatheHits {
  vec4 a;
  vec4 b;
  bool aEnters;
};

void latheKeep(inout LatheHits h, float t, vec3 n, bool enters) {
  if (t <= 1e-5) return;
  if (t < h.a.w) {
    h.b = h.a;
    h.a = vec4(n, t);
    h.aEnters = enters;
  } else if (t < h.b.w) {
    h.b = vec4(n, t);
  }
}

// The outline's radius at height y, -1 outside it: segments are sorted by height.
float latheRadius(int row, int segAt, int segs, float y) {
  if (latheTexel(row, segAt).y > y) return -1.0;
  int lo = 0;
  int hi = segs - 1;
  for (int i = 0; i < LATHE_SEARCH_STEPS + uLoopGuard; i++) {
    if (lo >= hi) break;
    int mid = (lo + hi + 1) / 2;
    if (latheTexel(row, segAt + 2 * mid).y <= y) lo = mid;
    else hi = mid - 1;
  }
  vec4 s = latheTexel(row, segAt + 2 * lo);
  if (y > s.w) return -1.0;
  if (s.w - s.y < 1e-7) return max(s.x, s.z);
  return mix(s.x, s.z, (y - s.y) / (s.w - s.y));
}

bool latheInside(int row, int segAt, int segs, vec3 p) {
  return length(p.xz) < latheRadius(row, segAt, segs, p.y);
}

// Turns about Y by -angle (into a copy's frame) or back with a negative angle.
vec3 latheTurn(vec3 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

bool latheInCut(int row, int copies, vec3 p) {
  float step = TAU / float(copies);
  vec3 q = latheTurn(p, step * floor(atan(p.z, p.x) / step + 0.5));
  for (int i = 0; i < 4; i++) {
    vec4 pl = latheTexel(row, 2 + i);
    if (dot(pl.xyz, q) >= pl.w) return false;
  }
  return true;
}

bool latheInBlock(int row, int blocks, vec3 p, int skip) {
  for (int i = 0; i < blocks; i++) {
    if (i == skip) continue;
    vec3 c = latheTexel(row, 6 + 2 * i).xyz;
    vec3 h = latheTexel(row, 7 + 2 * i).xyz;
    if (all(lessThan(abs(p - c), h))) return true;
  }
  return false;
}

// The knight's head: a side view (polygon) extruded across Z with rounded edges,
// thinner toward the muzzle and the ears, a groove between the ears and two hollows a side.
float latheHeadSdf(int row, vec3 p) {
  vec4 hdr = latheTexel(row, 0);
  int n = int(hdr.y + 0.5);
  int at = int(hdr.z + 0.5);
  vec4 th = latheTexel(row, 10);
  vec4 hm = latheTexel(row, 11);
  float dd = INF;
  float sgn = 1.0;
  vec4 last = latheTexel(row, at + (n - 1) / 2);
  vec2 vj = ((n - 1) & 1) == 0 ? last.xy : last.zw;
  for (int i = 0; i < n + uLoopGuard; i++) {
    vec4 tx = latheTexel(row, at + i / 2);
    vec2 vi = (i & 1) == 0 ? tx.xy : tx.zw;
    vec2 e = vj - vi;
    vec2 w = p.xy - vi;
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    dd = min(dd, dot(b, b));
    bvec3 c = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) sgn = -sgn;
    vj = vi;
  }
  float d2 = sgn * sqrt(dd);
  float half_ = clamp(th.x + th.y * p.x + th.z * p.y, th.w, hm.x);
  // Edges rounded `round` times the half-thickness in: above 1 the cross-section is an ellipse
  // (a domed side), traced in a space stretched across Z and scaled back to stay a safe bound.
  float rr = half_ * hm.y;
  float k = max(hm.y, 1.0);
  vec2 q = vec2(d2 + rr, (abs(p.z) - half_) * k + rr);
  float d = (min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rr) / k;
  d = max(d, -max(abs(p.z) - hm.w, hm.z - p.y));
  vec3 m = vec3(p.xy, abs(p.z));
  for (int k = 0; k < 2; k++) {
    vec4 dent = latheTexel(row, 13 + k);
    if (dent.w > 0.0) d = max(d, dent.w - length(m - dent.xyz));
  }
  return d;
}

// Nearest hit of the head ahead, INF on a miss; n is its normal.
float latheHead(int row, vec3 o, vec3 d, out vec3 n) {
  n = vec3(0, 1, 0);
  vec4 box = latheTexel(row, 12);
  float maxW = latheTexel(row, 11).x;
  vec3 c = vec3((box.x + box.z) * 0.5, (box.y + box.w) * 0.5, 0.0);
  vec3 h = vec3((box.z - box.x) * 0.5, (box.w - box.y) * 0.5, maxW) + 1e-3;
  Span s = cubeSpan((o - c) / h, d / h);
  if (!spanValid(s)) return INF;
  // The head lies inside its side view pushed straight across Z: find exactly where the ray
  // is inside that prism, and march only there (most rays near a knight never reach it).
  float ta = max(s.t0, 0.0);
  float tb = s.t1;
  vec4 hdr = latheTexel(row, 0);
  int verts = int(hdr.y + 0.5);
  int at = int(hdr.z + 0.5);
  vec2 q = o.xy + d.xy * ta;
  vec2 qb = o.xy + d.xy * tb;
  float enter = INF;
  float leave = -INF;
  bool inside = false;
  bool insideEnd = false;
  vec4 last = latheTexel(row, at + (verts - 1) / 2);
  vec2 vj = ((verts - 1) & 1) == 0 ? last.xy : last.zw;
  for (int i = 0; i < verts + uLoopGuard; i++) {
    vec4 tx = latheTexel(row, at + i / 2);
    vec2 vi = (i & 1) == 0 ? tx.xy : tx.zw;
    vec2 e = vj - vi;
    if ((vi.y > q.y) != (vj.y > q.y) && q.x < vi.x + e.x * (q.y - vi.y) / e.y) inside = !inside;
    if ((vi.y > qb.y) != (vj.y > qb.y) && qb.x < vi.x + e.x * (qb.y - vi.y) / e.y) insideEnd = !insideEnd;
    float den = d.x * e.y - d.y * e.x;
    if (abs(den) > 1e-12) {
      vec2 a = vi - o.xy;
      float u = (a.x * d.y - a.y * d.x) / den;
      float tc = (a.x * e.y - a.y * e.x) / den;
      if (u >= 0.0 && u <= 1.0 && tc >= ta && tc <= tb) { enter = min(enter, tc); leave = max(leave, tc); }
    }
    vj = vi;
  }
  if (inside) enter = ta;
  if (insideEnd) leave = tb;
  if (enter >= INF) return INF;
  float len = length(d);
  float t = enter;
  bool hit = false;
  for (int i = 0; i < LATHE_HEAD_STEPS + uLoopGuard; i++) {
    float dist = latheHeadSdf(row, o + d * t);
    if (dist < 2e-4 * (1.0 + t * len)) { hit = true; break; }
    t += dist * 0.85 / len;
    if (t > leave) break;
  }
  if (!hit) return INF;
  vec3 p = o + d * t;
  vec3 g = vec3(0);
  for (int k = 0; k < 4 + uLoopGuard; k++) {
    vec3 e = vec3(float(((k + 3) >> 1) & 1), float((k >> 1) & 1), float(k & 1)) * 2.0 - 1.0;
    g += e * latheHeadSdf(row, p + e * 4e-4);
  }
  n = g;
  return t;
}

Span latheSpan(vec3 lo, vec3 ld, float param) {
  int row = int(param + 0.5);
  vec4 hdr = latheTexel(row, 0);
  vec4 info = latheTexel(row, 1);
  float aspect = info.x;
  vec3 o = vec3(lo.x * aspect, lo.y, lo.z * aspect);
  vec3 d = vec3(ld.x * aspect, ld.y, ld.z * aspect);
  int segs = int(hdr.x + 0.5);
  int copies = int(hdr.w + 0.5);
  int blocks = int(info.y + 0.5);
  int segAt = int(info.w + 0.5);
  LatheHits h = LatheHits(vec4(0, 0, 0, INF), vec4(0, 0, 0, INF), false);
  float dxz = dot(d.xz, d.xz);
  // How close the ray's line comes to the axis: rings narrower than that are missed.
  float axis = dxz > 1e-12 ? abs(o.x * d.z - o.z * d.x) / sqrt(dxz) : length(o.xz);
  float oxz = dot(o.xz, o.xz);
  float bxz = dot(o.xz, d.xz);
  // The highest point of the ray inside the widest radius: below a cut or a block, skip it.
  float outer = bxz * bxz - dxz * (oxz - aspect * aspect);
  if (outer < 0.0) return NO_SPAN;
  float top = dxz > 1e-12 ? o.y + max(d.y * (-bxz - sqrt(outer)), d.y * (-bxz + sqrt(outer))) / dxz : INF;
  vec4 floors = latheTexel(row, 15);
  if (top < floors.x) copies = 0;
  if (top < floors.y) blocks = 0;
  int chunks = (segs + LATHE_CHUNK - 1) / LATHE_CHUNK;
  for (int i = 0; i < chunks * LATHE_CHUNK + uLoopGuard; i++) {
    // Each chunk's bounding cylinder: where the ray is inside it, does it reach the chunk's heights?
    if (i % LATHE_CHUNK == 0) {
      vec4 cb = latheTexel(row, LATHE_CHUNKS_AT + i / LATHE_CHUNK);
      float cd = bxz * bxz - dxz * (oxz - cb.x * cb.x);
      bool miss = cb.x < axis || cd < 0.0;
      if (!miss && dxz > 1e-12) {
        float sq0 = sqrt(cd);
        float ya = o.y + d.y * (-bxz - sq0) / dxz;
        float yb = o.y + d.y * (-bxz + sq0) / dxz;
        miss = max(ya, yb) < cb.y || min(ya, yb) > cb.z;
      }
      if (miss) { i += LATHE_CHUNK - 1; continue; }
    }
    if (i >= segs) break;
    vec4 s = latheTexel(row, segAt + 2 * i);
    if (max(s.x, s.z) < axis) continue;
    float dy = s.w - s.y;
    bool ring = dy < 1e-7;
    float k = ring ? 0.0 : (s.z - s.x) / dy;
    float q = s.x + k * (o.y - s.y);
    float sk = k * d.y;
    float A = dxz - sk * sk;
    float B = bxz - q * sk;
    float C = oxz - q * q;
    float disc = B * B - A * C;
    if (!ring && disc < 0.0) continue;
    if (ring && abs(d.y) < 1e-9) continue;
    float sq = sqrt(max(disc, 0.0));
    for (int j = 0; j < 2 + uLoopGuard; j++) {
      float t;
      if (ring) {
        if (j > 0) break;
        t = (s.y - o.y) / d.y;
      } else {
        t = abs(A) > 1e-12 ? (-B + (j == 0 ? -sq : sq)) / A : -C / (2.0 * B);
        if (abs(A) <= 1e-12 && j > 0) break;
      }
      if (t <= 1e-5 || t >= h.b.w) continue;
      vec3 p = o + d * t;
      float r = length(p.xz);
      float u;
      if (ring) {
        if (r < min(s.x, s.z) || r > max(s.x, s.z)) continue;
        u = (r - s.x) / (s.z - s.x);
      } else {
        if (p.y < s.y || p.y > s.w || q + sk * t < 0.0) continue;
        u = (p.y - s.y) / dy;
      }
      if (copies > 0 && p.y > floors.x && latheInCut(row, copies, p)) continue;
      if (blocks > 0 && latheInBlock(row, blocks, p, -1)) continue;
      vec4 nn = latheTexel(row, segAt + 2 * i + 1);
      vec2 n2 = normalize(mix(nn.xy, nn.zw, clamp(u, 0.0, 1.0)));
      vec2 radial = r > 1e-9 ? p.xz / r : vec2(1, 0);
      vec2 g2 = vec2(dy, s.x - s.z);
      bool enters = dot(vec3(g2.x * radial.x, g2.y, g2.x * radial.y), d) < 0.0;
      latheKeep(h, t, vec3(n2.x * radial.x, n2.y, n2.x * radial.y), enters);
    }
  }
  // The walls of the cuts, where they lie inside the outline.
  if (copies > 0) {
    vec4 p0 = latheTexel(row, 2);
    vec4 p1 = latheTexel(row, 3);
    vec4 p2 = latheTexel(row, 4);
    vec4 p3 = latheTexel(row, 5);
    float step = TAU / float(copies);
    for (int c = 0; c < copies + uLoopGuard; c++) {
      float ang = step * float(c);
      vec3 co = latheTurn(o, ang);
      vec3 cd = latheTurn(d, ang);
      Span cs = Span(-INF, INF, vec3(0), vec3(0));
      clipPlane(co, cd, p0.xyz, p0.w, cs);
      clipPlane(co, cd, p1.xyz, p1.w, cs);
      clipPlane(co, cd, p2.xyz, p2.w, cs);
      clipPlane(co, cd, p3.xyz, p3.w, cs);
      if (cs.t0 >= cs.t1) continue;
      if (cs.t0 > 1e-5 && cs.t0 < h.b.w && latheInside(row, segAt, segs, o + d * cs.t0)) latheKeep(h, cs.t0, -latheTurn(cs.n0, -ang), false);
      if (cs.t1 > 1e-5 && cs.t1 < h.b.w && latheInside(row, segAt, segs, o + d * cs.t1)) latheKeep(h, cs.t1, -latheTurn(cs.n1, -ang), true);
    }
  }
  // Blocks joined on: their faces outside the outline and the other blocks.
  for (int b = 0; b < blocks + uLoopGuard; b++) {
    vec3 c = latheTexel(row, 6 + 2 * b).xyz;
    vec3 hb = latheTexel(row, 7 + 2 * b).xyz;
    Span bs = cubeSpan((o - c) / hb, d / hb);
    if (bs.t0 >= bs.t1) continue;
    vec3 p0 = o + d * bs.t0;
    vec3 p1 = o + d * bs.t1;
    if (bs.t0 < h.b.w && !latheInside(row, segAt, segs, p0) && !latheInBlock(row, blocks, p0, b)) latheKeep(h, bs.t0, bs.n0 / hb, true);
    if (bs.t1 < h.b.w && !latheInside(row, segAt, segs, p1) && !latheInBlock(row, blocks, p1, b)) latheKeep(h, bs.t1, bs.n1 / hb, false);
  }
  if (info.z > 0.5) {
    vec3 hn;
    float th = latheHead(row, o, d, hn);
    if (th < h.a.w) latheKeep(h, th, hn, true);
  }
  if (h.a.w >= INF) return NO_SPAN;
  vec3 na = vec3(h.a.x * aspect, h.a.y, h.a.z * aspect);
  if (!h.aEnters) return Span(0.0, h.a.w, na, na);
  vec3 nb = vec3(h.b.x * aspect, h.b.y, h.b.z * aspect);
  return Span(h.a.w, h.b.w < INF ? h.b.w : h.a.w, na, nb);
}

// Heightfield terrains in the unit box. Height 0 is clipped away, like Bryce's black.
#define TERRAIN_CLIP 0.004

float terrainHeight(float layer, float res, vec2 xz) {
  vec2 uv = (xz * 0.5 + 0.5) * (res - 1.0) / res + 0.5 / res;
  return textureLod(uTerrains, vec3(uv, layer), 0.0).r;
}

bool terrainInside(bool lattice, float layer, float res, vec3 p) {
  float h = terrainHeight(layer, res, p.xz);
  if (h < TERRAIN_CLIP) return false;
  return lattice ? abs(p.y) < h : p.y < h * 2.0 - 1.0;
}

vec3 terrainNormal(bool lattice, float layer, float res, vec3 p) {
  float e = 2.0 / res;
  float hx = terrainHeight(layer, res, p.xz + vec2(e, 0)) - terrainHeight(layer, res, p.xz - vec2(e, 0));
  float hz = terrainHeight(layer, res, p.xz + vec2(0, e)) - terrainHeight(layer, res, p.xz - vec2(0, e));
  float k = lattice ? 1.0 : 2.0;
  vec3 n = vec3(-hx * k / (2.0 * e), 1.0, -hz * k / (2.0 * e));
  if (lattice && p.y < 0.0) n.y = -n.y;
  return n;
}

#define TERRAIN_CELL 8.0
#define MAX_CELL_STEPS 48.0

// Ray already inside the solid (camera underground, rays in glass): plain march to the exit.
Span terrainExit(bool lattice, vec3 ro, vec3 rd, float layer, float res, Span box) {
  int steps = int(clamp(res * 1.6, 96.0, 320.0));
  float t0 = max(box.t0, 0.0);
  float dt = (box.t1 - t0) / float(steps);
  float prev = t0;
  for (int i = 1; i <= steps + uLoopGuard; i++) {
    float t = t0 + dt * float(i);
    if (!terrainInside(lattice, layer, res, ro + rd * t)) {
      float lo = prev;
      float hi = t;
      for (int j = 0; j < 7 + uLoopGuard; j++) {
        float mid = 0.5 * (lo + hi);
        if (!terrainInside(lattice, layer, res, ro + rd * mid)) hi = mid; else lo = mid;
      }
      vec3 n = terrainNormal(lattice, layer, res, ro + rd * hi);
      return Span(t0, hi, -n, n);
    }
    prev = t;
  }
  return Span(t0, box.t1, box.n0, box.n1);
}

// Walks the max-height grid with a 2D DDA; only blocks the ray can touch are marched finely.
Span terrainSpan(bool lattice, vec3 ro, vec3 rd, float layer, float res) {
#ifdef LAB_NO_TERRAIN
  return NO_SPAN;
#endif
  Span box = cubeSpan(ro, rd);
  if (!spanValid(box)) return NO_SPAN;
  float t0 = max(box.t0, 0.0);
  vec3 entry = ro + rd * t0;
  if (terrainInside(lattice, layer, res, entry)) {
    if (box.t0 > 0.0) return Span(box.t0, box.t1, box.n0, box.n1);
    return terrainExit(lattice, ro, rd, layer, res, box);
  }
  float cells = max(floor(res / TERRAIN_CELL), 1.0);
  float cellSize = 2.0 / cells;
  vec2 dir = rd.xz;
  vec2 stepDir = vec2(dir.x >= 0.0 ? 1.0 : -1.0, dir.y >= 0.0 ? 1.0 : -1.0);
  vec2 invAbs = 1.0 / max(abs(dir), vec2(1e-12));
  vec2 cell = clamp(floor((entry.xz * 0.5 + 0.5) * cells), vec2(0.0), vec2(cells - 1.0));
  vec2 boundary = (cell + max(stepDir, vec2(0.0))) * cellSize - 1.0;
  vec2 tMax = t0 + abs(boundary - entry.xz) * invAbs;
  vec2 tDelta = cellSize * invAbs;
  float texel = 2.0 / res;
  float rayLen = length(rd);
  int layerIndex = int(layer + 0.5);
  float tCell = t0;
  int maxCells = int(cells) * 2 + 2;
  for (int i = 0; i < maxCells + uLoopGuard; i++) {
    float tEnd = min(min(tMax.x, tMax.y), box.t1);
    float hmax = texelFetch(uTerrainMax, ivec3(ivec2(cell), layerIndex), 0).r;
    if (hmax >= TERRAIN_CLIP) {
      float top = lattice ? hmax : hmax * 2.0 - 1.0;
      float a = tCell;
      float b = tEnd;
      // Trim the part of the segment that is above the block's highest point.
      if (abs(rd.y) > 1e-9) {
        float tTop = (top - ro.y) / rd.y;
        if (rd.y < 0.0) a = max(a, tTop); else b = min(b, tTop);
      } else if (ro.y > top) {
        b = a;
      }
      if (b > a) {
        float n = clamp(ceil((b - a) * rayLen / texel), 1.0, MAX_CELL_STEPS);
        float dt = (b - a) / n;
        float prev = a;
        for (int j = 1; j <= int(n) + uLoopGuard; j++) {
          float t = a + dt * float(j);
          if (terrainInside(lattice, layer, res, ro + rd * t)) {
            float lo = prev;
            float hi = t;
            for (int k = 0; k < 7 + uLoopGuard; k++) {
              float mid = 0.5 * (lo + hi);
              if (terrainInside(lattice, layer, res, ro + rd * mid)) hi = mid; else lo = mid;
            }
            return Span(hi, box.t1, terrainNormal(lattice, layer, res, ro + rd * hi), box.n1);
          }
          prev = t;
        }
      }
    }
    if (tEnd >= box.t1) break;
    tCell = tEnd;
    if (tMax.x < tMax.y) {
      cell.x += stepDir.x;
      tMax.x += tDelta.x;
    } else {
      cell.y += stepDir.y;
      tMax.y += tDelta.y;
    }
    if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= cells || cell.y >= cells) break;
  }
  return NO_SPAN;
}

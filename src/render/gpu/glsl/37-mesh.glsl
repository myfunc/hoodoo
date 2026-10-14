// Triangle meshes (ShapeKind.Mesh): models fitted to the unit box, one BVH each in uMesh
// (render/gpu/mesh-pack.ts), their pictures in uMeshImages. One flat loop visits a node or
// tests one triangle per step, with a short stack of the farther children still to visit.
#define K_MESH 19
#define MESH_TEX_WIDTH 2048
#define MESH_TRI_TEXELS 7
#define MESH_STACK 32
#define MESH_STEPS 1024
// A picture code is its layer plus this times its alpha mode (1: cut out where alpha < 0.5).
#define MESH_ALPHA_STEP 1024.0
#define MESH_CUTOUT 0.5
// Barycentric slack: a ray down a shared edge hits one of its triangles, not the crack between.
#define MESH_SLACK 1e-6

uniform sampler2D uMesh;
uniform sampler2DArray uMeshImages;

vec4 meshTexel(int i) { return texelFetch(uMesh, ivec2(i % MESH_TEX_WIDTH, i / MESH_TEX_WIDTH), 0); }

// The mesh surface last found by meshSpan: the picture's u, v, its code (-1 for none) and the
// mesh's picture texels per unit of its box. traceScene keeps the nearest one's (Hit.aux).
vec4 gMeshHit = vec4(0.0, 0.0, -1.0, 0.0);
// The surface being shaded, when it is a mesh's (90-main.glsl sets it from the hit).
vec4 gMeshNow = vec4(0.0, 0.0, -1.0, 0.0);

// Where the ray enters the box lo..hi; INF when it misses or enters past `far`.
float meshBox(vec3 ro, vec3 inv, vec3 lo, vec3 hi, float far) {
  vec3 a = (lo - ro) * inv;
  vec3 b = (hi - ro) * inv;
  vec3 near = min(a, b);
  vec3 away = max(a, b);
  float t0 = max(max(near.x, near.y), near.z);
  float t1 = min(min(away.x, away.y), away.z);
  return t1 >= max(t0, 0.0) && t0 < far ? t0 : INF;
}

// The picture at a mesh surface: layer from the code, mip level from the footprint.
vec4 meshPicture(vec4 m, float lod) {
  return textureLod(uMeshImages, vec3(m.xy, mod(m.z, MESH_ALPHA_STEP)), lod);
}

// u, v of the picture at barycentric b of the triangle whose texels start at `at`.
vec2 meshUv(int at, vec2 b) {
  vec4 n0 = meshTexel(at + 3);
  vec4 n1 = meshTexel(at + 4);
  vec4 n2 = meshTexel(at + 5);
  vec4 v = meshTexel(at + 6);
  float w = 1.0 - b.x - b.y;
  return vec2(n0.w * w + n1.w * b.x + n2.w * b.y, v.x * w + v.y * b.x + v.z * b.y);
}

Span meshSpan(vec3 ro, vec3 rd, float slot) {
  vec4 head = meshTexel(int(slot + 0.5));
  int nodeBase = int(head.x + 0.5);
  int triBase = int(head.y + 0.5);
  vec3 safe = vec3(abs(rd.x) > 1e-12 ? rd.x : 1e-12, abs(rd.y) > 1e-12 ? rd.y : 1e-12, abs(rd.z) > 1e-12 ? rd.z : 1e-12);
  vec3 inv = 1.0 / safe;
  if (meshBox(ro, inv, meshTexel(nodeBase).xyz, meshTexel(nodeBase + 1).xyz, INF) >= INF) return NO_SPAN;
  float best = INF;
  int bestTri = -1;
  vec2 bestB = vec2(0.0);
  int stack[MESH_STACK];
  float stackT[MESH_STACK];
  int top = 0;
  int node = 0;
  bool haveNode = true;
  int tri = 0;
  int triEnd = 0;
  for (int i = 0; i < MESH_STEPS + uLoopGuard; i++) {
    if (tri < triEnd) {
      int at = triBase + tri * MESH_TRI_TEXELS;
      vec4 p0 = meshTexel(at);
      vec3 e1 = meshTexel(at + 1).xyz - p0.xyz;
      vec3 e2 = meshTexel(at + 2).xyz - p0.xyz;
      vec3 pv = cross(rd, e2);
      float det = dot(e1, pv);
      if (abs(det) > 1e-24) {
        float id = 1.0 / det;
        vec3 tv = ro - p0.xyz;
        vec2 b = vec2(dot(tv, pv), 0.0) * id;
        vec3 qv = cross(tv, e1);
        b.y = dot(rd, qv) * id;
        float t = dot(e2, qv) * id;
        bool inside = b.x >= -MESH_SLACK && b.y >= -MESH_SLACK && b.x + b.y <= 1.0 + MESH_SLACK && t > EPS && t < best;
        // A cut-out part is not there where its picture is clear.
        if (inside && p0.w >= MESH_ALPHA_STEP) inside = meshPicture(vec4(meshUv(at, b), p0.w, 0.0), 0.0).a >= MESH_CUTOUT;
        if (inside) {
          best = t;
          bestTri = tri;
          bestB = b;
        }
      }
      tri++;
      continue;
    }
    if (!haveNode) {
      if (top == 0) break;
      top--;
      node = stack[top];
      if (stackT[top] >= best) continue;
    }
    haveNode = false;
    vec4 a = meshTexel(nodeBase + node * 2);
    vec4 b = meshTexel(nodeBase + node * 2 + 1);
    int first = int(a.w + 0.5);
    int count = int(b.w + 0.5);
    if (count > 0) {
      tri = first;
      triEnd = first + count;
      continue;
    }
    // An inner node: the nearer child next, the farther one on the stack.
    float tl = meshBox(ro, inv, meshTexel(nodeBase + first * 2).xyz, meshTexel(nodeBase + first * 2 + 1).xyz, best);
    float tr = meshBox(ro, inv, meshTexel(nodeBase + first * 2 + 2).xyz, meshTexel(nodeBase + first * 2 + 3).xyz, best);
    if (tl < INF && tr < INF) {
      bool leftFirst = tl <= tr;
      if (top < MESH_STACK) {
        stack[top] = leftFirst ? first + 1 : first;
        stackT[top] = leftFirst ? tr : tl;
        top++;
      }
      node = leftFirst ? first : first + 1;
      haveNode = true;
    } else if (tl < INF || tr < INF) {
      node = tl < INF ? first : first + 1;
      haveNode = true;
    }
  }
  if (bestTri < 0) return NO_SPAN;
  int at = triBase + bestTri * MESH_TRI_TEXELS;
  float w = 1.0 - bestB.x - bestB.y;
  vec3 n = normalize(meshTexel(at + 3).xyz * w + meshTexel(at + 4).xyz * bestB.x + meshTexel(at + 5).xyz * bestB.y);
  gMeshHit = vec4(meshUv(at, bestB), meshTexel(at).w, head.z);
  // Leaving through the back of a face: the ray was inside (glass), the surface faces out.
  if (dot(n, rd) > 0.0) return Span(0.0, best, -n, n);
  return Span(best, best, n, n);
}

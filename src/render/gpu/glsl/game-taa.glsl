#version 300 es
precision highp float;
// The game renderer's temporal upsample (game-renderer.ts): each output pixel keeps a
// running average of the jittered frames traced at a smaller size, so a still or slow
// camera builds up the view's own detail. The last average is found where the camera saw
// this point a frame ago (the first hit's distance gives the point, the sky is reprojected
// by direction), read with a sharp Catmull-Rom filter, and clipped to the spread of the new
// samples around the pixel (YCoCg variance box), so what moved or was uncovered leaves no
// trail. Moving objects carry their own motion (game-motion.ts): the point is first moved
// to where its object was a frame ago.
// What the new frame adds depends on how much history the pixel keeps. With history, the
// sample nearest the pixel's centre adds to it (a narrow kernel in output pixels). Where the
// history was lost (uncovered, a reflection that moved, the first frame) the pixel is
// rebuilt from the 3×3 traced samples around it with a kernel that follows the local edge:
// narrow across it, long along it (a structure tensor of the four 2×2 quads), so edges come
// out straight instead of in traced-pixel steps. Kernel widths come from game-upscale.ts.
// Blending happens on c / (1 + max(c)), so the sun cannot flicker.
uniform sampler2D uCur;
uniform sampler2D uAux;
uniform sampler2D uHistory;
// The traced picture's size (the used corner of uCur) and the output's, in pixels.
uniform vec2 uCurSize;
uniform vec2 uOutSize;
// Where this frame's sample sits inside its traced pixel, 0..1.
uniform vec2 uJitter;
uniform int uHasHistory;
// The most frames the average holds, at rest and while the camera moves fast.
uniform vec2 uMaxWeight;
// Kernel factors k of exp(-k d²) (game-upscale.ts upscaleKernel): the temporal kernel in output
// pixels; the spatial upscale in traced pixels, flat, across an edge and along it.
uniform vec4 uKernel;
// This frame's camera and the last one's (game-frame.ts cameraRows): position, forward,
// right, up; then tan(fov / 2) (orthographic: half the view height), aspect, 1 if orthographic.
uniform vec4 uCam[4];
uniform vec4 uPrev[4];
uniform vec3 uCamExtra;
uniform vec3 uPrevExtra;
// Per traced object (row = object id - 1), three rows of the map from its place now to its
// place a frame ago; read only when uHasMotion is 1. MOTION_VECS is defined by game-post.ts.
uniform GameMotion { vec4 uMotion[MOTION_VECS]; };
uniform int uHasMotion;
in vec2 vUv;
out vec4 fragColor;

#define CLIP_GAMMA 1.25
// Local luma range (on the squashed picture) under which there is no edge worth following.
#define EDGE_FLOOR 0.01
#define EDGE_FULL 0.05
// Output pixels of camera motion at which the average is held shortest.
#define FAST_MOTION 12.0
// History weight from which the pixel's own average is trusted fully.
#define TRUST_FRAMES 2.0
#define SKY_FAR 1e6
#define INF_BOX 1e9

vec3 toYCoCg(vec3 c) {
  return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25)));
}

vec3 fromYCoCg(vec3 c) {
  return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

// Reversible compression: blending in this space keeps one bright sample from dominating.
vec3 squash(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 unsquash(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }

vec3 rayDir(vec4 cam[4], vec3 extra, vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  return normalize(cam[1].xyz + cam[2].xyz * ndc.x * extra.x * extra.y + cam[3].xyz * ndc.y * extra.x);
}

// Where the previous camera saw world point p (or, for the sky, direction p); x < 0 when behind it.
vec2 reproject(vec3 p, bool sky) {
  vec3 v = sky ? p : p - uPrev[0].xyz;
  float z = dot(v, uPrev[1].xyz);
  if (uPrevExtra.z > 0.5) {
    if (sky) return vec2(-1.0);
    return vec2(dot(v, uPrev[2].xyz) / (uPrevExtra.x * uPrevExtra.y), dot(v, uPrev[3].xyz) / uPrevExtra.x) * 0.5 + 0.5;
  }
  if (z <= 1e-5) return vec2(-1.0);
  return vec2(dot(v, uPrev[2].xyz) / (z * uPrevExtra.x * uPrevExtra.y), dot(v, uPrev[3].xyz) / (z * uPrevExtra.x)) * 0.5 + 0.5;
}

// Catmull-Rom through five bilinear taps (after Jorge Jimenez): sharp, so resampling every frame does not blur.
vec4 historyAt(vec2 uv) {
  vec2 size = vec2(textureSize(uHistory, 0));
  vec2 pos = uv * size;
  vec2 c1 = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c1 - 1.0) / size;
  vec2 t3 = (c1 + 2.0) / size;
  vec2 t12 = (c1 + w2 / w12) / size;
  vec4 c = texture(uHistory, vec2(t12.x, t0.y)) * w12.x * w0.y
    + texture(uHistory, vec2(t0.x, t12.y)) * w0.x * w12.y
    + texture(uHistory, t12) * w12.x * w12.y
    + texture(uHistory, vec2(t3.x, t12.y)) * w3.x * w12.y
    + texture(uHistory, vec2(t12.x, t3.y)) * w12.x * w3.y;
  float w = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  // The weight channel is read plainly: a filtered count would ring at disocclusions.
  return vec4(max(c.rgb / w, 0.0), texture(uHistory, uv).a);
}

// The weight of a sample at offset d (traced pixels) from the pixel's centre in the spatial upscale:
// k.x across the edge direction n, k.y along it.
float edgeWeight(vec2 d, vec2 n, vec2 k) {
  float a = dot(d, n);
  float b = d.x * n.y - d.y * n.x;
  return exp(-(k.x * a * a + k.y * b * b));
}

void main() {
  vec2 uv = vUv;
  vec2 q = uv * uCurSize;
  ivec2 p0 = ivec2(floor(q - uJitter + 0.5));
  ivec2 hi = ivec2(uCurSize) - 1;
  float toOut = uOutSize.x / uCurSize.x;
  vec3 cols[9];
  vec2 offs[9];
  float lum[9];
  vec3 sum = vec3(0);
  float wSum = 0.0;
  float wMax = 0.0;
  vec3 m1 = vec3(0);
  vec3 m2 = vec3(0);
  vec3 lo = vec3(INF_BOX);
  vec3 hiC = vec3(-INF_BOX);
  float near = SKY_FAR;
  float nearId = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      int i = (dy + 1) * 3 + dx + 1;
      ivec2 p = clamp(p0 + ivec2(dx, dy), ivec2(0), hi);
      vec3 c = squash(texelFetch(uCur, p, 0).rgb);
      vec2 d = vec2(p0 + ivec2(dx, dy)) + uJitter - q;
      vec2 o = d * toOut;
      float w = exp(-uKernel.x * dot(o, o));
      sum += c * w;
      wSum += w;
      wMax = max(wMax, w);
      vec3 y = toYCoCg(c);
      cols[i] = c;
      offs[i] = d;
      lum[i] = y.x;
      m1 += y;
      m2 += y * y;
      lo = min(lo, y);
      hiC = max(hiC, y);
      vec2 a = texelFetch(uAux, p, 0).xy;
      if (a.x > 0.0 && a.x < near) {
        near = a.x;
        nearId = abs(a.y);
      }
    }
  }
  vec3 current = sum / max(wSum, 1e-5);
  m1 /= 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
  vec3 boxLo = max(lo, m1 - CLIP_GAMMA * sigma);
  vec3 boxHi = min(hiC, m1 + CLIP_GAMMA * sigma);

  // The local edge: a structure tensor of the luma gradients of the four 2×2 quads.
  vec3 tensor = vec3(0);
  for (int qy = 0; qy < 2; qy++) {
    for (int qx = 0; qx < 2; qx++) {
      int i = qy * 3 + qx;
      float gx = 0.5 * (lum[i + 1] + lum[i + 4] - lum[i] - lum[i + 3]);
      float gy = 0.5 * (lum[i + 3] + lum[i + 4] - lum[i] - lum[i + 1]);
      tensor += vec3(gx * gx, gx * gy, gy * gy);
    }
  }
  float half_ = 0.5 * (tensor.x - tensor.z);
  float root = sqrt(half_ * half_ + tensor.y * tensor.y);
  float spread = tensor.x + tensor.z;
  // 1 for a clean edge or line, 0 for a corner, a dot or noise; faint ones do not count.
  float edge = (2.0 * root / max(spread, 1e-8)) * smoothstep(EDGE_FLOOR, EDGE_FULL, hiC.x - lo.x);
  // The direction across it: the tensor's main eigenvector, from whichever of its two forms is not degenerate.
  vec2 v1 = vec2(half_ + root, tensor.y);
  vec2 v2 = vec2(tensor.y, root - half_);
  vec2 v = dot(v1, v1) >= dot(v2, v2) ? v1 : v2;
  vec2 across = dot(v, v) > 1e-16 ? normalize(v) : vec2(1.0, 0.0);
  vec2 k = vec2(mix(uKernel.y, uKernel.z, edge), mix(uKernel.y, uKernel.w, edge));
  vec3 spatialSum = vec3(0);
  float spatialW = 0.0;
  for (int i = 0; i < 9; i++) {
    float w = edgeWeight(offs[i], across, k);
    spatialSum += cols[i] * w;
    spatialW += w;
  }
  vec3 spatial = spatialSum / max(spatialW, 1e-5);

  // The point this pixel shows (the nearest hit around it, so edges move with what is in front).
  bool sky = near >= SKY_FAR;
  bool ortho = uCamExtra.z > 0.5;
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 dir = ortho ? uCam[1].xyz : rayDir(uCam, uCamExtra, uv);
  vec3 origin = ortho ? uCam[0].xyz + uCam[2].xyz * ndc.x * uCamExtra.x * uCamExtra.y + uCam[3].xyz * ndc.y * uCamExtra.x : uCam[0].xyz;
  vec3 point = sky ? dir : origin + dir * near;
  if (!sky && uHasMotion == 1 && nearId > 0.0) {
    int row = (int(nearId + 0.5) - 1) * 3;
    vec4 at = vec4(point, 1.0);
    point = vec3(dot(uMotion[row], at), dot(uMotion[row + 1], at), dot(uMotion[row + 2], at));
  }
  vec2 prevUv = reproject(point, sky);
  bool valid = uHasHistory == 1 && all(greaterThanEqual(prevUv, vec2(0.0))) && all(lessThanEqual(prevUv, vec2(1.0)));

  float wHist = 0.0;
  vec3 hist = current;
  if (valid) {
    vec4 h = historyAt(prevUv);
    vec3 hy = toYCoCg(squash(h.rgb));
    // Clip toward the box's centre along the line to it, not per channel: no hue shifts.
    vec3 centre = 0.5 * (boxLo + boxHi);
    vec3 extent = max(0.5 * (boxHi - boxLo), vec3(1e-4));
    vec3 off = hy - centre;
    float kc = max(abs(off.x) / extent.x, max(abs(off.y) / extent.y, abs(off.z) / extent.z));
    if (kc > 1.0) hy = centre + off / kc;
    hist = fromYCoCg(hy);
    float motion = length((prevUv - uv) * uOutSize);
    float cap = mix(uMaxWeight.x, uMaxWeight.y, clamp(motion / FAST_MOTION, 0.0, 1.0));
    // A clipped history was stale: it counts for less.
    wHist = min(h.a, cap) / max(kc, 1.0);
  }
  // How much the pixel's history holds (0: none, 1: two frames' worth or more): with it, the
  // nearest sample adds to it as before; without, the edge-following spatial upscale stands in,
  // at full weight. A settled history is left exactly as it was: no extra flicker at rest.
  float trust = clamp(wHist / TRUST_FRAMES, 0.0, 1.0);
  vec3 fresh = mix(spatial, current, trust);
  float wNew = mix(1.0, wMax, trust);
  vec3 outC = (hist * wHist + fresh * wNew) / max(wHist + wNew, 1e-5);
  fragColor = vec4(unsquash(outC), wHist + wNew);
}

#version 300 es
precision highp float;
// The game renderer's temporal upscale (game-renderer.ts): each output pixel keeps a
// running average of the jittered low-resolution frames. The last average is found
// where the camera saw this point a frame ago (the first hit's distance gives the point,
// the sky is reprojected by direction), read with a sharp Catmull-Rom filter, and clipped
// to the spread of the new samples around the pixel (YCoCg variance box), so what moved
// or was uncovered leaves no trail. Moving objects carry their own motion (game-motion.ts):
// the point is first moved to where its object was a frame ago. A new sample counts by how
// close it fell to the pixel's centre. Blending happens on c / (1 + max(c)), so the sun
// cannot flicker.
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

#define TAP_SHARPNESS 2.29
#define CLIP_GAMMA 1.25
// Output pixels of camera motion at which the average is held shortest.
#define FAST_MOTION 12.0
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

void main() {
  vec2 uv = vUv;
  vec2 q = uv * uCurSize;
  ivec2 p0 = ivec2(floor(q - uJitter + 0.5));
  ivec2 hi = ivec2(uCurSize) - 1;
  float toOut = uOutSize.x / uCurSize.x;
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
      ivec2 p = clamp(p0 + ivec2(dx, dy), ivec2(0), hi);
      vec3 c = squash(texelFetch(uCur, p, 0).rgb);
      vec2 d = (vec2(p) + uJitter - q) * toOut;
      float w = exp(-TAP_SHARPNESS * dot(d, d));
      sum += c * w;
      wSum += w;
      wMax = max(wMax, w);
      vec3 y = toYCoCg(c);
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
    float k = max(abs(off.x) / extent.x, max(abs(off.y) / extent.y, abs(off.z) / extent.z));
    if (k > 1.0) hy = centre + off / k;
    hist = fromYCoCg(hy);
    float motion = length((prevUv - uv) * uOutSize);
    float cap = mix(uMaxWeight.x, uMaxWeight.y, clamp(motion / FAST_MOTION, 0.0, 1.0));
    // A clipped history was stale: it counts for less.
    wHist = min(h.a, cap) / max(k, 1.0);
  }
  vec3 outC = (hist * wHist + current * wMax) / max(wHist + wMax, 1e-5);
  fragColor = vec4(unsquash(outC), wHist + wMax);
}

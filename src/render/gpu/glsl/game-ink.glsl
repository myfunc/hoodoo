#version 300 es
precision highp float;
// The ink look's outlines (game-renderer.ts), drawn into the traced picture before the
// temporal upscale, which smooths them like any other edge. A pixel is inked where the
// first hit changes object or meets the sky (both sides, so a line is two pixels wide; not
// the horizon of an infinite plane),
// where the depth breaks within one object, or where the surface folds. Depth breaks are
// found on the inverse distance, which runs straight across any flat surface, so a floor
// seen edge-on is not mistaken for one. The sky beside a surface takes no part in those two
// tests: the horizon stays clean.
uniform sampler2D uCur;
uniform sampler2D uAux;
uniform vec2 uCurSize;
uniform vec3 uInkColor;
// Strength 0..1, the inverse-depth break (relative) drawn, and the normal cosine below which a fold is drawn.
uniform vec3 uInk;
out vec4 fragColor;

#define FOLD_SOFT 0.2

vec3 octDecode(vec2 e) {
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}

vec4 auxAt(ivec2 p) {
  return texelFetch(uAux, clamp(p, ivec2(0), ivec2(uCurSize) - 1), 0);
}

// 1 / distance; the sky (distance 0) is infinitely far.
float invDepth(vec4 a) { return a.x > 0.0 ? 1.0 / a.x : 0.0; }

// Another object or the sky beyond: an outline, except where an infinite plane meets the sky (the horizon).
bool outlined(vec4 a, vec4 b) {
  if (b.y == a.y) return false;
  return !((a.y < 0.0 && b.y == 0.0) || (b.y < 0.0 && a.y == 0.0));
}

// The jump in inverse depth across a pixel between neighbours m and p (0 when one is the sky).
float bendAcross(vec4 m, vec4 p, float k) {
  if (m.y == 0.0 || p.y == 0.0) return 0.0;
  return abs(invDepth(m) + invDepth(p) - 2.0 * k);
}

// How far the surface turns toward neighbour b (1: not at all; the sky does not count).
float turn(vec3 n, vec4 b) { return b.y == 0.0 ? 1.0 : dot(n, octDecode(b.zw)); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uCur, p, 0);
  vec4 a = auxAt(p);
  vec4 l = auxAt(p + ivec2(-1, 0));
  vec4 r = auxAt(p + ivec2(1, 0));
  vec4 d = auxAt(p + ivec2(0, -1));
  vec4 u = auxAt(p + ivec2(0, 1));
  float edge = 0.0;
  if (outlined(a, l) || outlined(a, r) || outlined(a, d) || outlined(a, u)) edge = 1.0;
  else if (a.y != 0.0) {
    float k = invDepth(a);
    float bend = max(bendAcross(l, r, k), bendAcross(d, u, k));
    if (bend > uInk.y * k) edge = 1.0;
    vec3 n = octDecode(a.zw);
    float fold = min(min(turn(n, l), turn(n, r)), min(turn(n, d), turn(n, u)));
    edge = max(edge, smoothstep(uInk.z, uInk.z - FOLD_SOFT, fold));
  }
  fragColor = vec4(mix(c.rgb, uInkColor, edge * uInk.x), c.a);
}

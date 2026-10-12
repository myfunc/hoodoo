#version 300 es
precision highp float;
// The game renderer's bloom (game-renderer.ts), one program for both directions.
// Down (uUp = 0): the 13-tap filter of Jimenez's "Next generation post processing in Call
// of Duty", the first level with a soft threshold and Karis' average, so a lone bright
// pixel cannot pulse. Up (uUp = 1): this level plus a 3x3 tent of the smaller one.
uniform sampler2D uSrc;
uniform sampler2D uSame;
uniform vec2 uTexel;
uniform int uUp;
uniform int uFirst;
// Threshold and knee (on the brightest channel), and how much of the smaller level an up step adds.
uniform vec3 uBloom;
in vec2 vUv;
out vec4 fragColor;

vec3 tap(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }

float maxOf(vec3 c) { return max(c.r, max(c.g, c.b)); }

// Groups of four averaged; on the first level each group counts by 1 / (1 + brightness).
vec3 group(vec3 a, vec3 b, vec3 c, vec3 d, float share, inout float wSum) {
  vec3 m = (a + b + c + d) * 0.25;
  float w = share * (uFirst == 1 ? 1.0 / (1.0 + maxOf(m)) : 1.0);
  wSum += w;
  return m * w;
}

vec3 threshold(vec3 c) {
  float br = maxOf(c);
  float knee = max(uBloom.y, 1e-4);
  float soft = clamp(br - uBloom.x + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  return c * max(soft, br - uBloom.x) / max(br, 1e-4);
}

void main() {
  if (uUp == 1) {
    vec3 s = tap(vec2(-1, -1)) + tap(vec2(1, -1)) + tap(vec2(-1, 1)) + tap(vec2(1, 1))
      + 2.0 * (tap(vec2(0, -1)) + tap(vec2(-1, 0)) + tap(vec2(1, 0)) + tap(vec2(0, 1))) + 4.0 * tap(vec2(0));
    fragColor = vec4(texture(uSame, vUv).rgb + s / 16.0 * uBloom.z, 1.0);
    return;
  }
  vec3 a = tap(vec2(-2, -2));
  vec3 b = tap(vec2(0, -2));
  vec3 c = tap(vec2(2, -2));
  vec3 d = tap(vec2(-1, -1));
  vec3 e = tap(vec2(1, -1));
  vec3 f = tap(vec2(-2, 0));
  vec3 g = tap(vec2(0));
  vec3 h = tap(vec2(2, 0));
  vec3 i = tap(vec2(-1, 1));
  vec3 j = tap(vec2(1, 1));
  vec3 k = tap(vec2(-2, 2));
  vec3 l = tap(vec2(0, 2));
  vec3 m = tap(vec2(2, 2));
  float wSum = 0.0;
  vec3 s = group(d, e, i, j, 0.5, wSum) + group(a, b, f, g, 0.125, wSum) + group(b, c, g, h, 0.125, wSum)
    + group(f, g, k, l, 0.125, wSum) + group(g, h, l, m, 0.125, wSum);
  s /= wSum;
  fragColor = vec4(uFirst == 1 ? threshold(s) : s, 1.0);
}

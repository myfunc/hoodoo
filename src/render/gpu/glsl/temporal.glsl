#version 300 es
precision highp float;
// Detailed live quality, camera still: the new moving frame keeps uKeep of the last one.
// The last frame is first clamped to the colours around the pixel in the new one, so an
// object that moved leaves no trail, while noise (whose neighbours spread wide) averages out.
uniform sampler2D uFresh;
uniform sampler2D uHistory;
uniform vec2 uSize;
uniform float uKeep;
out vec4 fragColor;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uFresh, p, 0);
  vec4 lo = c;
  vec4 hi = c;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec4 s = texelFetch(uFresh, clamp(p + ivec2(dx, dy), ivec2(0), ivec2(uSize) - 1), 0);
      lo = min(lo, s);
      hi = max(hi, s);
    }
  }
  vec4 h = clamp(texelFetch(uHistory, p, 0), lo, hi);
  fragColor = mix(c, h, uKeep);
}

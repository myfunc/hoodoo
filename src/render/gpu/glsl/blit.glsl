#version 300 es
precision highp float;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform vec2 uCurScale;
uniform vec2 uPrevScale;
uniform float uSplit;
uniform int uHasPrev;
uniform int uChecker;
in vec2 vUv;
out vec4 fragColor;

void main() {
  bool done = vUv.y >= 1.0 - uSplit;
  vec4 c = (done || uHasPrev == 0) ? texture(uCur, vUv * uCurScale) : texture(uPrev, vUv * uPrevScale);
  if (!done && uHasPrev == 0) c = vec4(0);
  if (uChecker == 1) {
    vec2 cell = floor(gl_FragCoord.xy / 8.0);
    vec3 bg = mod(cell.x + cell.y, 2.0) < 1.0 ? vec3(0.8) : vec3(0.65);
    c = vec4(mix(bg, c.rgb / max(c.a, 1e-4), c.a), 1.0);
  }
  fragColor = c;
}

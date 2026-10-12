#version 300 es
precision highp float;
// Light shafts (game-renderer.ts), after "Volumetric light scattering as a post-process"
// (GPU Gems 3): every pixel walks toward the sun's place on screen and gathers the bright
// part of the upscaled picture near the sun, fading with each step. Whatever stands in
// front of the bright sky leaves a dark streak. Fixed steps, no dither: nothing crawls.
uniform sampler2D uSrc;
// The sun on screen (0..1, may lie outside) and how squarely the camera faces it, 0..1.
uniform vec2 uSunUv;
uniform float uFacing;
// Decay per step, how far the walk reaches (share of the way to the sun), how tight the glow
// round the sun is, and the brightness under which the sky gives nothing.
uniform vec4 uShaft;
uniform float uAspect;
in vec2 vUv;
out vec4 fragColor;

#define SHAFT_STEPS 32

void main() {
  vec2 delta = (vUv - uSunUv) * uShaft.y / float(SHAFT_STEPS);
  vec2 uv = vUv;
  vec3 sum = vec3(0);
  float fall = 1.0;
  for (int i = 0; i < SHAFT_STEPS; i++) {
    uv -= delta;
    vec2 d = (uv - uSunUv) * vec2(uAspect, 1.0);
    float near = exp(-dot(d, d) * uShaft.z);
    sum += max(texture(uSrc, clamp(uv, 0.0, 1.0)).rgb - uShaft.w, 0.0) * near * fall;
    fall *= uShaft.x;
  }
  fragColor = vec4(sum / float(SHAFT_STEPS) * uFacing, 1.0);
}

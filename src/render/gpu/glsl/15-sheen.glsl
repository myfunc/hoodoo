// Looks that follow the eye and the shape instead of a 3D pattern (TextureKind 15-17):
// an iridescent sheen, a light beam's glow and a rainbow's bands. evalTexture
// (20-textures.glsl) takes the scalar from sheenScalar and the colour from sheenColor;
// the three ramp colours tint the spectrum (white leaves it pure).
#define T_IRIDESCENT 15
#define T_BEAM 16
#define T_RAINBOW 17

// The violet end of a rainbow on the hue wheel (0 red, 1/3 green, 2/3 blue).
#define RAINBOW_HUES 0.78
// Thin films and discs shine in pastel colours.
#define IRIDESCENT_SATURATION 0.45
// A rainbow lets most of the sky through, even in the middle of its band.
#define RAINBOW_OPACITY 0.35

vec3 ramp(float v, vec3 c0, vec3 c1, vec3 c2); // 20-textures.glsl

bool isSheen(int kind) { return kind >= T_IRIDESCENT && kind <= T_RAINBOW; }

vec3 hueWheel(float h) {
  return clamp(abs(fract(h + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

// How squarely the surface faces the camera: 1 head-on, 0 edge-on.
float sheenFacing(vec3 wp, vec3 n) {
  vec3 eye = uOrtho == 1 ? uCamFwd : normalize(wp - uCamPos);
  return abs(dot(n, eye));
}

// Across a rainbow's band about the object's Y axis: 0 at the rim (red), 1 at the
// inner edge (violet); the band is 1 / freq of the radius wide.
float rainbowAcross(float freq, vec3 lp) {
  return (1.0 - length(lp.xz)) * max(freq, 0.01);
}

// Iridescent: the hue turns twice round the Y axis and shifts as the surface tilts
// away from the eye (freq sets how fast), like a compact disc or a soap film.
// Beam: brightest along the middle facing the eye, fading to the silhouette and up
// the object's Y axis. Rainbow: a soft band, a third opaque in its middle.
float sheenScalar(int kind, float freq, vec3 wp, vec3 lp, vec3 n) {
  float face = sheenFacing(wp, n);
  if (kind == T_IRIDESCENT) return fract(atan(lp.z, lp.x) / PI + face * freq);
  if (kind == T_BEAM) return face * face * clamp(0.5 - 0.5 * lp.y, 0.0, 1.0);
  float x = rainbowAcross(freq, lp);
  return x > 0.0 && x < 1.0 ? RAINBOW_OPACITY * sin(PI * x) : 0.0;
}

vec3 sheenColor(int kind, float v, float freq, vec3 lp, vec3 c0, vec3 c1, vec3 c2) {
  if (kind == T_BEAM) return ramp(v, c0, c1, c2);
  float x = kind == T_RAINBOW ? clamp(rainbowAcross(freq, lp), 0.0, 1.0) : v;
  vec3 hue = kind == T_RAINBOW ? hueWheel(x * RAINBOW_HUES) : mix(vec3(1.0), hueWheel(x), IRIDESCENT_SATURATION);
  return hue * ramp(x, c0, c1, c2);
}

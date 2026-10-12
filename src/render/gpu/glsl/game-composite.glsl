#version 300 es
precision highp float;
// The game renderer's last pass (game-renderer.ts): the upscaled HDR picture with its
// bloom and light shafts, through a look (game-looks.ts) onto the canvas. In order: a
// chromatic fringe toward the corners, sharpening, bloom, halation and shafts, exposure
// and a tone curve, an S-curve, saturation, a gradient map, lift / gamma / gain, split
// toning, vignette, scanlines and a fixed dither against banding.
uniform sampler2D uHdr;
uniform sampler2D uBloom;
uniform sampler2D uShafts;
uniform vec2 uOutSize;
// Exposure, tone curve (0 filmic, 1 soft shoulder), contrast, saturation.
uniform vec4 uTone;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
// Bloom colour times strength; halation (a warm glow of the wide bloom); shafts' colour times strength.
uniform vec3 uBloomTint;
uniform vec3 uHalation;
uniform vec3 uShaftTint;
// Chromatic fringe (output pixels at the corners), vignette, soft focus, sharpening.
uniform vec4 uLens;
// Scanlines, gradient map amount, the bloom's total weight (to show it as a blur for soft focus).
uniform vec3 uExtra;
uniform vec3 uMapLo;
uniform vec3 uMapMid;
uniform vec3 uMapHi;
in vec2 vUv;
out vec4 fragColor;

#define DISPLAY_GAMMA 2.2
#define SHOULDER_KNEE 0.75
#define CONTRAST_PIVOT 0.45
#define VIGNETTE_START 0.35

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Narkowicz's fit of the ACES film curve, on light linearised from the tracer's display-like values.
vec3 filmic(vec3 c) {
  vec3 x = pow(max(c, 0.0), vec3(DISPLAY_GAMMA));
  x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return pow(x, vec3(1.0 / DISPLAY_GAMMA));
}

// Leaves the Bryce colours alone up to the knee and rolls brighter light off toward white.
vec3 shoulder(vec3 c) {
  vec3 over = max(c - SHOULDER_KNEE, 0.0);
  float room = 1.0 - SHOULDER_KNEE;
  return min(c, vec3(SHOULDER_KNEE)) + room * (1.0 - exp(-over / room));
}

float sCurve(float x, float k) {
  return x < CONTRAST_PIVOT
    ? CONTRAST_PIVOT * pow(x / CONTRAST_PIVOT, k)
    : 1.0 - (1.0 - CONTRAST_PIVOT) * pow((1.0 - x) / (1.0 - CONTRAST_PIVOT), k);
}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec3 hdrAt(vec2 uv) { return texture(uHdr, uv).rgb; }

void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float aspect = uOutSize.x / uOutSize.y;
  // 0 in the middle, 1 in the corners.
  float r = length(cc * vec2(aspect, 1.0)) / length(vec2(0.5 * aspect, 0.5));
  vec2 fringe = cc * r * r * uLens.x * 2.0 / uOutSize;
  vec3 col = vec3(hdrAt(uv + fringe).r, hdrAt(uv).g, hdrAt(uv - fringe).b);
  if (uLens.w > 0.0) {
    vec2 px = 1.0 / uOutSize;
    vec3 around = 0.25 * (hdrAt(uv + vec2(px.x, 0.0)) + hdrAt(uv - vec2(px.x, 0.0)) + hdrAt(uv + vec2(0.0, px.y)) + hdrAt(uv - vec2(0.0, px.y)));
    col = max(col + (col - around) * uLens.w, 0.0);
  }
  vec3 bloom = texture(uBloom, uv).rgb;
  // Soft focus: toward the bloom seen as a blur of the whole picture (the dream look keeps its threshold near 0).
  col = mix(col, bloom / uExtra.z, uLens.z);
  col += bloom * uBloomTint + bloom * uHalation;
  col += texture(uShafts, uv).rgb * uShaftTint;

  col *= uTone.x;
  col = uTone.y < 0.5 ? filmic(col) : shoulder(col);
  col = vec3(sCurve(col.r, uTone.z), sCurve(col.g, uTone.z), sCurve(col.b, uTone.z));
  float l = luma(col);
  col = max(mix(vec3(l), col, uTone.w), 0.0);
  if (uExtra.y > 0.0) {
    vec3 mapped = l < 0.5 ? mix(uMapLo, uMapMid, l * 2.0) : mix(uMapMid, uMapHi, l * 2.0 - 1.0);
    col = mix(col, mapped, uExtra.y);
  }
  col = pow(max(col * uGain + uLift * (1.0 - col), 0.0), 1.0 / uGamma);
  l = luma(col);
  col += uShadowTint * (1.0 - l) * (1.0 - l) + uHighlightTint * l * l;
  col *= 1.0 - uLens.y * smoothstep(VIGNETTE_START, 1.0, r);
  if (uExtra.x > 0.0) col *= 1.0 - uExtra.x * (0.5 + 0.5 * cos(gl_FragCoord.y * 3.14159265));
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}

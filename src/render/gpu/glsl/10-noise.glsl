// Gradient noise after Inigo Quilez; hash without sine for stable precision.
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float hash11(float x) { return fract(sin(x * 127.1) * 43758.5453); }

float gnoise(vec3 p) { return textureLod(uNoise, p * (1.0 / NOISE_PERIOD), 0.0).r; }

#ifdef GAME_TRACE
// How many octaves a pattern keeps at the current hit (the game variant sets it from the
// ray's footprint, 20-textures.glsl): finer ones would only alias, so they fade out and
// are not sampled. The fractional part fades the last one, so nothing pops.
float gDetail = 8.0;
float octaveKeep(int i) { return clamp(gDetail - float(i), 0.0, 1.0); }
#else
float octaveKeep(int i) { return 1.0; }
#endif

// The mean of one crest octave, (1 - |1.6 g|)^2, over the noise volume (noise-texture.ts).
#define RIDGE_MEAN 0.6

// Fractal sum in roughly -1..1; ridged = true gives sharp crests in 0..1.
float fractal(vec3 p, int octaves, bool ridgedSum) {
  float sum = 0.0;
  float amp = 0.5;
  int n = clamp(octaves, 1, 8);
  for (int i = 0; i < n; i++) {
    // A faded octave tends to its mean: 0 for the plain sum, RIDGE_MEAN for a crest, so the far colour holds.
    float keep = octaveKeep(i);
    if (ridgedSum) {
      if (keep <= 0.0) {
        sum += amp * RIDGE_MEAN * 2.0 * (1.0 - exp2(float(i - n)));
        break;
      }
      float r = 1.0 - abs(gnoise(p) * 1.6);
      sum += amp * mix(RIDGE_MEAN, r * r, keep);
    } else {
      amp *= keep;
      if (amp <= 0.0) break;
      sum += amp * gnoise(p);
    }
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    amp *= 0.5;
  }
  return ridgedSum ? sum : sum * 1.6;
}

float fbm(vec3 p, int octaves) { return fractal(p, octaves, false); }

// Cellular distance: x = nearest, y = second nearest.
vec2 voronoi(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec2 d = vec2(8.0);
  for (int c = 0; c < VORONOI_CELLS + uLoopGuard; c++) {
    vec3 g = vec3(float(c % 3 - 1), float((c / 3) % 3 - 1), float(c / 9 - 1));
    vec3 o = hash33(i + g) * 0.5 + 0.5;
    float dist = length(g + o - f);
    if (dist < d.x) { d.y = d.x; d.x = dist; }
    else if (dist < d.y) { d.y = dist; }
  }
  return d;
}

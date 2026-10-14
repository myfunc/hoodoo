// A meadow (TextureKind 21): grass in two greens with flowers in clumps on the gentle
// ground (Y up), each with petals and a heart. The ramp's first two colours are the
// grass, the third the main flowers; some flowers are pale and some buttercup yellow.
// Detail sets how many flowers grow.
// evalTexture (20-textures.glsl) takes both the colour and the scalar from here.
#define T_FLOWERS 21

// Two layers of flowers, the second smaller and denser (cells per texture unit).
#define FLOWER_LAYERS 2
#define FLOWER_SMALL 1.7
// Clumps: how wide the patches of flowers are (texture units), and their noise.
#define FLOWER_CLUMP 0.22
// A flower's radius in its cell, its heart within that, and how far petals reach in.
#define FLOWER_MIN_R 0.15
#define FLOWER_MAX_R 0.27
#define FLOWER_HEART 0.27
#define FLOWER_NOTCH 0.5
// The share of the main colour, then pale ones; the rest are yellow.
#define FLOWER_MAIN 0.6
#define FLOWER_PALE 0.82
// Once a flower spans less than this many footprints it fades into the meadow's mean.
#define FLOWER_SHARP 3.0
// The share of a cell a flower covers on average (petals included), for the far mean.
#define FLOWER_AREA 0.11

bool isFlowers(int kind) { return kind == T_FLOWERS; }

// How thick flowers grow about x: patches, thinning out between them.
float flowerClump(vec3 x) {
  return smoothstep(-0.15, 0.35, gnoise(x * FLOWER_CLUMP + vec3(5.3, 1.1, 7.9)) + 0.2 * gnoise(x * 0.6));
}

// rgb: the colour, a: the scalar (grass 0..0.5, petals 1, hearts 0.75).
vec4 flowers(vec3 p, vec3 n, float foot, int detail, vec3 c0, vec3 c1, vec3 c2) {
  vec2 q = p.xz;
  // Flowers grow on gentle ground; a steep face is darker grass.
  float level = smoothstep(0.35, 0.75, abs(n.y));
  // Grass: broad swells of light and shade, and a fine grain that fades before it can shimmer.
  float grain = 0.45 * gnoise(p * 0.7) + 0.35 * gnoise(p * 6.3 + 3.7) * (1.0 - smoothstep(0.03, 0.12, foot));
  float g = clamp((0.55 + grain) * mix(0.3, 1.0, level), 0.0, 1.0);
  vec3 grass = mix(c0, c1, g);
  float density = clamp(float(detail) * 0.22, 0.15, 1.0);

  vec3 pale = mix(c2, vec3(1.0), 0.78);
  vec3 yellow = vec3(1.0, 0.84, 0.18);
  // Flowers over the grass, premultiplied: their colour times cover, and the cover.
  vec3 acc = vec3(0.0);
  float cover = 0.0;
  float heartCover = 0.0;
  float near = 1.0;
  for (int layer = 0; layer < FLOWER_LAYERS + uLoopGuard; layer++) {
    float k = layer == 0 ? 1.0 : FLOWER_SMALL;
    vec2 qc = q * k + float(layer) * vec2(0.37, 0.71);
    vec2 cell = floor(qc);
    vec2 f = fract(qc);
    // How many cell units one footprint is: the edge's soft width.
    float aa = foot * k;
    float sharp = 1.0 - smoothstep(FLOWER_MIN_R * 2.0 / FLOWER_SHARP, FLOWER_MAX_R * 2.0 / FLOWER_SHARP, aa);
    for (int c = 0; c < 9 + uLoopGuard; c++) {
      vec2 o = vec2(float(c % 3 - 1), float(c / 3 - 1));
      vec3 h = hash33(vec3(cell + o, float(layer) * 7.0 + 3.0)) * 0.5 + 0.5;
      vec3 h2 = hash33(vec3(cell + o, float(layer) * 7.0 + 11.0)) * 0.5 + 0.5;
      float r = mix(FLOWER_MIN_R, FLOWER_MAX_R, h2.x);
      vec2 at = o + 0.2 + 0.6 * h.xy;
      vec2 d = f - at;
      float rho = length(d) / r;
      if (rho > 1.3) continue;
      // Whether a flower grows is decided at its middle, so none is cut where the clumps thin.
      vec2 mid = (cell + at - float(layer) * vec2(0.37, 0.71)) / k;
      if (h.z > flowerClump(vec3(mid.x, p.y, mid.y)) * density) continue;
      // Petals: five or six lobes around the heart, notched between them.
      float petals = h2.y < 0.5 ? 5.0 : 6.0;
      float a = atan(d.y, d.x) + h2.z * TAU;
      float edge = mix(FLOWER_NOTCH, 1.0, sqrt(abs(cos(a * petals * 0.5))));
      float w = aa / r + 0.04;
      // A soft shadow on the grass around a flower.
      near = min(near, mix(1.0 - 0.28 * sharp * level, 1.0, smoothstep(0.7, 1.3, rho)));
      float petal = (1.0 - smoothstep(edge - w, edge + w, rho)) * sharp * level;
      float heart = (1.0 - smoothstep(FLOWER_HEART - w, FLOWER_HEART + w, rho)) * sharp * level;
      float tint = fract(h2.x * 7.31 + h.z * 3.7);
      vec3 bloom = tint < FLOWER_MAIN ? c2 : (tint < FLOWER_PALE ? pale : yellow);
      // Petals lighter at their tips, a heart that is yellow on the others and orange on the yellow ones.
      bloom *= mix(0.78, 1.08, clamp(rho / edge, 0.0, 1.0));
      vec3 centre = tint < FLOWER_PALE ? vec3(0.98, 0.76, 0.12) : vec3(0.85, 0.42, 0.05);
      acc = mix(bloom, centre, heart) * petal + acc * (1.0 - petal);
      heartCover = heart + heartCover * (1.0 - petal);
      cover = petal + cover * (1.0 - petal);
    }
    // Flowers too small to draw: their mean tint, so a far meadow keeps its colour.
    float mean = flowerClump(p) * density * level * FLOWER_AREA * (1.0 - sharp);
    vec3 avg = mix(c2, mix(pale, yellow, 0.45), 1.0 - FLOWER_MAIN);
    acc = avg * mean + acc * (1.0 - mean);
    cover = mean + cover * (1.0 - mean);
  }
  vec3 col = grass * near * (1.0 - cover) + acc;
  float v = mix(g * 0.5, 1.0, cover) - 0.25 * heartCover;
  return vec4(col, v);
}

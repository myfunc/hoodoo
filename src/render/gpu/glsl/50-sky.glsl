// Bryce-style atmosphere: gradient dome, sun or moon, cumulus/stratus layer, haze and ground fog.
// World distance around which surfaces fade into the sky at the horizon (atmosphere()): past
// any scene, so only the rows just below the horizon reach it (2.7 % at 100, 63 % at 600).
#define FAR_FADE 600.0
// Below this much the far fade is skipped (closer than about FAR_FADE / 20).
#define FAR_FADE_MIN 0.002
// Ground fog: its thinnest layer, and the density of the Fog dial at 100.
#define FOG_MIN_HEIGHT 0.05
#define FOG_DENSITY 0.35
#define SKY_SOFT 0
#define SKY_DARKER 1
#define SKY_CUSTOM 2
#define SKY_OFF 3

int skyMode() { return int(uSkyParams.x + 0.5); }

// The light that shines: the sun by day, the moon (opposite) by night.
vec3 keyLightDir() { return uFogParams.w > 0.5 ? -uSunDir : uSunDir; }

vec3 keyLightColor() {
  float night = uFogParams.w;
  float low = smoothstep(-0.02, 0.25, uSunDir.y);
  vec3 day = uSunColor * mix(0.55, 1.0, low) * mix(vec3(1.0, 0.75, 0.55), vec3(1), low);
  return mix(day, uSunColor * vec3(0.22, 0.26, 0.38), night);
}

float cloudDensity(vec3 rd, out float dist) {
  dist = INF;
#ifdef LAB_NO_CLOUDS
  return 0.0;
#endif
  if (rd.y <= 0.002 || uCloudParams.x <= 0.0) return 0.0;
  float h = uCloudParams.y;
  dist = h / rd.y;
  vec3 p = rd * dist;
  float freq = mix(0.004, 0.04, uCloudParams.z);
  float d = 0.0;
  float cover = uCloudParams.x;
  // Cumulus (k = 0) and stratus (k = 1) share one fractal call site.
  for (int k = 0; k < 2 + uLoopGuard; k++) {
    bool stratus = k == 1;
    if ((stratus ? uCloudKinds.y : uCloudKinds.x) < 0.5) continue;
    vec3 q = stratus ? vec3(p.x * 0.35, 0.0, p.z * 2.5) : vec3(p.x, 0.0, p.z);
#ifdef GAME_TRACE
    // Far clouds lose the octaves a pixel cannot hold (20-textures.glsl).
    gDetail = detailFor(dist * uPixelAngle * freq * (stratus ? 2.5 : 1.0));
#endif
    float n = fbm(q * freq, stratus ? 5 : 6) * 0.5 + 0.5;
    float c = stratus
      ? smoothstep(0.8 - cover * 0.6, 1.05 - cover * 0.5, n) * 0.85
      : smoothstep(0.78 - cover * 0.55, 0.9 - cover * 0.45 + uCloudParams.w * 0.12, n);
    d = max(d, c);
  }
  return d * smoothstep(0.0, 0.12, rd.y);
}

vec3 skyGradient(vec3 rd) {
  int mode = skyMode();
  float y = max(rd.y, 0.0);
  if (mode == SKY_OFF) return uSkyColor;
  vec3 zenith = uSkyColor;
  vec3 col;
  if (mode == SKY_DARKER) col = mix(uHorizonColor, zenith * 0.65, pow(y, 0.35));
  else if (mode == SKY_CUSTOM) col = mix(uHorizonColor, zenith, y);
  else col = mix(uHorizonColor, zenith, pow(y, 0.55));
  if (rd.y < 0.0) col = mix(uHorizonColor, uHorizonColor * 0.55, min(1.0, -rd.y * 3.0));
  return col;
}

vec3 sunGlow(vec3 rd) {
  if (uFogParams.z < 0.5 || skyMode() == SKY_OFF) return vec3(0);
  vec3 dir = keyLightDir();
  float c = max(dot(rd, dir), 0.0);
  float night = uFogParams.w;
  vec3 lc = keyLightColor();
  float disc = smoothstep(0.99985, 0.99993, c);
  float halo = pow(c, 350.0) * 0.6 + pow(c, 12.0) * 0.18 * (1.0 - night);
  return lc * (disc * (night > 0.5 ? 1.2 : 3.0) + halo);
}

vec3 starField(vec3 rd) {
  if (uSkyParams.w < 0.5 || rd.y <= 0.0) return vec3(0);
  vec3 p = rd * 220.0;
  vec3 cell = floor(p);
  float h = hash13(cell);
  vec3 centre = cell + 0.5 + (hash33(cell) * 0.3);
  float d = length(p - centre);
  float star = step(0.9965, h) * smoothstep(0.32, 0.05, d) * smoothstep(0.0, 0.2, rd.y);
  return vec3(star * (0.6 + 0.6 * hash13(cell + 7.0)));
}

// Sky seen along a ray that escapes the scene.
vec3 skyColor(vec3 rd) {
  vec3 col = skyGradient(rd);
  col += starField(rd) * (1.0 - smoothstep(0.0, 0.3, uSunDir.y + 0.1));
  if (skyMode() != SKY_OFF) {
    float cdist;
    float d = cloudDensity(rd, cdist);
    if (d > 0.0) {
      vec3 ld = keyLightDir();
      float lit = 0.55 + 0.45 * max(dot(rd, ld), 0.0);
      vec3 shade = mix(uCloudColor, uCloudColor * mix(uAmbientColor, vec3(1), 0.4), d);
      vec3 cloud = shade * lit * mix(vec3(1), keyLightColor(), 0.35) + uAmbientColor * 0.08;
      float fade = exp(-cdist * 0.0012);
      col = mix(col, cloud, d * mix(0.35, 1.0, fade));
    }
    col += sunGlow(rd);
    float haze = uSkyParams.z * (1.0 - smoothstep(0.0, 0.35, abs(rd.y)));
    col = mix(col, uHazeColor, haze * 0.85);
  }
  return col;
}

// How much of the ground fog a ray from ro crosses on its way out of the scene: the whole
// layer is crossed at and below the horizon, so the sky meets fogged ground in the fog's colour.
float skyFog(vec3 ro, vec3 rd) {
  if (uFogParams.x <= 0.0 || skyMode() == SKY_OFF) return 0.0;
  float k = 1.0 / max(uFogParams.y, FOG_MIN_HEIGHT);
  float dy = rd.y * k;
  if (dy <= 1e-4) return 1.0;
  return 1.0 - exp(-exp(-ro.y * k) / dy * uFogParams.x * FOG_DENSITY);
}

// The sky drawn just above the horizon in rd's direction (skyColor and skyFog): the horizon
// colour, the sun's glow and the haze band, or the fog wherever there is any.
vec3 horizonSky(vec3 rd) {
  if (uFogParams.x > 0.0) return uFogColor;
  vec3 level = vec3(rd.x, 0.0, rd.z);
  float len = length(level);
  vec3 col = uHorizonColor + (len > 1e-6 ? sunGlow(level / len) : vec3(0));
  return mix(col, uHazeColor, uSkyParams.z * 0.85);
}

// Aerial perspective for a surface at distance t along rd from ro: returns the veil colour, alpha = amount.
// Past about FAR_FADE every surface also fades into horizonSky(), so an endless ground or sea meets
// the sky without a seam whatever the haze and fog (both alone stop short of the last rows).
vec4 atmosphere(vec3 ro, vec3 rd, float t) {
  if (skyMode() == SKY_OFF) return vec4(0);
  float far = t / FAR_FADE;
  far = 1.0 - exp(-far * far);
  float haze = 1.0 - exp(-t * uSkyParams.z * uSkyParams.z * 0.012);
  float fogAmt = 0.0;
  if (uFogParams.x > 0.0) {
    float k = 1.0 / max(uFogParams.y, FOG_MIN_HEIGHT);
    float dy = rd.y * k;
    float optical = abs(dy) < 1e-4 ? t * exp(-ro.y * k) : exp(-ro.y * k) * (1.0 - exp(-t * dy)) / dy;
    fogAmt = 1.0 - exp(-max(optical, 0.0) * uFogParams.x * FOG_DENSITY);
  }
  // Fog over the haze, as on the sky (skyColor, then skyFog): far fogged ground meets it in the fog's colour.
  float a = clamp(1.0 - (1.0 - haze) * (1.0 - fogAmt), 0.0, 1.0);
  vec3 veil = (uHazeColor * haze * (1.0 - fogAmt) + uFogColor * fogAmt) / max(a, 1e-4);
  if (far < FAR_FADE_MIN) return vec4(veil, a);
  // Haze and fog first, then the far fade over them: one veil of the combined amount.
  float total = 1.0 - (1.0 - a) * (1.0 - far);
  return vec4((veil * a * (1.0 - far) + horizonSky(rd) * far) / total, total);
}

#ifdef GAME_TRACE
// The sky a glass surface mirrors when the game variant follows the ray through it: the
// gradient and the sun, without clouds or haze (no second cloud evaluation to compile).
vec3 skyGlint(vec3 rd) {
  return skyGradient(rd) + sunGlow(rd);
}
#endif

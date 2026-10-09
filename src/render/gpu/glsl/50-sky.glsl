// Bryce-style atmosphere: gradient dome, sun or moon, cumulus/stratus layer, haze and ground fog.
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

// Aerial perspective for a surface at distance t along rd from ro: returns the veil colour, alpha = amount.
vec4 atmosphere(vec3 ro, vec3 rd, float t) {
  if (skyMode() == SKY_OFF) return vec4(0);
  float haze = 1.0 - exp(-t * uSkyParams.z * uSkyParams.z * 0.012);
  float fogAmt = 0.0;
  if (uFogParams.x > 0.0) {
    float H = max(uFogParams.y, 0.05);
    float k = 1.0 / H;
    float dy = rd.y * k;
    float optical = abs(dy) < 1e-4 ? t * exp(-ro.y * k) : exp(-ro.y * k) * (1.0 - exp(-t * dy)) / dy;
    fogAmt = 1.0 - exp(-max(optical, 0.0) * uFogParams.x * 0.35);
  }
  vec3 veil = mix(uHazeColor, uFogColor, fogAmt / max(fogAmt + haze, 1e-4));
  float a = clamp(1.0 - (1.0 - haze) * (1.0 - fogAmt), 0.0, 1.0);
  return vec4(veil, a);
}

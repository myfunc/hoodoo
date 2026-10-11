// Ray generation and the path loop: one stochastic branch (mirror or glass) per bounce,
// averaged over samples by the progressive accumulator.
//
// FAST_PREVIEW builds the interaction variant the live view draws while things move:
// primary rays with their lights and hard shadows, then one mirror or glass ray whose
// hit is lit without shadow rays, then the sky. It takes the heavier of the two
// branches every time, so the picture has no noise. Without the deeper bounces and
// the shadows in reflections a frame costs about a fifth less; dropping the
// reflection too would halve it, but water without its reflections no longer looks
// like the finished picture.
//
// Path rays and shadow rays share one loop and one traceScene / evalMaterial call
// site. A hit on the path queues its lights; the following iterations trace their
// shadow rays (through transparent occluders) before the path continues. Nesting
// the shadow loop inside the light and bounce loops instead made FXC (Chrome and
// Edge on Windows) spend 36 s compiling this shader.
vec4 radiance(vec3 ro, vec3 rd) {
  vec3 col = vec3(0);
  vec3 thr = vec3(1);
#if defined(FAST_PREVIEW)
  // The second bounce only looks up the sky.
  const int maxBounces = 2;
#elif defined(LAB_ONE_BOUNCE)
  int maxBounces = 0;
#else
  int maxBounces = uMaxBounces;
#endif
  int bounce = 0;
  bool pathDone = false;
  // The shaded point whose lights are still to be traced.
  Mat sm;
  vec3 sp = vec3(0);
  vec3 sn = vec3(0, 1, 0);
  vec3 sv = vec3(0, 1, 0);
  vec3 sw = vec3(0);
  int nextLight = uLightCount;
  // The shadow ray in flight.
  bool shadow = false;
  vec3 shOrigin = vec3(0);
  vec3 shDir = vec3(0, 1, 0);
  float shLeft = 0.0;
  vec3 shT = vec3(1);
  vec3 shC = vec3(0);
  int shDepth = 0;
#ifdef FAST_PREVIEW
  int steps = (maxBounces + 1) * (1 + (uLightCount + 1) * SHADOW_DEPTH) + 1;
#else
  int steps = (uMaxBounces + 1) * (1 + (uLightCount + 1) * SHADOW_DEPTH) + 1;
#endif
  // Passes through portals (70-portals.glsl) are not bounces: they get steps of their own.
  int portals = 0;
  steps += PORTAL_DEPTH;
  for (int step = 0; step < steps + uLoopGuard; step++) {
    if (!shadow) {
      for (; nextLight < uLightCount; nextLight++) {
        vec3 l;
        float dist;
        vec3 lc = lightAt(nextLight, sp, l, dist);
        if (dot(sn, l) <= 0.0 || maxOf(lc) < 0.002) continue;
        vec3 c = sw * lightTerm(sm, sn, sv, l, lc);
        if (maxOf(c) <= 0.0) continue;
#ifdef LAB_NO_SHADOW
        col += c;
        continue;
#endif
#ifdef FAST_PREVIEW
        // A point seen in a mirror or through glass is lit without testing its shadow.
        if (uSkyParams.y <= 0.0 || bounce > 1) {
#else
        if (uSkyParams.y <= 0.0) {
#endif
          col += c;
          continue;
        }
        shadow = true;
        shOrigin = sp;
        shDir = l;
        shLeft = dist;
        shT = vec3(1);
        shC = c;
        shDepth = 0;
        nextLight++;
        break;
      }
      if (!shadow && pathDone) break;
    }
    vec3 o = shadow ? shOrigin : ro;
    vec3 d = shadow ? shDir : rd;
    Hit h;
#ifdef FAST_PREVIEW
    bool hit = (shadow || bounce < 2) && traceScene(o, d, shadow ? shLeft : INF, h, shadow);
#else
    bool hit = traceScene(o, d, shadow ? shLeft : INF, h, shadow);
#endif
    Obj ob;
    bool shaded = false;
    if (hit) {
      ob = loadObj(h.obj);
      shaded = !shadow || ((ob.flags & F_NO_SHADOW) == 0 && (ob.flags & F_OPAQUE) == 0);
    }
    vec3 wp = o + d * h.t;
    bool entering = dot(h.n, d) < 0.0;
    vec3 n = entering ? h.n : -h.n;
    vec3 ng = n;
    Mat mt;
    if (shaded) {
      Surface sf = surfaceAt(h.obj, wp, n);
      mt = evalMaterial(h.obj, sf, n, !shadow);
    }

    if (shadow) {
      bool escaped = !hit;
      if (hit && (ob.flags & F_NO_SHADOW) == 0) {
        shT *= shaded ? mt.transparency * mt.transColor : vec3(0);
        if (maxOf(shT) < 0.02) {
          shT = vec3(0);
          escaped = true;
        }
      }
      shDepth++;
      if (escaped || shDepth >= SHADOW_DEPTH) {
        col += shC * mix(vec3(1), shT, uSkyParams.y);
        shadow = false;
      } else {
        shOrigin = wp + d * 2e-3;
        shLeft -= h.t + 2e-3;
      }
      continue;
    }

    if (!hit) {
      if (bounce == 0 && uTransparentBg == 1) return vec4(0);
      col += thr * skyColor(rd);
      break;
    }
    vec4 atm = atmosphere(ro, rd, h.t);
    if (ob.kind == K_PORTAL && portalPass(h.obj, wp, atm, mt.diffuse, ro, rd, thr, col, portals, pathDone)) continue;
    float surfW = (1.0 - mt.transparency) * (1.0 - mt.reflection);
    col += thr * atm.a * atm.rgb;
    if (surfW > 0.002) {
      sw = thr * (1.0 - atm.a) * surfW;
      col += sw * ambientTerm(mt);
      sm = mt;
      sp = wp + n * 2e-3;
      sn = n;
      sv = -rd;
      nextLight = -1;
    }
    thr *= 1.0 - atm.a;
    bounce++;
    float wR = (1.0 - mt.transparency) * mt.reflection;
    float wT = mt.transparency;
    if (bounce > maxBounces || wR + wT < 0.003) {
      pathDone = true;
      continue;
    }
#ifdef FAST_PREVIEW
    bool mirror = wR >= wT;
    float wPick = wR + wT;
#else
    float pR = wR / (wR + wT);
    bool mirror = rand() < pR;
    float wPick = mirror ? wR / pR : wT / (1.0 - pR);
#endif
    if (mirror) {
      thr *= mix(vec3(1), mt.diffuse, mt.metal) * wPick;
      rd = reflect(rd, n);
      // A bumped normal must not send the mirror ray back through the surface.
      float below = dot(rd, ng);
      if (below < 0.0) rd = normalize(rd - 2.0 * below * ng);
      ro = wp + ng * 2e-3;
    } else {
      thr *= mt.transColor * wPick;
      if (isThin(ob.kind) || abs(mt.ior - 1.0) < 0.005) {
        ro = wp + rd * 2e-3;
      } else {
        float eta = entering ? 1.0 / mt.ior : mt.ior;
        vec3 r = refract(rd, n, eta);
        if (dot(r, r) < 1e-6) {
          rd = reflect(rd, n);
          ro = wp + n * 2e-3;
        } else {
          rd = r;
          ro = wp - n * 2e-3;
        }
      }
    }
    if (maxOf(thr) < 0.01) pathDone = true;
  }
  return vec4(col, 1.0);
}

void main() {
  vec2 pix = uOffset + (gl_FragCoord.xy - 0.5) * uBlock + uJitter * uBlock;
  seedRng(pix, uSample);
  vec2 ndc = pix / uResolution * 2.0 - 1.0;
  vec3 ro;
  vec3 rd;
  if (uOrtho == 1) {
    ro = uCamPos + uCamRight * ndc.x * uHalfH * uAspect + uCamUp * ndc.y * uHalfH;
    rd = uCamFwd;
  } else {
    ro = uCamPos;
    rd = normalize(uCamFwd + uCamRight * ndc.x * uHalfH * uAspect + uCamUp * ndc.y * uHalfH);
    // Thin lens: start on the aperture disc and aim at the same point of the focal plane.
#ifndef FAST_PREVIEW
    if (uLens.x > 0.0) {
      vec3 focal = ro + rd * (uLens.y / dot(rd, uCamFwd));
      float r = uLens.x * sqrt(rand());
      float a = TAU * rand();
      ro += (uCamRight * cos(a) + uCamUp * sin(a)) * r;
      rd = normalize(focal - ro);
    }
#endif
  }
  vec4 c = radiance(ro, rd);
  // Soft shadows also roll highlights off above the knee instead of clipping them flat.
  if (uStyle.z > 0.0) {
    float knee = 1.0 - uStyle.z;
    vec3 over = max(c.rgb - knee, 0.0);
    c.rgb = min(c.rgb, vec3(knee)) + uStyle.z * (1.0 - exp(-over / uStyle.z));
  }
  fragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}

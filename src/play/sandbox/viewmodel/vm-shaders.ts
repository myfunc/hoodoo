/**
 * The shaders of the gun in the hands. `SKIN_*` is Source's VertexLitGeneric
 * with Phong as the weapons use it: base texture (its alpha masks self-illum),
 * normal map (its alpha masks the Phong highlight), a mod2x detail texture,
 * half-Lambert diffuse from an ambient cube and up to two lights, Phong with
 * Source's three-point Fresnel ranges, optional rim light, and self-illum tinted
 * by the weapon colour. Vertices are skinned to three bones whose 3×4 matrices
 * come from a float texture (three texels per bone). `SPRITE_*` draws Source's
 * additive sprites and beams: a texture times a vertex colour.
 */

export const MAX_LIGHTS = 2;

export const SKIN_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
in vec3 aPos;
in vec3 aNormal;
in vec4 aTangent;
in vec2 aUv;
in vec3 aBones;
in vec3 aWeights;
uniform sampler2D uBones;
uniform mat4 uModelView;
uniform mat4 uProj;
out vec3 vPos;
out vec3 vNormal;
out vec3 vTangent;
out vec3 vBitangent;
out vec2 vUv;

mat4 boneMatrix(float b) {
  int x = int(b) * 3;
  vec4 r0 = texelFetch(uBones, ivec2(x, 0), 0);
  vec4 r1 = texelFetch(uBones, ivec2(x + 1, 0), 0);
  vec4 r2 = texelFetch(uBones, ivec2(x + 2, 0), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}

void main() {
  mat4 skin = boneMatrix(aBones.x) * aWeights.x + boneMatrix(aBones.y) * aWeights.y + boneMatrix(aBones.z) * aWeights.z;
  vec4 view = uModelView * skin * vec4(aPos, 1.0);
  mat3 turn = mat3(uModelView) * mat3(skin);
  vPos = view.xyz;
  vNormal = turn * aNormal;
  vTangent = turn * aTangent.xyz;
  vBitangent = cross(vNormal, vTangent) * (aTangent.w < 0.0 ? -1.0 : 1.0);
  vUv = aUv;
  gl_Position = uProj * view;
}`;

export const SKIN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNormal;
in vec3 vTangent;
in vec3 vBitangent;
in vec2 vUv;
uniform sampler2D uBase;
uniform sampler2D uBump;
uniform sampler2D uDetail;
uniform bool uHasBump;
uniform bool uHasTangents;
uniform bool uHasDetail;
uniform float uDetailScale;
uniform float uDetailBlend;
uniform vec3 uColor;
uniform float uAlpha;
uniform bool uTranslucent;
uniform float uAlphaTest;
uniform bool uUnlit;
uniform bool uSelfIllum;
uniform vec3 uSelfIllumTint;
uniform bool uPhong;
uniform float uPhongExponent;
uniform float uPhongBoost;
uniform vec3 uPhongTint;
uniform vec3 uFresnel;
uniform bool uBaseAlphaPhongMask;
uniform bool uRim;
uniform float uRimExponent;
uniform float uRimBoost;
uniform bool uHalfLambert;
uniform mat3 uViewToWorld;
uniform vec3 uAmbient[6];
uniform vec3 uLightDir[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
out vec4 outColor;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toGamma(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

// Source's ambient cube: six colours blended by the squared normal.
vec3 ambient(vec3 n) {
  vec3 s = n * n;
  return s.x * (n.x >= 0.0 ? uAmbient[0] : uAmbient[1])
       + s.y * (n.y >= 0.0 ? uAmbient[2] : uAmbient[3])
       + s.z * (n.z >= 0.0 ? uAmbient[4] : uAmbient[5]);
}

// Source's Fresnel ranges: (1 - N.V)^2 mapped through three points.
float fresnel(float ndv, vec3 r) {
  float f = 1.0 - clamp(ndv, 0.0, 1.0);
  f *= f;
  return f > 0.5 ? mix(r.y, r.z, 2.0 * f - 1.0) : mix(r.x, r.y, 2.0 * f);
}

void main() {
  vec4 base = texture(uBase, vUv);
  if (base.a < uAlphaTest) discard;
  vec3 albedo = toLinear(base.rgb) * uColor;
  if (uHasDetail) {
    vec3 d = texture(uDetail, vUv * uDetailScale).rgb;
    albedo *= mix(vec3(1.0), d * 2.0, uDetailBlend);
  }
  vec3 n = normalize(vNormal);
  float mask = uBaseAlphaPhongMask ? base.a : 1.0;
  if (uHasBump) {
    vec4 b = texture(uBump, vUv);
    if (uHasTangents) {
      vec3 t = b.xyz * 2.0 - 1.0;
      n = normalize(normalize(vTangent) * t.x + normalize(vBitangent) * t.y + n * t.z);
    }
    if (!uBaseAlphaPhongMask) mask = b.a;
  }
  vec3 nw = normalize(uViewToWorld * n);
  vec3 vw = normalize(uViewToWorld * normalize(-vPos));
  vec3 diffuse = ambient(nw);
  vec3 spec = vec3(0.0);
  vec3 r = reflect(-vw, nw);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    float ndl = dot(nw, uLightDir[i]);
    float lit = uHalfLambert ? pow(ndl * 0.5 + 0.5, 2.0) : max(ndl, 0.0);
    diffuse += uLightColor[i] * lit;
    if (uPhong) spec += uLightColor[i] * pow(max(dot(r, uLightDir[i]), 0.0), uPhongExponent) * max(ndl, 0.0);
  }
  float ndv = dot(nw, vw);
  vec3 color = albedo * diffuse;
  if (uPhong) color += spec * mask * fresnel(ndv, uFresnel) * uPhongBoost * uPhongTint;
  if (uRim) color += pow(1.0 - clamp(ndv, 0.0, 1.0), uRimExponent) * uRimBoost * ambient(vw) * mask;
  // Source tints self-illum in the texture's own (gamma) space, so a tint of 2 doubles what you see.
  if (uSelfIllum) color = mix(color, toLinear(min(base.rgb * uColor * uSelfIllumTint, 1.0)), base.a);
  if (uUnlit) color = albedo;
  float alpha = uTranslucent ? base.a * uAlpha : uAlpha;
  outColor = vec4(toGamma(color) * alpha, alpha);
}`;

export const SPRITE_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
in vec2 aUv;
in vec4 aColor;
uniform mat4 uProj;
out vec2 vUv;
out vec4 vColor;
void main() {
  vUv = aUv;
  vColor = aColor;
  gl_Position = uProj * vec4(aPos, 1.0);
}`;

/** Additive as Source's $additive blends (SRC_ALPHA, ONE): the texture's colour times its alpha (1 without one) and the vertex colour and alpha. */
export const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vColor;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUv);
  outColor = vec4(t.rgb * t.a * vColor.rgb * vColor.a, 0.0);
}`;

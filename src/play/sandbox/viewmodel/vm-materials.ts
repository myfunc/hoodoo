import { decodeVtf } from '../../../io/source/vtf';
import { loadMaterial, paramBool, paramNumber, paramVector, texturePath } from '../../../io/source/material';
import type { SourceFiles, SourceMaterial, SourceTextureSlot } from '../../../io/source/source.types';
import { ToolScreen } from './tool-screen';
import type { VmGpu, VmMaterial } from './vm-gpu';

/**
 * Source materials (.vmt) as the hands' shader wants them: textures on the GPU
 * and the VertexLitGeneric parameters with Source's defaults. A self-illum
 * tint written by the PlayerWeaponColor proxy follows the weapon colour, as
 * the Physics Gun's glowing parts do in Garry's Mod.
 */

const DEFAULTS = {
  alphaTestReference: 0.5,
  phongExponent: 5,
  phongBoost: 1,
  fresnel: [0, 0.5, 1] as const,
  rimExponent: 4,
  rimBoost: 1,
  detailScale: 4,
  detailBlend: 1,
} as const;
const WHITE: readonly [number, number, number] = [1, 1, 1];
const LIT_SHADERS = ['vertexlitgeneric', 'unlitgeneric', 'lightmappedgeneric', 'unlittwotexture'];
const WEAPON_COLOR_PROXY = 'playerweaponcolor';
/** The Tool Gun's screen: cl_viewscreen.lua draws it (tool-screen.ts). */
const TOOL_SCREEN = /v_toolgun\/screen\.vmt$/i;
const SELF_ILLUM_TINT = '$selfillumtint';

export class VmMaterials {
  private readonly textures = new Map<string, Promise<WebGLTexture | null>>();
  /** The Tool Gun's screen, once its material is loaded. */
  screen: ToolScreen | null = null;

  constructor(private readonly gpu: VmGpu, private readonly files: SourceFiles) {}

  /** The first candidate of a model's material slot that exists, or null when none does. */
  async slot(s: SourceTextureSlot): Promise<VmMaterial | null> {
    const path = s.candidates.find((c) => this.files.has(c));
    if (!path) return null;
    const source = await loadMaterial(this.files, path);
    const m = await this.load(source);
    if (!m || !TOOL_SCREEN.test(path)) return m;
    const bg = source.params.get('$basetexture');
    const bytes = bg ? await this.files.read(texturePath(bg)) : null;
    this.screen ??= new ToolScreen(this.gpu, bytes ? decodeVtf(bytes) : null);
    return { ...m, base: this.screen.texture };
  }

  /** A texture by its material name ("sprites/physbeam_white"), cached. */
  texture(name: string, srgb = true): Promise<WebGLTexture | null> {
    const path = texturePath(name);
    const key = `${path}|${srgb}`;
    let t = this.textures.get(key);
    if (!t) {
      t = this.files.read(path).then((bytes) => (bytes ? this.gpu.texture(decodeVtf(bytes), srgb) : null));
      this.textures.set(key, t);
    }
    return t;
  }

  /** The base texture of a sprite or effect material (sprites/physbeama.vmt → its $basetexture). */
  async spriteTexture(materialPath: string): Promise<WebGLTexture | null> {
    if (!this.files.has(materialPath)) return null;
    const m = await loadMaterial(this.files, materialPath);
    const base = m.params.get('$basetexture');
    return base ? this.texture(base) : null;
  }

  private async load(m: SourceMaterial): Promise<VmMaterial | null> {
    if (!LIT_SHADERS.some((s) => m.shader.includes(s)) || paramBool(m, '$no_draw')) return null;
    const name = (key: string) => m.params.get(key) ?? null;
    const base = name('$basetexture');
    const bump = name('$bumpmap');
    const detail = name('$detail');
    const [baseTex, bumpTex, detailTex] = await Promise.all([
      base ? this.texture(base) : null,
      bump ? this.texture(bump, false) : null,
      detail ? this.texture(detail) : null,
    ]);
    const weaponTint = m.proxies.some((p) => p.key.toLowerCase() === WEAPON_COLOR_PROXY && p.children.some((c) => c.value?.toLowerCase() === SELF_ILLUM_TINT));
    const phong = paramBool(m, '$phong');
    const unlit = m.shader.includes('unlit');
    return {
      base: baseTex ?? this.gpu.white,
      bump: unlit ? null : bumpTex,
      detail: detailTex,
      detailScale: paramNumber(m, '$detailscale', DEFAULTS.detailScale),
      detailBlend: paramNumber(m, '$detailblendfactor', DEFAULTS.detailBlend),
      color: m.params.has('$color2') ? paramVector(m, '$color2', WHITE) : paramVector(m, '$color', WHITE),
      alpha: paramNumber(m, '$alpha', 1),
      translucent: paramBool(m, '$translucent'),
      additive: paramBool(m, '$additive'),
      alphaTest: paramBool(m, '$alphatest') ? paramNumber(m, '$alphatestreference', DEFAULTS.alphaTestReference) : 0,
      noCull: paramBool(m, '$nocull'),
      unlit,
      selfIllum: paramBool(m, '$selfillum'),
      selfIllumTint: weaponTint ? null : paramVector(m, SELF_ILLUM_TINT, WHITE),
      phong,
      phongExponent: paramNumber(m, '$phongexponent', DEFAULTS.phongExponent),
      phongBoost: paramNumber(m, '$phongboost', DEFAULTS.phongBoost),
      phongTint: paramVector(m, '$phongtint', WHITE),
      fresnel: paramVector(m, '$phongfresnelranges', DEFAULTS.fresnel),
      baseAlphaPhongMask: paramBool(m, '$basemapalphaphongmask'),
      rim: paramBool(m, '$rimlight'),
      rimExponent: paramNumber(m, '$rimlightexponent', DEFAULTS.rimExponent),
      rimBoost: paramNumber(m, '$rimlightboost', DEFAULTS.rimBoost),
      halfLambert: phong || paramBool(m, '$halflambert'),
      hidden: false,
    };
  }
}

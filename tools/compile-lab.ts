// Dev tool: how long does each variant of the trace shader take to compile here?
// Every variant gets a nonce so no driver cache is reused. Results land in window.__lab.
import header from '../src/render/gpu/glsl/00-header.glsl?raw';
import noise from '../src/render/gpu/glsl/10-noise.glsl?raw';
import textures from '../src/render/gpu/glsl/20-textures.glsl?raw';
import shapes from '../src/render/gpu/glsl/30-shapes.glsl?raw';
import terrain from '../src/render/gpu/glsl/35-terrain.glsl?raw';
import scene from '../src/render/gpu/glsl/40-scene.glsl?raw';
import sky from '../src/render/gpu/glsl/50-sky.glsl?raw';
import shade from '../src/render/gpu/glsl/60-shade.glsl?raw';
import main from '../src/render/gpu/glsl/90-main.glsl?raw';
import vert from '../src/render/gpu/glsl/fullscreen.vert.glsl?raw';

const SOURCE = [header, noise, textures, shapes, terrain, scene, sky, shade, main].join('\n');
/** The pre-2026-10-09 source sampled with implicit derivatives; FXC (Windows) chokes on those inside loops. */
const GRADIENT_SOURCE = SOURCE.replace(/textureLod\(([^;]*), 0\.0\)/g, 'texture($1)');
const VARIANTS: Record<string, string[]> = {
  full: [],
  gradients: ['GRADIENTS'],
  noTerrain: ['LAB_NO_TERRAIN'],
  noSdf: ['LAB_NO_SDF'],
  noBool: ['LAB_NO_BOOL'],
  noTex: ['LAB_NO_TEX'],
  noShadow: ['LAB_NO_SHADOW'],
  noClouds: ['LAB_NO_CLOUDS'],
  oneBounce: ['LAB_ONE_BOUNCE'],
  preview: ['LAB_NO_TEX', 'LAB_NO_CLOUDS', 'LAB_NO_SDF', 'LAB_ONE_BOUNCE'],
  minimal: ['LAB_NO_TERRAIN', 'LAB_NO_SDF', 'LAB_NO_BOOL', 'LAB_NO_TEX', 'LAB_NO_SHADOW', 'LAB_NO_CLOUDS', 'LAB_ONE_BOUNCE'],
};

const COMPLETION_STATUS_KHR = 0x91b1;
const POLL_MS = 20;

/** `?async`: compile through KHR_parallel_shader_compile and poll, as the app does. */
async function compile(defines: string[], parallel: boolean): Promise<number> {
  const gl = document.createElement('canvas').getContext('webgl2')!;
  const base = defines.includes('GRADIENTS') ? GRADIENT_SOURCE : SOURCE;
  const src = base.replace('precision highp float;', `precision highp float;\n${defines.map((d) => `#define ${d}`).join('\n')}\nconst float NONCE = ${Math.random()};`);
  const t0 = performance.now();
  const mk = (type: number, s: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, s);
    gl.compileShader(sh);
    if (!parallel && !gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'compile');
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vert));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, src));
  gl.linkProgram(p);
  if (parallel && gl.getExtension('KHR_parallel_shader_compile')) {
    while (!gl.getProgramParameter(p, COMPLETION_STATUS_KHR)) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  gl.useProgram(p);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.finish();
  const ms = performance.now() - t0;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return Math.round(ms);
}

const params = new URLSearchParams(location.search);
const wanted = params.get('only')?.split(',') ?? Object.keys(VARIANTS);
/** `?report=<url>` posts each result as it lands (for browsers driven without a debugger). */
const report = params.get('report');
const out: Record<string, number> = {};
if (params.has('concurrent')) {
  // All variants start together (each in its own context); each reports when it lands.
  const t0 = performance.now();
  await Promise.all(wanted.map(async (name) => {
    await compile(VARIANTS[name], true);
    out[name] = Math.round(performance.now() - t0);
    if (report) await fetch(report, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ [name]: out[name], concurrent: true }) });
  }));
  wanted.length = 0;
}
for (const name of wanted) {
  out[name] = await compile(VARIANTS[name], params.has('async'));
  (document.getElementById('out') as HTMLElement).textContent = JSON.stringify(out, null, 1);
  if (report) await fetch(report, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ [name]: out[name], ua: navigator.userAgent }) });
  await new Promise((r) => setTimeout(r, 50));
}
(window as unknown as { __lab: unknown }).__lab = out;

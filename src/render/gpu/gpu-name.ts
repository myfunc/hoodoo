/** Words of a WebGL renderer string that say nothing about which GPU it is. */
const NOISE = [
  /ANGLE Metal Renderer:\s*/g,
  /\s*\(0x[0-9a-f]+\)/gi,
  /\s*Direct3D\S*(\s+[vp]s_\d_\d)*/g,
  /\s*OpenGL\s+(ES\s+)?[\d.]+.*$/g,
  /\((R|TM)\)/g,
];
const ANGLE_PREFIX = 'ANGLE (';
const PART = ', ';
const SOFTWARE = /SwiftShader|llvmpipe|Software/i;
export const SOFTWARE_GPU = 'Software (no graphics card)';

/**
 * The GPU a WebGL renderer string names, short enough for one line: "ANGLE (Intel,
 * Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)" is
 * "Intel Iris Xe Graphics". On a laptop with two GPUs Windows often gives the browser the
 * slower one, and seeing its name is the quickest way to tell (Render Options shows it).
 */
export function gpuLabel(renderer: string): string {
  let name = renderer.trim();
  if (SOFTWARE.test(name)) return SOFTWARE_GPU;
  if (name.startsWith(ANGLE_PREFIX) && name.endsWith(')')) {
    const inner = name.slice(ANGLE_PREFIX.length, -1);
    const first = inner.indexOf(PART);
    const last = inner.lastIndexOf(PART);
    if (first >= 0 && last > first) name = inner.slice(first + PART.length, last);
    else if (first >= 0) name = inner.slice(first + PART.length);
  }
  for (const pattern of NOISE) name = name.replace(pattern, '');
  return name.replace(/\s+/g, ' ').trim() || renderer.trim();
}

/** The GPU a context draws with, or '' when the browser does not tell. */
export function gpuName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const raw = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return typeof raw === 'string' && raw ? gpuLabel(raw) : '';
}

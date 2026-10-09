import { Logger } from '../../core/log';

const logger = Logger.create('GL');

export class GlError extends Error {}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new GlError('Cannot create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? '';
    logger.error('shader compile failed', { info });
    throw new GlError(info);
  }
  return shader;
}

/** KHR_parallel_shader_compile: compile on driver threads and poll, instead of blocking the page. */
const COMPLETION_STATUS_KHR = 0x91b1;

/**
 * Starts compiling and linking; resolves once the driver reports the program
 * finished. Without the extension it falls back to a blocking link.
 */
export function linkProgramAsync(gl: WebGL2RenderingContext, vertex: string, fragment: string): Promise<WebGLProgram> {
  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  if (!parallel) return Promise.resolve(linkProgram(gl, vertex, fragment));
  const program = gl.createProgram();
  if (!program) return Promise.reject(new GlError('Cannot create program'));
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) return Promise.reject(new GlError('Cannot create shader'));
  gl.shaderSource(vs, vertex);
  gl.shaderSource(fs, fragment);
  gl.compileShader(vs);
  gl.compileShader(fs);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (gl.isContextLost()) {
        reject(new GlError('The graphics context was lost while compiling'));
        return;
      }
      if (!gl.getProgramParameter(program, COMPLETION_STATUS_KHR)) {
        requestAnimationFrame(poll);
        return;
      }
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        resolve(program);
        return;
      }
      const info = `${gl.getShaderInfoLog(fs) ?? ''}\n${gl.getProgramInfoLog(program) ?? ''}`;
      logger.error('program link failed', { info });
      reject(new GlError(info));
    };
    poll();
  });
}

export function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new GlError('Cannot create program');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? '';
    logger.error('program link failed', { info });
    throw new GlError(info);
  }
  return program;
}

/** Caches uniform locations by name. */
export class Uniforms {
  private readonly cache = new Map<string, WebGLUniformLocation | null>();

  constructor(private readonly gl: WebGL2RenderingContext, private readonly program: WebGLProgram) {}

  private loc(name: string): WebGLUniformLocation | null {
    if (!this.cache.has(name)) this.cache.set(name, this.gl.getUniformLocation(this.program, name));
    return this.cache.get(name) ?? null;
  }

  f(name: string, ...v: number[]): void {
    const l = this.loc(name);
    if (v.length === 1) this.gl.uniform1f(l, v[0]);
    else if (v.length === 2) this.gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) this.gl.uniform3f(l, v[0], v[1], v[2]);
    else this.gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  }

  i(name: string, v: number): void {
    this.gl.uniform1i(this.loc(name), v);
  }

  v4array(name: string, data: Float32Array): void {
    this.gl.uniform4fv(this.loc(name), data);
  }
}

export function dataTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new GlError('Cannot create texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function uploadFloatRows(gl: WebGL2RenderingContext, tex: WebGLTexture, width: number, rows: number, data: Float32Array): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, Math.max(rows, 1), 0, gl.RGBA, gl.FLOAT, data);
}

export interface Target {
  readonly tex: WebGLTexture;
  readonly fbo: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, internal: number, filter: number): Target {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new GlError('Cannot create render target');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null): void {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

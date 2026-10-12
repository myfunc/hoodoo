/**
 * The game renderer's upscale numbers (game-taa.glsl, game-composite.glsl), worked out on the
 * CPU for each traced size so the shaders only apply them. A kernel weighs a sample at distance
 * d by exp(-k d²); `kernelFactor` turns a width (σ) into k. Distances are in pixels of the view
 * ("output") or of the traced picture ("traced"). Measured in docs/rendering.md.
 */
export const UPSCALE = {
  /**
   * The temporal kernel, σ in output pixels: how much this frame's nearest sample adds to a
   * pixel whose history holds. Narrow, so jittered samples build up the view's own detail.
   */
  temporalSigma: 0.47,
  /**
   * The spatial upscale, σ in traced pixels: what a pixel shows when its history was lost
   * (uncovered, a reflection moved). Flat areas blend smoothly; at an edge the kernel narrows
   * across it and stretches along it, so the edge is rebuilt instead of stair-stepped.
   */
  flatSigma: 0.5,
  acrossSigma: 0.3,
  alongSigma: 1,
  /** At or below this scale the spatial kernel has its full width; toward full size it narrows to the temporal one. */
  fullWidthBelow: 0.5,
  /** Jitter phases: this many for each output pixel's share of a traced pixel (more when the trace is smaller). */
  phasesPerPixel: 8,
  minPhases: 8,
  maxPhases: 32,
  /**
   * Contrast-adaptive sharpening (0..1) after the upscale: the look's `sharpen` times `lookShare`,
   * plus `lostShare` for each unit of size lost per side (an upscaled picture is softer).
   */
  lookShare: 1,
  lostShare: 0.15,
} as const;

/** exp(-k d²) of a Gaussian with this σ. */
export function kernelFactor(sigma: number): number {
  return 1 / (2 * sigma * sigma);
}

/** The kernel factors for game-taa.glsl's uKernel. */
export interface UpscaleKernel {
  /** In output pixels: the temporal kernel. */
  readonly temporal: number;
  /** In traced pixels: the spatial upscale in flat areas, across an edge and along it. */
  readonly flat: number;
  readonly across: number;
  readonly along: number;
}

/**
 * The kernels for a picture traced at `scale` of the view per side. At full size the spatial
 * upscale is never wider than the temporal kernel: there is nothing to rebuild.
 */
export function upscaleKernel(scale: number): UpscaleKernel {
  const s = clampScale(scale);
  // The temporal kernel's width in traced pixels, and how far toward the spatial widths this size goes.
  const temporal = UPSCALE.temporalSigma * s;
  const blend = Math.min(1, (1 - s) / (1 - UPSCALE.fullWidthBelow));
  const spatial = (sigma: number) => kernelFactor(temporal + (sigma - temporal) * blend);
  return {
    temporal: kernelFactor(UPSCALE.temporalSigma),
    flat: spatial(UPSCALE.flatSigma),
    across: spatial(UPSCALE.acrossSigma),
    along: spatial(UPSCALE.alongSigma),
  };
}

/** Jitter phases for a picture traced at `scale`: every output pixel gets about the same number of samples. */
export function jitterPhases(scale: number): number {
  const s = clampScale(scale);
  return Math.min(UPSCALE.maxPhases, Math.max(UPSCALE.minPhases, Math.ceil(UPSCALE.phasesPerPixel / (s * s))));
}

/** RCAS strength (0..1) for a look's own sharpening and a picture traced at `scale`. */
export function sharpenAmount(lookSharpen: number, scale: number): number {
  const lost = 1 - clampScale(scale);
  return Math.min(1, Math.max(0, lookSharpen * UPSCALE.lookShare + lost * UPSCALE.lostShare));
}

const MIN_SCALE = 1 / 64;

function clampScale(scale: number): number {
  return Math.min(1, Math.max(MIN_SCALE, scale));
}

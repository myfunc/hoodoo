/** Tuning of the terrain editor operations; amounts arrive on a 0..100 dial. */
export const AMOUNT_MAX = 100;
export const FRACTAL = { baseFrequency: 3, octaves: 7 } as const;
export const RIDGES = { baseFrequency: 2.5, octaves: 6 } as const;
export const ERODE = { maxIterations: 40, talus: 0.004, carry: 0.5, rainSmooth: 0.15 } as const;
export const SMOOTH = { maxPasses: 12 } as const;
export const SHARPEN = { maxGain: 3 } as const;
export const SPIKES = { maxCount: 70, minRadius: 0.02, maxRadius: 0.12, minHeight: 0.3 } as const;
export const MOUNDS = { maxCount: 60, minRadius: 0.06, maxRadius: 0.25, height: 0.35 } as const;
export const PLATEAUS = { minLevels: 2, maxLevels: 14, softness: 0.18 } as const;
export const RAISE = { maxStep: 0.25 } as const;
export const MESA = { minWidth: 0.02, maxWidth: 0.3, threshold: 0.5 } as const;
export const CANYON = { meander: 0.22, waves: 2.2, minWidth: 0.06, maxWidth: 0.2, wobble: 3 } as const;
export const CRATER = { radius: 0.38, rim: 0.12 } as const;
export const ISLAND = { edge: 0.95 } as const;
export const BRUSH = { smoothMix: 0.5 } as const;

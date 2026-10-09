/** Low-discrepancy sub-pixel offsets for anti-aliasing samples. */
export const HALTON_X = 2;
export const HALTON_Y = 3;
/** First sample of every pass sits in the pixel centre. */
export const CENTER_JITTER = 0.5;

export function halton(i: number, base: number): number {
  let f = 1;
  let r = 0;
  for (let n = i; n > 0; n = Math.floor(n / base)) {
    f /= base;
    r += f * (n % base);
  }
  return r;
}

export const jitter = (sample: number): [number, number] =>
  sample === 0 ? [CENTER_JITTER, CENTER_JITTER] : [halton(sample, HALTON_X), halton(sample, HALTON_Y)];

import { Logger } from '../core/log';
import { type EncodedFrame, type WebmTrack, muxWebm } from './webm-muxer';

const logger = Logger.create('MovieEncoder');

/** VP9 first (smaller files), VP8 where VP9 encoding is missing. */
const CODECS: readonly { readonly config: string; readonly track: WebmTrack['codec'] }[] = [
  { config: 'vp09.00.41.08', track: 'V_VP9' },
  { config: 'vp8', track: 'V_VP8' },
];
const US_PER_MS = 1000;
const MS_PER_S = 1000;
/** Bits per pixel per frame: clean gradients in skies need more than a talking head. */
const BITS_PER_PIXEL = 0.25;
const KEY_EVERY_S = 2;
const MAX_QUEUE = 4;
const MIME = 'video/webm';

export class MovieUnsupportedError extends Error {}

/**
 * Frames in, a WebM file out, through WebCodecs. Frames get exact timestamps, so the
 * movie plays at its frame rate however long each frame took to ray-trace.
 */
export class MovieEncoder {
  private readonly frames: EncodedFrame[] = [];
  private failure: Error | null = null;
  private count = 0;

  private constructor(
    private readonly encoder: VideoEncoder,
    private readonly track: WebmTrack,
    private readonly fps: number,
  ) {}

  /** `bitsPerPixel` per frame: slow, smooth motion (the splash clips) looks clean on far less than the default. */
  static async create(width: number, height: number, fps: number, bitsPerPixel = BITS_PER_PIXEL): Promise<MovieEncoder> {
    if (typeof VideoEncoder === 'undefined') throw new MovieUnsupportedError('This browser cannot encode video (no WebCodecs)');
    const bitrate = Math.round(width * height * fps * bitsPerPixel);
    for (const c of CODECS) {
      const config: VideoEncoderConfig = { codec: c.config, width, height, bitrate, framerate: fps };
      const support = await VideoEncoder.isConfigSupported(config);
      if (!support.supported) continue;
      let self: MovieEncoder | null = null;
      const encoder = new VideoEncoder({
        output: (chunk) => self?.take(chunk),
        error: (e) => self?.fail(e),
      });
      encoder.configure(config);
      self = new MovieEncoder(encoder, { codec: c.track, width, height }, fps);
      logger.info('encoder ready', { codec: c.config, width, height, bitrate });
      return self;
    }
    throw new MovieUnsupportedError('This browser cannot encode VP8 or VP9 video');
  }

  /** Encodes one frame; waits while the encoder is behind. */
  async add(canvas: HTMLCanvasElement): Promise<void> {
    if (this.failure) throw this.failure;
    while (this.encoder.encodeQueueSize > MAX_QUEUE) await new Promise((r) => setTimeout(r));
    const frameUs = (MS_PER_S * US_PER_MS) / this.fps;
    const frame = new VideoFrame(canvas, { timestamp: Math.round(this.count * frameUs), duration: Math.round(frameUs) });
    try {
      this.encoder.encode(frame, { keyFrame: this.count % (KEY_EVERY_S * this.fps) === 0 });
    } finally {
      frame.close();
    }
    this.count++;
  }

  async finish(): Promise<Blob> {
    await this.encoder.flush();
    this.encoder.close();
    if (this.failure) throw this.failure;
    const sorted = [...this.frames].sort((a, b) => a.timeMs - b.timeMs);
    const bytes = muxWebm(this.track, sorted, (this.count * MS_PER_S) / this.fps);
    return new Blob([bytes], { type: MIME });
  }

  cancel(): void {
    if (this.encoder.state !== 'closed') this.encoder.close();
  }

  private take(chunk: EncodedVideoChunk): void {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.frames.push({ data, timeMs: chunk.timestamp / US_PER_MS, key: chunk.type === 'key' });
  }

  private fail(e: Error): void {
    logger.error('encoder failed', {}, e);
    this.failure = e;
  }
}

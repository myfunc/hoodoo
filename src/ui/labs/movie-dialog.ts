import type { DocumentSetup } from '../../model/scene.types';
import { MOTION_LABELS, MOVIE_FPS, MovieMotion, type MovieSpec } from '../../world/movie-motion';
import { Select } from '../kit/controls';
import { Dialog, DialogStyle } from '../kit/dialog';
import { el } from '../kit/dom';

const LENGTHS = [2, 4, 6, 8] as const;
const SCALES = [0.5, 1] as const;
const SAMPLES = [4, 9, 16, 36] as const;
/** Long side cap: VP9 encoders in browsers top out around here, and so does patience. */
const MAX_SIDE = 1920;
const DEFAULT = { motion: MovieMotion.Orbit, seconds: 4, scale: 0.5, samples: 9 } as const;

/** Even pixel sizes: 4:2:0 video needs them. */
const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2);

function sized(doc: DocumentSetup, k: number): { width: number; height: number } {
  const fit = Math.min(k, MAX_SIDE / Math.max(doc.width, doc.height));
  return { width: even(doc.width * fit), height: even(doc.height * fit) };
}

/** Render Turntable Movie: motion, length, size and rays per pixel. */
export function openMovieDialog(doc: DocumentSetup, onApply: (s: MovieSpec) => void): void {
  let motion: MovieMotion = DEFAULT.motion;
  let seconds: number = DEFAULT.seconds;
  let k: number = DEFAULT.scale;
  let samples: number = DEFAULT.samples;
  const info = el('span', { cls: 'props-label' });
  const show = () => {
    const { width, height } = sized(doc, k);
    info.textContent = `${width} × ${height} px · ${seconds * MOVIE_FPS} frames at ${MOVIE_FPS} fps · WebM`;
  };
  const row = (label: string, control: HTMLElement) => [el('span', { text: label }), control];
  const body = el('div', { cls: 'form-grid movie-form' }, [
    ...row('Motion', new Select<MovieMotion>({ items: Object.values(MovieMotion).map((m) => ({ value: m, label: MOTION_LABELS[m] })), value: motion, onChange: (m) => { motion = m; } }).el),
    ...row('Length', new Select<number>({ items: LENGTHS.map((s) => ({ value: s, label: `${s} seconds` })), value: seconds, onChange: (s) => { seconds = s; show(); } }).el),
    ...row('Size', new Select<number>({ items: SCALES.map((s) => ({ value: s, label: `${s}× document` })), value: k, onChange: (s) => { k = s; show(); } }).el),
    ...row('Quality', new Select<number>({ items: SAMPLES.map((n) => ({ value: n, label: `${n} rays / pixel` })), value: samples, onChange: (n) => { samples = n; } }).el),
    el('span'), info,
  ]);
  show();
  new Dialog({
    title: 'Render Turntable Movie', style: DialogStyle.Stone, body,
    onOk: () => onApply({ motion, seconds, samples, ...sized(doc, k) }),
    onCancel: () => undefined,
  }).open();
}

import { downloadBlob } from './download';

const PNG = 'image/png';

/** Saving and copying finished pictures. */
export function canvasBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, PNG));
}

export async function downloadCanvas(c: HTMLCanvasElement, name: string): Promise<void> {
  const blob = await canvasBlob(c);
  if (blob) downloadBlob(blob, `${name}.png`);
}

export async function copyCanvas(c: HTMLCanvasElement): Promise<boolean> {
  const blob = await canvasBlob(c);
  if (!blob || !navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
  await navigator.clipboard.write([new ClipboardItem({ [PNG]: blob })]);
  return true;
}

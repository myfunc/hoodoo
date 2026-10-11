import { ScrollPreference } from '../world/world.enums';
import { SWIPE_GAP_MS, WHEEL_NOTCH } from './input.constants';

export { ScrollPreference };

/**
 * Which device a wheel event came from. A Mac trackpad scrolls in fine pixel steps
 * and sideways; a mouse wheel turns in notches. Ctrl+wheel is a pinch (browsers
 * send it for trackpad pinches). The device of a swipe is decided on its first
 * event and kept until a pause, so momentum scrolling never flips it.
 */
export enum ScrollDevice {
  Wheel = 'wheel',
  Trackpad = 'trackpad',
  Pinch = 'pinch',
}


interface WheelLike {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly timeStamp: number;
  /** Non-standard but present in Chromium and WebKit: ±120 per notch. */
  readonly wheelDeltaY?: number;
}

const PIXEL_MODE = 0;
/** Chromium and WebKit report a trackpad's legacy wheelDelta as three times its pixel delta. */
const TRACKPAD_RATIO = -3;
const RATIO_SLACK = 1.5;

function looksLikeTrackpad(e: WheelLike): boolean {
  // Firefox scrolls a mouse wheel in lines, a trackpad in pixels.
  if (e.deltaMode !== PIXEL_MODE) return false;
  if (e.deltaX !== 0) return true;
  const legacy = e.wheelDeltaY;
  if (legacy !== undefined && legacy !== 0) {
    if (Math.abs(legacy - TRACKPAD_RATIO * e.deltaY) <= RATIO_SLACK) return true;
    return legacy % WHEEL_NOTCH !== 0 && !Number.isInteger(e.deltaY);
  }
  return !Number.isInteger(e.deltaY);
}

export class ScrollClassifier {
  private device = ScrollDevice.Wheel;
  private last = -Infinity;

  constructor(public preference: ScrollPreference = ScrollPreference.Auto) {}

  classify(e: WheelLike): ScrollDevice {
    if (e.ctrlKey) return ScrollDevice.Pinch;
    if (this.preference === ScrollPreference.Wheel) return ScrollDevice.Wheel;
    if (this.preference === ScrollPreference.Trackpad) return ScrollDevice.Trackpad;
    if (e.timeStamp - this.last > SWIPE_GAP_MS) this.device = looksLikeTrackpad(e) ? ScrollDevice.Trackpad : ScrollDevice.Wheel;
    else if (this.device === ScrollDevice.Wheel && looksLikeTrackpad(e)) this.device = ScrollDevice.Trackpad;
    this.last = e.timeStamp;
    return this.device;
  }
}

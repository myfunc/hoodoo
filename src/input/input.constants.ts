/** Mouse and keyboard feel of the scene window. */
export const PICK_RADIUS_PX = 6;
export const GIZMO_PICK_PX = 9;
export const DRAG_THRESHOLD_PX = 4;
export const ORBIT_DEG_PER_PX = 0.35;
export const LOOK_DEG_PER_PX = 0.2;
export const WHEEL_DOLLY = 0.0012;
export const ORTHO_ZOOM = 0.0012;
export const FLY_UNITS_PER_SEC = 8;
export const FLY_FAST = 4;
export const BUTTON_LEFT = 0;
export const BUTTON_MIDDLE = 1;
export const BUTTON_RIGHT = 2;
export const MS_PER_SECOND = 1000;
export const MAX_FLY_DT = 0.1;
export const PARALLEL_EPS = 1e-6;
/** Trackpad: degrees of orbit and pixels of pan per pixel of two-finger scroll. */
export const TRACKPAD_ORBIT_DEG_PER_PX = 0.3;
export const TRACKPAD_PAN = 1;
/** Pinch arrives as Ctrl+wheel with small deltas: stronger than a wheel notch per unit. */
export const PINCH_DOLLY = 0.01;
/** Safari pinch (gesture events) scale steps. */
export const GESTURE_MIN_SCALE = 0.2;
/** A wheel notch is a whole multiple of this in Chrome, Edge and Safari (wheelDelta). */
export const WHEEL_NOTCH = 120;
/** Scroll events closer than this belong to the same swipe and keep its device. */
export const SWIPE_GAP_MS = 400;

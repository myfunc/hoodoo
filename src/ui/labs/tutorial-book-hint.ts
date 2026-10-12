import { Action } from '../../input/actions';
import { loadPrefs, savePrefs } from '../../io/prefs';
import type { UiContext } from '../context';
import { isModalOpen } from '../kit/dialog';
import { showOffer } from '../panels/offer-toast';

/** How often the first visit checks that the welcome and start windows are gone. */
const WAIT_MS = 500;
/** Checks in a row with neither: the start window opens a moment after the welcome one fades. */
const QUIET_CHECKS = 2;
/** The welcome window; the start window counts as a modal (isModalOpen). */
const SPLASH = '.splash-screen';
const MESSAGE = 'New here? Help › Tutorial Book: recipes with a picture for every step';

let takeBack: (() => void) | null = null;

/**
 * The first visit only: once the welcome and start windows are gone, a one-line
 * offer points at Help › Tutorial Book. It is remembered as shown at once
 * (prefs `tutorialSeen`), so it never comes back; browser automation never gets it.
 */
export function offerTutorialBook(ctx: UiContext): void {
  if (loadPrefs().tutorialSeen || navigator.webdriver) return;
  let quiet = 0;
  const timer = window.setInterval(() => {
    quiet = isModalOpen() || document.querySelector(SPLASH) ? 0 : quiet + 1;
    if (quiet < QUIET_CHECKS) return;
    window.clearInterval(timer);
    savePrefs({ tutorialSeen: true });
    takeBack = showOffer(MESSAGE, 'Open', () => ctx.dispatch(Action.TutorialBook));
  }, WAIT_MS);
}

/** The book opened: the offer has done its job. */
export function dismissTutorialHint(): void {
  takeBack?.();
  takeBack = null;
}

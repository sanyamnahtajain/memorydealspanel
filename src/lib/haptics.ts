/**
 * Tiny haptic cues for the installed app.
 *
 * Android Chrome exposes `navigator.vibrate`; iOS Safari does not, and some
 * browsers block it until the user has interacted. Every call is best-effort
 * and silent on failure — a missing buzz is nothing, a thrown error in a tap
 * handler would be a broken button. Honours the OS and in-app reduced-motion
 * settings: a person who asked for less motion did not ask for buzzing.
 */

function allowed(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    if (document.documentElement.dataset.reduceMotion === "true") return false;
    // Chrome refuses (and logs a console error for) vibrate before the page
    // has ever been tapped; skip quietly until then where the API exists.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation && !activation.hasBeenActive) return false;
  } catch {
    return false;
  }
  return true;
}

function buzz(pattern: number | number[]): void {
  if (!allowed()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* unsupported or blocked — nothing to do */
  }
}

/** A tab or chip tap. */
export const hapticTap = (): void => buzz(8);
/** A gesture crossed its threshold (pull-to-refresh armed, swipe committed). */
export const hapticThreshold = (): void => buzz(14);
/** Something was added or confirmed. */
export const hapticSuccess = (): void => buzz([10, 30, 14]);

const MOBILE_SCREEN_QUERY = "(max-width: 680px)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/**
 * Estimates whether the current browser is being used in a phone-sized,
 * touch-first layout. This cannot determine whether a physical keyboard is attached.
 */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const matches = (query: string) => window.matchMedia?.(query)?.matches === true;
  const compactScreen = matches(MOBILE_SCREEN_QUERY);
  const touchInput = (navigator.maxTouchPoints || 0) > 0 || matches(COARSE_POINTER_QUERY);
  // Treat the device as mobile only when both the compact-screen and touch-input checks pass.
  return compactScreen && touchInput;
}

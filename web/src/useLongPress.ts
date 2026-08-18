import { useCallback, useEffect, useRef } from "react";

export const LONG_PRESS_MS = 350;

/**
 * Fire once when a press is held. Returns props to spread onto the element.
 *
 * The window-level release listener is not belt-and-braces: a pointerup is not
 * guaranteed to reach the element it started on — a scroll steals it, the
 * browser drops it, a synthetic event never sends one — and a timer that only
 * clears on the element's own pointerup will fire long after the finger left.
 *
 * `onContextMenu` is suppressed because a long press on mobile otherwise raises
 * the selection callout over whatever the press was meant to do.
 */
export function useLongPress(onLongPress: () => void, ms = LONG_PRESS_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
      window.removeEventListener("blur", clear);
    };
  }, [clear]);

  return {
    onPointerDown: () => {
      firedRef.current = false;
      timer.current = setTimeout(() => {
        firedRef.current = true;
        navigator.vibrate?.(30); // you can't see the element under your thumb
        onLongPress();
      }, ms);
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    /** True if the press that just ended was a hold, so a click can ignore it. */
    wasLongPress: () => firedRef.current,
  };
}

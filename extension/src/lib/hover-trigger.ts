import { useEffect, useRef, useState } from "react";

/**
 * Fire a button by hovering it with Ctrl+Shift held.
 *
 * A click on the panel takes focus away from the page, and a dropdown the
 * tester opened there closes before the capture lands — the one moment
 * they wanted a picture of is the moment a click destroys. Hovering moves
 * no focus. And although keystrokes go to the page while it is focused,
 * the pointer events the panel gets carry the modifier state, so "the
 * mouse is over the button and both keys are down" is knowable here. One
 * firing per visit: the pointer has to leave and come back for another.
 */
export function useHoverTrigger(action: () => void, disabled = false) {
  const armed = useRef(true);
  const check = (e: React.PointerEvent) => {
    if (disabled || !armed.current) return;
    if (e.ctrlKey && e.shiftKey) {
      armed.current = false;
      action();
    }
  };
  return {
    onPointerEnter: check,
    onPointerMove: check,
    onPointerLeave: () => {
      armed.current = true;
    },
  };
}

export const HOVER_HINT = "or hover with Ctrl+Shift held, to keep the page's focus — a dropdown stays open";

/**
 * A capture that waits: press, click back into the page, open what should
 * be in the picture, and the capture fires on its own. The count is shown
 * on the button so the tester knows how long they have. Pressing again
 * while counting cancels.
 */
export function useDelayedTrigger(action: () => void, seconds = 3) {
  const [left, setLeft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setLeft(null);
  };
  useEffect(() => stop, []);
  const start = () => {
    if (timer.current) {
      stop();
      return;
    }
    let n = seconds;
    setLeft(n);
    timer.current = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setLeft(n);
        return;
      }
      stop();
      action();
    }, 1000);
  };
  return { left, start, counting: left !== null };
}

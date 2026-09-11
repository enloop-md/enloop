import { getPageAccess } from "./page-access.js";

/**
 * Where things are on the page, in the pixels of a screenshot.
 *
 * `captureVisibleTab` hands back the viewport at device resolution, so a
 * rect from `getBoundingClientRect` has to be scaled by the page's
 * `devicePixelRatio` before it can be drawn onto the capture — and the
 * panel is not the page, so the page has to report its own ratio. One
 * injected call does the scroll, the wait, and every lookup, so the rects
 * describe the same instant the capture will.
 *
 * Top frame only, like Highlight: a rect inside an iframe is relative to
 * that frame's viewport and would need the frame's own position added,
 * which cross-origin frames do not report.
 */

export interface DeviceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ElementRects {
  dpr: number;
  /** One entry per requested selector: null for no match, an invalid
   * selector, or an element wholly outside the viewport. */
  rects: (DeviceRect | null)[];
}

/** Injected. Scrolls `scrollTo` into view when it names something, waits
 * for the scroll and any layout it triggers, then measures. */
function measure(scrollTo: string, selectors: string[], settleMs: number): Promise<ElementRects> {
  let target: Element | null = null;
  if (scrollTo) {
    try {
      target = document.querySelector(scrollTo);
    } catch {
      target = null;
    }
  }
  if (target) target.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center", inline: "nearest" });
  // Highlight's flash is a 1 s outline-and-tint animation on the very
  // element the photo is about; a capture mid-flash keeps the orange box.
  // Cancelling every running animation also freezes spinners and fades,
  // which a still picture is better off without.
  try {
    for (const animation of document.getAnimations()) animation.cancel();
  } catch {
    // Not supported: the capture just has to live with the page as it is.
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      const dpr = window.devicePixelRatio || 1;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rects = selectors.map((selector) => {
        if (!selector) return null;
        let el: Element | null = null;
        try {
          el = document.querySelector(selector);
        } catch {
          return null;
        }
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const x1 = Math.max(0, r.left);
        const y1 = Math.max(0, r.top);
        const x2 = Math.min(vw, r.right);
        const y2 = Math.min(vh, r.bottom);
        if (x2 - x1 <= 0 || y2 - y1 <= 0) return null;
        return { x: x1 * dpr, y: y1 * dpr, w: (x2 - x1) * dpr, h: (y2 - y1) * dpr };
      });
      resolve({ dpr, rects });
    }, target ? settleMs : 0);
  });
}

/**
 * Rects of the first match of every selector, in device pixels, clamped
 * to the viewport, after scrolling `scrollTo` (a selector, or "") into
 * view. Null when the page cannot be scripted at all.
 */
export async function elementRects(scrollTo: string, selectors: string[]): Promise<ElementRects | null> {
  const access = await getPageAccess();
  if (access.status !== "ready") return null;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: access.tabId },
      world: "ISOLATED",
      func: measure,
      args: [scrollTo, selectors, 250],
    });
    const result = injection?.result as ElementRects | undefined;
    return result ?? null;
  } catch {
    return null;
  }
}

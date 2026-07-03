/**
 * Injected directly via chrome.scripting.executeScript's `func` — this is
 * static, extension-authored code (not dynamic user script text), so none
 * of the blob/CSP complexity in automation.ts applies here; `func`-based
 * injection is never subject to the page's CSP in the first place.
 */
function highlightElement(selector: string): { found: boolean } {
  const el = document.querySelector(selector);
  if (!el) return { found: false };

  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  el.animate(
    [
      { outline: "3px solid rgba(245, 158, 11, 0)", backgroundColor: "rgba(245, 158, 11, 0)" },
      { outline: "3px solid rgba(245, 158, 11, 0.9)", backgroundColor: "rgba(245, 158, 11, 0.35)" },
      { outline: "3px solid rgba(245, 158, 11, 0)", backgroundColor: "rgba(245, 158, 11, 0)" },
    ],
    { duration: 1000, iterations: 1 },
  );
  return { found: true };
}

/** Scrolls `selector` into view and flashes it in the given tab. Returns
 * false (without throwing) if the tab has no active document or the
 * selector doesn't match anything there — this is a visual aid, not a
 * correctness check, so callers should treat failure as a no-op. */
export async function highlightSelectorInTab(tabId: number, selector: string): Promise<boolean> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: highlightElement,
      args: [selector],
    });
    return injection?.result?.found ?? false;
  } catch {
    return false;
  }
}

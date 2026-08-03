/**
 * Injected directly via chrome.scripting.executeScript's `func` — this is
 * static, extension-authored code (not dynamic user script text), so none
 * of the blob/CSP complexity in automation.ts applies here; `func`-based
 * injection is never subject to the page's CSP in the first place.
 *
 * Walks `selectors` in order and flashes the first one that matches, so a
 * step can name an exact handle first and looser fallbacks after it. An
 * invalid selector (a typo, or a `%VAR%` that never got substituted) makes
 * `querySelector` throw; that candidate is skipped rather than aborting the
 * whole attempt, since the point of a fallback list is to survive one bad
 * entry.
 */
function highlightElement(selectors: string[]): { matched: string | null } {
  for (const selector of selectors) {
    let el: Element | null = null;
    try {
      el = document.querySelector(selector);
    } catch {
      continue;
    }
    if (!el) continue;

    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    el.animate(
      [
        { outline: "3px solid rgba(245, 158, 11, 0)", backgroundColor: "rgba(245, 158, 11, 0)" },
        { outline: "3px solid rgba(245, 158, 11, 0.9)", backgroundColor: "rgba(245, 158, 11, 0.35)" },
        { outline: "3px solid rgba(245, 158, 11, 0)", backgroundColor: "rgba(245, 158, 11, 0)" },
      ],
      { duration: 1000, iterations: 1 },
    );
    return { matched: selector };
  }
  return { matched: null };
}

/** Scrolls the first matching selector into view and flashes it in the given
 * tab, returning which one matched — `null` if the tab has no active
 * document or none of the candidates match anything there. Never throws:
 * this is a visual aid, not a correctness check, so callers should treat a
 * miss as a no-op. */
export async function highlightSelectorsInTab(
  tabId: number,
  selectors: string[],
): Promise<string | null> {
  if (selectors.length === 0) return null;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: highlightElement,
      args: [selectors],
    });
    return injection?.result?.matched ?? null;
  } catch {
    return null;
  }
}

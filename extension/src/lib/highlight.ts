import { getPageAccess, type PageAccess } from "./page-access.js";

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

export type HighlightOutcome =
  /** A candidate matched and was flashed. */
  | { status: "matched"; selector: string }
  /** The page was reachable and none of the candidates matched. */
  | { status: "no-match" }
  /** Nothing was looked for — the page could not be scripted at all. */
  | { status: "blocked"; access: PageAccess };

/**
 * Scrolls the first matching selector into view and flashes it in the active
 * tab. Never throws: this is a visual aid, not a correctness check.
 *
 * The `blocked` case is separate from `no-match` because they lie about each
 * other. Reporting "not found on page" for a `chrome://` tab, or for a site
 * whose access has not been granted, sends the tester off to check a
 * selector that was never looked for.
 */
export async function highlightSelectors(selectors: string[]): Promise<HighlightOutcome> {
  if (selectors.length === 0) return { status: "no-match" };

  const access = await getPageAccess();
  if (access.status !== "ready") return { status: "blocked", access };

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: access.tabId },
      world: "ISOLATED",
      func: highlightElement,
      args: [selectors],
    });
    const matched = injection?.result?.matched ?? null;
    return matched ? { status: "matched", selector: matched } : { status: "no-match" };
  } catch {
    // Access was there a moment ago, so this is the page itself refusing —
    // a tab mid-navigation, or a frame that went away.
    return { status: "no-match" };
  }
}

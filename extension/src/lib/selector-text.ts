/**
 * Deciding whether a scrap of text inside a step's prose is a CSS selector
 * the tester can be offered a Highlight for.
 *
 * The step contract tells authors to put visible UI labels in backticks
 * (`` `Save changes` ``), so inline code is *mostly* not selectors. A rule
 * that guesses generously turns every quoted button label into a control
 * that flashes nothing — worse than no feature, because the tester learns
 * to distrust it. So this errs hard toward "no", and only says yes to
 * shapes a label could not plausibly take.
 */

/** Rejects anything `querySelector` itself would throw on, which is the
 * cheapest correctness filter available and needs no page access — the
 * side panel is a document too. */
function isParseableSelector(text: string): boolean {
  try {
    document.querySelector(text);
    return true;
  } catch {
    return false;
  }
}

/** An id selector: `#` followed by a name that cannot start with a digit —
 * which is what keeps `#1234` (an issue reference, very common in a step
 * that names a ticket) from reading as one. */
const ID_SELECTOR = /^#[A-Za-z_-][\w-]*$/;

/** An attribute selector anywhere in the string — `[data-testid="x"]`,
 * `button[type=submit]`. Nothing that reads as prose contains one. */
const HAS_ATTRIBUTE = /\[[\w-]+([~|^$*]?=|])/;

/** A compound/descendant selector built from classes and ids: `.modal .btn`,
 * `#panel > .row`. Requires more than one part on purpose — a lone
 * `.env` or `.gitignore` in an instruction is a filename, not a selector. */
const MULTIPART = /^[.#][\w-]+(\s*[>+~]\s*|\s+|[.#:])[\w\s.#:>+~[\]="'-]+$/;

/**
 * True when `text` should be offered as a clickable Highlight in rendered
 * step Markdown. Single line, bounded length, and one of the three shapes
 * above — plus actually parseable as a selector.
 */
export function looksLikeSelector(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 120 || value.includes("\n")) return false;
  if (!(ID_SELECTOR.test(value) || HAS_ATTRIBUTE.test(value) || MULTIPART.test(value))) {
    return false;
  }
  return isParseableSelector(value);
}

/**
 * The selector an author meant by a Markdown link, or null if the link is
 * an ordinary URL to open.
 *
 * Two forms, both deliberate rather than incidental:
 * - `[the Sync button](#sync-crm-btn)` — a fragment href. There is no
 *   document to scroll to in a side panel, so this syntax is free to mean
 *   "the element with this id", which is also exactly what it says.
 * - `[the row](selector:[data-testid="row"])` — an explicit escape hatch
 *   for selectors a fragment cannot express.
 */
export function selectorFromHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("selector:")) {
    const value = href.slice("selector:".length).trim();
    return value && isParseableSelector(value) ? value : null;
  }
  if (href.startsWith("#") && href.length > 1) {
    // Markdown may percent-encode what the author typed; a raw `#` href is
    // an id selector as-is.
    let value = href;
    try {
      value = decodeURIComponent(href);
    } catch {
      // Malformed escape — fall back to the literal text.
    }
    return ID_SELECTOR.test(value) && isParseableSelector(value) ? value : null;
  }
  return null;
}

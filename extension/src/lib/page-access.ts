/**
 * Whether the panel can act on the page in front of the tester, and if not,
 * which of the several different reasons it is.
 *
 * Every page-touching feature — Highlight, Go, value insertion, automated
 * steps — used to collapse all of these into one silent failure that the run
 * screen then reported as "not found on page". Three of the four reasons
 * have nothing to do with the selector, and one of them (no host permission
 * yet) is fixable by the tester in a single click, which is impossible to
 * offer if the panel cannot tell it apart from a stale selector.
 *
 * Site access is requested per origin, on demand, rather than taken at
 * install time: `optional_host_permissions` in the manifest means the
 * install prompt asks for nothing, and the grant arrives later attached to
 * the domain it is for and the action that needs it.
 */

export type PageAccess =
  /** Scriptable right now. */
  | { status: "ready"; tabId: number; url: string }
  /** No page to act on — an empty window, or a tab still being created. */
  | { status: "no-tab" }
  /** A page no extension may touch, whatever permissions it holds. */
  | { status: "restricted"; url: string; reason: string }
  /** An ordinary page Enloop has not been granted access to yet. */
  | { status: "needs-grant"; tabId: number; url: string; origin: string; host: string };

/** Chrome refuses injection on its own surfaces regardless of permissions. */
const BROWSER_SCHEMES = [
  "chrome:",
  "chrome-untrusted:",
  "chrome-extension:",
  "devtools:",
  "edge:",
  "brave:",
  "about:",
  "view-source:",
  "data:",
];

/** The Web Store is blocked for every extension, by name rather than scheme. */
function isWebStore(url: URL): boolean {
  return (
    url.hostname === "chromewebstore.google.com" ||
    (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore"))
  );
}

/** The match pattern covering everything on the same origin. Ports are not
 * part of a match pattern, so `http://localhost:3000` and `http://localhost:8080`
 * are one grant — which is the right granularity for a dev machine. */
function originPattern(url: URL): string {
  return `${url.protocol}//${url.hostname}/*`;
}

async function allowedOnFileUrls(): Promise<boolean> {
  try {
    return await chrome.extension.isAllowedFileSchemeAccess();
  } catch {
    return false;
  }
}

/**
 * Classifies the active tab. Never throws: every failure mode is one of the
 * states above, since callers are UI handlers that must render something
 * useful either way.
 */
export async function getPageAccess(): Promise<PageAccess> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return { status: "no-tab" };
  }
  if (!tab?.id) return { status: "no-tab" };

  const raw = tab.url || tab.pendingUrl;
  if (!raw) return { status: "no-tab" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { status: "restricted", url: raw, reason: "Chrome reports no address for this tab." };
  }

  if (BROWSER_SCHEMES.includes(url.protocol)) {
    return {
      status: "restricted",
      url: raw,
      reason: "Chrome does not allow extensions to run on its own pages.",
    };
  }

  if (url.protocol === "file:") {
    if (await allowedOnFileUrls()) {
      return { status: "ready", tabId: tab.id, url: raw };
    }
    return {
      status: "restricted",
      url: raw,
      reason:
        "Chrome blocks extensions on local files until “Allow access to file URLs” is switched " +
        "on for Enloop at chrome://extensions.",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      status: "restricted",
      url: raw,
      reason: `Enloop can only act on http and https pages, not ${url.protocol}`,
    };
  }

  if (isWebStore(url)) {
    return {
      status: "restricted",
      url: raw,
      reason: "Chrome blocks every extension on the Chrome Web Store.",
    };
  }

  const origin = originPattern(url);
  const granted = await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
  if (granted) return { status: "ready", tabId: tab.id, url: raw };
  return { status: "needs-grant", tabId: tab.id, url: raw, origin, host: url.hostname };
}

/**
 * Asks Chrome for access to one origin.
 *
 * Must be called straight out of a click handler with nothing awaited before
 * it: Chrome requires a live user gesture, and an `await` in front of this
 * spends it. That constraint is why `getPageAccess` never requests anything
 * itself — it reports `needs-grant`, the UI renders a button, and the
 * button's handler calls this as its first statement.
 */
export async function requestSiteAccess(origin: string): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

/** One sentence for a tester, for the states that are not `ready`. */
export function pageAccessMessage(access: PageAccess): string | null {
  switch (access.status) {
    case "ready":
      return null;
    case "no-tab":
      return "No page open to act on — open the app in a tab first.";
    case "restricted":
      return access.reason;
    case "needs-grant":
      return `Enloop needs your permission to act on ${access.host}.`;
  }
}

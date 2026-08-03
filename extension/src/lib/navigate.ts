import { getActiveTabId, getActivePageUrl } from "./automation.js";

/**
 * Turning a step's `Where:` into a page the tester can open in one click.
 *
 * `Where:` is prose as often as it is a route — "the CRM's web console →
 * Contacts", "terminal, in the deployed app's project root" — so this is a
 * best-effort read of the text, and everything it cannot confidently open
 * simply gets no button.
 */

/** `localhost:3000`, `127.0.0.1:8080/admin` — a scheme-less local address,
 * which is what a case testing against a dev server usually names. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

const ABSOLUTE = /^https?:\/\//i;

/** Shape-only test, so the UI can decide whether to offer a Navigate control
 * without first going and asking the browser what tab is active. A `/path`
 * says yes here and may still fail to resolve later — see
 * `resolveNavigationTarget`. */
export function looksNavigable(where: string): boolean {
  const value = where.trim();
  if (!value || /\s/.test(value.split("?")[0].split("#")[0].trim())) {
    // A route has no spaces in it. Anything that does is prose describing a
    // place, not an address — "the CRM's web console → Contacts".
    return ABSOLUTE.test(value) && !/\s/.test(value);
  }
  return ABSOLUTE.test(value) || LOCAL_HOST.test(value) || value.startsWith("/");
}

/**
 * The absolute URL a `Where:` names, or a reason it cannot be resolved.
 *
 * A bare path like `/admin/sync-console` is only half an address; the other
 * half is whichever origin the tester is already on. That is the right guess
 * far more often than not — they are testing an app and have it open — but
 * it is a guess, so the caller shows the result before acting on it, and a
 * case that wants certainty writes an absolute `Where:` (or builds one from
 * a `%BASE_URL%` variable, which is substituted before the run starts).
 */
export function resolveNavigationTarget(
  where: string,
  pageUrl: string | undefined,
): { url: string } | { error: string } {
  const value = where.trim();

  if (ABSOLUTE.test(value)) return { url: value };
  if (LOCAL_HOST.test(value)) return { url: `http://${value}` };

  if (value.startsWith("/")) {
    if (!pageUrl || !ABSOLUTE.test(pageUrl)) {
      return {
        error:
          "This step names a path, so it needs an open page to resolve against. " +
          "Open the app in this tab first.",
      };
    }
    try {
      return { url: new URL(value, new URL(pageUrl).origin).toString() };
    } catch {
      return { error: `Could not build a URL from ${value}.` };
    }
  }

  return { error: `${value} is not a route this can open.` };
}

/** Navigates the tab the run is being executed against — the same tab
 * Highlight and automated steps use, deliberately, so "open the page" leaves
 * the tester exactly where the next step expects them. */
export async function navigateActiveTab(url: string): Promise<void> {
  const tabId = await getActiveTabId();
  await chrome.tabs.update(tabId, { url });
}

/** Resolves against the active tab and navigates it. Returns the URL opened,
 * or throws with a message meant to be shown to the tester. */
export async function openWhere(where: string): Promise<string> {
  const resolved = resolveNavigationTarget(where, await getActivePageUrl());
  if ("error" in resolved) throw new Error(resolved.error);
  await navigateActiveTab(resolved.url);
  return resolved.url;
}

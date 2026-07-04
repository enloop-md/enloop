import type { AutomatedResult } from "@tcm/shared";

export async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found to run the automated step against.");
  return tab.id;
}

/** Used to seed `page-url`/`page-domain` variable generators. Returns
 * `undefined` rather than throwing — a run can still start without it, the
 * generated value just comes back blank for the user to fill in by hand. */
export async function getActivePageUrl(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url;
}

/**
 * Calls the global `public/harness.js` defines. Reinjected fresh before
 * every automated step (idempotent — redefining the global is harmless),
 * since world state doesn't survive a page navigation, and the previous
 * step may well have navigated the page.
 */
function callHarness(userScript: string): Promise<{
  status: "success" | "failed" | "warning";
  warnings: string[];
  error?: string;
  stack?: string;
}> {
  return (
    globalThis as unknown as {
      __tcmRunAutomatedStep: (src: string) => Promise<{
        status: "success" | "failed" | "warning";
        warnings: string[];
        error?: string;
        stack?: string;
      }>;
    }
  ).__tcmRunAutomatedStep(userScript);
}

export async function runScriptInTab(tabId: number, script: string): Promise<AutomatedResult> {
  // Everything here runs in the page's own MAIN world, deliberately. Blob
  // URLs (used to load the step's script without eval/CSP issues) are only
  // fetchable by the same world that created them — a blob created from an
  // isolated-world content script isn't visible to the page's own document,
  // which is what was actually behind both the "Failed to fetch dynamically
  // imported module" and the follow-up "CSP blocks it" errors (neither was
  // really about CSP). Running harness.js itself in MAIN world sidesteps
  // that mismatch entirely instead of working around it after the fact.
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["harness.js"],
  });

  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: callHarness,
    args: [script],
  });
  const result = injections[0]?.result;
  if (!result) {
    return { status: "failed", warnings: [], error: "Automated step produced no result." };
  }
  return result;
}

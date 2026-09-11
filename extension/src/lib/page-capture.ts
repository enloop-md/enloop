import { getPageAccess, pageAccessMessage } from "./page-access.js";

/**
 * What a question can carry along: the page as pixels, and the page as
 * structure. Both are for the agent session answering the question — a
 * screenshot shows the state the tester is looking at, and the DOM
 * snapshot is what selectors get verified against.
 *
 * Every capture degrades to `null` rather than failing the ask: a
 * restricted page, a lapsed grant, or a tab mid-navigation should cost the
 * attachment, never the question.
 */

/** Caps keep a framework page from turning one question into megabytes.
 * Generous on purpose — the reader greps this file, it never loads it into
 * a context window whole. */
const SNAPSHOT_FRAME_CAP = 400_000;
const SNAPSHOT_TOTAL_CAP = 1_500_000;

/**
 * Injected per frame. Serializes the live DOM with the noise removed:
 * scripts, styles and stylesheets say nothing about structure, and `data:`
 * URLs are base64 by the megabyte. Everything that identifies an element —
 * ids, classes, data-testids, aria — survives, which is the point.
 */
function snapshotFrame(): { url: string; html: string } {
  const root = document.documentElement.cloneNode(true) as HTMLElement;
  for (const el of root.querySelectorAll("script, style, link[rel='stylesheet'], noscript, template")) {
    el.remove();
  }
  for (const el of root.querySelectorAll("[src], [href], [srcset]")) {
    for (const attr of ["src", "href", "srcset"]) {
      const value = el.getAttribute(attr);
      if (value && value.startsWith("data:")) el.setAttribute(attr, "data:…stripped");
    }
  }
  return { url: location.href, html: root.outerHTML };
}

/** Sanitized DOM of the active tab, every reachable frame included, each
 * introduced by a `<!-- enloop frame: <url> -->` marker so a selector found
 * in the file can be placed in the right document. */
export async function capturePageSnapshot(): Promise<{ html: string; url: string } | null> {
  const access = await getPageAccess();
  if (access.status !== "ready") return null;
  try {
    const injections = await chrome.scripting.executeScript({
      target: { tabId: access.tabId, allFrames: true },
      world: "ISOLATED",
      func: snapshotFrame,
    });
    // Top frame first — frameId 0 is the document the tester thinks of as
    // "the page", and the file should read in that order.
    injections.sort((a, b) => (a.frameId ?? 0) - (b.frameId ?? 0));
    const parts: string[] = [];
    let total = 0;
    for (const injection of injections) {
      const result = injection?.result;
      if (!result) continue;
      const html =
        result.html.length > SNAPSHOT_FRAME_CAP
          ? `${result.html.slice(0, SNAPSHOT_FRAME_CAP)}\n<!-- enloop: frame truncated -->`
          : result.html;
      if (total + html.length > SNAPSHOT_TOTAL_CAP) {
        parts.push("<!-- enloop: remaining frames omitted for size -->");
        break;
      }
      total += html.length;
      parts.push(`<!-- enloop frame: ${result.url} -->\n${html}`);
    }
    return parts.length > 0 ? { html: parts.join("\n\n"), url: access.url } : null;
  } catch {
    return null;
  }
}

/** PNG of the visible viewport of the active tab. */
export async function captureScreenshot(): Promise<Uint8Array | null> {
  const result = await captureScreenshotDetailed();
  return result.ok ? result.png : null;
}

export type CaptureResult =
  | { ok: true; png: Uint8Array }
  /** `needsGesture`: Chrome refused because this tab has not granted
   * `activeTab` yet — a per-origin grant does not count for captures.
   * The tester fixes it with a gesture on the tab: the shortcut, the
   * page's context-menu item, or the toolbar icon. */
  | { ok: false; error: string; needsGesture: boolean };

/** Chrome's exact refusal when neither `activeTab` nor all-sites access
 * covers the tab. */
const PERMISSION_REFUSAL = /activeTab|all_urls/;

/** What to tell a tester when Chrome refuses a capture on this tab. */
export const GESTURE_HINT =
  "Chrome lets Enloop photograph a tab only after you invoke it there: press Alt+Shift+S on the page, or right-click it and choose “Take an Enloop screenshot”. After that, this tab stays photographable until it moves to another site.";

/**
 * The same capture, with Chrome's reason when it refuses — a screenshot
 * button that says "could not be captured" and nothing else sends the
 * tester guessing between a missing grant, a protected page and a rate
 * limit (Chrome allows two captures a second).
 */
export async function captureScreenshotDetailed(): Promise<CaptureResult> {
  const access = await getPageAccess();
  if (access.status !== "ready") {
    return { ok: false, error: pageAccessMessage(access) ?? "no page to capture", needsGesture: false };
  }
  let lastError = "";
  // With the tab's window first; without one (the current window) as the
  // fallback, since the two disagree in some multi-window arrangements.
  const attempts: (() => Promise<string>)[] = [
    async () => {
      const tab = await chrome.tabs.get(access.tabId);
      if (tab.windowId === undefined) throw new Error("the tab has no window");
      return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    },
    () => chrome.tabs.captureVisibleTab({ format: "png" }),
  ];
  for (const attempt of attempts) {
    try {
      const dataUrl = await attempt();
      const base64 = dataUrl.split(",")[1] ?? "";
      const bytes = atob(base64);
      const out = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
      return { ok: true, png: out };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(chrome.runtime.lastError?.message ?? e);
    }
  }
  return {
    ok: false,
    error: lastError || "Chrome refused the capture",
    needsGesture: PERMISSION_REFUSAL.test(lastError),
  };
}

/** The active page's URL, for a question sent without a snapshot. Unlike
 * the captures, the URL needs no host grant — the `tabs` permission knows
 * it even for a page the panel cannot script — so a question from an
 * ungranted or restricted page still says where the tester was standing. */
export async function activePageUrl(): Promise<string> {
  const access = await getPageAccess();
  switch (access.status) {
    case "ready":
    case "needs-grant":
    case "restricted":
      return access.url;
    default:
      return "";
  }
}

/**
 * The panel's half of console/network capture: the setting, the "is this page
 * wrapped?" ping, and the pipe the service worker buffers into.
 *
 * The page-side scripts live in `public/console-capture.js` (MAIN world) and
 * `public/console-relay.js` (ISOLATED world); the registration lifecycle and
 * the buffer live in `background/capture.ts`. This file is what a screen
 * imports, plus the constants all three sides have to agree on.
 *
 * Nothing here decides to capture anything. Capture is off until a tester
 * turns it on in Settings, because console output can contain tokens and
 * customer data, and runs are written to a folder people commit.
 */

import type { CapturedEntry } from "@tcm/shared";

/** `chrome.storage.local`, so the ISOLATED-world relay can read it too — it
 * cannot see `localStorage` for the panel's origin, and it must learn the
 * setting without a round trip to the service worker. Duplicated as a literal
 * in `public/console-relay.js`; change both. */
export const CAPTURE_SETTINGS_KEY = "enloop:capture";

/**
 * How much of the page's traffic to keep.
 *
 * Three states rather than a boolean because "every request" and "only the
 * ones that broke" are different jobs, not different intensities of the same
 * one. Failures are evidence about a defect; the whole trace answers *what did
 * this app actually call when I clicked that*, which is the question nobody
 * can answer from the outside and the reason DevTools gets opened at all.
 *
 * It stays one setting with three values rather than two booleans, because two
 * booleans can express "capture every request, but not the failed ones", which
 * is not a thing anyone means.
 */
export type NetworkCapture = "off" | "failed" | "all";

export interface CaptureSettings {
  /** `console.log`/`info`/`warn`/`error`/`debug`, plus uncaught errors and
   * unhandled rejections. */
  console: boolean;
  /** Never headers and never bodies at any setting, and query strings are
   * redacted — those are the parts that carry credentials by design. Its own
   * setting rather than riding on the console one: a tester who agreed to
   * capture logs has not agreed to capture traffic. */
  network: NetworkCapture;
}

export const CAPTURE_OFF: CaptureSettings = { console: false, network: "off" };

export function captureIsOn(settings: CaptureSettings): boolean {
  return settings.console || settings.network !== "off";
}

/** Reads the stored value, accepting the boolean this used to be: `true` meant
 * failures only, which is what it still means. */
function toNetworkCapture(value: unknown): NetworkCapture {
  if (value === "all" || value === "failed") return value;
  if (value === true || value === "true") return "failed";
  return "off";
}

/** The stored value as a settings object, however it was written — used by
 * the reader below and by the live `storage.onChanged` listener, which sees the
 * same raw shape. */
export function normalizeCaptureSettings(value: unknown): CaptureSettings {
  const raw = value as Partial<CaptureSettings> | undefined;
  return { console: !!raw?.console, network: toNetworkCapture(raw?.network) };
}

export async function readCaptureSettings(): Promise<CaptureSettings> {
  try {
    const stored = await chrome.storage.local.get(CAPTURE_SETTINGS_KEY);
    return normalizeCaptureSettings(stored[CAPTURE_SETTINGS_KEY]);
  } catch {
    return { ...CAPTURE_OFF };
  }
}

/** The write the whole feature turns on: the relay is watching this key, and
 * the service worker registers or unregisters the content scripts from it. */
export async function writeCaptureSettings(settings: CaptureSettings): Promise<void> {
  await chrome.storage.local.set({ [CAPTURE_SETTINGS_KEY]: settings });
}

// ---- the pipe ----

export const CAPTURE_BATCH_MESSAGE = "enloop:capture-batch";
export const CAPTURE_TARGET_MESSAGE = "enloop:capture-target";
export const CAPTURE_DRAIN_MESSAGE = "enloop:capture-drain";

/**
 * What the panel is currently recording into.
 *
 * `key` identifies a run or a free run; entries are buffered under it and
 * drained by it, so two windows each running a case cannot drink each other's
 * output. Set per browser window, because the entry's window is the only
 * honest way to attribute a page's output to a panel — the side panel is
 * per-window, and so is the tab the tester is driving.
 */
export interface CaptureTarget {
  key: string;
  /** The step that was running when an entry arrived; the service worker
   * stamps it on. Null for a free run, and before the first step starts. */
  stepId: string | null;
}

export function runCaptureKey(testCaseId: string, runId: string): string {
  return `run:${testCaseId}:${runId}`;
}

export function freeRunCaptureKey(freeRunId: string): string {
  return `free-run:${freeRunId}`;
}

async function currentWindowId(): Promise<number> {
  const window = await chrome.windows.getCurrent();
  return window.id ?? chrome.windows.WINDOW_ID_CURRENT;
}

/** Starts (or re-points) capture for this window. Called when a run screen
 * opens and again whenever the current step changes. */
export async function setCaptureTarget(key: string, stepId: string | null): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: CAPTURE_TARGET_MESSAGE,
      windowId: await currentWindowId(),
      target: { key, stepId } satisfies CaptureTarget,
    });
  } catch {
    // The service worker is gone (an extension reload mid-run). Capture stops;
    // the run is unaffected.
  }
}

/** Stops capture for this window, but only if it is still pointed at `key` —
 * an unmount that raced another screen's mount must not turn off the capture
 * that screen just started. */
export async function clearCaptureTarget(key: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: CAPTURE_TARGET_MESSAGE,
      windowId: await currentWindowId(),
      target: null,
      onlyIfKey: key,
    });
  } catch {
    // See above.
  }
}

/** Takes everything buffered for `key` and empties the buffer. The caller owns
 * the entries from here — they are gone from the service worker, so a failed
 * write loses them. */
export async function drainCapture(key: string): Promise<CapturedEntry[]> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: CAPTURE_DRAIN_MESSAGE,
      key,
    })) as { entries?: CapturedEntry[] } | undefined;
    return response?.entries ?? [];
  } catch {
    return [];
  }
}

// ---- "is this page wrapped?" ----

export type WrapperState =
  /** The wrapper is installed in the active tab — capture is live. */
  | "present"
  /** An ordinary page loaded before capture was registered. A reload fixes it. */
  | "absent"
  /** Nothing to ask: no tab, a `chrome://` page, or a site Enloop cannot
   * script yet. Not a problem to nag about — the run flow grants site access
   * when a step needs it. */
  | "unknown";

/**
 * Asks the page itself, rather than reasoning from when the toggle was flipped.
 *
 * A stored `enabledAt` gets exactly one case wrong, and it is a common one: a
 * tab loaded *before* the toggle went on still has no wrapper, and switching
 * to it would show no notice while quietly capturing nothing. Asking the page
 * is right in every case, clears itself on reload, and stays up if the tester
 * ignores it.
 */
export async function wrapperState(): Promise<WrapperState> {
  let tabId: number | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  } catch {
    return "unknown";
  }
  if (tabId === undefined) return "unknown";

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => !!(window as unknown as { __enloopConsole?: unknown }).__enloopConsole,
    });
    return injection?.result ? "present" : "absent";
  } catch {
    // No host permission for this origin, or a page no extension may touch.
    return "unknown";
  }
}

/** The fix the notice offers. A registration only takes effect on the next
 * navigation, so this is the whole mechanism, not a convenience. */
export async function reloadActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
  } catch {
    // Nothing to reload.
  }
}

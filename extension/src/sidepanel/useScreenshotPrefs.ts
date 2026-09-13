import { useCallback, useEffect, useState } from "react";

/**
 * Whether a test run shows its screenshot tools.
 *
 * Pictures are what a guide is made of, so a guide run always shows them.
 * On a test they are evidence for the odd step and dead space on every
 * other: the capture buttons, the delayed-capture countdown and the runner's
 * slot rows sit under each step whether or not anyone will ever take a
 * picture there. So a test run hides all of that by default, and a tester
 * who wants it — a visual regression, a case whose failures need showing —
 * turns it on in Settings, in front of the run, or from the run itself.
 *
 * One setting for the whole extension, on the same argument as capture: it
 * appears in three places and a tester who ticks it in one is entitled to
 * see it ticked in the others, so storage is the state and every screen
 * follows it. Pictures already taken are shown regardless — the setting
 * hides tools, never evidence — and the keyboard shortcut and context-menu
 * capture keep working either way.
 */
export const SCREENSHOT_PREFS_KEY = "enloop:screenshot-prefs";

export interface ScreenshotPrefs {
  /** Show the screenshot tools on test (non-guide) runs. */
  onTests: boolean;
}

const DEFAULT_PREFS: ScreenshotPrefs = { onTests: false };

function normalize(value: unknown): ScreenshotPrefs {
  const raw = value as Partial<ScreenshotPrefs> | undefined;
  return { onTests: !!raw?.onTests };
}

export async function readScreenshotPrefs(): Promise<ScreenshotPrefs> {
  try {
    const stored = await chrome.storage.local.get(SCREENSHOT_PREFS_KEY);
    return normalize(stored[SCREENSHOT_PREFS_KEY]);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function writeScreenshotPrefs(prefs: ScreenshotPrefs): Promise<void> {
  await chrome.storage.local.set({ [SCREENSHOT_PREFS_KEY]: prefs });
}

/** The stored preference, kept current across screens, with its writer. */
export function useScreenshotPrefs(): [ScreenshotPrefs, (next: ScreenshotPrefs) => void] {
  const [prefs, setPrefs] = useState<ScreenshotPrefs>({ ...DEFAULT_PREFS });

  useEffect(() => {
    let cancelled = false;
    void readScreenshotPrefs().then((next) => !cancelled && setPrefs(next));
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !changes[SCREENSHOT_PREFS_KEY]) return;
      setPrefs(normalize(changes[SCREENSHOT_PREFS_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  // Local first, storage second — a checkbox that waits for the round trip
  // feels broken; the write echoes back through the subscription.
  const set = useCallback((next: ScreenshotPrefs) => {
    setPrefs(next);
    void writeScreenshotPrefs(next);
  }, []);

  return [prefs, set];
}

/** Whether this run shows its screenshot tools: guides always, tests by
 * preference. */
export function screenshotsShown(kind: "test" | "guide" | string, prefs: ScreenshotPrefs): boolean {
  return kind === "guide" || prefs.onTests;
}

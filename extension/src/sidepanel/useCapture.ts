/**
 * Recording what the page said, for as long as a screen is open on something
 * that can hold it.
 *
 * Both callers — a run and a free run — need the same four things: know whether
 * capture is on, tell the service worker where to put arriving entries, move
 * them to disk every few seconds, and know whether the page in front of the
 * tester is actually wrapped. That last one is the whole reason this is a hook
 * and not three lines in each screen: the answer changes when the tester
 * switches tabs or reloads, and a stale answer is a notice that lies in both
 * directions.
 *
 * The setting itself is one thing for the whole extension, not a property of a
 * run, so the two hooks that read it — `useCaptureSettings` for the screens
 * that offer the checkboxes, `useCaptureRecorder` for the screens that record
 * — both follow `chrome.storage` rather than holding a copy. Ticking a box in
 * front of a run reaches Settings, a run already in progress, and the service
 * worker's registration by the same route.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAPTURE_MAX_ENTRIES,
  ZERO_CAPTURE_COUNTS,
  totalCounts,
  type CaptureCounts,
  type CapturedEntry,
} from "@tcm/shared";
import {
  CAPTURE_OFF,
  CAPTURE_SETTINGS_KEY,
  captureIsOn,
  clearCaptureTarget,
  drainCapture,
  readCaptureSettings,
  setCaptureTarget,
  wrapperState,
  writeCaptureSettings,
  type CaptureSettings,
  type WrapperState,
} from "../lib/capture.js";

/**
 * How often entries move from the service worker to disk.
 *
 * Not on every batch: a chatty page would turn each keystroke into a file
 * write. Not once at the end either — a run that is never finished (the panel
 * closed, Chrome restarted) would keep nothing at all, and an abandoned run is
 * one of the cases where the log explains the most.
 */
const DRAIN_INTERVAL_MS = 2500;

/**
 * How long to leave the page alone after capture is switched on before asking
 * whether it is wrapped.
 *
 * Registering the content scripts is the service worker's reaction to the
 * setting being written, so for a moment after the click the honest answer is
 * "not yet" for a page that would be fine on its next load anyway. Waiting
 * costs nothing — the notice is about a reload the tester has not done — and
 * saves showing one that is wrong the instant it appears.
 */
const WRAPPER_SETTLE_MS = 300;

/**
 * The extension-wide capture setting, kept current, with the writer beside it.
 *
 * Storage is the state: the two checkboxes appear in Settings, in front of a
 * run and in a free run, and a tester who ticks one in one place is entitled to
 * see it ticked in the others. The subscription is what makes that true without
 * anything having to be told.
 */
function useStoredCaptureSettings(): [CaptureSettings, (next: CaptureSettings) => void] {
  const [settings, setSettings] = useState<CaptureSettings>({ ...CAPTURE_OFF });

  useEffect(() => {
    let cancelled = false;
    void readCaptureSettings().then((next) => !cancelled && setSettings(next));
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !changes[CAPTURE_SETTINGS_KEY]) return;
      const value = changes[CAPTURE_SETTINGS_KEY].newValue as Partial<CaptureSettings> | undefined;
      setSettings({ console: !!value?.console, network: !!value?.network });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  // Moved locally first and written second: a checkbox that waits for a storage
  // round trip to move is a checkbox that feels broken. The write echoes back
  // through the subscription and agrees with what is already on screen.
  const set = useCallback((next: CaptureSettings) => {
    setSettings(next);
    void writeCaptureSettings(next);
  }, []);

  return [settings, set];
}

/**
 * Whether the page in front of the tester carries the wrapper — asked of the
 * page itself, and asked again whenever the answer could have changed.
 *
 * `active` is "is there anything to say", not "is capture on": with capture off
 * there is no notice to drive, and pinging every tab switch would be work
 * nobody asked for. Switching tabs and finishing a load are the two moments the
 * answer flips, and the second of them is how the notice clears itself after
 * the tester takes the reload it asked for.
 */
export function useWrapperState(active: boolean): WrapperState {
  const [wrapper, setWrapper] = useState<WrapperState>("unknown");

  useEffect(() => {
    if (!active) {
      setWrapper("unknown");
      return;
    }
    let cancelled = false;
    const check = () => {
      void wrapperState().then((state) => !cancelled && setWrapper(state));
    };
    const settle = setTimeout(check, WRAPPER_SETTLE_MS);
    const onActivated = () => check();
    const onUpdated = (_id: number, change: chrome.tabs.TabChangeInfo) => {
      if (change.status === "complete") check();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      clearTimeout(settle);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [active]);

  return wrapper;
}

export interface CaptureControl {
  settings: CaptureSettings;
  /** Either stream is on. */
  on: boolean;
  /** What the active tab says about itself — what the reload notice is driven
   * by, and meaningful only while capture is on. */
  wrapper: WrapperState;
  /** Writes the setting for the whole extension. Every screen offering the
   * checkboxes writes the same key, and everything else follows it. */
  set: (next: CaptureSettings) => void;
}

/** The capture checkboxes, for a screen that offers them rather than records
 * through them. */
export function useCaptureSettings(): CaptureControl {
  const [settings, set] = useStoredCaptureSettings();
  const on = captureIsOn(settings);
  return { settings, on, wrapper: useWrapperState(on), set };
}

export interface CaptureRecorder {
  /** Either stream is on. When false, nothing below is doing anything. */
  on: boolean;
  settings: CaptureSettings;
  /** Whether the active tab carries the wrapper — what the notice is driven by. */
  wrapper: WrapperState;
  /** Everything written for this target since this screen opened. */
  counts: CaptureCounts;
  /** Entries seen, for the cap and for "nothing was captured" copy. */
  total: number;
  /** Moves whatever is buffered to disk now. Call before finishing, so the
   * last few seconds — usually the interesting ones — are in the file the
   * report is built from. */
  flush: () => Promise<void>;
  /** Turns capture on or off for the whole extension, for a screen that offers
   * the checkboxes as well as recording through them. */
  set: (next: CaptureSettings) => void;
}

export function useCaptureRecorder(opts: {
  /** Where entries belong; null while there is nothing to record into. */
  key: string | null;
  /** The step to stamp on arriving entries, or null for a free run. */
  stepId: string | null;
  /** False once the run is finished — capture stops with it. */
  active: boolean;
  append: (entries: CapturedEntry[]) => Promise<void>;
}): CaptureRecorder {
  const { key, stepId, active, append } = opts;

  // The same setting the checkboxes write, followed rather than copied:
  // toggling in Settings, or in front of the next run, reaches a run already in
  // progress — the tester turned capture on *because* of what they are looking
  // at. The wrapper ping below is this screen's own, because what it is asking
  // about is narrower than "is capture on".
  const [settings, set] = useStoredCaptureSettings();
  const on = captureIsOn(settings);
  const [counts, setCounts] = useState<CaptureCounts>({ ...ZERO_CAPTURE_COUNTS });
  const [total, setTotal] = useState(0);

  // Read through refs inside the interval and the listeners: they are set up
  // once, and closing over the first render's values would freeze the target
  // at step 1 and the tally at zero.
  const appendRef = useRef(append);
  appendRef.current = append;
  const totalRef = useRef(0);
  const cappedRef = useRef(false);
  const recording = active && key !== null && on;
  // Nothing to say about the page once this run is over: a finished run's
  // screen is a record, not a thing to reload for.
  const wrapper = useWrapperState(recording);

  const take = useCallback(async () => {
    if (!key) return;
    const entries = await drainCapture(key);
    if (entries.length === 0) return;

    // Drained either way — leaving them in the worker would grow a buffer
    // nobody is going to write — but past the cap they are counted and
    // dropped, with one marker on the way out so the log says so.
    if (cappedRef.current) return;
    let batch = entries;
    if (totalRef.current + entries.length > CAPTURE_MAX_ENTRIES) {
      const room = Math.max(0, CAPTURE_MAX_ENTRIES - totalRef.current);
      const dropped = entries.length - room;
      batch = entries.slice(0, room);
      batch.push({
        level: "notice",
        at: new Date().toISOString(),
        url: "",
        text: `Capture stopped after ${CAPTURE_MAX_ENTRIES} entries; ${dropped} more were dropped.`,
      });
      cappedRef.current = true;
    }

    totalRef.current += batch.length;
    setTotal(totalRef.current);
    const batchCounts = totalCounts(batch);
    setCounts((previous) => ({
      consoleErrors: previous.consoleErrors + batchCounts.consoleErrors,
      consoleWarnings: previous.consoleWarnings + batchCounts.consoleWarnings,
      networkFailures: previous.networkFailures + batchCounts.networkFailures,
    }));
    await appendRef.current(batch);
  }, [key]);

  // Point the worker at this screen, and keep the stamped step current.
  useEffect(() => {
    if (!recording || !key) return;
    void setCaptureTarget(key, stepId);
  }, [recording, key, stepId]);

  useEffect(() => {
    if (!recording || !key) return;
    const timer = setInterval(() => void take(), DRAIN_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      // One last drain on the way out, then stop recording for this window.
      // Not awaited — an unmount cannot wait — but it is fired before the
      // target is cleared, so nothing already buffered is orphaned.
      void take().finally(() => void clearCaptureTarget(key));
    };
  }, [recording, key, take]);

  return {
    on,
    settings,
    wrapper,
    counts,
    total,
    flush: take,
    set,
  };
}

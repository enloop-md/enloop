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
  CAPTURE_SETTINGS_KEY,
  captureIsOn,
  clearCaptureTarget,
  drainCapture,
  readCaptureSettings,
  setCaptureTarget,
  wrapperState,
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

  const [settings, setSettings] = useState<CaptureSettings>({ console: false, network: false });
  const [wrapper, setWrapper] = useState<WrapperState>("unknown");
  const [counts, setCounts] = useState<CaptureCounts>({ ...ZERO_CAPTURE_COUNTS });
  const [total, setTotal] = useState(0);

  // Read through refs inside the interval and the listeners: they are set up
  // once, and closing over the first render's values would freeze the target
  // at step 1 and the tally at zero.
  const appendRef = useRef(append);
  appendRef.current = append;
  const totalRef = useRef(0);
  const cappedRef = useRef(false);
  const recording = active && key !== null && captureIsOn(settings);

  useEffect(() => {
    let cancelled = false;
    void readCaptureSettings().then((next) => !cancelled && setSettings(next));
    // Toggling in Settings must reach a run already in progress: the tester
    // turned capture on *because* of what they are looking at.
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
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

  // Ask the page itself, and ask again whenever the page could have changed.
  // A tab activated or reloaded is exactly when the answer flips, and it is
  // also when the tester is most likely to be looking at the notice.
  useEffect(() => {
    if (!recording) {
      setWrapper("unknown");
      return;
    }
    let cancelled = false;
    const check = () => {
      void wrapperState().then((state) => !cancelled && setWrapper(state));
    };
    check();
    const onActivated = () => check();
    const onUpdated = (_id: number, change: chrome.tabs.TabChangeInfo) => {
      if (change.status === "complete") check();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [recording]);

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
    on: captureIsOn(settings),
    settings,
    wrapper,
    counts,
    total,
    flush: take,
  };
}

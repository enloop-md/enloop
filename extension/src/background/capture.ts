/**
 * The service worker's half of console/network capture: which pages carry the
 * wrapper, and where entries wait until the panel can write them to disk.
 *
 * Two reasons this is not in the side panel:
 *
 * - **Registration** must survive the panel being closed, and must be
 *   reconciled at startup. A dynamic content-script registration is
 *   browser-wide state; leaving one behind means injecting into every page of
 *   a user who turned the feature off.
 * - **Buffering** must survive it too. The panel is where entries become files
 *   (only it holds the folder handles), but it unloads whenever the tester
 *   closes it, and a run keeps running. The worker holds what arrives in the
 *   meantime so the log has no hole in the middle.
 */

import type { CapturedEntry } from "@tcm/shared";
import {
  CAPTURE_BATCH_MESSAGE,
  CAPTURE_DRAIN_MESSAGE,
  CAPTURE_SETTINGS_KEY,
  CAPTURE_TARGET_MESSAGE,
  captureIsOn,
  readCaptureSettings,
  type CaptureTarget,
} from "../lib/capture.js";

const MAIN_SCRIPT_ID = "enloop-capture-main";
const RELAY_SCRIPT_ID = "enloop-capture-relay";

/** In-memory session state, not `local`: a buffer that outlived a browser
 * restart would attach yesterday's console output to today's run. */
const STATE_KEY = "enloop:capture-state";

/**
 * How many entries one run may have waiting to be written. Reaching this means
 * the panel has been closed for a long time against a chatty page; the marker
 * that gets drained with the batch says so rather than letting the log look
 * complete.
 */
const BUFFER_MAX_PER_KEY = 3000;

interface CaptureState {
  /** Per browser window: what that window's panel is recording into. */
  targets: Record<string, CaptureTarget>;
  /** Per target key: entries waiting to be drained. */
  buffers: Record<string, CapturedEntry[]>;
  /** Per target key: entries refused because the buffer was full. */
  dropped: Record<string, number>;
}

const EMPTY_STATE: CaptureState = { targets: {}, buffers: {}, dropped: {} };

async function readState(): Promise<CaptureState> {
  try {
    const stored = await chrome.storage.session.get(STATE_KEY);
    const value = stored[STATE_KEY] as CaptureState | undefined;
    return value ? { ...EMPTY_STATE, ...value } : { ...EMPTY_STATE };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeState(state: CaptureState): Promise<void> {
  try {
    await chrome.storage.session.set({ [STATE_KEY]: state });
  } catch {
    // Session storage is full or unavailable — capture degrades, the run does
    // not.
  }
}

/**
 * Every state change goes through here, one at a time.
 *
 * Batches arrive from every frame of every tab, and a read-modify-write of the
 * whole state under two interleaved `await`s loses whichever one finished
 * first. The queue costs nothing at this volume and removes the entire class
 * of problem.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: (state: CaptureState) => Promise<T> | T): Promise<T> {
  const next = queue.then(async () => {
    const state = await readState();
    const result = await work(state);
    await writeState(state);
    return result;
  });
  // Keep the chain alive even if one link throws, and never let a rejection
  // become unhandled — a failed drain must not stop the next one.
  queue = next.catch(() => {});
  return next;
}

// ---- entries in ----

function acceptBatch(state: CaptureState, windowId: number | undefined, entries: CapturedEntry[]): void {
  if (windowId === undefined) return;
  const target = state.targets[String(windowId)];
  // Nothing is being recorded in this window. Dropping here is the reason
  // capture costs nothing between runs: the wrapper keeps forwarding, and the
  // worker keeps refusing.
  if (!target) return;

  const buffer = state.buffers[target.key] ?? [];
  for (const entry of entries) {
    if (buffer.length >= BUFFER_MAX_PER_KEY) {
      state.dropped[target.key] = (state.dropped[target.key] ?? 0) + 1;
      continue;
    }
    // The step is stamped here rather than in the page: the page has no idea
    // what a step is, and the panel is the only thing that knows which one is
    // running. Anything logged between steps lands on the step that was
    // current when it arrived, which is the one that just finished.
    buffer.push({ ...entry, stepId: target.stepId });
  }
  state.buffers[target.key] = buffer;
}

function drain(state: CaptureState, key: string): CapturedEntry[] {
  const entries = state.buffers[key] ?? [];
  delete state.buffers[key];
  const dropped = state.dropped[key] ?? 0;
  if (dropped > 0) {
    delete state.dropped[key];
    entries.push({
      level: "notice",
      at: new Date().toISOString(),
      url: "",
      text: `${dropped} entries dropped: the panel was closed while the page kept logging.`,
    });
  }
  return entries;
}

// ---- registration ----

/**
 * Match patterns for the origins the tester has actually granted.
 *
 * `PLAN-TOOLING.md` assumed `<all_urls>` was available to register against
 * because it is in the manifest — but it is in `optional_host_permissions`,
 * which is a list of what *may* be asked for, not of what was given. Chrome
 * will not register a content script for a host the extension cannot access,
 * so the registration follows the per-origin grants the run flow already
 * collects. One consequence worth knowing: capture starts working on a site
 * the moment that site is granted, and never before.
 */
async function grantedMatches(): Promise<string[]> {
  try {
    const { origins = [] } = await chrome.permissions.getAll();
    return origins.filter((origin) => /^(https?:\/\/|\*:\/\/|<all_urls>)/.test(origin));
  } catch {
    return [];
  }
}

function sameMatches(existing: string[] | undefined, wanted: string[]): boolean {
  if (!existing || existing.length !== wanted.length) return false;
  const sorted = [...existing].sort();
  const target = [...wanted].sort();
  return sorted.every((value, index) => value === target[index]);
}

/**
 * Makes the browser's registrations match the setting. Idempotent, and safe to
 * call often — it is the single path for enabling, disabling, and picking up a
 * newly granted origin.
 */
export async function syncCaptureRegistration(): Promise<void> {
  const existing = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  const ours = existing.filter(
    (script) => script.id === MAIN_SCRIPT_ID || script.id === RELAY_SCRIPT_ID,
  );

  const settings = await readCaptureSettings();
  const matches = captureIsOn(settings) ? await grantedMatches() : [];
  const wanted = matches.length > 0;

  // Compared rather than blindly re-applied, because this runs on every worker
  // wake: tearing the registration down and putting it back would leave a
  // window in which a page loading right then gets no wrapper at all.
  if (wanted && ours.length === 2 && ours.every((script) => sameMatches(script.matches, matches))) {
    return;
  }

  if (ours.length > 0) {
    await chrome.scripting
      .unregisterContentScripts({ ids: ours.map((script) => script.id) })
      .catch(() => {});
  }
  if (!wanted) return;

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: MAIN_SCRIPT_ID,
        matches,
        js: ["console-capture.js"],
        world: "MAIN",
        runAt: "document_start",
        allFrames: true,
        // Never persisted: a registration that outlives the browser session is
        // how a disabled feature keeps injecting. The reconcile on startup
        // re-creates it from the setting, which is the only source of truth.
        persistAcrossSessions: false,
      },
      {
        id: RELAY_SCRIPT_ID,
        matches,
        js: ["console-relay.js"],
        world: "ISOLATED",
        runAt: "document_start",
        allFrames: true,
        persistAcrossSessions: false,
      },
    ]);
  } catch {
    // A match pattern Chrome refuses, or a race with another sync. The next
    // sync (a settings change, a new grant, the next startup) tries again.
  }
}

// ---- wiring ----

interface CaptureMessage {
  type?: string;
  entries?: CapturedEntry[];
  key?: string;
  windowId?: number;
  target?: CaptureTarget | null;
  onlyIfKey?: string;
}

export function installCaptureListeners(): void {
  chrome.runtime.onStartup.addListener(() => void syncCaptureRegistration());
  chrome.runtime.onInstalled.addListener(() => void syncCaptureRegistration());

  // The setting is the trigger: the panel writes it, this reacts. One less
  // message to keep in sync, and it works even if the write came from another
  // extension page.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[CAPTURE_SETTINGS_KEY]) void syncCaptureRegistration();
  });

  // A newly granted site has to be added to the registration, and a revoked
  // one removed — otherwise capture silently covers the wrong set of pages.
  chrome.permissions.onAdded.addListener(() => void syncCaptureRegistration());
  chrome.permissions.onRemoved.addListener(() => void syncCaptureRegistration());

  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const message = raw as CaptureMessage;

    if (message?.type === CAPTURE_BATCH_MESSAGE) {
      const entries = message.entries ?? [];
      void serialize((state) => acceptBatch(state, sender.tab?.windowId, entries));
      return false;
    }

    if (message?.type === CAPTURE_TARGET_MESSAGE) {
      const windowKey = String(message.windowId);
      void serialize((state) => {
        if (message.target) state.targets[windowKey] = message.target;
        else if (!message.onlyIfKey || state.targets[windowKey]?.key === message.onlyIfKey) {
          delete state.targets[windowKey];
        }
      }).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message?.type === CAPTURE_DRAIN_MESSAGE) {
      const key = message.key ?? "";
      void serialize((state) => drain(state, key)).then((entries) => sendResponse({ entries }));
      return true;
    }

    return false;
  });
}

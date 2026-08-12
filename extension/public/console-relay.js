// NOT processed by Vite — copied verbatim from public/ into dist/ and
// registered alongside console-capture.js, in the ISOLATED world.
//
// The MAIN-world wrapper cannot read `chrome.storage` and cannot talk to the
// extension; this can do both. It exists for exactly those two errands:
//
//   - relay the capture setting *in*, as a `CustomEvent` on `document`, so
//     turning capture off takes effect on already-loaded pages without a
//     reload;
//   - relay entries *out*, batched, to the service worker.
//
// Both directions carry JSON strings rather than objects: a primitive crosses
// the world boundary with nothing to reason about.
(() => {
  const OUT_EVENT = "enloop:capture";
  const STATE_EVENT = "enloop:capture-state";
  // Must match CAPTURE_SETTINGS_KEY in src/lib/capture.ts and the message type
  // the service worker listens for.
  const SETTINGS_KEY = "enloop:capture";
  const BATCH_MESSAGE = "enloop:capture-batch";

  const FLUSH_MS = 300;
  const FLUSH_AT = 25;

  let batch = [];
  let timer = null;
  let stopped = false;

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (stopped || batch.length === 0) return;
    const entries = batch;
    batch = [];
    try {
      // The service worker may be asleep; sending wakes it. A rejection here
      // means the extension was reloaded or removed under us, in which case
      // there is nothing left to send to and retrying would spin forever.
      const sent = chrome.runtime.sendMessage({ type: BATCH_MESSAGE, entries });
      if (sent && typeof sent.catch === "function") sent.catch(() => {});
    } catch {
      stopped = true;
    }
  }

  document.addEventListener(OUT_EVENT, (event) => {
    if (stopped) return;
    let entry;
    try {
      entry = JSON.parse(event.detail);
    } catch {
      return;
    }
    batch.push(entry);
    if (batch.length >= FLUSH_AT) flush();
    else if (timer === null) timer = setTimeout(flush, FLUSH_MS);
  });

  // A navigation tears this context down; without the tail flush the last
  // batch — which is often the error that caused whatever the tester clicked
  // to navigate — never leaves the page.
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  // "off" | "failed" | "all". Stored as a boolean before every-request capture
  // existed, where true meant failures only — which is still what it means.
  function networkMode(value) {
    if (value === "all" || value === "failed") return value;
    return value === true ? "failed" : "off";
  }

  function announce(settings) {
    document.dispatchEvent(
      new CustomEvent(STATE_EVENT, {
        detail: JSON.stringify({
          console: !!(settings && settings.console),
          network: networkMode(settings && settings.network),
        }),
      }),
    );
  }

  try {
    chrome.storage.local.get(SETTINGS_KEY, (all) => {
      announce(all && all[SETTINGS_KEY]);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[SETTINGS_KEY]) return;
      announce(changes[SETTINGS_KEY].newValue);
    });
  } catch {
    // No extension context (a reload mid-navigation). Tell the wrapper
    // nothing is on, so it releases its held entries instead of holding them
    // for a relay that is never coming.
    announce(null);
  }
})();

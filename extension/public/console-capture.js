// NOT processed by Vite — copied verbatim from public/ into dist/ and
// registered as a content script in the page's own MAIN world at
// `document_start` (see src/background/capture.js's registration).
//
// Why a wrapper and not the debugger: reading the console properly means
// chrome.debugger / CDP, which shows the "Enloop started debugging this
// browser" banner and fights with a DevTools window the tester may well have
// open. That is too much tax for a background convenience. So this keeps the
// original `console.*`, `fetch` and XHR methods, calls through to them, and
// forwards a copy of what passed by.
//
// Two constraints force the reload the UI asks for, and they are facts about
// the page rather than limitations to paper over:
//
//   1. This must be installed before any page script runs. Later, and it
//      misses everything logged during load — usually the interesting part —
//      and any module that captured `console.error` into a local at import
//      time keeps bypassing the wrapper forever.
//   2. MV3's only guarantee of `document_start` in `world: "MAIN"` is a
//      registered content script, and a registration takes effect on the
//      *next* navigation.
//
// Turning capture off needs no reload: the wrapper stays installed and simply
// stops forwarding, which is what the state event below is for.
(() => {
  if (window.__enloopConsole) return;

  /** Out: one JSON string per entry, read by console-relay.js in the
   * ISOLATED world. A string rather than an object deliberately — a primitive
   * crosses the world boundary with no cloning questions to answer. */
  const OUT_EVENT = "enloop:capture";
  /** In: `{ console: boolean, network: boolean }`, same encoding. */
  const STATE_EVENT = "enloop:capture-state";

  /** Ceiling per page load, so a page logging inside a loop cannot flood the
   * message channel. The run-level cap in the panel is the one a tester sees;
   * this one exists to keep the pipe usable until then. */
  const MAX_PER_PAGE = 5000;
  /** Entries held while waiting for the first state event. The relay has to
   * read `chrome.storage` to learn whether capture is on, and that is async —
   * without this, everything the page logs in those first milliseconds (i.e.
   * everything that happens during load) would be dropped by a wrapper that
   * had not been told yet. */
  const MAX_PENDING = 500;

  const ARG_MAX_CHARS = 200;
  const LINE_MAX_CHARS = 1200;
  const MAX_DEPTH = 2;
  const MAX_KEYS = 10;

  let state = null; // null until the relay reports; then { console, network }
  let pending = [];
  let forwarded = 0;
  let capped = false;

  const xhrMeta = Symbol("enloopXhr");

  // ---- what gets sent ----

  /** Query strings are where tokens, emails and record ids live, and this file
   * has no way to tell a safe one from a dangerous one. So neither a page URL
   * nor a request URL ever carries one. */
  function redactUrl(raw) {
    try {
      const url = new URL(raw, location.href);
      const search = url.search ? "?…" : "";
      return `${url.origin}${url.pathname}${search}`;
    } catch {
      return String(raw).split("?")[0];
    }
  }

  function send(level, text, extra) {
    if (capped) return;
    if (forwarded >= MAX_PER_PAGE) {
      capped = true;
      text = `Capture stopped: this page produced more than ${MAX_PER_PAGE} entries.`;
      level = "notice";
      extra = undefined;
    }
    const entry = {
      level,
      at: new Date().toISOString(),
      url: redactUrl(location.href),
      text: text.length > LINE_MAX_CHARS ? `${text.slice(0, LINE_MAX_CHARS - 1)}…` : text,
    };
    if (extra && extra.stack) entry.stack = String(extra.stack).slice(0, 4000);
    if (extra && extra.request) entry.request = extra.request;

    // Before the relay has spoken, hold. After it has, forward or drop
    // according to which streams the tester turned on.
    if (state === null) {
      if (pending.length < MAX_PENDING) pending.push(entry);
      return;
    }
    if (!wants(entry.level)) return;
    forwarded += 1;
    document.dispatchEvent(new CustomEvent(OUT_EVENT, { detail: JSON.stringify(entry) }));
  }

  function wants(level) {
    if (level === "notice") return !!(state && (state.console || state.network));
    if (level === "network") return !!(state && state.network);
    return !!(state && state.console);
  }

  // ---- formatting ----

  function describeNode(node) {
    const tag = (node.tagName || node.nodeName || "node").toLowerCase();
    const testid =
      node.getAttribute &&
      (node.getAttribute("data-testid") ||
        node.getAttribute("data-test-id") ||
        node.getAttribute("data-test") ||
        node.getAttribute("id"));
    return testid ? `<${tag} ${JSON.stringify(testid)}>` : `<${tag}>`;
  }

  function truncate(text) {
    return text.length > ARG_MAX_CHARS ? `${text.slice(0, ARG_MAX_CHARS - 1)}…` : text;
  }

  /** Bounded and cycle-safe, because it runs on arguments the page chose and a
   * console line is not worth a stack overflow or a megabyte. */
  function format(value, depth, seen) {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    const type = typeof value;
    if (type === "string") return truncate(value);
    if (type === "number" || type === "boolean" || type === "bigint") return String(value);
    if (type === "symbol") return value.toString();
    if (type === "function") return `function ${value.name || "anonymous"}()`;

    if (value instanceof Error) {
      return `${value.name}: ${value.message}`;
    }
    if (typeof Node !== "undefined" && value instanceof Node) return describeNode(value);
    if (typeof value.then === "function" && !Array.isArray(value)) {
      // Not necessarily a promise, but printing "[object Object]" for one is
      // worse than saying so.
      if (value.constructor && value.constructor.name === "Promise") return "Promise {…}";
    }

    if (seen.has(value)) return "[circular]";
    if (depth > MAX_DEPTH) return Array.isArray(value) ? "[…]" : "{…}";
    seen.add(value);

    try {
      if (Array.isArray(value)) {
        const shown = value.slice(0, MAX_KEYS).map((v) => format(v, depth + 1, seen));
        if (value.length > MAX_KEYS) shown.push(`… ${value.length - MAX_KEYS} more`);
        return `[${shown.join(", ")}]`;
      }
      if (value instanceof Map) return `Map(${value.size})`;
      if (value instanceof Set) return `Set(${value.size})`;
      const keys = Object.keys(value).slice(0, MAX_KEYS);
      const body = keys.map((k) => `${k}: ${format(value[k], depth + 1, seen)}`);
      const total = Object.keys(value).length;
      if (total > keys.length) body.push(`… ${total - keys.length} more`);
      const name = value.constructor && value.constructor.name;
      const prefix = name && name !== "Object" ? `${name} ` : "";
      return `${prefix}{${body.join(", ")}}`;
    } catch {
      // A proxy that throws on property access, or a cross-origin window.
      return "[unreadable]";
    } finally {
      seen.delete(value);
    }
  }

  function formatArgs(args) {
    const seen = new Set();
    const parts = [];
    for (let i = 0; i < args.length && i < 8; i += 1) {
      parts.push(format(args[i], 0, seen));
    }
    if (args.length > 8) parts.push(`… ${args.length - 8} more arguments`);
    // The first Error argument's stack is the one worth keeping: it is what
    // names the file and line, and a formatted message without it sends a
    // reader looking for a needle in a bundle.
    let stack;
    for (const arg of args) {
      if (arg instanceof Error && arg.stack) {
        stack = arg.stack;
        break;
      }
    }
    return { text: parts.join(" "), stack };
  }

  // ---- console ----

  const LEVELS = ["log", "info", "warn", "error", "debug"];
  const original = {};

  for (const level of LEVELS) {
    const native = console[level];
    if (typeof native !== "function") continue;
    original[level] = native;
    const wrapper = function (...args) {
      try {
        const { text, stack } = formatArgs(args);
        send(level, text, { stack });
      } catch {
        // Never let capture break the page's own logging.
      }
      return native.apply(console, args);
    };
    // A page that reads `console.error.toString()` — some error reporters do,
    // to check whether something has already patched it — must not see this
    // wrapper's source and conclude the console is compromised.
    try {
      Object.defineProperty(wrapper, "name", { value: level });
      wrapper.toString = () => native.toString();
      console[level] = wrapper;
    } catch {
      // A frozen console object. Leave it alone; the page wins.
    }
  }

  // Uncaught errors matter most, and in some frameworks they never reach
  // `console.error` at all — an error boundary that swallows and re-reports,
  // a promise rejected with no handler.
  window.addEventListener(
    "error",
    (event) => {
      try {
        const error = event.error;
        const where = event.filename ? ` (${redactUrl(event.filename)}:${event.lineno})` : "";
        send("uncaught", `${event.message || (error && error.message) || "Error"}${where}`, {
          stack: error && error.stack,
        });
      } catch {
        /* see above */
      }
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason;
      const text =
        reason instanceof Error
          ? `Unhandled rejection: ${reason.name}: ${reason.message}`
          : `Unhandled rejection: ${format(reason, 0, new Set())}`;
      send("uncaught", text, { stack: reason instanceof Error ? reason.stack : undefined });
    } catch {
      /* see above */
    }
  });

  // ---- network ----
  //
  // Only failures: a request that 4xx'd, 5xx'd, or never completed. Requests
  // carry auth headers, cookies and bodies by design, so this captures method,
  // redacted URL, status and duration — and nothing that could be a credential
  // — and it captures them only when something went wrong. A button that did
  // nothing because a request 500'd shows up here and often nowhere else.

  function reportRequest(method, url, status, startedAt, failure) {
    const durationMs = Math.round(performance.now() - startedAt);
    const outcome = status === null ? `failed${failure ? ` (${failure})` : ""}` : `→ ${status}`;
    send("network", `${method} ${redactUrl(url)} ${outcome} in ${durationMs}ms`, {
      request: { method, status, durationMs },
    });
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    const fetchWrapper = function (input, init) {
      const startedAt = performance.now();
      const method = String(
        (init && init.method) || (input && input.method) || "GET",
      ).toUpperCase();
      const url = typeof input === "string" ? input : (input && input.url) || String(input);
      let result;
      try {
        result = nativeFetch.apply(this, arguments);
      } catch (e) {
        reportRequest(method, url, null, startedAt, e && e.message);
        throw e;
      }
      return result.then(
        (response) => {
          try {
            // An opaque (`no-cors`) response always reports status 0 and
            // `ok: false`. Calling those failures would flag every analytics
            // beacon and font fetch on the page.
            if (!response.ok && response.type !== "opaque") {
              reportRequest(method, url, response.status, startedAt);
            }
          } catch {
            /* never break the page's request */
          }
          return response;
        },
        (error) => {
          try {
            reportRequest(method, url, null, startedAt, error && error.message);
          } catch {
            /* as above */
          }
          throw error;
        },
      );
    };
    try {
      fetchWrapper.toString = () => nativeFetch.toString();
      window.fetch = fetchWrapper;
    } catch {
      /* a page that froze fetch keeps its own */
    }
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const nativeOpen = XHR.prototype.open;
    const nativeSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      try {
        this[xhrMeta] = { method: String(method || "GET").toUpperCase(), url: String(url) };
      } catch {
        /* an exotic XHR subclass */
      }
      return nativeOpen.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      try {
        const meta = this[xhrMeta];
        if (meta) {
          const startedAt = performance.now();
          this.addEventListener("loadend", () => {
            try {
              // 0 means it never completed — blocked, aborted, offline.
              if (this.status === 0 || this.status >= 400) {
                reportRequest(
                  meta.method,
                  meta.url,
                  this.status === 0 ? null : this.status,
                  startedAt,
                  this.status === 0 ? "no response" : undefined,
                );
              }
            } catch {
              /* as above */
            }
          });
        }
      } catch {
        /* as above */
      }
      return nativeSend.apply(this, arguments);
    };
  }

  // ---- state, in from the relay ----

  document.addEventListener(STATE_EVENT, (event) => {
    let next;
    try {
      next = JSON.parse(event.detail);
    } catch {
      return;
    }
    const first = state === null;
    state = { console: !!next.console, network: !!next.network };
    if (!first) {
      pending = [];
      return;
    }
    // Release what was held during load, in order, through the same filter
    // everything else goes through.
    const held = pending;
    pending = [];
    for (const entry of held) {
      if (!wants(entry.level)) continue;
      forwarded += 1;
      document.dispatchEvent(new CustomEvent(OUT_EVENT, { detail: JSON.stringify(entry) }));
    }
  });

  // The flag the panel pings for ("is this page's console wrapped?"), which is
  // what drives the reload notice by fact rather than by a stored timestamp.
  // `original` is exposed with it so a page — or a curious tester in the
  // console — can always reach the untouched methods.
  window.__enloopConsole = { version: 1, original };
})();

// NOT processed by Vite — copied verbatim from public/ into dist/, so
// nothing here is rewritten by any bundler transform (see automation.ts for
// why that matters for the extension's own bundled code).
//
// Runs the step's script by injecting a classic <script src="blob:..."> tag
// rather than `import()`ing a blob URL directly. Dynamic `import()` of a
// blob: URL created inside an isolated-world content script isn't reliably
// fetchable by Chrome ("Failed to fetch dynamically imported module") —
// but a <script> element, regardless of which world inserted it, is always
// loaded and executed by the page's own document, which doesn't have that
// problem. This is also why the executed script always runs in the page's
// MAIN world in practice: there's no isolated-world equivalent of a script
// tag. Results come back via a one-off global the injected script calls
// into, since a <script src> has no return value of its own.
(() => {
  globalThis.__tcmRunAutomatedStep = function (userScript) {
    return new Promise((resolve) => {
      const warnings = [];
      const resultKey = `__tcmResult_${Math.random().toString(36).slice(2)}`;
      let scriptEl;
      let url;

      const cleanup = () => {
        delete globalThis[resultKey];
        if (url) URL.revokeObjectURL(url);
        if (scriptEl) scriptEl.remove();
      };

      globalThis[resultKey] = {
        warn(msg) {
          warnings.push(msg);
        },
        resolve() {
          cleanup();
          resolve({ status: warnings.length ? "warning" : "success", warnings });
        },
        reject(message, stack) {
          cleanup();
          resolve({ status: "failed", warnings, error: message, stack });
        },
      };

      const wrapped = `(function () {
  var __r = globalThis[${JSON.stringify(resultKey)}];
  var api = {
    fail: function (msg) { throw new Error(msg); },
    warn: function (msg) { __r.warn(msg); },
  };
  (async function () {
${userScript}
  })().then(
    function () { __r.resolve(); },
    function (e) { __r.reject(e && e.message ? e.message : String(e), e && e.stack); }
  );
})();`;

      const blob = new Blob([wrapped], { type: "text/javascript" });
      url = URL.createObjectURL(blob);
      scriptEl = document.createElement("script");
      scriptEl.src = url;
      scriptEl.onerror = () => {
        cleanup();
        resolve({
          status: "failed",
          warnings,
          error:
            "Failed to load the automated step's script — this page's Content Security Policy likely " +
            "blocks it. Try a step that doesn't rely on this page, or manually override this step's " +
            "result once you've verified it by hand.",
        });
      };
      (document.head || document.documentElement).appendChild(scriptEl);
    });
  };
})();

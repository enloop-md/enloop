import { useState } from "react";
import { reloadActiveTab, type WrapperState } from "../lib/capture.js";

/**
 * "This page is not being captured, and here is the one thing that fixes it."
 *
 * The asymmetry it explains is real and worth stating rather than hiding: **on
 * needs a reload, off does not.** A registered content script only takes effect
 * on the next navigation, so the page in front of the tester at the moment they
 * flip the toggle is already past capture. Turning capture off, by contrast,
 * reaches every loaded page immediately, because the wrapper is still there and
 * simply stops forwarding.
 *
 * Driven by a live ping of the page (`wrapperState`), never by a stored
 * "enabled at" timestamp — see `lib/capture.ts` for why a timestamp gets the
 * common case wrong.
 */
export function CaptureNotice({
  wrapper,
  className = "",
  explainUnknown = false,
}: {
  wrapper: WrapperState;
  className?: string;
  /** In Settings, say something for the "cannot tell" case too. In a run,
   * stay quiet: the run flow asks for site access when a step needs it, and a
   * second notice about the same missing grant is noise. */
  explainUnknown?: boolean;
}) {
  const [why, setWhy] = useState(false);

  if (wrapper === "present") return null;

  if (wrapper === "unknown") {
    if (!explainUnknown) return null;
    return (
      <p className={`text-[11px] text-slate-400 ${className}`}>
        Nothing to capture on the page in front of you — Enloop has no access to it yet, or it is
        a page no extension may touch. Capture starts on a site once you have granted it, which
        the first Highlight or automated step of a run asks for.
      </p>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 ${className}`}
    >
      <span className="flex-1">
        <span className="font-medium">The page needs a reload before it is captured.</span> This
        page's console has already run — Enloop can only wrap it from the next page load.
      </span>
      {/* The "why" is a technical limitation rather than a preference, and a
          tester told to reload for no stated reason reasonably suspects the
          feature is broken. Folded away because it is read once, ever. */}
      <button
        type="button"
        onClick={() => setWhy((open) => !open)}
        aria-expanded={why}
        aria-label="Why a reload is needed"
        title="Why a reload is needed"
        className="shrink-0 rounded-full border border-amber-300 px-1.5 py-0.5 text-[11px] leading-none text-amber-700 hover:bg-amber-100"
      >
        ⓘ
      </button>
      <button
        type="button"
        onClick={() => void reloadActiveTab()}
        className="shrink-0 rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-500"
      >
        Reload page
      </button>
      {why && (
        <p className="w-full border-t border-amber-200 pt-1.5 text-amber-800">
          Enloop captures by replacing the page's own <code>console</code> and <code>fetch</code>{" "}
          with wrappers, and Chrome can only install those at the very start of a page load,
          before the page's scripts run. It cannot reach into a page that has already loaded, so
          capture begins with the <em>next</em> one — and everything this page logged while
          loading, usually the part worth having, has already happened. Turning capture off needs
          no reload: the wrapper is still there and simply stops forwarding.
        </p>
      )}
    </div>
  );
}

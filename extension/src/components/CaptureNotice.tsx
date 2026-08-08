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
        <span className="font-medium">Reload the page to start capturing.</span> This page's
        console has already run — Enloop can only wrap it from the next page load.
      </span>
      <button
        type="button"
        onClick={() => void reloadActiveTab()}
        className="shrink-0 rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-500"
      >
        Reload page
      </button>
    </div>
  );
}

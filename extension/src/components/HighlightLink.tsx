import { useState } from "react";
import { getActiveTabId } from "../lib/automation.js";
import { highlightSelectorsInTab } from "../lib/highlight.js";

/**
 * A selector mentioned in a step's prose, rendered as a control that flashes
 * it in the page. Same mechanism as the step's own Highlight button, reached
 * from wherever the author happened to name the element.
 *
 * Failure is shown, briefly and in place, rather than swallowed: a selector
 * that no longer matches is worth noticing during a run — it is usually the
 * first sign the case has gone stale — but not worth a dialog interrupting
 * one.
 */
export function HighlightLink({ selector, label }: { selector: string; label: string }) {
  const [state, setState] = useState<"idle" | "busy" | "miss">("idle");

  async function highlight() {
    setState("busy");
    try {
      const tabId = await getActiveTabId();
      const matched = await highlightSelectorsInTab(tabId, [selector]);
      setState(matched ? "idle" : "miss");
      if (!matched) setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("miss");
      setTimeout(() => setState("idle"), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={highlight}
      disabled={state === "busy"}
      // The selector is the tooltip even when the label is prose, so a
      // tester can tell what a link will actually look for before clicking.
      title={state === "miss" ? `Not found on page: ${selector}` : `Highlight ${selector}`}
      className={`inline-flex items-baseline gap-0.5 rounded border px-1 text-[11px] transition-colors ${
        state === "miss"
          ? "border-red-200 bg-red-50 text-red-600"
          : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
      } disabled:opacity-60`}
    >
      <span aria-hidden="true">✨</span>
      <span className="font-mono">{label}</span>
    </button>
  );
}

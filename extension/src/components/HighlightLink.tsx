import { useState } from "react";
import { highlightSelectors } from "../lib/highlight.js";
import { requestSiteAccess } from "../lib/page-access.js";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "miss" }
  | { kind: "grant"; origin: string; host: string }
  | { kind: "blocked"; reason: string };

/**
 * A selector mentioned in a step's prose, rendered as a control that flashes
 * it in the page. Same mechanism as the step's own Highlight button, reached
 * from wherever the author happened to name the element.
 *
 * Failure is shown, briefly and in place, rather than swallowed: a selector
 * that no longer matches is worth noticing during a run — it is usually the
 * first sign the case has gone stale — but not worth a dialog interrupting
 * one. A page that could not be looked at *at all* says so instead, since
 * "not found" would be a lie that sends the tester to check the case.
 *
 * When the only thing missing is permission for this site, the control turns
 * into the grant itself. It takes the second click to do it: `permissions.
 * request` needs a live user gesture, and the first click spent its own
 * finding out that the page was blocked.
 */
export function HighlightLink({ selector, label }: { selector: string; label: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  function flashMiss(next: State) {
    setState(next);
    setTimeout(() => setState({ kind: "idle" }), 2500);
  }

  async function highlight() {
    setState({ kind: "busy" });
    const outcome = await highlightSelectors([selector]);
    if (outcome.status === "matched") {
      setState({ kind: "idle" });
      return;
    }
    if (outcome.status === "no-match") {
      flashMiss({ kind: "miss" });
      return;
    }
    if (outcome.access.status === "needs-grant") {
      setState({ kind: "grant", origin: outcome.access.origin, host: outcome.access.host });
      return;
    }
    flashMiss({
      kind: "blocked",
      reason:
        outcome.access.status === "restricted"
          ? outcome.access.reason
          : "No page open to act on.",
    });
  }

  function grant(origin: string) {
    // First statement in the handler, nothing awaited in front of it.
    void requestSiteAccess(origin).then((granted) => {
      if (granted) void highlight();
      else setState({ kind: "idle" });
    });
  }

  const failed = state.kind === "miss" || state.kind === "blocked";
  const title =
    state.kind === "miss"
      ? `Not found on page: ${selector}`
      : state.kind === "blocked"
        ? state.reason
        : state.kind === "grant"
          ? `Enloop needs permission to act on ${state.host}`
          : `Highlight ${selector}`;

  return (
    <button
      type="button"
      onClick={() => (state.kind === "grant" ? grant(state.origin) : void highlight())}
      disabled={state.kind === "busy"}
      // The selector is the tooltip even when the label is prose, so a
      // tester can tell what a link will actually look for before clicking.
      title={title}
      className={`inline-flex items-baseline gap-0.5 rounded border px-1 text-[11px] transition-colors ${
        failed
          ? "border-red-200 bg-red-50 text-red-600"
          : state.kind === "grant"
            ? "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
            : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
      } disabled:opacity-60`}
    >
      <span aria-hidden="true">{state.kind === "grant" ? "🔓" : "✨"}</span>
      <span className="font-mono">{state.kind === "grant" ? "Grant access" : label}</span>
    </button>
  );
}

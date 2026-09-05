import { useState } from "react";
import type { LocationStatus } from "@tcm/shared";
import { openWhere } from "../lib/navigate.js";

const TONE: Record<LocationStatus, string> = {
  unchecked: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100",
  match: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  mismatch: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
};

/**
 * "Go there" for a step's `Where:`. Navigates the tab the run is executed
 * against rather than opening a new one, so the tester lands where the next
 * Highlight and the next automated step will look.
 *
 * A path-only `Where:` resolves against the run's main domain when the case
 * declares one, else against whatever page is currently open, which can be
 * wrong; the failure to show is therefore the message, inline and
 * persistent until dismissed by the next attempt — not a toast that
 * vanishes before it is read.
 */
export function NavigateButton({
  where,
  mainOrigin = "",
  status = "unchecked",
}: {
  where: string;
  mainOrigin?: string;
  /** Where the address stands against the case's `@locations` — tints the
   * control so a wrong-tab run is visible on the button itself. */
  status?: LocationStatus;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await openWhere(where, mainOrigin);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={busy}
        title={`Open ${where} in the tab this run is using`}
        className={`inline-flex items-baseline gap-0.5 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-60 ${TONE[status]}`}
      >
        <span aria-hidden="true">↗</span>
        Go
      </button>
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </>
  );
}

import { useState } from "react";
import { openWhere } from "../lib/navigate.js";

/**
 * "Go there" for a step's `Where:`. Navigates the tab the run is executed
 * against rather than opening a new one, so the tester lands where the next
 * Highlight and the next automated step will look.
 *
 * A path-only `Where:` resolves against whatever page is currently open,
 * which can be wrong; the failure to show is therefore the message, inline
 * and persistent until dismissed by the next attempt — not a toast that
 * vanishes before it is read.
 */
export function NavigateButton({ where }: { where: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await openWhere(where);
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
        className="inline-flex items-baseline gap-0.5 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-60"
      >
        <span aria-hidden="true">↗</span>
        Go
      </button>
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </>
  );
}

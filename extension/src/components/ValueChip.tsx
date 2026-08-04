import { useState } from "react";
import { cancelInsertInActiveTab, insertValueInActiveTab, type InsertOutcome } from "../lib/insert-value.js";
import type { PageAccess } from "../lib/page-access.js";
import { PageAccessNotice } from "./PageAccessNotice.js";

/** Message shown once an arming settles — kept short enough for a side panel
 * and specific enough to act on. `null` means "say nothing", which is right
 * for a plain success: the tester is looking at the page, where the value
 * just appeared. */
function outcomeMessage(outcome: InsertOutcome): string | null {
  switch (outcome.status) {
    case "inserted":
      return null;
    case "cancelled":
      return "Cancelled.";
    case "timeout":
      return "Timed out waiting for a field.";
    case "no-option":
      return "That select has no matching option.";
    case "unsupported":
      return `Can't type into a ${outcome.field}.`;
    case "blocked":
      // Carried by the notice instead, which can also offer the grant.
      return null;
    case "unavailable":
      return "The page went away before the value could be inserted.";
  }
}

/**
 * An example value quoted in a step's instructions — `"Buy milk"` — made
 * usable rather than merely readable. Clicking it arms the page: the next
 * input, textarea, select or contenteditable the tester clicks receives the
 * value, with the events a framework-controlled field needs to notice.
 *
 * Copy is offered alongside, because a value sometimes has to go somewhere
 * this cannot reach — another tab, a terminal, a native dialog.
 */
export function ValueChip({ value }: { value: string }) {
  const [armed, setArmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<PageAccess | null>(null);
  const [copied, setCopied] = useState(false);

  async function arm() {
    if (armed) {
      await cancelInsertInActiveTab();
      return;
    }
    setMessage(null);
    setBlocked(null);
    setCopied(false);
    setArmed(true);
    const outcome = await insertValueInActiveTab(value);
    setArmed(false);
    setBlocked(outcome.status === "blocked" ? outcome.access : null);
    setMessage(outcomeMessage(outcome));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMessage("Copy failed.");
    }
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => void arm()}
        title={armed ? "Click a field on the page, or click here to cancel" : `Insert "${value}"`}
        className={`rounded border px-1 font-mono text-[11px] transition-colors ${
          armed
            ? "border-blue-400 bg-blue-100 text-blue-800"
            : "border-slate-300 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50"
        }`}
      >
        &quot;{value}&quot;
      </button>

      {armed && (
        <span className="absolute left-0 top-full z-10 mt-1 flex w-max max-w-[240px] items-center gap-1.5 rounded border border-blue-200 bg-white p-1.5 text-[11px] text-slate-600 shadow-md">
          <span>Click any input on the page to insert, or</span>
          <button
            type="button"
            onClick={() => void copy()}
            className="shrink-0 rounded border border-slate-300 px-1 text-slate-700 hover:bg-slate-50"
          >
            {copied ? "copied" : "copy it"}
          </button>
        </span>
      )}

      {!armed && blocked && (
        <span className="absolute left-0 top-full z-10 mt-1 block w-max max-w-[260px]">
          <PageAccessNotice
            access={blocked}
            onGranted={() => {
              setBlocked(null);
              void arm();
            }}
          />
        </span>
      )}

      {!armed && message && <span className="ml-1 text-[10px] text-slate-400">{message}</span>}
      {!armed && copied && <span className="ml-1 text-[10px] text-emerald-600">copied</span>}
    </span>
  );
}

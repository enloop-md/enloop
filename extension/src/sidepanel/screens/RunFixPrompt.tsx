import { useState } from "react";
import {
  renderFixPrompt,
  splitId,
  type AgentQuestion,
  type Run,
  type RunStep,
} from "@tcm/shared";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { downloadTextFile, fileSlug } from "../../lib/download.js";
import { useReadyStore } from "../store/DataStoreProvider.js";

/**
 * "Prompt to fix this" under a step: one click gathers the step, the
 * tester's comments, the question thread and what the page printed while
 * the step ran into a Markdown prompt (see `renderFixPrompt`), copies it,
 * and shows it so the tester can read what they are about to paste into
 * the agent working on the right project.
 *
 * Generated on click rather than kept current: the console is read from
 * disk and the case's context from its folder, and doing that on every
 * keystroke in the comment box would be work for a prompt nobody has asked
 * for yet. The text is a snapshot — a comment added afterwards is not in
 * it — so the box says when it was made and offers to make it again.
 */
export function FixPrompt({
  run,
  step,
  questions,
}: {
  run: Run;
  step: RunStep;
  questions: AgentQuestion[];
}) {
  const store = useReadyStore();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);

  /** The id as spelled on disk. Ids reach this screen storage-qualified;
   * a bare one (a store that does not namespace) is already local. */
  function localId(id: string): string {
    try {
      return splitId(id).localId;
    } catch {
      return id;
    }
  }

  async function copy(prompt: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      // Clipboard needs a focused document; the text is on screen either
      // way, and the Copy button retries.
      return false;
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      // Each source degrades on its own: a case without context.json, or a
      // run that captured nothing, still gets a prompt from the rest.
      const [meta, context, entries] = await Promise.all([
        store.getTestCase(run.testCaseId).catch(() => null),
        store.getCaseContext(run.testCaseId).catch(() => null),
        store.readRunConsole(run.testCaseId, run.id).catch(() => []),
      ]);
      const prompt = renderFixPrompt({
        run,
        stepId: step.stepId,
        project: meta?.project ?? "",
        context,
        questions,
        entries,
        folder: { testCaseId: localId(run.testCaseId), runId: localId(run.id) },
      });
      setText(prompt);
      await copy(prompt);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {text === null ? (
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Gather this step, your comments, the question thread and the page's console into a prompt for the agent working on this project"
        >
          {busy ? "Gathering…" : "⚒ Prompt to fix this"}
        </button>
      ) : (
        <div className="space-y-1 rounded border border-slate-200 bg-slate-50/60 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copy(text)}
              className="rounded bg-slate-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-600"
            >
              {copied ? "✓ Copied" : "⧉ Copy prompt"}
            </button>
            <button
              type="button"
              onClick={() =>
                downloadTextFile(`${fileSlug(run.testCaseTitle)}-step-${step.stepId}-fix.md`, text)
              }
              className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-white"
            >
              Download .md
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy}
              className="text-[11px] text-sky-600 hover:underline disabled:opacity-50"
              title="Make it again with whatever you added since"
            >
              Regenerate
            </button>
            <button
              type="button"
              onClick={() => setText(null)}
              className="ml-auto text-[11px] text-slate-400 hover:text-slate-600"
            >
              Hide
            </button>
          </div>
          <p className="text-[10px] text-slate-400">
            Paste into the agent working on this project — Claude Code in the app's repo.
            A snapshot: comments added after this are not in it.
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-2 font-mono text-[10px] leading-snug text-slate-700">
            {text}
          </pre>
        </div>
      )}
      <ErrorNotice error={error} />
    </div>
  );
}

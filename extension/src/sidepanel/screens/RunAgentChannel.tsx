import { useEffect, useRef, useState } from "react";
import type { AgentCommand, AgentQuestion, CompatResult, Run } from "@tcm/shared";
import { Markdown } from "../../components/Markdown.js";
import {
  activePageUrl,
  capturePageSnapshot,
  captureScreenshot,
} from "../../lib/page-capture.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { commandPending, type AskDraft } from "../useAgentChannel.js";

/**
 * The run-screen half of the agent channel: asking a question from a step,
 * showing its answer, offering a compatible patch version, and the cards a
 * requested command lives in. The other half is a Claude Code session
 * looping `/enloop:serve` over the data folder — nothing here talks to it
 * except through files, so every state below is re-derived from what
 * `useAgentChannel` read off disk.
 */

/** How long a question sits unanswered before the panel explains that an
 * answer needs a watching session, not more patience. */
const UNWATCHED_HINT_MS = 60_000;

export function StepQuestions({
  run,
  stepId,
  questions,
  readOnly,
  onAsk,
  onSwapped,
}: {
  run: Run;
  stepId: string;
  questions: AgentQuestion[];
  readOnly: boolean;
  onAsk: (draft: AskDraft) => Promise<void>;
  onSwapped: (run: Run) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [selection, setSelection] = useState("");
  const [busy, setBusy] = useState(false);
  // Both default on: "how do I check this?" is almost always a question
  // about the page in front of the tester, and everything stays in the
  // local data folder either way. Captures degrade to nothing on a page
  // the panel cannot script — the question still goes.
  const [withScreenshot, setWithScreenshot] = useState(true);
  const [withSnapshot, setWithSnapshot] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);

  const mine = questions.filter((q) => q.stepId === stepId);

  function openBox() {
    // What the tester had selected in the step is the "this" their question
    // points at — captured at open, because clicking into the textarea
    // collapses the selection.
    const sel = window.getSelection();
    const picked = sel?.toString().trim() ?? "";
    const inThisStep =
      !!sel?.anchorNode &&
      !!wrapRef.current?.closest("[data-step-row]")?.contains(sel.anchorNode);
    setSelection(picked && inThisStep ? picked : "");
    setOpen(true);
  }

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const [snapshot, screenshot] = await Promise.all([
        withSnapshot ? capturePageSnapshot() : Promise.resolve(null),
        withScreenshot ? captureScreenshot() : Promise.resolve(null),
      ]);
      await onAsk({
        stepId,
        question: text.trim(),
        selection,
        pageUrl: snapshot?.url ?? (await activePageUrl()),
        screenshotPng: screenshot,
        pageHtml: snapshot?.html ?? null,
      });
      setText("");
      setSelection("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (mine.length === 0 && readOnly) return null;

  return (
    <div ref={wrapRef} className="space-y-1.5">
      {mine.map((q) => (
        <QuestionCard key={q.id} run={run} question={q} readOnly={readOnly} onSwapped={onSwapped} />
      ))}
      {!readOnly && !open && (
        <button
          onClick={openBox}
          className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
          title="Ask the Claude Code session watching this folder — select text in the step first to quote it"
        >
          ✳ Ask the agent
        </button>
      )}
      {!readOnly && open && (
        <div className="space-y-1 rounded border border-violet-200 bg-violet-50/50 p-2">
          {selection && (
            <p className="border-l-2 border-violet-300 pl-1.5 text-[11px] italic text-slate-500">
              “{selection}”
            </p>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            autoFocus
            placeholder="What do you need to know to do this step?"
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
            <label className="flex items-center gap-1" title="PNG of the visible tab — what you are looking at">
              <input
                type="checkbox"
                checked={withScreenshot}
                onChange={(e) => setWithScreenshot(e.target.checked)}
              />
              Screenshot
            </label>
            <label
              className="flex items-center gap-1"
              title="The page's structure with scripts and styles stripped — what selectors are checked against"
            >
              <input
                type="checkbox"
                checked={withSnapshot}
                onChange={(e) => setWithSnapshot(e.target.checked)}
              />
              Page snapshot
            </label>
          </div>
          <p className="text-[10px] text-slate-400">
            Captured from the page in front of you, saved with the question in this folder's{" "}
            <code>agent/</code> directory.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => void submit()}
              disabled={busy || !text.trim()}
              className="rounded bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Ask
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Host and path, clipped — enough to recognize the page; the full URL is
 * in the title attribute. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    const short = `${u.host}${path}`;
    return short.length > 48 ? `${short.slice(0, 47)}…` : short;
  } catch {
    return url.length > 48 ? `${url.slice(0, 47)}…` : url;
  }
}

function QuestionCard({
  run,
  question,
  readOnly,
  onSwapped,
}: {
  run: Run;
  question: AgentQuestion;
  readOnly: boolean;
  onSwapped: (run: Run) => void;
}) {
  const waitedMs = Date.now() - Date.parse(question.askedAt);
  const proposed = question.answer?.meta.proposedVersion ?? null;
  // An offer is over once taken (it is in `swaps`) or overtaken (the run
  // moved to this version or past it some other way).
  const offerOpen =
    proposed !== null &&
    run.testCaseVersion < proposed &&
    !run.swaps.some((s) => s.toVersion === proposed);

  return (
    <div className="space-y-1 rounded border border-violet-200 p-2 text-xs">
      <p className="text-slate-700">
        <span className="font-medium text-violet-700">You asked:</span> {question.question}
      </p>
      {question.selection && (
        <p className="border-l-2 border-violet-200 pl-1.5 text-[11px] italic text-slate-400">
          “{question.selection}”
        </p>
      )}
      {(question.pageUrl || question.attachments.length > 0) && (
        <p className="text-[10px] text-slate-400">
          {question.pageUrl && (
            <span title={question.pageUrl}>on {shortUrl(question.pageUrl)}</span>
          )}
          {question.pageUrl && question.attachments.length > 0 && " · "}
          {question.attachments.length > 0 && <>📎 {question.attachments.join(" · ")}</>}
        </p>
      )}
      {question.answer === null ? (
        <div className="text-[11px] text-slate-400">
          <span className="mr-1 inline-block animate-pulse">●</span>
          Waiting for an agent session…
          {waitedMs > UNWATCHED_HINT_MS && (
            <p className="mt-0.5 text-slate-500">
              No agent session picked this up yet — run{" "}
              <code className="rounded bg-slate-100 px-1">/loop 1m /enloop:serve</code> in Claude
              Code.
            </p>
          )}
        </div>
      ) : (
        <>
          <Markdown text={question.answer.markdown} className="text-xs text-slate-600" />
          {proposed !== null && offerOpen && !readOnly && (
            <PatchOffer run={run} question={question} toVersion={proposed} onSwapped={onSwapped} />
          )}
          {proposed !== null && !offerOpen && (
            <p className="text-[11px] text-slate-400">
              Proposed v{proposed}
              {run.swaps.some((s) => s.toVersion === proposed)
                ? " — loaded into this run."
                : " — this run has moved on."}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * "Load v<n>?" — shown only after this panel verified the candidate itself.
 * The agent's `proposedVersion` is a claim; `previewSwap` composes the
 * version exactly as the swap would and judges it, so an incompatible patch
 * (or one for a run that predates variable snapshots) degrades to a plain
 * note instead of a button that would fail.
 */
function PatchOffer({
  run,
  question,
  toVersion,
  onSwapped,
}: {
  run: Run;
  question: AgentQuestion;
  toVersion: number;
  onSwapped: (run: Run) => void;
}) {
  const store = useReadyStore();
  const [verdict, setVerdict] = useState<CompatResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    store
      .previewSwap(run.testCaseId, run.id, toVersion)
      .then((v) => !cancelled && setVerdict(v))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [store, run.testCaseId, run.id, toVersion]);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      onSwapped(await store.swapRunVersion(run.testCaseId, run.id, toVersion, question.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (dismissed) {
    return <p className="text-[11px] text-slate-400">Proposed v{toVersion} — not loaded.</p>;
  }
  if (error) {
    return <p className="text-[11px] text-red-500">Could not check v{toVersion}: {error}</p>;
  }
  if (!verdict) {
    return <p className="text-[11px] text-slate-400">Checking v{toVersion}…</p>;
  }
  if (!verdict.ok) {
    return (
      <p className="text-[11px] text-slate-500">
        v{toVersion} was proposed but isn't compatible with this run — {verdict.reasons[0]}. It is
        saved as a normal version for the next run.
      </p>
    );
  }
  return (
    <div className="space-y-1 rounded border border-emerald-200 bg-emerald-50/60 p-2">
      <p className="text-[11px] text-slate-600">
        Load v{toVersion}? {verdict.changedStepIds.length} step
        {verdict.changedStepIds.length === 1 ? "" : "s"} updated, finished steps unchanged.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => void load()}
          disabled={busy}
          className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Load v{toVersion}
        </button>
        <button
          onClick={() => setDismissed(true)}
          disabled={busy}
          className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

const COMMAND_STATE_STYLES: Record<AgentCommand["display"], string> = {
  queued: "bg-slate-100 text-slate-500",
  running: "bg-sky-100 text-sky-700",
  stopping: "bg-amber-100 text-amber-800",
  exited: "bg-emerald-100 text-emerald-700",
  killed: "bg-slate-200 text-slate-600",
  refused: "bg-red-100 text-red-700",
};

function commandStateLabel(command: AgentCommand): string {
  switch (command.display) {
    case "queued":
      return "waiting for agent";
    case "running":
      return "running";
    case "stopping":
      return "stopping…";
    case "exited":
      return command.exitCode === 0
        ? "done"
        : command.exitCode === 124
          ? "timed out"
          : `exited ${command.exitCode}`;
    case "killed":
      return command.reason === "heartbeat"
        ? "stopped (panel was closed)"
        : command.reason === "timeout"
          ? "timed out"
          : "stopped";
    case "refused":
      return "refused";
  }
}

/** Roughly six lines of log before the tail hides behind a toggle. */
const LOG_PREVIEW_CHARS = 400;

export function CommandCard({
  command,
  readOnly,
  onKill,
  onRunAgain,
}: {
  command: AgentCommand;
  readOnly: boolean;
  onKill: (commandId: string) => Promise<void>;
  onRunAgain: (command: AgentCommand) => Promise<void>;
}) {
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = commandPending(command);
  const logLong = command.logTail.length > LOG_PREVIEW_CHARS;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1 rounded border border-slate-200 p-2 text-xs">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-[11px] text-slate-600" title={command.command}>
          {command.command}
        </code>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${COMMAND_STATE_STYLES[command.display]}`}
        >
          {commandStateLabel(command)}
        </span>
      </div>
      {command.display === "refused" && (
        <p className="text-[11px] text-red-500">
          The agent couldn't find this command in the case, so it wouldn't run it.
        </p>
      )}
      {command.display === "queued" && (
        <p className="text-[11px] text-slate-400">
          Needs a watching session —{" "}
          <code className="rounded bg-slate-100 px-1">/loop 1m /enloop:serve</code> in Claude Code.
        </p>
      )}
      {command.logTail && (
        <pre
          className={`overflow-x-auto rounded bg-slate-900 p-1.5 text-[10px] leading-snug text-slate-200 ${
            showLog ? "max-h-64 overflow-y-auto" : "max-h-16 overflow-y-hidden"
          }`}
        >
          {showLog || !logLong
            ? command.logTail
            : `…${command.logTail.slice(-LOG_PREVIEW_CHARS)}`}
        </pre>
      )}
      <div className="flex gap-2">
        {command.logTail && logLong && (
          <button
            onClick={() => setShowLog((s) => !s)}
            className="text-[11px] text-sky-600 hover:underline"
          >
            {showLog ? "Less output" : "More output"}
          </button>
        )}
        {!readOnly && pending && command.display !== "stopping" && (
          <button
            onClick={() => void act(() => onKill(command.id))}
            disabled={busy}
            className="ml-auto rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Stop
          </button>
        )}
        {!readOnly && !pending && (
          <button
            onClick={() => void act(() => onRunAgain(command))}
            disabled={busy}
            className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Run again
          </button>
        )}
      </div>
    </div>
  );
}

export function CommandList({
  commands,
  readOnly,
  onKill,
  onRunAgain,
}: {
  commands: AgentCommand[];
  readOnly: boolean;
  onKill: (commandId: string) => Promise<void>;
  onRunAgain: (command: AgentCommand) => Promise<void>;
}) {
  if (commands.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {commands.map((c) => (
        <CommandCard
          key={c.id}
          command={c}
          readOnly={readOnly}
          onKill={onKill}
          onRunAgain={onRunAgain}
        />
      ))}
    </div>
  );
}

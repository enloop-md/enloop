import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUDIENCE_HINTS,
  AUDIENCE_LABELS,
  COMMENT_AUDIENCES,
  describeCounts,
  hasCaptureSignal,
  newCommentId,
  stepComments,
  type RunCommentDraft,
  type CapturedEntry,
  type CommentAudience,
  type Run,
  type RunStep,
  type RunStepStatus,
} from "@tcm/shared";
import { CaptureNotice } from "../../components/CaptureNotice.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { Markdown } from "../../components/Markdown.js";
import { PageAccessNotice } from "../../components/PageAccessNotice.js";
import { RunStatusBadge, StepStatusBadge } from "../../components/StatusBadge.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { chainAutomatedFrom, markManualStep, runAutomatedStep } from "../../lib/run-engine.js";
import { highlightSelectors } from "../../lib/highlight.js";
import { getPageAccess, type PageAccess } from "../../lib/page-access.js";
import { looksNavigable } from "../../lib/navigate.js";
import { NavigateButton } from "../../components/NavigateButton.js";
import { runCaptureKey } from "../../lib/capture.js";
import { useCaptureRecorder } from "../useCapture.js";

export function RunScreen({
  testCaseId,
  runId,
  onBack,
  onSettings,
}: {
  testCaseId: string;
  runId: string;
  onBack: () => void;
  onSettings: () => void;
}) {
  const store = useReadyStore();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<unknown>(null);
  // A set, not one id: steps open and close independently, so a tester can
  // keep the step that explains the setup visible while working through the
  // one that depends on it.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  // The step this screen opened by itself. Tracked so that advancing can
  // close it again without also closing whatever the tester opened by hand.
  const autoOpenedId = useRef<string | null>(null);
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const autoStarted = useRef(false);
  const [commentDraft, setCommentDraft] = useState("");
  // Seeded once per run rather than mirrored from `run.comment`: every save
  // returns a fresh Run, and syncing on that would fight the cursor of
  // someone still typing.
  const commentSeeded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    store
      .getRun(testCaseId, runId)
      .then(async (loaded) => {
        if (cancelled) return;
        setRun(loaded);
        if (!commentSeeded.current) {
          commentSeeded.current = true;
          setCommentDraft(loaded.comment);
        }
        if (loaded.status === "in_progress" && !autoStarted.current) {
          autoStarted.current = true;
          const chained = await chainAutomatedFrom(store, loaded, null);
          if (!cancelled) setRun(chained);
        }
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId, runId]);

  const readOnly = !run || run.status !== "in_progress";

  /** The step the tester is on: the first that has not been decided yet.
   * Null once the run is finished, which is why a finished run highlights
   * nothing and greys nothing — there is no "here" to be ahead of. */
  const currentStepId =
    run?.steps.find((s) => s.status === "pending" || s.status === "running")?.stepId ?? null;

  const appendConsole = useCallback(
    async (entries: CapturedEntry[]) => {
      await store.appendConsole(testCaseId, runId, entries);
    },
    [store, testCaseId, runId],
  );
  // Entries arriving while this run is in progress are stamped with whatever
  // step is current, which is what makes the log readable a day later.
  const capture = useCaptureRecorder({
    key: runCaptureKey(testCaseId, runId),
    stepId: currentStepId,
    active: run?.status === "in_progress",
    append: appendConsole,
  });
  // Null until the tester touches the box. Until then it follows the evidence:
  // a clean log is noise, a log with a stack trace in it is the reason capture
  // exists — and defaulting off in both cases would mean the box only ever
  // gets ticked by someone who already knew what they were looking for.
  const [consoleChoice, setConsoleChoice] = useState<boolean | null>(null);
  const consoleInReport = consoleChoice ?? capture.counts.consoleErrors > 0;

  // What each step's comment box holds right now, updated on every keystroke.
  // The box persists itself on a timer; this exists for the one gap that
  // leaves — typing a sentence and pressing Finish inside the same second,
  // which is the most natural thing in the world to do on the last step.
  // Flushed before the run is finished, so nothing depends on a timer having
  // fired.
  const pendingDrafts = useRef(new Map<string, RunCommentDraft | null>());

  // Follow the run: open the current step, close the one we opened for the
  // step before it. Driven by which step is current rather than by the
  // mark/run handlers, so an automated chain that carries several steps at
  // once lands in the same place as a manual pass.
  useEffect(() => {
    if (!currentStepId || currentStepId === autoOpenedId.current) return;
    const previous = autoOpenedId.current;
    autoOpenedId.current = currentStepId;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (previous) next.delete(previous);
      next.add(currentStepId);
      return next;
    });
  }, [currentStepId]);

  // Autosave while typing. The side panel closes whenever the user clicks
  // away from it, which can happen mid-sentence and takes the component with
  // it — waiting for blur would lose exactly the long comment worth keeping.
  useEffect(() => {
    if (!run || readOnly || commentDraft === run.comment) return;
    const timer = setTimeout(() => void saveComment(commentDraft), 700);
    return () => clearTimeout(timer);
  }, [commentDraft, run, readOnly]);

  async function handleMark(step: RunStep, status: "success" | "failed" | "warning" | "skipped") {
    if (!run) return;
    setBusyStepId(step.stepId);
    setError(null);
    try {
      setRun(await markManualStep(store, run, step.stepId, status));
      // A verdict closes the step. It is decided, the panel is narrow, and
      // leaving it open pushes the step the tester is moving on to off the
      // bottom of the screen. What they wrote about it survives in the
      // collapsed summary, so nothing is hidden by this — see StepRow.
      setExpandedIds((ids) => {
        const next = new Set(ids);
        next.delete(step.stepId);
        return next;
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusyStepId(null);
    }
  }

  async function handleRunAutomated(step: RunStep) {
    if (!run) return;
    setBusyStepId(step.stepId);
    setError(null);
    try {
      const ran = await runAutomatedStep(store, run, step.stepId);
      const chained = await chainAutomatedFrom(store, ran, step.stepId);
      setRun(chained);
    } catch (e) {
      setError(e);
    } finally {
      setBusyStepId(null);
    }
  }

  async function updateStepFields(step: RunStep, patch: Partial<RunStep>) {
    if (!run) return;
    try {
      const updated = await store.updateStep(run.testCaseId, run.id, step.stepId, patch);
      setRun(updated);
    } catch (e) {
      setError(e);
    }
  }

  async function saveComment(text: string) {
    if (!run || text === run.comment) return;
    try {
      setRun(await store.updateRun(run.testCaseId, run.id, { comment: text }));
    } catch (e) {
      setError(e);
    }
  }

  async function finishRun(status: "passed" | "failed" | "aborted") {
    if (!run) return;
    setError(null);
    try {
      // Everything the report is built from has to land before it is built:
      // report.md and feedback.md are rendered by finishRun, so a comment, a
      // decision about the log, or a last batch of entries saved after it
      // would appear in neither. An abort takes the same path deliberately —
      // an abandoned run is where the console most often explains what
      // happened, and it needs no extra asking to keep it.
      await capture.flush();
      for (const [stepId, draft] of pendingDrafts.current) {
        await store.updateStep(run.testCaseId, run.id, stepId, { draft });
      }
      pendingDrafts.current.clear();
      await store.updateRun(run.testCaseId, run.id, {
        comment: commentDraft,
        consoleInReport,
      });
      const updated = await store.finishRun(run.testCaseId, run.id, status);
      setRun(updated);
    } catch (e) {
      setError(e);
    }
  }

  if (!run) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Run" onBack={onBack} onSettings={onSettings} />
        {error == null ? (
          <p className="p-3 text-sm text-slate-400">Loading…</p>
        ) : (
          <ErrorNotice error={error} className="p-3" />
        )}
      </div>
    );
  }

  const passCount = run.steps.filter((s) => s.status === "success").length;
  const failCount = run.steps.filter((s) => s.status === "failed").length;
  const allExpanded = run.steps.every((s) => expandedIds.has(s.stepId));
  const currentIndex = run.steps.findIndex((s) => s.stepId === currentStepId);
  // Must mirror renderRunFeedback's own test, including the run-level
  // comment — a banner promising a feedback.md that was never written is
  // worse than no banner.
  const hasFeedbackSignal =
    run.comment.trim().length > 0 ||
    run.steps.some(
      (s) =>
        s.status === "failed" ||
        s.status === "warning" ||
        stepComments(s).some((c) => c.text.trim().length > 0) ||
        !!s.automatedResult?.error ||
        s.consoleErrors > 0,
    );

  return (
    <div className="flex h-full flex-col">
      <Header
        title={run.testCaseTitle}
        onBack={onBack}
        onSettings={onSettings}
        actions={<RunStatusBadge status={run.status} />}
      />
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs text-slate-500">
        {run.tier === "quick" && (
          <span
            className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
            title="Only the steps marked Kind: quick are in this run"
          >
            quick
          </span>
        )}
        {/* Visible during the run, not just at setup — "which environment am
            I on" is the question a tester asks when something looks wrong. */}
        {run.environment && (
          <span
            className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800"
            title="The environment whose values pre-filled this run"
          >
            {run.environment}
          </span>
        )}
        <span>
          v{run.testCaseVersion} · {passCount}/{run.steps.length} passed
          {failCount > 0 && <span className="text-red-600"> · {failCount} failed</span>}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setExpandedIds(new Set(run.steps.map((s) => s.stepId)))}
            disabled={allExpanded}
            className="text-sky-600 hover:underline disabled:text-slate-300 disabled:no-underline"
          >
            Open all
          </button>
          <span className="text-slate-300">·</span>
          <button
            onClick={() => {
              // Drop the follow-the-run bookkeeping too: after an explicit
              // "close all", nothing should reopen until the run moves on.
              autoOpenedId.current = null;
              setExpandedIds(new Set());
            }}
            disabled={expandedIds.size === 0}
            className="text-sky-600 hover:underline disabled:text-slate-300 disabled:no-underline"
          >
            Close all
          </button>
        </span>
      </div>
      <ErrorNotice error={error} className="px-3 pt-2" />
      {/* Settings is not where anyone is looking while the evidence is being
          lost, so the notice belongs here too. */}
      {!readOnly && <CaptureNotice wrapper={capture.wrapper} className="mx-3 mt-2" />}
      {readOnly && hasFeedbackSignal && (
        <p className="border-b border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-700">
          Feedback saved to feedback.md in this run's folder — point Claude Code at it.
        </p>
      )}

      <div className="flex-1 overflow-y-auto">
        <BeforeYouStart dependencies={run.dependencies} prerequisites={run.prerequisites} />
        {run.steps.map((step, index) => (
          <StepRow
            key={step.stepId}
            index={index}
            step={step}
            expanded={expandedIds.has(step.stepId)}
            isCurrent={step.stepId === currentStepId}
            isPast={currentIndex >= 0 && index < currentIndex}
            busy={busyStepId === step.stepId}
            readOnly={readOnly}
            onToggle={() =>
              setExpandedIds((ids) => {
                const next = new Set(ids);
                if (!next.delete(step.stepId)) next.add(step.stepId);
                return next;
              })
            }
            onMark={(status) => handleMark(step, status)}
            onRunAutomated={() => handleRunAutomated(step)}
            onUpdateFields={(patch) => updateStepFields(step, patch)}
            onDraftChange={(draft) => pendingDrafts.current.set(step.stepId, draft)}
          />
        ))}
      </div>

      {!readOnly && (
        <div className="space-y-2 border-t border-slate-200 p-3">
          <textarea
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            onBlur={() => void saveComment(commentDraft)}
            rows={2}
            placeholder="Comment on the whole run (optional) — anything that isn't about one step"
            className="w-full resize-y rounded border border-slate-300 px-2 py-1.5 text-xs"
          />
          {/* Capturing is one decision; handing the log to a model is a second
              one, made here because this is the moment the tester knows whether
              the run was interesting and the log exists to be looked at rather
              than guessed about. */}
          {/* Shown once anything has been captured even if capture was since
              switched off — the entries are on disk, and the question of what
              happens to them is still open. */}
          {(capture.on || capture.total > 0) && (
            <label className="flex items-start gap-2 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={consoleInReport}
                onChange={(e) => setConsoleChoice(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Include console output in the report
                {capture.total > 0
                  ? ` (${describeCounts(capture.counts) || `${capture.total} entries, nothing alarming`})`
                  : " — nothing captured so far"}
                <span className="mt-0.5 block text-slate-400">
                  A digest, not the raw log. <code>console.md</code> is kept in the run's folder
                  either way; this decides what <code>report.md</code> hands on.
                </span>
              </span>
            </label>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => finishRun(failCount > 0 ? "failed" : "passed")}
              className="flex-1 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Finish run
            </button>
            <button
              onClick={() => finishRun("aborted")}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Abort
            </button>
          </div>
        </div>
      )}

      {readOnly && run.comment.trim() && (
        <div className="border-t border-slate-200 p-3">
          <h2 className="mb-1 text-xs font-semibold uppercase text-slate-400">
            Comment on this run
          </h2>
          <Markdown text={run.comment} className="text-xs text-slate-600" />
        </div>
      )}
    </div>
  );
}

/**
 * What had to be true before step 1 — a service started, a fixture seeded,
 * a branch deployed. Collapsed by default and on every open: most runs
 * happen against an environment that is already up, so this is reference
 * material, not a checklist to work through, and in a side panel the space
 * it would cost is space the current step needs. The summary line still
 * says it is there, which is the part that was missing entirely before.
 */
function BeforeYouStart({
  dependencies,
  prerequisites,
}: {
  dependencies: string[];
  prerequisites: string[];
}) {
  if (dependencies.length === 0 && prerequisites.length === 0) return null;

  const counts = [
    prerequisites.length > 0 &&
      `${prerequisites.length} prerequisite${prerequisites.length === 1 ? "" : "s"}`,
    dependencies.length > 0 &&
      `${dependencies.length} dependenc${dependencies.length === 1 ? "y" : "ies"}`,
  ].filter((c): c is string => !!c);

  return (
    <details className="group border-b border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:bg-slate-100">
        <span className="text-slate-400 transition-transform group-open:rotate-90">▸</span>
        <span className="font-medium text-slate-600">Before you start</span>
        <span className="text-slate-400">{counts.join(" · ")}</span>
      </summary>
      <div className="space-y-2 px-3 pb-3 pt-1">
        {prerequisites.length > 0 && (
          <div>
            <h3 className="mb-0.5 text-[10px] font-semibold uppercase text-slate-400">
              Prerequisites
            </h3>
            <Markdown
              text={prerequisites.map((p) => `- ${p}`).join("\n")}
              className="text-xs text-slate-600"
            />
          </div>
        )}
        {dependencies.length > 0 && (
          <div>
            <h3 className="mb-0.5 text-[10px] font-semibold uppercase text-slate-400">
              Dependencies
            </h3>
            <Markdown
              text={dependencies.map((d) => `- ${d}`).join("\n")}
              className="text-xs text-slate-600"
            />
          </div>
        )}
      </div>
    </details>
  );
}

type Verdict = "success" | "warning" | "failed";

/** Filled while the step is still open for a decision; once it has one, only
 * the chosen verdict stays filled. Both variants carry a border so switching
 * between them cannot shift the row by a pixel. */
const VERDICT_STYLES: Record<Verdict, { filled: string; outlined: string }> = {
  success: {
    filled: "border border-transparent bg-emerald-600 text-white hover:bg-emerald-500",
    outlined: "border border-emerald-300 text-emerald-700 hover:bg-emerald-50",
  },
  warning: {
    filled: "border border-transparent bg-amber-500 text-white hover:bg-amber-400",
    outlined: "border border-amber-300 text-amber-700 hover:bg-amber-50",
  },
  failed: {
    filled: "border border-transparent bg-red-600 text-white hover:bg-red-500",
    outlined: "border border-red-300 text-red-700 hover:bg-red-50",
  },
};

/**
 * One of the three verdicts. Before the step is decided all three are filled
 * — they are equally available, and nothing should look preselected. After,
 * the one that was chosen keeps its fill and the others drop to an outline:
 * the row then reads as a record of what was decided rather than three
 * buttons still asking, while leaving both of the others one tap away for a
 * tester who changes their mind.
 */
function VerdictButton({
  verdict,
  label,
  status,
  disabled,
  onMark,
}: {
  verdict: Verdict;
  label: string;
  status: RunStepStatus;
  disabled: boolean;
  onMark: (status: Verdict) => void;
}) {
  // `skipped` counts as decided with none of the three chosen, so all three
  // outline — nothing here is the current verdict.
  const decided = status !== "pending" && status !== "running";
  const style = VERDICT_STYLES[verdict];
  return (
    <button
      disabled={disabled}
      onClick={() => onMark(verdict)}
      aria-pressed={status === verdict}
      className={`flex-1 rounded px-2 py-1.5 text-xs font-medium disabled:opacity-50 ${
        decided && status !== verdict ? style.outlined : style.filled
      }`}
    >
      {label}
    </button>
  );
}

/** How many comments a collapsed step will list before it stops and counts. */
const COLLAPSED_COMMENT_LIMIT = 2;

/**
 * What the tester wrote on a step that did not simply pass, kept visible
 * after the step collapses. Marking a step closes it, and closing it must
 * not swallow the reason it was marked — a list of red badges with no words
 * next to them is exactly the run report nobody can act on a day later.
 *
 * Only for `failed` and `warning`: a comment on a passed step is usually an
 * aside, and showing every one of them turns the list back into the wall of
 * text that collapsing was meant to fix. Clamped to two for the same reason —
 * this is a reminder of what is inside, not a second copy of it.
 */
function CollapsedFindings({ step, hidden }: { step: RunStep; hidden: boolean }) {
  const needsAttention = step.status === "failed" || step.status === "warning";
  // Through `stepComments` like every other reader: a comment still in the
  // box is the one most likely to be forgotten, so it is the last thing that
  // should vanish when the step collapses.
  const comments = stepComments(step);
  if (hidden || !needsAttention || comments.length === 0) return null;

  const shown = comments.slice(0, COLLAPSED_COMMENT_LIMIT);
  const overflow = comments.length - shown.length;

  return (
    <div className="space-y-0.5 pb-2 pl-8 pr-3 text-[11px] leading-snug">
      {shown.map((c) => (
        <p key={c.id} className="flex items-baseline gap-1">
          {c.audiences.map((a) => (
            <span key={a} className={`shrink-0 rounded px-1 py-px text-[9px] ${AUDIENCE_STYLES[a]}`}>
              {AUDIENCE_LABELS[a]}
            </span>
          ))}
          <span className="truncate text-slate-500">{c.text}</span>
        </p>
      ))}
      {overflow > 0 && <p className="text-slate-400">+{overflow} more</p>}
    </div>
  );
}

const AUDIENCE_STYLES: Record<CommentAudience, string> = {
  developer: "bg-red-100 text-red-700",
  product: "bg-violet-100 text-violet-700",
  "test-writer": "bg-emerald-100 text-emerald-700",
  docs: "bg-sky-100 text-sky-700",
  ops: "bg-amber-100 text-amber-800",
};

/**
 * Everything the tester has to say about one step: a box, and who it is for.
 *
 * This replaced three inputs — a free-text comment, a typed note with a
 * category dropdown, and a task list — which between them asked the tester to
 * classify an observation before writing it down, and gave no honest answer
 * for most observations. "The save button did nothing" is not a note *or* a
 * task, and choosing between `bug` and `note` is a taxonomy question at the
 * exact moment the tester is holding a fact they want to put down.
 *
 * So: one box, and checkboxes for who needs to see it. Audience is something
 * a tester genuinely knows in the moment, several can be right at once, and
 * none being ticked is a real answer — context for whoever reads the run.
 * The hints matter as much as the labels: "Product" means nothing mid-run,
 * "it works, but should work differently" is a question anyone can answer.
 */
function StepComments({
  step,
  readOnly,
  onUpdateFields,
  onDraftChange,
}: {
  step: RunStep;
  readOnly: boolean;
  onUpdateFields: (patch: Partial<RunStep>) => void;
  /** Reported on every keystroke so the run can be finished without waiting
   * for this box's write to fire. */
  onDraftChange: (draft: RunCommentDraft | null) => void;
}) {
  const [draft, setDraft] = useState(step.draft?.text ?? "");
  const [audiences, setAudiences] = useState<CommentAudience[]>(step.draft?.audiences ?? []);

  // Written through while typing, not on blur and not on Add. A side panel is
  // destroyed the moment the tester clicks into the page they are testing, so
  // anything living only in this component is gone before they come back —
  // and what they had typed was, by then, a finished thought. 700ms matches
  // the run comment above.
  useEffect(() => {
    if (readOnly) return;
    const next = draft.trim() ? { text: draft, audiences } : null;
    onDraftChange(next);
    if (JSON.stringify(next) === JSON.stringify(step.draft)) return;
    const timer = setTimeout(() => onUpdateFields({ draft: next }), 700);
    return () => clearTimeout(timer);
  }, [draft, audiences, readOnly, step.draft]);

  function add() {
    if (!draft.trim()) return;
    onUpdateFields({
      comments: [
        ...step.comments,
        { id: newCommentId(), text: draft.trim(), audiences: [...audiences] },
      ],
      draft: null,
    });
    // The box empties, the ticks do not: a tester writing three things for the
    // developer should not have to re-tick Developer three times.
    setDraft("");
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-medium text-slate-400">Comments</label>

      <ul className="space-y-1">
        {step.comments.map((c) => (
          <li key={c.id} className="flex items-start gap-1.5 text-xs text-slate-600">
            <span className="flex-1">
              {c.text}
              {c.audiences.length > 0 && (
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {c.audiences.map((a) => (
                    <span
                      key={a}
                      className={`rounded px-1.5 py-0.5 text-[10px] ${AUDIENCE_STYLES[a]}`}
                    >
                      {AUDIENCE_LABELS[a]}
                    </span>
                  ))}
                </span>
              )}
            </span>
            {!readOnly && (
              <button
                onClick={() =>
                  onUpdateFields({ comments: step.comments.filter((cc) => cc.id !== c.id) })
                }
                className="text-slate-400 hover:text-red-600"
                aria-label="Remove comment"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      {!readOnly && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="What did you see?"
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <div className="space-y-0.5">
            <p className="text-[10px] text-slate-400">This comment is for:</p>
            {COMMENT_AUDIENCES.map((audience) => (
              <label
                key={audience}
                title={AUDIENCE_HINTS[audience]}
                className="flex items-start gap-1.5 text-[11px]"
              >
                <input
                  type="checkbox"
                  checked={audiences.includes(audience)}
                  onChange={(e) =>
                    setAudiences((prev) =>
                      e.target.checked
                        ? [...prev, audience]
                        : prev.filter((a) => a !== audience),
                    )
                  }
                  className="mt-0.5"
                />
                {/* Label and hint in one span so a hint that wraps stays
                    aligned under the label rather than under the checkbox. */}
                <span className="text-slate-700">
                  {AUDIENCE_LABELS[audience]}{" "}
                  <span className="text-slate-400">— {AUDIENCE_HINTS[audience]}</span>
                </span>
              </label>
            ))}
            <p className="pl-5 text-[10px] text-slate-400">
              Tick none and it is context: kept with the run, addressed to nobody.
            </p>
          </div>
          <button
            onClick={add}
            disabled={!draft.trim()}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
          >
            Add comment
          </button>
          {/* Said out loud because the opposite used to be true, and because
              a tester who believes an unsent box is lost writes less in it. */}
          {draft.trim() && (
            <p className="text-[10px] text-slate-400">
              Saved as you type. This goes into the run whether or not you press Add — the
              button is for starting a second comment.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function StepRow({
  index,
  step,
  expanded,
  isCurrent,
  isPast,
  busy,
  readOnly,
  onToggle,
  onMark,
  onRunAutomated,
  onUpdateFields,
  onDraftChange,
}: {
  index: number;
  step: RunStep;
  expanded: boolean;
  isCurrent: boolean;
  isPast: boolean;
  busy: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onMark: (status: "success" | "failed" | "warning" | "skipped") => void;
  onRunAutomated: () => void;
  onUpdateFields: (patch: Partial<RunStep>) => void;
  onDraftChange: (draft: RunCommentDraft | null) => void;
}) {
  const [highlightState, setHighlightState] = useState<"idle" | "highlighting" | "not-found">(
    "idle",
  );
  // Why the page could not be acted on, when that is what happened. Kept as
  // the access state rather than a message because `needs-grant` comes with
  // a fix the tester can apply from here.
  const [access, setAccess] = useState<PageAccess | null>(null);
  // Which candidate actually matched last time — null until a highlight runs.
  // With fallbacks in play, "it worked" is not enough: the tester needs to see
  // that it was the third selector, not the one they expected.
  const [matchedSelector, setMatchedSelector] = useState<string | null>(null);
  const selectorKey = step.selectors.join("\n");
  const rowRef = useRef<HTMLDivElement>(null);

  async function highlight() {
    if (step.selectors.length === 0) return;
    setHighlightState("highlighting");
    const outcome = await highlightSelectors(step.selectors);

    if (outcome.status === "blocked") {
      // Deliberately not "not found on page": nothing was looked for.
      setAccess(outcome.access);
      setMatchedSelector(null);
      setHighlightState("idle");
      return;
    }

    setAccess(null);
    const matched = outcome.status === "matched" ? outcome.selector : null;
    setMatchedSelector(matched);
    setHighlightState(matched ? "idle" : "not-found");
    if (!matched) setTimeout(() => setHighlightState("idle"), 2000);
  }

  /** Automated steps are checked before they run, so a missing grant costs a
   * click rather than a failed step that says nothing about the app. */
  async function runAutomated() {
    const current = await getPageAccess();
    if (current.status !== "ready") {
      setAccess(current);
      return;
    }
    setAccess(null);
    onRunAutomated();
  }

  // Flash the element automatically whenever this step becomes the current
  // one. Gated on `isCurrent` and not on `expanded` alone: since steps open
  // independently, "Open all" would otherwise fire one highlight per step
  // into the same tab, and they would fight over the same overlay.
  useEffect(() => {
    if (expanded && isCurrent && step.selectors.length > 0) void highlight();
  }, [expanded, isCurrent, selectorKey]);

  // Keep the step being worked on in view as the run advances past the fold.
  // `nearest` so a step that is already visible does not get yanked around.
  useEffect(() => {
    if (isCurrent) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isCurrent]);

  return (
    <div
      ref={rowRef}
      className={`border-b border-slate-100 border-l-2 transition-colors duration-200 ${
        isCurrent ? "border-l-sky-500 bg-sky-50/60" : "border-l-transparent"
      }`}
    >
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-opacity duration-200 hover:bg-slate-50 ${
          // Done and behind the tester: dimmed so the eye lands on the
          // current step, but readable again on hover, since going back to
          // re-read a step you just passed is a normal thing to do. Failures
          // and warnings never dim — they are the reason anyone scrolls back.
          isPast && !expanded && step.status !== "failed" && step.status !== "warning"
            ? "opacity-55 hover:opacity-100"
            : ""
        }`}
      >
        <span
          className={`text-[10px] transition-transform duration-200 ${
            expanded ? "rotate-90 text-slate-500" : "text-slate-300"
          }`}
          aria-hidden="true"
        >
          ▸
        </span>
        <span className="text-xs text-slate-400">#{index + 1}</span>
        <span
          className={`flex-1 truncate text-sm ${
            isCurrent ? "font-medium text-slate-900" : "text-slate-800"
          }`}
        >
          {step.title}
        </span>
        {/* Only automated steps carry a type badge. Manual is what a step is
            unless it says otherwise, so labelling it puts a word on every row
            that distinguishes nothing and crowds the titles it sits next to. */}
        {step.type === "automated" && (
          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">
            automated
          </span>
        )}
        <StepStatusBadge status={step.status} />
      </button>

      <CollapsedFindings step={step} hidden={expanded} />

      {/* Animating a grid row from 0fr to 1fr is the one collapse that does
          not need the content measured first — no height in JS, no jump when
          a Markdown block reflows, and it stays correct when a step's body
          grows as notes are added. Quick on purpose: this fires on every
          pass, and anything slower than ~200ms starts to feel like waiting. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        {/* The clip has to be on the grid item itself, with every bit of
            padding inside it — padding on the item survives the row going to
            zero and leaves a visible gap under each collapsed step. `inert`
            keeps the collapsed body out of the tab order, since it is still
            in the DOM and its fields are still focusable. */}
        <div className="overflow-hidden" inert={!expanded}>
          <div className="space-y-3 px-3 pb-3">
            {step.where && (
              <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                <span className="font-medium text-slate-500">Where:</span>
                <code className="text-slate-600">{step.where}</code>
                {looksNavigable(step.where) && <NavigateButton where={step.where} />}
              </div>
            )}
            {step.selectors.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={highlight}
                    disabled={highlightState === "highlighting"}
                    className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                  >
                    ✨ Highlight
                  </button>
                  {highlightState === "not-found" && (
                    <span className="text-[10px] text-red-500">
                      {step.selectors.length > 1 ? "no candidate matched" : "not found on page"}
                    </span>
                  )}
                  {matchedSelector && step.selectors.length > 1 && (
                    <span className="text-[10px] text-slate-400">
                      matched #{step.selectors.indexOf(matchedSelector) + 1} of{" "}
                      {step.selectors.length}
                    </span>
                  )}
                </div>
                <PageAccessNotice access={access} onGranted={() => void highlight()} />
                <ul className="space-y-0.5">
                  {step.selectors.map((sel, i) => (
                    <li key={`${i}-${sel}`} className="flex items-baseline gap-1">
                      {step.selectors.length > 1 && (
                        <span className="text-[10px] text-slate-300">{i + 1}.</span>
                      )}
                      <code
                        className={`text-[10px] ${
                          matchedSelector === sel ? "font-medium text-amber-600" : "text-slate-400"
                        }`}
                      >
                        {sel}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {step.instructions && (
              <Markdown
                text={step.instructions}
                insertValues
                className="text-sm text-slate-600"
              />
            )}
            {step.type === "automated" && step.script && (
              <pre className="overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">
                {step.script}
              </pre>
            )}
            {step.expected && (
              <div className="text-xs text-slate-500">
                <span className="font-medium text-slate-600">Expected:</span>
                <Markdown text={step.expected} insertValues className="text-xs text-slate-500" />
              </div>
            )}
            {step.note && (
              <div className="border-l-2 border-slate-200 pl-2 text-[11px] text-slate-400">
                <span className="font-medium">Note:</span>
                <Markdown text={step.note} insertValues className="text-[11px] text-slate-400" />
              </div>
            )}

            {/* Counts are folded into run.json when the run finishes, so this
                is a record on a finished run rather than a live meter. The
                lines themselves are in console.md — pointing at the step is
                what makes them findable. */}
            {hasCaptureSignal(step) && (
              <p className="text-[11px] text-slate-500">
                <span className="font-medium">Console:</span> {describeCounts(step)}
                <span className="text-slate-400"> — see console.md in this run's folder</span>
              </p>
            )}

            {step.type === "automated" && step.automatedResult && (
              <div className="rounded border border-slate-200 p-2 text-xs">
                {step.automatedResult.warnings.length > 0 && (
                  <ul className="list-disc pl-4 text-amber-700">
                    {step.automatedResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                {step.automatedResult.error && (
                  <p className="text-red-600">{step.automatedResult.error}</p>
                )}
              </div>
            )}

            {!readOnly && step.type === "automated" && (
              <div className="space-y-1.5">
                {step.selectors.length === 0 && (
                  <PageAccessNotice access={access} onGranted={() => void runAutomated()} />
                )}
                <button
                  disabled={busy}
                  onClick={() => void runAutomated()}
                  className="w-full rounded bg-violet-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {step.status === "pending" ? "Run" : "Re-run"}
                </button>
              </div>
            )}

            <StepComments
              step={step}
              readOnly={readOnly}
              onUpdateFields={onUpdateFields}
              onDraftChange={onDraftChange}
            />

            {/* The verdict goes last, after everything it is a verdict on:
                the tester reads the step, does it, writes down what they
                saw, and only then decides. It also puts the three buttons in
                the same place on every step, right above the next step's
                header, which is where the thumb already is.

                Only on the step being worked on and on steps already
                decided — a pending step three ahead offers a judgement the
                tester is in no position to make, and an accidental tap on it
                silently skips the work in between. */}
            {!readOnly && (isCurrent || step.status !== "pending") && (
              <div className="space-y-1 border-t border-slate-100 pt-2.5">
                <label className="text-[10px] font-medium text-slate-400">
                  {step.type === "automated" ? "Override result" : "Result"}
                </label>
                <div className="flex gap-2">
                  <VerdictButton
                    verdict="success"
                    label="Pass"
                    status={step.status}
                    disabled={busy}
                    onMark={onMark}
                  />
                  <VerdictButton
                    verdict="warning"
                    label="Warning"
                    status={step.status}
                    disabled={busy}
                    onMark={onMark}
                  />
                  <VerdictButton
                    verdict="failed"
                    label="Fail"
                    status={step.status}
                    disabled={busy}
                    onMark={onMark}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

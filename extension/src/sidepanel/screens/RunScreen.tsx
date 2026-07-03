import { useEffect, useRef, useState } from "react";
import { newTaskId, type Run, type RunStep } from "@tcm/shared";
import { Header } from "../../components/Header.js";
import { Markdown } from "../../components/Markdown.js";
import { RunStatusBadge, StepStatusBadge } from "../../components/StatusBadge.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { chainAutomatedFrom, markManualStep, runAutomatedStep } from "../../lib/run-engine.js";
import { getActiveTabId } from "../../lib/automation.js";
import { highlightSelectorInTab } from "../../lib/highlight.js";

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
  const [error, setError] = useState<string | null>(null);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    store
      .getRun(testCaseId, runId)
      .then(async (loaded) => {
        if (cancelled) return;
        setRun(loaded);
        const firstActionable =
          loaded.steps.find((s) => s.status === "pending" || s.status === "running") ??
          loaded.steps[0];
        setExpandedStepId(firstActionable?.stepId ?? null);
        if (loaded.status === "in_progress" && !autoStarted.current) {
          autoStarted.current = true;
          const chained = await chainAutomatedFrom(store, loaded, null);
          if (!cancelled) setRun(chained);
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId, runId]);

  const readOnly = !run || run.status !== "in_progress";

  async function handleMark(step: RunStep, status: "success" | "failed" | "warning" | "skipped") {
    if (!run) return;
    setBusyStepId(step.stepId);
    setError(null);
    try {
      const updated = await markManualStep(store, run, step.stepId, status);
      setRun(updated);
      const next = updated.steps[updated.steps.findIndex((s) => s.stepId === step.stepId) + 1];
      if (next) setExpandedStepId(next.stepId);
    } catch (e) {
      setError(String(e));
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
      setError(String(e));
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
      setError(String(e));
    }
  }

  async function finishRun(status: "passed" | "failed" | "aborted") {
    if (!run) return;
    setError(null);
    try {
      const updated = await store.finishRun(run.testCaseId, run.id, status);
      setRun(updated);
    } catch (e) {
      setError(String(e));
    }
  }

  if (!run) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Run" onBack={onBack} onSettings={onSettings} />
        <p className="p-3 text-sm text-slate-400">{error ?? "Loading…"}</p>
      </div>
    );
  }

  const passCount = run.steps.filter((s) => s.status === "success").length;
  const failCount = run.steps.filter((s) => s.status === "failed").length;

  return (
    <div className="flex h-full flex-col">
      <Header
        title={run.testCaseTitle}
        onBack={onBack}
        onSettings={onSettings}
        actions={<RunStatusBadge status={run.status} />}
      />
      <div className="border-b border-slate-200 px-3 py-2 text-xs text-slate-500">
        v{run.testCaseVersion} · {passCount}/{run.steps.length} passed
        {failCount > 0 && <span className="text-red-600"> · {failCount} failed</span>}
      </div>
      {error && <p className="px-3 pt-2 text-sm text-red-600">{error}</p>}

      <div className="flex-1 overflow-y-auto">
        {run.steps.map((step, index) => (
          <StepRow
            key={step.stepId}
            index={index}
            step={step}
            expanded={expandedStepId === step.stepId}
            busy={busyStepId === step.stepId}
            readOnly={readOnly}
            onToggle={() =>
              setExpandedStepId((id) => (id === step.stepId ? null : step.stepId))
            }
            onMark={(status) => handleMark(step, status)}
            onRunAutomated={() => handleRunAutomated(step)}
            onUpdateFields={(patch) => updateStepFields(step, patch)}
          />
        ))}
      </div>

      {!readOnly && (
        <div className="flex gap-2 border-t border-slate-200 p-3">
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
      )}
    </div>
  );
}

function StepRow({
  index,
  step,
  expanded,
  busy,
  readOnly,
  onToggle,
  onMark,
  onRunAutomated,
  onUpdateFields,
}: {
  index: number;
  step: RunStep;
  expanded: boolean;
  busy: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onMark: (status: "success" | "failed" | "warning" | "skipped") => void;
  onRunAutomated: () => void;
  onUpdateFields: (patch: Partial<RunStep>) => void;
}) {
  const [commentDraft, setCommentDraft] = useState(step.comment);
  const [noteDraft, setNoteDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [highlightState, setHighlightState] = useState<"idle" | "highlighting" | "not-found">(
    "idle",
  );

  useEffect(() => setCommentDraft(step.comment), [step.comment]);

  async function highlight() {
    if (!step.selector) return;
    setHighlightState("highlighting");
    try {
      const tabId = await getActiveTabId();
      const found = await highlightSelectorInTab(tabId, step.selector);
      setHighlightState(found ? "idle" : "not-found");
      if (!found) setTimeout(() => setHighlightState("idle"), 2000);
    } catch {
      setHighlightState("not-found");
      setTimeout(() => setHighlightState("idle"), 2000);
    }
  }

  // Flash the element automatically whenever this step becomes the focused one.
  useEffect(() => {
    if (expanded && step.selector) void highlight();
  }, [expanded, step.selector]);

  return (
    <div className="border-b border-slate-100">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
      >
        <span className="text-xs text-slate-400">#{index + 1}</span>
        <span className="flex-1 truncate text-sm text-slate-800">{step.title}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            step.type === "automated"
              ? "bg-violet-100 text-violet-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {step.type}
        </span>
        <StepStatusBadge status={step.status} />
      </button>

      {expanded && (
        <div className="space-y-3 px-3 pb-3">
          {step.selector && (
            <div className="flex items-center gap-2">
              <button
                onClick={highlight}
                disabled={highlightState === "highlighting"}
                className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                ✨ Highlight
              </button>
              <code className="text-[10px] text-slate-400">{step.selector}</code>
              {highlightState === "not-found" && (
                <span className="text-[10px] text-red-500">not found on page</span>
              )}
            </div>
          )}
          {step.instructions && (
            <Markdown text={step.instructions} className="text-sm text-slate-600" />
          )}
          {step.type === "automated" && step.script && (
            <pre className="overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">
              {step.script}
            </pre>
          )}
          {step.expected && (
            <div className="text-xs text-slate-500">
              <span className="font-medium text-slate-600">Expected:</span>
              <Markdown text={step.expected} className="text-xs text-slate-500" />
            </div>
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
            <button
              disabled={busy}
              onClick={onRunAutomated}
              className="w-full rounded bg-violet-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {step.status === "pending" ? "Run" : "Re-run"}
            </button>
          )}

          {!readOnly && (
            <div className="space-y-1">
              {step.type === "automated" && (
                <label className="text-[10px] font-medium text-slate-400">
                  Override result
                </label>
              )}
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => onMark("success")}
                  className="flex-1 rounded bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Pass
                </button>
                <button
                  disabled={busy}
                  onClick={() => onMark("warning")}
                  className="flex-1 rounded bg-amber-500 px-2 py-1.5 text-xs font-medium text-white hover:bg-amber-400 disabled:opacity-50"
                >
                  Warning
                </button>
                <button
                  disabled={busy}
                  onClick={() => onMark("failed")}
                  className="flex-1 rounded bg-red-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                >
                  Fail
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-400">Comment</label>
            <textarea
              value={commentDraft}
              disabled={readOnly}
              onChange={(e) => setCommentDraft(e.target.value)}
              onBlur={() => {
                if (commentDraft !== step.comment) onUpdateFields({ comment: commentDraft });
              }}
              rows={2}
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-400">Notes</label>
            <ul className="space-y-0.5">
              {step.notes.map((n, i) => (
                <li key={i} className="text-xs text-slate-600">
                  • {n}
                </li>
              ))}
            </ul>
            {!readOnly && (
              <div className="flex gap-1">
                <input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add a note…"
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                />
                <button
                  onClick={() => {
                    if (!noteDraft.trim()) return;
                    onUpdateFields({ notes: [...step.notes, noteDraft.trim()] });
                    setNoteDraft("");
                  }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-400">Tasks</label>
            <ul className="space-y-0.5">
              {step.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={t.done}
                    disabled={readOnly}
                    onChange={(e) =>
                      onUpdateFields({
                        tasks: step.tasks.map((tt) =>
                          tt.id === t.id ? { ...tt, done: e.target.checked } : tt,
                        ),
                      })
                    }
                  />
                  <span className={t.done ? "line-through text-slate-400" : ""}>{t.text}</span>
                </li>
              ))}
            </ul>
            {!readOnly && (
              <div className="flex gap-1">
                <input
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  placeholder="Add a task…"
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                />
                <button
                  onClick={() => {
                    if (!taskDraft.trim()) return;
                    onUpdateFields({
                      tasks: [...step.tasks, { id: newTaskId(), text: taskDraft.trim(), done: false }],
                    });
                    setTaskDraft("");
                  }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

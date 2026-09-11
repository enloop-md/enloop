import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUDIENCE_HINTS,
  AUDIENCE_LABELS,
  COMMENT_AUDIENCES,
  describeCounts,
  hasCaptureSignal,
  matchesLocations,
  newCommentId,
  QUICK_COMMENTS,
  renderBulletList,
  stepComments,
  stepNumberLabels,
  type AgentCommand,
  type AgentCommandSourceField,
  type AgentQuestion,
  type AgentPresence,
  type RunCommentDraft,
  type CapturedEntry,
  type CommentAudience,
  RATING_MAX,
  RATING_WORDS,
  ratingStars,
  type PhotoSpec,
  type Run,
  type RunScreenshot,
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
import { looksNavigable, whereAddress } from "../../lib/navigate.js";
import { NavigateButton } from "../../components/NavigateButton.js";
import { runCaptureKey } from "../../lib/capture.js";
import { downloadTextFile, fileSlug } from "../../lib/download.js";
import { canDownloadGuide, downloadRunGuide } from "../../lib/guide-download.js";
import { takePhoto, takePlainScreenshot, type TakenPhoto } from "../../lib/photo-runner.js";
import { GESTURE_HINT } from "../../lib/page-capture.js";
import { useGestureScreenshot } from "../../lib/use-gesture-screenshot.js";
import { editScreenshot, EditorTooLargeError, screenshotApi, type ScreenshotOwner } from "../../lib/screenshot-store.js";
import { useCaptureRecorder } from "../useCapture.js";
import { commandPending, useAgentChannel, type AskDraft } from "../useAgentChannel.js";
import { CommandList, StepQuestions } from "./RunAgentChannel.js";
import { FixPrompt } from "./RunFixPrompt.js";
import {
  PhotoConfirmSheet,
  PhotoToast,
  RunScreenshots,
  type PhotoDecision,
  type SpecNotices,
} from "./RunScreenshots.js";

/** A `Mode: confirm` photo waiting for the tester's word. */
interface PendingConfirm {
  stepId: string;
  slot: number;
  spec: PhotoSpec;
  photo: TakenPhoto;
  onDecide: (decision: PhotoDecision) => void;
}

/** How long the auto-photo toast stays. */
const TOAST_MS = 2000;

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
  // The run as of the last store answer, readable from inside the runner's
  // serial photo loop — which spans several awaits and cannot trust the
  // `run` its closure captured at the first one.
  const runRef = useRef<Run | null>(null);
  // Slots the runner has already fired for, as `${stepId}:${slot}`. A
  // discarded or failed photo stays fired: re-opening the step must not
  // take it again (G5); Retake inside the sheet is the one way to a second
  // capture.
  const firedSlots = useRef(new Set<string>());
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // What the runner could not do, per `${stepId}:${slot}` — shown on the
  // spec row, never thrown: the verdict lands either way.
  const [specNotices, setSpecNotices] = useState<Record<string, string>>({});
  const [guideWarnings, setGuideWarnings] = useState<string[] | null>(null);
  const [headerBusy, setHeaderBusy] = useState(false);

  const owner: ScreenshotOwner = { kind: "run", testCaseId, runId };

  /** Every path that gets a new run from the store goes through here, so
   * the ref the photo loop reads is never behind the screen. */
  function applyRun(next: Run) {
    runRef.current = next;
    setRun(next);
  }

  useEffect(() => {
    let cancelled = false;
    store
      .getRun(testCaseId, runId)
      .then(async (loaded) => {
        if (cancelled) return;
        applyRun(loaded);
        if (!commentSeeded.current) {
          commentSeeded.current = true;
          setCommentDraft(loaded.comment);
        }
        if (loaded.status === "in_progress" && !autoStarted.current) {
          autoStarted.current = true;
          const chained = await chainAutomatedFrom(store, loaded, null);
          if (!cancelled) applyRun(chained);
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

  // Questions and commands for this run, re-read from disk while anything is
  // pending — the other side is a Claude Code session looping over the
  // folder, so files are the only place state can live.
  const agent = useAgentChannel(store, testCaseId, runId, run?.status === "in_progress");

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

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), TOAST_MS);
  }

  /**
   * The runner's photos for one step at one moment (`before` when the step
   * opens, `after` when it is marked). Serial, in spec order, so two
   * confirm sheets never fight and the page is not captured twice at once.
   * Every failure becomes a notice on the spec row; nothing here throws,
   * because the verdict waiting behind an `after` photo must land whatever
   * happened to the picture.
   */
  async function takeSlotPhotos(stepId: string, moment: "before" | "after") {
    const api = screenshotApi(store, owner);
    for (let i = 0; ; i++) {
      const current = runRef.current;
      if (!current || current.status !== "in_progress") return;
      const step = current.steps.find((s) => s.stepId === stepId);
      if (!step || i >= step.photos.length) return;
      const spec = step.photos[i];
      const slot = i + 1;
      const key = `${stepId}:${slot}`;
      if (spec.take !== moment || firedSlots.current.has(key)) continue;
      if (current.screenshots.some((s) => s.stepId === stepId && s.slot === slot)) continue;
      firedSlots.current.add(key);

      const fail = (why: string) =>
        setSpecNotices((n) => ({ ...n, [key]: `Photo ${slot} not taken: ${why}` }));
      try {
        let result = await takePhoto(spec, step.selectors);
        while (true) {
          if (!result.ok) {
            fail(result.error);
            break;
          }
          const photo = result.photo;
          const decision: PhotoDecision =
            spec.mode === "auto"
              ? "keep"
              : await new Promise<PhotoDecision>((onDecide) =>
                  setConfirm({ stepId, slot, spec, photo, onDecide }),
                );
          setConfirm(null);
          if (decision === "retake") {
            result = await takePhoto(spec, step.selectors);
            continue;
          }
          if (decision === "discard") break;
          const { next, screenshot } = await api.add({
            stepId,
            slot,
            pageUrl: photo.pageUrl,
            width: photo.width,
            height: photo.height,
            sourcePng: photo.sourcePng,
            ops: photo.ops,
            renderedPng: photo.ops.length > 0 ? photo.renderedPng : null,
            missing: photo.missing,
            caption: "",
          });
          applyRun(next as Run);
          setSpecNotices((n) => {
            const { [key]: _gone, ...rest } = n;
            return rest;
          });
          if (spec.mode === "auto") showToast(`Photo ${slot} taken`);
          if (decision === "edit") {
            try {
              const edited = await editScreenshot(
                api,
                screenshot,
                editorTitleFor(current, step),
                photo.ops,
                photo.sourcePng,
              );
              if (edited) applyRun(edited as Run);
            } catch (e) {
              if (e instanceof EditorTooLargeError) fail("too large to edit (the photo is kept)");
              else setError(e);
            }
          }
          break;
        }
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    }
  }

  /** A hand-taken capture, attached to the step the tester is on, or to
   * the run when there is no current step. */
  async function attachPlainPhoto(photo: TakenPhoto) {
    const current = runRef.current;
    if (!current || current.status !== "in_progress") return;
    const step = current.steps.find((s) => s.status === "pending" || s.status === "running");
    const { run: next } = await store.addScreenshot(testCaseId, runId, {
      stepId: step?.stepId ?? null,
      slot: null,
      pageUrl: photo.pageUrl,
      width: photo.width,
      height: photo.height,
      sourcePng: photo.sourcePng,
      ops: [],
      renderedPng: null,
      missing: [],
      caption: "",
    });
    applyRun(next);
  }

  // The shortcut and the context-menu item: the worker captures on the
  // gesture and hands the bytes here.
  useGestureScreenshot(
    readOnly ? null : (photo) => attachPlainPhoto(photo).catch(setError),
    (message) => setError(new Error(`Cannot capture: ${message}`)),
  );

  /** The header camera: the page as it is. */
  async function captureFromHeader() {
    const current = runRef.current;
    if (!current || readOnly) return;
    setHeaderBusy(true);
    setError(null);
    try {
      const access = await getPageAccess();
      if (access.status !== "ready") {
        setError(new Error(`Cannot capture: ${pageAccessWords(access)}`));
        return;
      }
      const result = await takePlainScreenshot();
      if (!result.ok) {
        setError(new Error(result.needsGesture ? GESTURE_HINT : `Cannot capture: ${result.error}`));
        return;
      }
      await attachPlainPhoto(result.photo);
    } catch (e) {
      setError(e);
    } finally {
      setHeaderBusy(false);
    }
  }

  async function downloadGuide() {
    if (!run) return;
    setError(null);
    try {
      setGuideWarnings(await downloadRunGuide(store, run));
    } catch (e) {
      setError(e);
    }
  }

  async function handleMark(step: RunStep, status: "success" | "failed" | "warning" | "skipped") {
    if (!run) return;
    setBusyStepId(step.stepId);
    setError(null);
    try {
      // The picture of the result comes before the verdict is written: an
      // `after` photo is the state the tester is judging, and marking the
      // step advances the run past it. A skip has no result to picture.
      if (status !== "skipped") await takeSlotPhotos(step.stepId, "after");
      applyRun(await markManualStep(store, runRef.current ?? run, step.stepId, status));
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
      applyRun(await runAutomatedStep(store, run, step.stepId));
      // The script's result is on the page now; the chain moves on only
      // once it has been pictured.
      await takeSlotPhotos(step.stepId, "after");
      applyRun(await chainAutomatedFrom(store, runRef.current ?? run, step.stepId));
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
      applyRun(updated);
    } catch (e) {
      setError(e);
    }
  }

  async function saveComment(text: string) {
    if (!run || text === run.comment) return;
    try {
      applyRun(await store.updateRun(run.testCaseId, run.id, { comment: text }));
    } catch (e) {
      setError(e);
    }
  }

  async function saveRating(rating: number | null) {
    if (!run || rating === run.rating) return;
    try {
      applyRun(await store.updateRun(run.testCaseId, run.id, { rating }));
    } catch (e) {
      setError(e);
    }
  }

  async function handleRunCommand(
    command: string,
    stepId: string | null,
    sourceField: AgentCommandSourceField,
  ) {
    // One in flight per command per place: a second ▶ while the first is
    // queued or running is a double-click, not a second request.
    if (agent.commands.some((c) => c.command === command && c.stepId === stepId && commandPending(c)))
      return;
    try {
      await agent.runCommand(command, stepId, sourceField);
    } catch (e) {
      setError(e);
    }
  }

  async function handleRunAgain(command: AgentCommand) {
    try {
      await agent.runCommand(command.command, command.stepId, command.sourceField);
    } catch (e) {
      setError(e);
    }
  }

  async function handleKillCommand(commandId: string) {
    try {
      await agent.kill(commandId);
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
      applyRun(updated);
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
  const skippedCount = run.steps.filter((s) => s.status === "skipped").length;
  const allExpanded = run.steps.every((s) => expandedIds.has(s.stepId));
  const currentIndex = run.steps.findIndex((s) => s.stepId === currentStepId);
  const numberLabels = stepNumberLabels(run.steps);
  const moveTargets = run.steps.map((s, i) => ({ stepId: s.stepId, label: `#${numberLabels[i]} ${s.title}` }));
  const guide = run.kind === "guide";
  const specNoticesFor = (stepId: string): SpecNotices => {
    const out: SpecNotices = {};
    for (const [key, text] of Object.entries(specNotices)) {
      const [id, slot] = [key.slice(0, key.lastIndexOf(":")), Number(key.slice(key.lastIndexOf(":") + 1))];
      if (id === stepId) out[slot] = text;
    }
    return out;
  };
  // Must mirror renderRunFeedback's own test, including the run-level
  // comment — a banner promising a feedback.md that was never written is
  // worse than no banner.
  const hasFeedbackSignal =
    run.comment.trim().length > 0 ||
    run.rating != null ||
    run.steps.some(
      (s) =>
        s.status === "failed" ||
        s.status === "warning" ||
        (s.status === "skipped" && !s.extra) ||
        stepComments(s).some((c) => c.text.trim().length > 0) ||
        !!s.automatedResult?.error ||
        s.consoleErrors > 0 ||
        s.rating != null,
    );

  return (
    <div className="relative flex h-full flex-col">
      <Header
        title={run.testCaseTitle}
        onBack={onBack}
        onSettings={onSettings}
        actions={<RunStatusBadge status={run.status} />}
      />
      {/* The goal stays above whatever step is current, for the whole run:
          nobody should wonder what the click they are about to make is for.
          The camera beside it is the one-click capture that needs no step
          open: it lands on the step the tester is on, or on the run. */}
      {(run.goal.trim() || !readOnly) && (
        <div className="flex items-start gap-2 border-b border-emerald-100 bg-emerald-50 px-3 py-1.5">
          <p className="flex-1 text-sm font-medium text-emerald-900" title="What this case proves">
            {run.goal}
          </p>
          {!readOnly && (
            <button
              type="button"
              onClick={() => void captureFromHeader()}
              disabled={headerBusy}
              className="shrink-0 rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-sm leading-none hover:bg-emerald-100 disabled:opacity-50"
              title={currentStepId ? "Screenshot for the current step" : "Screenshot for the run"}
              aria-label="Take a screenshot"
            >
              📷
            </button>
          )}
        </div>
      )}
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
          {/* Skipped steps leave the denominator: "5/5 passed · 2 skipped"
              is a done run, "5/7 passed" is a run that looks abandoned. */}
          v{run.testCaseVersion} · {passCount}/{run.steps.length - skippedCount} passed
          {failCount > 0 && <span className="text-red-600"> · {failCount} failed</span>}
          {skippedCount > 0 && <span> · {skippedCount} skipped</span>}
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
          Feedback saved to feedback.md in this run's folder — point Claude Code
          at it, or copy and download it from the bottom of this screen.
        </p>
      )}

      <div className="flex-1 overflow-y-auto">
        {(run.youWill.trim() || run.youWillNeed.length > 0) && (
          <WhatToExpect youWill={run.youWill} youWillNeed={run.youWillNeed} locations={run.locations} />
        )}
        {/* Screenshots of the run as a whole — the landing page, the state
            before step 1 — and the home of anything moved off a step. */}
        {(!readOnly || run.screenshots.some((s) => s.stepId === null)) && (
          <div className="border-b border-slate-200 px-3 py-2">
            <RunScreenshots
            owner={owner}
            step={null}
            screenshots={run.screenshots.filter((s) => s.stepId === null)}
            readOnly={readOnly}
            onChanged={(next) => applyRun(next as Run)}
            moveTargets={moveTargets}
            editorTitle={`${run.testCaseTitle} — run`}
            compact
          />
          </div>
        )}
        <BeforeYouStart
          dependencies={run.dependencies}
          prerequisites={run.prerequisites}
          locations={run.locations}
          onRunCommand={
            readOnly ? undefined : (command, field) => void handleRunCommand(command, null, field)
          }
        />
        {/* Run-level command cards live outside the collapsed details above:
            a server someone started must stay visible while it runs. */}
        {agent.commands.some((c) => c.stepId === null) && (
          <div className="border-b border-slate-100 px-3 py-2">
            <CommandList
              commands={agent.commands.filter((c) => c.stepId === null)}
              readOnly={readOnly}
              onKill={handleKillCommand}
              onRunAgain={handleRunAgain}
            />
          </div>
        )}
        {run.steps.map((step, index) => (
          <div key={step.stepId}>
            {step.group && run.steps[index - 1]?.group !== step.group && (
              <GroupHeader
                title={step.group}
                goal={
                  run.groups.find((g) => g.title === step.group)?.goal ?? ""
                }
                steps={run.steps.filter((s) => s.group === step.group)}
              />
            )}
            <StepRow
              numberLabel={numberLabels[index]}
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
              onDraftChange={(draft) =>
                pendingDrafts.current.set(step.stepId, draft)
              }
              onBeforePhotos={() => takeSlotPhotos(step.stepId, "before")}
              owner={owner}
              screenshots={run.screenshots.filter((s) => s.stepId === step.stepId)}
              specNotices={specNoticesFor(step.stepId)}
              moveTargets={moveTargets}
              editorTitle={editorTitleFor(run, step, numberLabels[index])}
              onScreenshotsChanged={(next) => applyRun(next as Run)}
              run={run}
              questions={agent.questions}
              commands={agent.commands.filter((c) => c.stepId === step.stepId)}
              watcher={agent.watcher}
              onAsk={agent.ask}
              onSwapped={applyRun}
              onRunCommand={(command, field) =>
                void handleRunCommand(command, step.stepId, field)
              }
              onKillCommand={handleKillCommand}
              onRunAgain={handleRunAgain}
            />
          </div>
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
          {/* The case as a piece of test writing, not the feature under test:
              a run can fail on a five-star case. Most runs leave this empty;
              it is here for the case worth pointing the next author at, and
              the one that should not be repeated. */}
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span title="How well written is this case? Feeds the ratings the authoring skills read for this project.">
              Rate this test case
            </span>
            <StarRating
              value={run.rating}
              onChange={(rating) => void saveRating(rating)}
              label="Rate this test case"
            />
          </div>
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

      {readOnly &&
        (run.comment.trim() || run.rating != null || hasFeedbackSignal) && (
          <div className="space-y-2 border-t border-slate-200 p-3">
            {run.rating != null && (
              <p className="text-xs text-slate-600">
                <span className="text-amber-500">
                  {ratingStars(run.rating)}
                </span>{" "}
                The tester rated this case {RATING_WORDS[run.rating]}.
              </p>
            )}
            {run.comment.trim() && (
              <div>
                <h2 className="mb-1 text-xs font-semibold uppercase text-slate-400">
                  Comment on this run
                </h2>
                <Markdown
                  text={run.comment}
                  className="text-xs text-slate-600"
                />
              </div>
            )}
            {hasFeedbackSignal && (
              <FeedbackHandoff
                store={store}
                testCaseId={testCaseId}
                runId={runId}
                title={run.testCaseTitle}
              />
            )}
          </div>
        )}

      {/* A run with pictures is a guide waiting to be read; a guide's run
          is one even without them. One self-contained HTML file, every
          screenshot inlined, so it can be mailed as it is. */}
      {readOnly && canDownloadGuide(run) && (
        <div className="space-y-1 border-t border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void downloadGuide()}
              className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500"
              title="This run as a user guide: one HTML page with the screenshots inlined"
            >
              ⬇ Download guide
            </button>
            <span className="text-[11px] text-slate-400">
              {run.screenshots.length} screenshot{run.screenshots.length === 1 ? "" : "s"}
              {guide ? " · guide" : ""}
            </span>
          </div>
          {guideWarnings && guideWarnings.length > 0 && (
            <p className="text-[11px] text-amber-700" title={guideWarnings.join("\n")}>
              {guideWarnings.length === 1
                ? guideWarnings[0]
                : `${guideWarnings.length} placeholders had no screenshot and were dropped`}
            </p>
          )}
        </div>
      )}

      {confirm && (
        <PhotoConfirmSheet
          slot={confirm.slot}
          spec={confirm.spec}
          photo={confirm.photo}
          onDecide={confirm.onDecide}
        />
      )}
      <PhotoToast text={toast} />
    </div>
  );
}

/** Names the editor tab after where the screenshot belongs. */
function editorTitleFor(run: Run, step: RunStep, label?: string): string {
  const index = run.steps.findIndex((s) => s.stepId === step.stepId);
  const number = label ?? stepNumberLabels(run.steps)[index] ?? "";
  return `${run.testCaseTitle} — step ${number}: ${step.title}`;
}

/** The access states as one clause, for an error the header camera shows. */
function pageAccessWords(access: PageAccess): string {
  switch (access.status) {
    case "no-tab":
      return "no page open to capture";
    case "needs-grant":
      return `Enloop has no access to ${access.host} yet — open the step's Highlight or Screenshot to grant it`;
    case "restricted":
      return access.reason;
    default:
      return "";
  }
}

/**
 * The finished run's `feedback.md` — every comment, rating and failure,
 * grouped by who it is addressed to — shown in the panel with a copy button
 * and a download button. On a machine with Claude Code the file in the run's
 * folder is enough; this is for the tester who has no agent watching, and
 * needs to hand the same text to someone who does. Loaded on first open, not
 * on mount: a finished run is opened far more often to look at than to hand
 * on, and the file is already on disk.
 */
function FeedbackHandoff({
  store,
  testCaseId,
  runId,
  title,
}: {
  store: {
    getRunFeedback(testCaseId: string, runId: string): Promise<string | null>;
  };
  testCaseId: string;
  runId: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  // `undefined` = not loaded yet; `null` = the run had nothing to hand on.
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open || text !== undefined) return;
    let cancelled = false;
    store
      .getRunFeedback(testCaseId, runId)
      .then((t) => !cancelled && setText(t))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [open, text, store, testCaseId, runId]);

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(e);
    }
  }

  function download() {
    if (!text) return;
    downloadTextFile(`${fileSlug(title)}-${runId}-feedback.md`, text);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-xs text-violet-700 hover:underline"
      >
        {open ? "▾" : "▸"} Comments for all steps
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {text === undefined && !error && (
            <p className="text-[11px] text-slate-400">Loading…</p>
          )}
          <ErrorNotice error={error} />
          {text === null && (
            <p className="text-[11px] text-slate-500">
              Nothing to hand on: no comments, ratings or failures were recorded
              for this run.
            </p>
          )}
          {text && (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void download()}
                  className="rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500"
                >
                  Download .md
                </button>
                <button
                  type="button"
                  onClick={() => void copy()}
                  title="Copy to clipboard"
                  aria-label="Copy to clipboard"
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {copied ? "✓ Copied" : "⧉ Copy"}
                </button>
                <span className="text-[11px] text-slate-400">
                  Same text as feedback.md in the run's folder.
                </span>
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] leading-snug text-slate-700">
                {text}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The heading over a group's steps: its title, its goal, and how the steps
 * under it stand so far. The goal is the sentence a tester reads to know
 * what the next few verdicts are for — which is the whole reason groups
 * exist — so it is shown in full rather than behind a toggle.
 */
function GroupHeader({
  title,
  goal,
  steps,
}: {
  title: string;
  goal: string;
  steps: Array<{ status: RunStep["status"] }>;
}) {
  const failed = steps.filter((s) => s.status === "failed").length;
  const warning = steps.filter((s) => s.status === "warning").length;
  const passed = steps.filter((s) => s.status === "success").length;
  const tone =
    failed > 0
      ? "text-red-600"
      : warning > 0
        ? "text-amber-600"
        : "text-emerald-600";
  const tally = [
    passed > 0 && `${passed} passed`,
    warning > 0 && `${warning} warn`,
    failed > 0 && `${failed} failed`,
  ].filter((t): t is string => !!t);
  return (
    <div className="border-b border-slate-200 bg-slate-50 px-3 pb-2 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </h2>
        <span className="text-[10px] text-slate-400">
          {steps.length} {steps.length === 1 ? "step" : "steps"}
          {tally.length > 0 && (
            <span className={tone}> · {tally.join(", ")}</span>
          )}
        </span>
      </div>
      {goal.trim() && (
        <Markdown text={goal} className="mt-0.5 text-xs text-slate-600" />
      )}
    </div>
  );
}

/**
 * The shape of the work and what must be in hand, read before step 1. Open,
 * never collapsed, unlike `BeforeYouStart`: a mailbox the confirmation code
 * lands in is needed now, not discovered mid-step with the code expiring.
 */
function WhatToExpect({
  youWill,
  youWillNeed,
  locations,
}: {
  youWill: string;
  youWillNeed: string[];
  locations: string[];
}) {
  return (
    <div className="space-y-1.5 border-b border-slate-200 bg-white px-3 py-2 text-xs">
      {youWill.trim() && (
        <p className="text-slate-600">
          <span className="font-medium text-slate-700">You will: </span>
          {youWill}
        </p>
      )}
      {youWillNeed.length > 0 && (
        <div>
          <span className="font-medium text-slate-700">You will need:</span>
          <Markdown
            text={renderBulletList(youWillNeed)}
            className="text-xs text-slate-600"
            locations={locations}
          />
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
  locations,
  onRunCommand,
}: {
  dependencies: string[];
  prerequisites: string[];
  /** The case's `@locations`, so the entry-point link is coloured. */
  locations: string[];
  /** Hands an authored command to the watching agent session; absent when
   * the run is read-only. */
  onRunCommand?: (command: string, field: "dependencies" | "prerequisites") => void;
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
              text={renderBulletList(prerequisites)}
              className="text-xs text-slate-600"
              locations={locations}
              onRunCommand={onRunCommand && ((c) => onRunCommand(c, "prerequisites"))}
            />
          </div>
        )}
        {dependencies.length > 0 && (
          <div>
            <h3 className="mb-0.5 text-[10px] font-semibold uppercase text-slate-400">
              Dependencies
            </h3>
            <Markdown
              text={renderBulletList(dependencies)}
              className="text-xs text-slate-600"
              locations={locations}
              onRunCommand={onRunCommand && ((c) => onRunCommand(c, "dependencies"))}
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

/**
 * Five stars, none lit until the tester says so. One tap sets, a tap on the
 * lit star clears — there is no "zero stars" rating, only the absence of one,
 * and most steps stay that way. The stars are the whole control: no label
 * under them, no confirm, because the rating is an aside made in passing,
 * not a form to fill in.
 */
function StarRating({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | null;
  onChange: (rating: number | null) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <span
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center gap-px"
      title={
        value == null
          ? label
          : `${value}/${RATING_MAX} — ${RATING_WORDS[value]}`
      }
    >
      {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((star) => {
        const lit = value != null && star <= value;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} of ${RATING_MAX} — ${RATING_WORDS[star]}`}
            disabled={disabled}
            onClick={() => onChange(value === star ? null : star)}
            className={`px-px text-base leading-none transition-colors disabled:opacity-50 ${
              lit
                ? "text-amber-500 hover:text-amber-400"
                : "text-slate-300 hover:text-amber-300"
            }`}
          >
            {lit ? "★" : "☆"}
          </button>
        );
      })}
    </span>
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

/** Where the audience-legend switch is remembered. `localStorage` is the
 * panel's own, so this never touches the data folder. Wrapped because a
 * side panel can run where storage throws, and a lost preference is nothing
 * next to a step that will not render. */
const LEGEND_PREFERENCE_KEY = "enloop.audienceLegend";

function readLegendPreference(): boolean {
  try {
    return localStorage.getItem(LEGEND_PREFERENCE_KEY) === "on";
  } catch {
    return false;
  }
}

function writeLegendPreference(on: boolean): void {
  try {
    localStorage.setItem(LEGEND_PREFERENCE_KEY, on ? "on" : "off");
  } catch {
    // Nothing to do: the switch still works for this render.
  }
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
  hasPreviousStep,
  readOnly,
  onUpdateFields,
  onDraftChange,
}: {
  step: RunStep;
  /** False on the first step of the run, which hides the shortcuts that
   * talk about a previous one. */
  hasPreviousStep: boolean;
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

  // Whether the audience row shows what each name means. Off by default:
  // five hints under five checkboxes is a paragraph on every step, and after
  // the first run nobody reads it. Remembered across steps and runs, so
  // switching it on is done once, not once per step.
  const [showLegend, setShowLegend] = useState(() => readLegendPreference());

  function toggleLegend() {
    const next = !showLegend;
    setShowLegend(next);
    writeLegendPreference(next);
  }

  function add() {
    if (!draft.trim()) return;
    onUpdateFields({
      comments: [
        ...step.comments,
        { id: newCommentId(), text: draft.trim(), audiences: [...audiences] },
      ],
      draft: null,
    });
    // Box and ticks both empty: the next comment starts from nothing, so a
    // tick left over from the last one cannot address it to the wrong reader
    // unnoticed.
    setDraft("");
    setAudiences([]);
  }

  /** The one-tap comments: the same shape as `add`, with the words and the
   * audience supplied. Added outright rather than put in the box — the
   * tester chose the button because the sentence is already right. */
  function addQuick(quick: (typeof QUICK_COMMENTS)[number]) {
    onUpdateFields({
      comments: [
        ...step.comments,
        {
          id: newCommentId(),
          text: quick.text,
          audiences: [...quick.audiences],
        },
      ],
    });
  }

  const quickComments = QUICK_COMMENTS.filter(
    (quick) =>
      (!quick.needsPreviousStep || hasPreviousStep) &&
      // Once it is on the step, the button has done its job; the × next to
      // the comment is the way to take it back.
      !step.comments.some((c) => c.text === quick.text),
  );

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
          {/* Above the box, not below the Add button: these are the things
              a tester says instead of typing, so they belong where typing
              would otherwise start. */}
          {quickComments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {quickComments.map((quick) => (
                <button
                  key={quick.id}
                  type="button"
                  onClick={() => addQuick(quick)}
                  title={`Adds the comment "${quick.text}" for the ${quick.audiences
                    .map((a) => AUDIENCE_LABELS[a].toLowerCase())
                    .join(", ")}`}
                  className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800 hover:bg-emerald-100"
                >
                  + {quick.label}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="What did you see?"
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>This comment is for:</span>
              <button
                type="button"
                onClick={toggleLegend}
                aria-pressed={showLegend}
                className="hover:text-slate-600 hover:underline"
              >
                {showLegend ? "Hide hints" : "What do these mean?"}
              </button>
            </div>
            {/* Condensed: names in a row, each still carrying its hint as a
                tooltip. Expanded: one per line with the hint spelled out —
                the view a first-time tester needs and a tenth-time tester
                scrolls past. */}
            <div
              className={
                showLegend ? "space-y-0.5" : "flex flex-wrap gap-x-3 gap-y-0.5"
              }
            >
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
                    {AUDIENCE_LABELS[audience]}
                    {showLegend && (
                      <span className="text-slate-400">
                        {" "}
                        — {AUDIENCE_HINTS[audience]}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {showLegend && (
              <p className="pl-5 text-[10px] text-slate-400">
                Tick none and it is context: kept with the run, addressed to
                nobody.
              </p>
            )}
          </div>
          {/* Pale while the box is empty, filled the moment it is not: the
              button's colour is the one cue that something is waiting to be
              added, on a panel where the box itself looks the same either
              way. */}
          <button
            onClick={add}
            disabled={!draft.trim()}
            className={`w-full rounded px-2 py-1.5 text-xs font-medium transition-colors ${
              draft.trim()
                ? "border border-transparent bg-sky-600 text-white shadow-sm hover:bg-sky-500"
                : "border border-slate-200 text-slate-400"
            }`}
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

/** A `Where:` address by where its host stands against `@locations`. */
const WHERE_CLASS = {
  unchecked: "text-slate-600",
  match: "text-emerald-700",
  mismatch: "text-red-600",
} as const;

function StepRow({
  numberLabel,
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
  onBeforePhotos,
  owner,
  screenshots,
  specNotices,
  moveTargets,
  editorTitle,
  onScreenshotsChanged,
  run,
  questions,
  commands,
  watcher,
  onAsk,
  onSwapped,
  onRunCommand,
  onKillCommand,
  onRunAgain,
}: {
  /** "2" for an ordinary step, "2.1" for an extra one — see stepNumberLabels. */
  numberLabel: string;
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
  /** The runner's `Take: before` photos, fired once the step is open and
   * its Highlight has settled. */
  onBeforePhotos: () => Promise<void>;
  owner: ScreenshotOwner;
  /** This step's screenshots only. */
  screenshots: RunScreenshot[];
  specNotices: SpecNotices;
  moveTargets: Array<{ stepId: string; label: string }>;
  editorTitle: string;
  onScreenshotsChanged: (next: Run) => void;
  run: Run;
  questions: AgentQuestion[];
  commands: AgentCommand[];
  watcher: AgentPresence | null;
  onAsk: (draft: AskDraft) => Promise<AgentQuestion>;
  onSwapped: (run: Run) => void;
  onRunCommand: (command: string, field: "instructions" | "note") => void;
  onKillCommand: (commandId: string) => Promise<void>;
  onRunAgain: (command: AgentCommand) => Promise<void>;
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
  // The address this step's `Where:` would open, held against the case's
  // `@locations`: green fits, red does not, and a placeholder the run could
  // not fill is neither — it is a page the tester finds by hand.
  const unresolvedWhere = /%[A-Za-z_][A-Za-z0-9_]*%/.test(step.where ?? "");
  const whereStatus = matchesLocations(run.locations, whereAddress(step.where ?? "", run.mainOrigin));
  const whereTitle =
    whereStatus === "mismatch"
      ? `Does not match this case's @locations: ${run.locations.join(", ")}`
      : whereStatus === "match"
        ? "Matches this case's @locations"
        : undefined;
  // What the `%PHOTO_n%` chips in the prose say: green once the slot has a
  // screenshot, amber until then.
  const photoSlots = {
    filled: screenshots.filter((s) => s.slot !== null).map((s) => s.slot as number),
    captions: step.photos.map((p) => p.caption),
  };

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
  // The `before` photos follow the highlight, in that order: the highlight
  // scrolls the subject into view, and the photo wants it there. The
  // run screen guards against a slot firing twice, so a step opened,
  // closed and opened again does not take a second picture.
  useEffect(() => {
    if (!expanded || !isCurrent) return;
    void (async () => {
      if (step.selectors.length > 0) await highlight();
      await onBeforePhotos();
    })();
  }, [expanded, isCurrent, selectorKey]);

  // Keep the step being worked on in view as the run advances past the fold.
  // `nearest` so a step that is already visible does not get yanked around.
  useEffect(() => {
    if (isCurrent) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isCurrent]);

  return (
    <div
      ref={rowRef}
      // The marker StepQuestions uses to tell "selected text in this step"
      // from a selection elsewhere in the panel.
      data-step-row
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
        <span className="text-xs text-slate-400">#{numberLabel}</span>
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
        {step.extra && (
          <span
            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
            title="Optional side-check — skipped unless you decide to do it"
          >
            extra
          </span>
        )}
        {step.rating != null && (
          <span
            className="text-[11px] text-amber-500"
            title={`Rated ${step.rating}/${RATING_MAX} — ${RATING_WORDS[step.rating]}`}
          >
            ★{step.rating}
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
                <code className={WHERE_CLASS[whereStatus]} title={whereTitle}>
                  {step.where}
                </code>
                {looksNavigable(step.where) && (
                  <NavigateButton
                    where={step.where}
                    mainOrigin={run.mainOrigin}
                    status={whereStatus}
                  />
                )}
                {unresolvedWhere && (
                  <span className="text-[10px] text-amber-600">
                    holds a value the run does not have — find the page by the
                    instructions instead
                  </span>
                )}
              </div>
            )}
            {/* The UI path to the page, beside the address: the link may be for
                another deployment or incomplete, and this is how a person gets
                there anyway. "link only" is the explicit answer that there is
                no menu to look for. */}
            {step.via && (
              <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                <span className="font-medium text-slate-500">Via:</span>
                <span className="text-slate-600">{step.via}</span>
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
                locations={run.locations}
                photoSlots={photoSlots}
                className="text-sm text-slate-600"
                onRunCommand={
                  !readOnly && step.type === "manual"
                    ? (c) => onRunCommand(c, "instructions")
                    : undefined
                }
              />
            )}
            {step.type === "automated" && step.script && (
              <pre className="overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">
                {step.script}
              </pre>
            )}
            {step.expected && (
              <div className="text-xs text-slate-500">
                <span className="font-medium text-slate-600">
                  {run.kind === "guide" ? "You should see:" : "Expected:"}
                </span>
                <Markdown
                  text={step.expected}
                  insertValues
                  locations={run.locations}
                  photoSlots={photoSlots}
                  className="text-xs text-slate-500"
                />
              </div>
            )}
            {step.note && (
              <div className="border-l-2 border-slate-200 pl-2 text-[11px] text-slate-400">
                <span className="font-medium">Note:</span>
                <Markdown
                  text={step.note}
                  insertValues
                  locations={run.locations}
                  className="text-[11px] text-slate-400"
                  onRunCommand={
                    !readOnly && step.type === "manual" ? (c) => onRunCommand(c, "note") : undefined
                  }
                />
              </div>
            )}

            {/* The pictures of this step: what the case asked for, what was
                taken by hand. After the prose they illustrate and before the
                questions and comments about it. */}
            <RunScreenshots
              owner={owner}
              step={step}
              screenshots={screenshots}
              readOnly={readOnly}
              onChanged={(next) => onScreenshotsChanged(next as Run)}
              matchedSelector={matchedSelector}
              moveTargets={moveTargets}
              editorTitle={editorTitle}
              specNotices={specNotices}
            />

            <CommandList
              commands={commands}
              readOnly={readOnly}
              onKill={onKillCommand}
              onRunAgain={onRunAgain}
            />

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

            <StepQuestions
              run={run}
              stepId={step.stepId}
              questions={questions}
              readOnly={readOnly}
              watcher={watcher}
              onAsk={onAsk}
              onSwapped={onSwapped}
            />

            {/* Offered on the step being worked on and on any decided step,
                finished runs included: a run that failed yesterday is
                exactly the one someone hands to an agent today. Not on a
                step three ahead — nothing has been found there yet. */}
            {(isCurrent || step.status !== "pending") && (
              <FixPrompt run={run} step={step} questions={questions} />
            )}

            <StepComments
              step={step}
              hasPreviousStep={run.steps[0]?.stepId !== step.stepId}
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
                    label={run.kind === "guide" ? "Done" : "Pass"}
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
                    label={run.kind === "guide" ? "Could not" : "Fail"}
                    status={step.status}
                    disabled={busy}
                    onMark={onMark}
                  />
                </div>
                {/* Two asides on one line, pushed to opposite ends so neither
                    reads as belonging to the other. Left: skipping — a link,
                    not a fourth button, because declining to judge should
                    not have a verdict's weight. Skips land in feedback.md for
                    the test writer; a step skipped run after run is one the
                    case may not need. Hidden once the step is skipped: the
                    buttons above are the way back. Right: the stars — an
                    opinion of the step as test writing, nothing to do with
                    whether the app passed it. */}
                <div className="flex items-center justify-between pt-0.5">
                  {step.status !== "skipped" ? (
                    <button
                      onClick={() => onMark("skipped")}
                      disabled={busy}
                      className="text-[11px] text-slate-400 hover:text-slate-600 hover:underline disabled:opacity-50"
                    >
                      {step.extra ? "Back to skipped" : "Skip this step"}
                    </button>
                  ) : (
                    <span />
                  )}
                  <StarRating
                    value={step.rating}
                    onChange={(rating) => onUpdateFields({ rating })}
                    disabled={busy}
                    label="Rate how well this step is written"
                  />
                </div>
              </div>
            )}
            {readOnly && step.rating != null && (
              <p className="text-[11px] text-slate-500">
                <span className="text-amber-500">
                  {ratingStars(step.rating)}
                </span>{" "}
                The tester rated this step {RATING_WORDS[step.rating]}.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

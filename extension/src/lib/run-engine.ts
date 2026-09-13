import type { DataStore, Run, RunStepStatus } from "@tcm/shared";
import { runScriptInTab } from "./automation.js";
import { describeError } from "./errors.js";
import { getPageAccess, pageAccessMessage } from "./page-access.js";
import { nowIso } from "./time.js";

/** Statuses that allow the automated chain to keep advancing into the next step. */
const CONTINUES_CHAIN: RunStepStatus[] = ["success", "warning"];

/**
 * A step that submits a form (or otherwise navigates the page) can tear
 * down the frame's JS context before its result callback fires — Chrome
 * doesn't always reliably reject chrome.scripting.executeScript's promise
 * when that happens, so without a timeout the step (and the whole chain
 * behind it) would hang at "running" forever. On timeout we fail the step
 * with an explanatory message rather than leave it stuck; the action
 * itself likely still happened on the page, so the manual override buttons
 * exist specifically for this — verify by eye and mark it Pass.
 */
const AUTOMATED_STEP_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function markManualStep(
  store: DataStore,
  run: Run,
  stepId: string,
  status: "success" | "failed" | "warning" | "skipped",
): Promise<Run> {
  const step = run.steps.find((s) => s.stepId === stepId);
  const updated = await store.updateStep(run.testCaseId, run.id, stepId, {
    status,
    startedAt: step?.startedAt ?? nowIso(),
    finishedAt: nowIso(),
    // A verdict given by hand is the tester's own, even on a step a jump
    // had passed over.
    jumpedOver: false,
  });
  if (CONTINUES_CHAIN.includes(status)) {
    return chainAutomatedFrom(store, updated, stepId);
  }
  return updated;
}

/**
 * "Skip to this step": every undecided step before `stepId` is marked
 * skipped in one go, so the tester lands on the step they want without
 * clicking through the ones they already did — the run before this one was
 * too dirty to finish, and the early steps are not in question. Stamped
 * `jumpedOver` so the report and feedback tell these apart from a step
 * the tester declined: a jump is not a vote against the steps under it.
 * Extra steps keep their resting skipped state; automated steps are not
 * run. Nothing is chained afterwards — the target is the tester's to
 * start, by hand or by its Run button.
 */
export async function skipToStep(store: DataStore, run: Run, stepId: string): Promise<Run> {
  const target = run.steps.findIndex((s) => s.stepId === stepId);
  if (target === -1) throw new Error(`Step not found in run: ${stepId}`);
  let current = run;
  for (const step of run.steps.slice(0, target)) {
    if (step.status !== "pending") continue;
    current = await store.updateStep(run.testCaseId, run.id, step.stepId, {
      status: "skipped",
      jumpedOver: true,
      startedAt: step.startedAt ?? nowIso(),
      finishedAt: nowIso(),
    });
  }
  return current;
}

export async function runAutomatedStep(store: DataStore, run: Run, stepId: string): Promise<Run> {
  const step = run.steps.find((s) => s.stepId === stepId);
  if (!step) throw new Error(`Step not found in run: ${stepId}`);

  await store.updateStep(run.testCaseId, run.id, stepId, {
    status: "running",
    startedAt: nowIso(),
    jumpedOver: false,
  });

  // Checked before injecting rather than after failing: a step that never
  // ran because the page is a `chrome://` tab, or because this site has not
  // been granted yet, is not evidence about the app. Saying which it was is
  // what lets the run screen offer the one-click grant next to the step.
  const access = await getPageAccess();
  if (access.status !== "ready") {
    return await store.updateStep(run.testCaseId, run.id, stepId, {
      status: "failed",
      automatedResult: {
        status: "failed",
        warnings: [],
        error: `${pageAccessMessage(access)} The script was not run.`,
      },
      finishedAt: nowIso(),
    });
  }

  try {
    const result = await withTimeout(
      runScriptInTab(access.tabId, step.script ?? ""),
      AUTOMATED_STEP_TIMEOUT_MS,
      "Automated step timed out. If this step submits a form or otherwise navigates the page, the " +
        "action likely still happened — the page tearing down can prevent the result from reporting " +
        "back. Verify by eye and use the override buttons below if it actually succeeded.",
    );
    return await store.updateStep(run.testCaseId, run.id, stepId, {
      status: result.status,
      automatedResult: result,
      finishedAt: nowIso(),
    });
  } catch (e) {
    return await store.updateStep(run.testCaseId, run.id, stepId, {
      status: "failed",
      automatedResult: { status: "failed", warnings: [], error: describeError(e) },
      finishedAt: nowIso(),
    });
  }
}

/**
 * After `afterStepId` (or from the very start, when null) succeeds, run any
 * immediately-following automated steps back to back, stopping at the first
 * manual step or the first automated step that doesn't succeed/warn.
 */
export async function chainAutomatedFrom(
  store: DataStore,
  run: Run,
  afterStepId: string | null,
): Promise<Run> {
  let current = run;
  let index = afterStepId ? current.steps.findIndex((s) => s.stepId === afterStepId) : -1;

  while (true) {
    const next = current.steps[index + 1];
    // An extra step still in its resting skipped state is transparent to the
    // chain — it was opted out of by default, and stopping at it would strand
    // the pending automated step behind it.
    if (next && next.extra && next.status === "skipped") {
      index += 1;
      continue;
    }
    if (!next || next.type !== "automated" || next.status !== "pending") break;
    current = await runAutomatedStep(store, current, next.stepId);
    index += 1;
    const ranStep = current.steps[index];
    if (!ranStep || !CONTINUES_CHAIN.includes(ranStep.status)) break;
  }
  return current;
}

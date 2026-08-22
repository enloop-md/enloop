import type { RunStepState, Step, TestCaseVersion } from "./types.js";

/**
 * Verdict on loading a candidate version under an in-flight run.
 *
 * `changedStepIds` lists the not-yet-executed steps whose text differs —
 * what the confirmation dialog shows the tester. `reasons` is empty exactly
 * when `ok`.
 */
export interface CompatResult {
  ok: boolean;
  reasons: string[];
  changedStepIds: string[];
}

/**
 * A step the run has acted on: its recorded status must keep describing the
 * text it was recorded against, so its definition may not change. An extra
 * step starts life `skipped` without anyone touching it (see `createRun`),
 * which is why status alone is not the test — untouched extras are still
 * free to change.
 */
function isFrozen(def: Step, state: RunStepState): boolean {
  if (state.status === "pending") return false;
  if (def.extra && state.startedAt === null && state.finishedAt === null) return false;
  return true;
}

function changedFields(a: Step, b: Step): string[] {
  const changed: string[] = [];
  const norm = (v: string | undefined) => v ?? "";
  if (a.title !== b.title) changed.push("title");
  if (a.type !== b.type) changed.push("type");
  if (norm(a.instructions) !== norm(b.instructions)) changed.push("instructions");
  if (norm(a.expected) !== norm(b.expected)) changed.push("expected");
  if (norm(a.note) !== norm(b.note)) changed.push("note");
  if (norm(a.script) !== norm(b.script)) changed.push("script");
  if (norm(a.where) !== norm(b.where)) changed.push("where");
  if (a.quick !== b.quick) changed.push("quick");
  if (a.extra !== b.extra) changed.push("extra");
  if (a.selectors.length !== b.selectors.length || a.selectors.some((s, i) => s !== b.selectors[i])) {
    changed.push("selectors");
  }
  return changed;
}

/**
 * Whether `candidate` can replace `current` under a run whose per-step
 * state is `steps`: same step count, and every frozen step textually
 * unchanged. Pending steps may change freely — that is what a mid-run patch
 * is for.
 *
 * Both documents must be composed the way the run's frozen `case.md` was
 * (suite prep merged, tier filtered, variables substituted) — comparing a
 * raw `versions/vN.md` against a frozen `case.md` differs on every `%VAR%`
 * and, for quick runs, on the step list itself. Step ids are positional
 * (`step-<n>`), which is what makes an index-wise comparison — and the swap
 * itself — sound.
 */
export function checkRunCompat(
  current: TestCaseVersion,
  candidate: TestCaseVersion,
  steps: RunStepState[],
): CompatResult {
  if (current.steps.length !== steps.length) {
    // One state per doc step is createRun's invariant; a mismatch is a
    // corrupt run, not an incompatible candidate.
    throw new Error(
      `run state has ${steps.length} steps but its case.md has ${current.steps.length}`,
    );
  }
  if (current.steps.length !== candidate.steps.length) {
    return {
      ok: false,
      reasons: [`step count changed (${current.steps.length} → ${candidate.steps.length})`],
      changedStepIds: [],
    };
  }

  const reasons: string[] = [];
  const changedStepIds: string[] = [];
  for (let i = 0; i < current.steps.length; i++) {
    const diff = changedFields(current.steps[i], candidate.steps[i]);
    if (diff.length === 0) continue;
    if (isFrozen(current.steps[i], steps[i])) {
      reasons.push(
        `executed step ${current.steps[i].id} "${current.steps[i].title}" changed (${diff.join(", ")})`,
      );
    } else {
      changedStepIds.push(current.steps[i].id);
    }
  }
  return { ok: reasons.length === 0, reasons, changedStepIds };
}

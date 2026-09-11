/**
 * "⬇ Download guide": a finished run or free run as one HTML page with
 * every screenshot inlined.
 *
 * The renderers in `@tcm/shared/guide` take the on-disk shapes — the
 * frozen case document and `run.json` — because the validator, their other
 * caller, has exactly those. The panel has the composed `Run` instead, so
 * the two are rebuilt from it here: the step definitions and the case
 * fields come off the run, the per-step state is split back out. The one
 * thing the composed run does not carry is the description; that is read
 * from the version source, which is the same text the run was frozen from
 * before its variables were filled in.
 */

import {
  parseCaseDocument,
  renderFreeRunGuideHtml,
  renderGuideHtml,
  substituteVariables,
  type DataStore,
  type FreeRun,
  type Run,
  type RunFile,
  type RunScreenshot,
  type RunStepState,
  type Step,
  type TestCaseVersion,
} from "@tcm/shared";
import { downloadTextFile, fileSlug } from "./download.js";
import { bytesToDataUrl } from "./screenshot-render.js";

/** Whether a finished run has anything to hand out as a guide. */
export function canDownloadGuide(holder: { screenshots: RunScreenshot[]; kind?: "case" | "guide" }): boolean {
  return holder.screenshots.length > 0 || holder.kind === "guide";
}

async function imageRefs(
  shots: RunScreenshot[],
  read: (id: string) => Promise<Uint8Array>,
): Promise<(shot: RunScreenshot) => string> {
  const urls = new Map<string, string>();
  for (const shot of shots) urls.set(shot.id, bytesToDataUrl(await read(shot.id)));
  return (shot) => urls.get(shot.id) ?? "";
}

function splitRun(run: Run): { doc: Omit<TestCaseVersion, "description">; file: RunFile } {
  const steps: Step[] = [];
  const states: RunStepState[] = [];
  for (const s of run.steps) {
    const {
      stepId,
      status,
      comments,
      draft,
      automatedResult,
      startedAt,
      finishedAt,
      consoleErrors,
      consoleWarnings,
      networkFailures,
      requests,
      rating,
      ...definition
    } = s;
    steps.push({ id: stepId, ...definition });
    states.push({
      stepId,
      status,
      comments,
      draft,
      automatedResult,
      startedAt,
      finishedAt,
      consoleErrors,
      consoleWarnings,
      networkFailures,
      requests,
      rating,
    });
  }
  return {
    doc: {
      version: run.testCaseVersion,
      createdAt: run.startedAt,
      formatVersion: "",
      author: "",
      project: "",
      changeNote: "",
      kind: run.kind,
      title: run.testCaseTitle,
      goal: run.goal,
      youWill: run.youWill,
      youWillNeed: run.youWillNeed,
      tags: [],
      locations: run.locations,
      domains: [],
      variables: [],
      dependencies: run.dependencies,
      prerequisites: run.prerequisites,
      groups: run.groups,
      steps,
    },
    file: {
      id: run.id,
      testCaseId: run.testCaseId,
      testCaseVersion: run.testCaseVersion,
      testCaseTitle: run.testCaseTitle,
      status: run.status,
      comment: run.comment,
      // Bookkeeping the renderer never reads; the composed run does not
      // carry it.
      screenshotSeq: 0,
      tier: run.tier,
      environment: run.environment,
      consoleInReport: run.consoleInReport,
      rating: run.rating,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      variables: {},
      swaps: run.swaps,
      screenshots: run.screenshots,
      steps: states,
    },
  };
}

/** The case description the run was frozen from, with the one value the
 * run still knows filled in. Empty when the version is gone — a guide
 * without its preamble beats no guide. */
async function runDescription(store: DataStore, run: Run): Promise<string> {
  try {
    const source = await store.getRunSource(run.testCaseId, run.testCaseVersion, run.tier);
    const parsed = parseCaseDocument(source, { version: run.testCaseVersion, createdAt: run.startedAt }, { requireSteps: false });
    return run.mainOrigin ? substituteVariables(parsed.description, { DOMAIN: run.mainOrigin }) : parsed.description;
  } catch {
    return "";
  }
}

/** Renders and saves the run's guide; resolves with the renderer's warnings. */
export async function downloadRunGuide(store: DataStore, run: Run): Promise<string[]> {
  const { doc, file } = splitRun(run);
  const description = await runDescription(store, run);
  const imageRef = await imageRefs(run.screenshots, (id) => store.readScreenshot(run.testCaseId, run.id, id, "rendered"));
  const { text, warnings } = renderGuideHtml({ ...doc, description }, file, { imageRef });
  downloadTextFile(`${fileSlug(run.testCaseTitle)}-guide.html`, text, "text/html");
  return warnings;
}

/** The free-run counterpart; `notes` is the text on screen, which may be
 * ahead of what is on disk. */
export async function downloadFreeRunGuide(store: DataStore, freeRun: FreeRun, notes: string): Promise<string[]> {
  const imageRef = await imageRefs(freeRun.screenshots, (id) => store.readFreeRunScreenshot(freeRun.id, id, "rendered"));
  const { text, warnings } = renderFreeRunGuideHtml(freeRun, notes, { imageRef });
  downloadTextFile(`${fileSlug(freeRun.title || "free-run")}-guide.html`, text, "text/html");
  return warnings;
}

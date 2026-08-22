import { existsSync } from "node:fs";
import path from "node:path";
import type { AgentQuestionFile, RunFile, TestCaseVersion } from "@tcm/shared";

/**
 * The self-contained per-question instruction — everything a backend needs
 * without the enloop plugin installed. One text serves all three backends:
 * the api backend gets it as the user message (with tools jailed to the
 * paths it names), the CLI backends get it as the headless prompt and
 * answer on stdout.
 */
export function buildBrief(opts: {
  question: AgentQuestionFile;
  qDir: string;
  runDirPath: string;
  repo: string;
  doc: TestCaseVersion | null;
  runFile: RunFile | null;
  canPatch: boolean;
}): string {
  const { question, qDir, runDirPath, repo, doc, runFile, canPatch } = opts;
  const step = doc?.steps.find((s) => s.id === question.stepId);
  const executed =
    runFile?.steps
      .filter((s) => s.status !== "pending" && s.status !== "running")
      .map((s) => s.stepId)
      .join(", ") || "none";

  const lines = [
    `You are answering one question a tester asked mid-run from the Enloop`,
    `browser extension. They are standing in the page, blocked on a step;`,
    `answer concretely and fast. Do not ask anything back — nobody is at`,
    `this terminal.`,
    ``,
    `Question (step ${question.stepId}, "${question.stepTitle}"):`,
    `  ${question.question}`,
    question.selection ? `They had selected: "${question.selection}"` : ``,
    question.pageUrl ? `They were on: ${question.pageUrl}` : ``,
    ``,
    `Context on disk (read as needed):`,
    `- The exact case text this run executes: ${path.join(runDirPath, "case.md")}`,
    `- Run state (which steps already have verdicts): ${path.join(runDirPath, "run.json")}`,
    step?.instructions ? `- The step's current text: ${step.instructions.replace(/\n/g, " ")}` : ``,
    existsSync(path.join(qDir, "page.html"))
      ? `- ${path.join(qDir, "page.html")} — the tester's page as a sanitized DOM` +
        ` snapshot (scripts/styles stripped, ids/classes/testids kept). Grep` +
        ` it to verify any selector or element you mention; never read it whole.`
      : ``,
    existsSync(path.join(qDir, "screenshot.png"))
      ? `- ${path.join(qDir, "screenshot.png")} — what the tester saw (view it` +
        ` if you can read images; otherwise ignore it).`
      : ``,
    `- The app's source: ${repo} — the answer must come from evidence here,`,
    `  with file:line where it helps. Do not speculate; if the source`,
    `  contradicts the step, say so plainly.`,
    ``,
    `Respond with the answer text only, as Markdown. The FIRST LINE must be`,
    `the direct answer; the exact click-path after it; background last. Your`,
    `entire response is shown to the tester verbatim — no preamble, no`,
    `"I looked at", no closing questions.`,
    canPatch
      ? `` // The api backend appends its own patch-tool instructions.
      : `Do not attempt to edit any file — you are answering only.`,
  ];
  return lines.filter((l) => l !== ``).join("\n");
}

export const PATCH_TOOL_GUIDANCE = `
If — and only if — the step's own text was the problem (the next tester
would ask the same question), also land a patched version with the
land_patch tool: the COMPLETE case markdown with only the necessary steps
changed. Rules: same step count; never change a "Kind:" line; only change
steps the run has not judged yet (see run.json — pending/running, an
untouched extra, or the asked step itself), keep every other step
byte-identical; add a "Change note:" line under the title naming the run.
A good answer without a patch beats a patch that breaks these rules.`;

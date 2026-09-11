import { buildCaptureDigest, LEVEL_LABEL, type CapturedEntry } from "./capture.js";
import { AUDIENCE_LABELS, stepComments, stepNumberLabels } from "./markdown.js";
import type { AgentQuestion, CaseContext, Run, RunStep } from "./types.js";

/**
 * The prompt a tester hands to a coding agent to fix what a step found.
 *
 * A finding in the panel is spread over five places — the step text, the
 * comments under it, the question thread, the console the page printed
 * while the step ran, and the case's `@project` — and the tester who wants
 * it fixed has, until now, retyped the parts they remembered into a chat.
 * This gathers every one of them into a single Markdown document that says
 * which project it belongs in, what was expected, what happened instead,
 * and what the page said about it, so the agent that receives it starts
 * from evidence rather than from a summary.
 *
 * It is a prompt, not a report: `report.md` and `feedback.md` describe a
 * whole run for whoever reads it later; this describes one step, now, to
 * whoever will change code. Everything a fix would need and nothing a fix
 * would not: the digest is filtered to this step's entries, and `log`/
 * `info` chatter stays in `console.md` where it always was.
 */
export interface FixPromptInput {
  run: Run;
  stepId: string;
  /** The case's `@project`, "" when it declares none. */
  project: string;
  /** Authoring provenance, when an agent stamped it — names the repo. */
  context: CaseContext | null;
  /** Every question asked in this run; the ones from this step are quoted. */
  questions: AgentQuestion[];
  /** Everything captured for this run so far; filtered to this step here. */
  entries: CapturedEntry[];
  /** The ids as the data folder spells them — a multi-storage panel
   * prefixes the run's ids with the storage they came from, and the prompt
   * names a path on disk, not a panel-internal id. */
  folder: { testCaseId: string; runId: string };
}

/** Digest requests kept: a trace is useful for its shape, and fifteen
 * endpoints show a shape without filling the prompt with the app's
 * heartbeat. */
const PROMPT_MAX_REQUESTS = 15;
/** An answer is quoted in full up to this; the agent that reads the
 * prompt can open the question folder for the rest. */
const PROMPT_MAX_ANSWER_CHARS = 1500;

function quote(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function fence(text: string, lang = ""): string {
  return `\`\`\`${lang}\n${text.replace(/\n$/, "")}\n\`\`\``;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}… (truncated)` : trimmed;
}

function audienceTag(audiences: RunStep["comments"][number]["audiences"]): string {
  return audiences.length > 0 ? `[${audiences.map((a) => AUDIENCE_LABELS[a]).join(", ")}] ` : "";
}

function statusWord(step: RunStep): string {
  switch (step.status) {
    case "success":
      return "passed";
    case "failed":
      return "failed";
    case "warning":
      return "passed with a warning";
    case "skipped":
      return "skipped";
    case "running":
      return "in progress";
    case "pending":
      return "not yet done";
  }
}

export function renderFixPrompt(input: FixPromptInput): string {
  const { run, project, context, entries } = input;
  const index = run.steps.findIndex((s) => s.stepId === input.stepId);
  const step = run.steps[index];
  if (!step) throw new Error(`Step not found in run: ${input.stepId}`);
  const labels = stepNumberLabels(run.steps);
  const label = labels[index];
  const lines: string[] = [];

  lines.push(`# Fix: ${step.title}`);
  lines.push("");
  lines.push(
    `A tester running the Enloop test case **${run.testCaseTitle}** (v${run.testCaseVersion}) ` +
      `found a problem at step ${label} and wants it fixed. Everything they saw is below; ` +
      "the run's own folder has the rest.",
  );

  // ---- where the fix belongs ----
  lines.push("");
  lines.push("## Where to work");
  lines.push("");
  if (project) lines.push(`- Project: **${project}** (the case's \`@project\`)`);
  if (context) {
    lines.push(`- Repo: \`${context.cwd}\` on \`${context.host}\` — where this case was authored`);
  }
  if (!project && !context) {
    lines.push(
      "- The case names no project. Work in the repo that serves the pages below.",
    );
  }
  if (run.environment) lines.push(`- Environment: ${run.environment}`);
  if (run.mainOrigin) lines.push(`- Main domain of the run: ${run.mainOrigin}`);
  lines.push(
    `- Run folder: \`runs/${input.folder.testCaseId}/${input.folder.runId}/\` in the Enloop data folder — ` +
      "`case.md` is the exact text executed, `console.md` the full page log.",
  );
  if (run.goal.trim()) {
    lines.push("");
    lines.push(`What the case proves: ${run.goal.trim()}`);
  }

  // ---- the step ----
  lines.push("");
  lines.push(`## Step ${label} of ${run.steps.length}: ${step.title}`);
  lines.push("");
  const facts: string[] = [];
  facts.push(`- Result: **${statusWord(step)}**`);
  if (step.group) facts.push(`- Group: ${step.group}`);
  if (step.where) facts.push(`- Where: \`${step.where}\``);
  if (step.via) facts.push(`- Via: ${step.via}`);
  if (step.selectors.length > 0) {
    facts.push(`- Selectors: ${step.selectors.map((s) => `\`${s}\``).join(", ")}`);
  }
  lines.push(...facts);
  if (step.instructions?.trim()) {
    lines.push("");
    lines.push("Instructions:");
    lines.push("");
    lines.push(quote(step.instructions));
  }
  if (step.expected?.trim()) {
    lines.push("");
    lines.push("Expected:");
    lines.push("");
    lines.push(quote(step.expected));
  }
  if (step.note?.trim()) {
    lines.push("");
    lines.push("Note from the case:");
    lines.push("");
    lines.push(quote(step.note));
  }
  if (step.type === "automated" && step.script?.trim()) {
    lines.push("");
    lines.push("The step's script, run in the page:");
    lines.push("");
    lines.push(fence(step.script, "js"));
  }
  if (step.automatedResult) {
    const r = step.automatedResult;
    lines.push("");
    lines.push(`Automated result: **${r.status}**`);
    for (const w of r.warnings) lines.push(`- warning: ${w}`);
    if (r.error) {
      lines.push("");
      lines.push(fence(r.stack ? `${r.error}\n${r.stack}` : r.error));
    }
  }

  // ---- what the tester said ----
  const comments = stepComments(step).filter((c) => c.text.trim());
  const asked = input.questions.filter((q) => q.stepId === step.stepId);
  lines.push("");
  lines.push("## What the tester found");
  lines.push("");
  if (comments.length === 0 && asked.length === 0) {
    lines.push(
      step.status === "failed" || step.status === "warning"
        ? "No comment was left; the result above is the finding."
        : "No comment was left on this step.",
    );
  }
  for (const c of comments) {
    lines.push(`- ${audienceTag(c.audiences)}${c.text.trim()}`);
  }
  for (const q of asked) {
    lines.push("");
    lines.push(`Asked from this step${q.pageUrl ? ` on ${q.pageUrl}` : ""}:`);
    lines.push("");
    if (q.selection) lines.push(quote(`“${q.selection}”`));
    lines.push(quote(q.question));
    if (q.answer) {
      lines.push("");
      lines.push("The watching agent answered:");
      lines.push("");
      lines.push(quote(clip(q.answer.markdown, PROMPT_MAX_ANSWER_CHARS)));
    } else {
      lines.push("");
      lines.push("(not answered yet)");
    }
  }

  // ---- earlier steps ----
  const earlier = run.steps
    .slice(0, index)
    .map((s, i) => ({ step: s, label: labels[i] }))
    .filter(
      ({ step: s }) =>
        s.status === "failed" ||
        s.status === "warning" ||
        stepComments(s).some((c) => c.text.trim()),
    );
  if (earlier.length > 0 || run.comment.trim()) {
    lines.push("");
    lines.push("## Earlier in this run");
    lines.push("");
    for (const { step: s, label: l } of earlier) {
      const own = stepComments(s)
        .filter((c) => c.text.trim())
        .map((c) => `${audienceTag(c.audiences)}${c.text.trim()}`);
      lines.push(`- Step ${l} "${s.title}" — ${statusWord(s)}${own.length ? `: ${own.join("; ")}` : ""}`);
    }
    if (run.comment.trim()) {
      lines.push(`- On the run as a whole: ${run.comment.trim()}`);
    }
  }

  // ---- console and network ----
  const stepEntries = entries.filter((e) => e.stepId === step.stepId);
  const digest = buildCaptureDigest(stepEntries);
  const signal =
    digest.items.length > 0 || digest.requests.length > 0 || digest.notices.length > 0;
  if (signal) {
    lines.push("");
    lines.push("## What the page printed during this step");
    lines.push("");
    lines.push(
      "Console and network output captured while this step was current. Identical " +
        "messages are collapsed; `×N` is how many times one appeared. Query strings are " +
        "redacted; headers and bodies were never captured.",
    );
    for (const notice of digest.notices) {
      lines.push("");
      lines.push(`**${notice}**`);
    }
    if (digest.items.length > 0) lines.push("");
    for (const item of digest.items) {
      lines.push(`- **${LEVEL_LABEL[item.level]}${item.count > 1 ? ` ×${item.count}` : ""}** ${item.text}`);
      if (item.stack) {
        lines.push("");
        lines.push(fence(item.stack));
        lines.push("");
      }
    }
    if (digest.omittedMessages > 0) {
      lines.push("");
      lines.push(`${digest.omittedMessages} further distinct messages are in \`console.md\`.`);
    }
    if (digest.requests.length > 0) {
      lines.push("");
      lines.push("Requests the page made, in order:");
      lines.push("");
      for (const item of digest.requests.slice(0, PROMPT_MAX_REQUESTS)) {
        lines.push(`- ${item.text}${item.count > 1 ? ` ×${item.count}` : ""}`);
      }
      const left = digest.requests.length - PROMPT_MAX_REQUESTS + digest.omittedRequests;
      if (left > 0) lines.push(`- … ${left} more in \`console.md\``);
    }
  } else if (stepEntries.length > 0) {
    lines.push("");
    lines.push(
      `The page printed ${stepEntries.length} log line${stepEntries.length === 1 ? "" : "s"} ` +
        "during this step and no errors, warnings or failed requests; they are in `console.md`.",
    );
  }

  // ---- the ask ----
  lines.push("");
  lines.push("## What to do");
  lines.push("");
  lines.push(
    "1. Find the code in this project behind the step: start from the page and " +
      "selectors named above, and from any stack trace or failed request listed.",
  );
  lines.push(
    "2. Fix it so that **Expected** holds when the instructions are followed. Keep the " +
      "change to this problem; do not rewrite unrelated behaviour.",
  );
  lines.push(
    "3. If the finding is about the case rather than the app — the tester addressed the " +
      "test writer, or the step asks for something the app was never meant to do — say so, " +
      "and fix the case in the Enloop data folder instead (the `enloop` plugin's skills " +
      "know the format).",
  );
  lines.push(
    "4. Reply with what was wrong, which files changed, and how to re-verify by redoing " +
      `step ${label} of this case.`,
  );
  lines.push("");
  return lines.join("\n");
}

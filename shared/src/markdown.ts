import { VARIABLE_GENERATORS } from "./schemas.js";
import type {
  FreeRunFile,
  NoteType,
  RunFile,
  RunStepState,
  Step,
  StepType,
  TestCaseVariable,
  TestCaseVersion,
  VariableGenerator,
} from "./types.js";

/**
 * Format version of this grammar itself — bump only when the grammar below
 * changes in a way that would matter to a parser (new/renamed sections,
 * changed line syntax, etc). Not to be confused with a test case's own
 * v1.md/v2.md version history, which tracks edits to a case's *content*
 * under this same grammar.
 */
export const CURRENT_FORMAT_VERSION = "0.0.1";

/**
 * Grammar (see README-less by design — this comment is the spec). The very
 * first `# ` heading in the file is special-cased as the case title;
 * every other heading level is one below what you'd naively expect, since
 * that first H1 already "used up" the top level:
 *
 *   # Case title
 *   @version 0.0.1
 *   @author Sergey Ryabenko
 *   Tags: auth, smoke
 *   Change note: Added SSO redirect check      (all four lines optional)
 *
 *   Free text description.
 *
 *   # Variables                                 (optional)
 *
 *   ## USERNAME
 *   Login username to register with.            (free text description,
 *                                                 like a step's instructions)
 *   Generator: random-string 8                   (optional — see below;
 *                                                 omit for a plain manual
 *                                                 field)
 *
 *   ## PRODUCT_ID
 *   Product to add to cart.
 *   Default: sku-12345                          (optional literal default)
 *
 *   Generators, given as `Generator: <name> [arg]`: `timestamp` (epoch ms,
 *   or ISO text with arg `iso`), `page-url`, `page-domain` (both read the
 *   active tab when a run starts), `random-number` (arg `min-max`, default
 *   `0-999999`), `random-string` (arg = length, default 8). A run prompts
 *   for every declared variable, pre-filling generated ones, then replaces
 *   every `%NAME%` placeholder anywhere in the rest of the document —
 *   title, description, step instructions, selectors, scripts — with the
 *   resolved value. See `substituteVariables`.
 *
 *   # Dependencies                              (optional, bullet list)
 *   - Seeded test user
 *
 *   # Prerequisites                             (optional, bullet list)
 *   - Browser open at https://app.example.com
 *
 *   # Steps
 *
 *   ## Step title
 *   Selector: #login-button                     (optional — scrolls this
 *                                                 into view and flashes it
 *                                                 in the page when the step
 *                                                 is focused, or on demand
 *                                                 via the Highlight button)
 *   Free text instructions (manual step — no code fence found).
 *
 *   ### Expected                                (optional)
 *   What should happen.
 *
 *   ## Another step title
 *   ```js
 *   if (!document.querySelector('#el')) api.fail('missing #el');
 *   ```                                          (fenced code block present
 *                                                  -> automated step; runs
 *                                                  in the page's own MAIN
 *                                                  world with DOM access)
 *
 * `version`/`createdAt` are not part of the text — callers supply them
 * (derived from the filename and file mtime) via `fallback`. `@version`
 * (the format version) defaults to `CURRENT_FORMAT_VERSION` when absent,
 * so older files written before this field existed still parse as current.
 *
 * A suite's `suite.md` reuses this exact grammar for its shared preparation
 * steps, description, variables, dependencies, and prerequisites — with one
 * relaxation: pass `{ requireSteps: false }` to allow a suite with no prep
 * steps at all (`opts.requireSteps` defaults to `true` for ordinary cases).
 */
export function parseCaseDocument(
  raw: string,
  fallback: { version: number; createdAt: string },
  opts: { requireSteps?: boolean } = {},
): TestCaseVersion {
  const requireSteps = opts.requireSteps ?? true;
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  if (!lines[i]?.startsWith("# ")) {
    throw new Error('Test case Markdown must start with a level-1 heading, e.g. "# Case title".');
  }
  const title = lines[i].slice(2).trim();
  i++;

  let formatVersion = CURRENT_FORMAT_VERSION;
  let author = "";
  let tags: string[] = [];
  let changeNote = "";
  while (i < lines.length) {
    const line = lines[i];
    const versionMatch = /^@version\s+(.*)$/i.exec(line);
    const authorMatch = /^@author\s+(.*)$/i.exec(line);
    const tagsMatch = /^Tags:\s*(.*)$/i.exec(line);
    const noteMatch = /^Change note:\s*(.*)$/i.exec(line);
    if (versionMatch) {
      formatVersion = versionMatch[1].trim();
      i++;
      continue;
    }
    if (authorMatch) {
      author = authorMatch[1].trim();
      i++;
      continue;
    }
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      i++;
      continue;
    }
    if (noteMatch) {
      changeNote = noteMatch[1].trim();
      i++;
      continue;
    }
    break;
  }

  const rest = lines.slice(i).join("\n");
  const { preamble, sections: topSections } = splitTopSections(rest, 1);
  const description = preamble.trim();

  let variables: TestCaseVariable[] = [];
  let dependencies: string[] = [];
  let prerequisites: string[] = [];
  let steps: Step[] = [];

  for (const section of topSections) {
    const name = section.heading.trim().toLowerCase();
    if (name === "variables") variables = parseVariables(section.content);
    else if (name === "dependencies") dependencies = parseBulletList(section.content);
    else if (name === "prerequisites" || name === "prerequirements")
      prerequisites = parseBulletList(section.content);
    else if (name === "steps") steps = parseSteps(section.content);
  }

  if (requireSteps && steps.length === 0) {
    throw new Error('No steps found — add a "# Steps" section with "## " step headings.');
  }

  return {
    version: fallback.version,
    createdAt: fallback.createdAt,
    formatVersion,
    author,
    changeNote,
    title,
    description,
    tags,
    variables,
    dependencies,
    prerequisites,
    steps,
  };
}

function splitTopSections(
  text: string,
  level: number,
): { preamble: string; sections: Array<{ heading: string; content: string }> } {
  const marker = "#".repeat(level) + " ";
  const lines = text.split("\n");
  const preambleLines: string[] = [];
  const sections: Array<{ heading: string; content: string[] }> = [];
  let current: { heading: string; content: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith(marker)) {
      if (current) sections.push(current);
      current = { heading: line.slice(marker.length).trim(), content: [] };
    } else if (current) {
      current.content.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current) sections.push(current);

  return {
    preamble: preambleLines.join("\n"),
    sections: sections.map((s) => ({ heading: s.heading, content: s.content.join("\n").trim() })),
  };
}

function parseVariables(sectionBody: string): TestCaseVariable[] {
  const { sections } = splitTopSections(sectionBody, 2);
  return sections.map((s) => parseOneVariable(s.heading, s.content));
}

const VARIABLE_DEFAULT_RE = /^Default:\s*(.*)$/i;
const VARIABLE_GENERATOR_RE = /^Generator:\s*(\S+)(?:\s+(.*))?$/i;

function parseOneVariable(name: string, body: string): TestCaseVariable {
  const descriptionLines: string[] = [];
  let defaultValue: string | undefined;
  let generator: VariableGenerator | undefined;
  let generatorArg: string | undefined;

  for (const line of body.split("\n")) {
    const defaultMatch = VARIABLE_DEFAULT_RE.exec(line);
    const generatorMatch = VARIABLE_GENERATOR_RE.exec(line);
    if (defaultMatch) {
      defaultValue = defaultMatch[1].trim() || undefined;
      continue;
    }
    if (generatorMatch) {
      const candidate = generatorMatch[1].trim().toLowerCase();
      if ((VARIABLE_GENERATORS as readonly string[]).includes(candidate)) {
        generator = candidate as VariableGenerator;
        generatorArg = generatorMatch[2]?.trim() || undefined;
      }
      continue;
    }
    descriptionLines.push(line);
  }

  return {
    name: name.trim(),
    description: descriptionLines.join("\n").trim(),
    defaultValue,
    generator,
    generatorArg,
  };
}

const PLACEHOLDER_RE = /%([A-Za-z_][A-Za-z0-9_]*)%/g;

/** Replaces every `%NAME%` placeholder in `text` with its resolved value.
 * A placeholder with no matching entry in `values` is left untouched,
 * rather than assuming a missing variable means "blank it out". */
export function substituteVariables(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (match, name: string) =>
    name in values ? values[name] : match,
  );
}

function parseBulletList(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- ") || l.startsWith("* "))
    .map((l) => l.slice(2).trim());
}

function parseSteps(stepsSectionBody: string): Step[] {
  const { sections } = splitTopSections(stepsSectionBody, 2);
  return sections.map((s, index) => parseOneStep(s.heading, s.content, index));
}

const FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/;
const EXPECTED_RE = /^###\s+Expected\s*$/im;
const SELECTOR_RE = /^Selector:\s*(.*)$/i;

function parseOneStep(title: string, body: string, index: number): Step {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const selectorMatch = i < lines.length ? SELECTOR_RE.exec(lines[i]) : null;
  const selector = selectorMatch?.[1].trim() || undefined;
  const bodyAfterSelector = (selector ? lines.slice(i + 1) : lines).join("\n");

  let script: string | undefined;
  let remaining = bodyAfterSelector;

  const fenceMatch = FENCE_RE.exec(bodyAfterSelector);
  if (fenceMatch) {
    script = fenceMatch[2].replace(/\n$/, "");
    remaining = (
      bodyAfterSelector.slice(0, fenceMatch.index) +
      bodyAfterSelector.slice(fenceMatch.index + fenceMatch[0].length)
    ).trim();
  }

  let instructions = remaining;
  let expected: string | undefined;
  const expectedMatch = EXPECTED_RE.exec(remaining);
  if (expectedMatch) {
    instructions = remaining.slice(0, expectedMatch.index).trim();
    expected = remaining.slice(expectedMatch.index + expectedMatch[0].length).trim() || undefined;
  }
  instructions = instructions.trim();

  const type: StepType = script !== undefined ? "automated" : "manual";

  return {
    id: `step-${index + 1}`,
    order: index,
    title: title.trim(),
    type,
    instructions: instructions || undefined,
    expected,
    script,
    selector,
  };
}

/** Starter text for a brand new test case, shown in an empty editor. */
export function starterCaseTemplate(): string {
  return `# New test case
@version ${CURRENT_FORMAT_VERSION}
@author
Tags:

Describe what this test case covers.

# Dependencies
-

# Prerequisites
-

# Steps

## First step
Describe what the tester should do.

### Expected
Describe what should happen.
`;
}

/** Starter text for a brand new suite, shown in an empty suite editor.
 * Steps are optional for a suite (shared preparation only), but the
 * template includes one example since most suites have at least one. */
export function starterSuiteTemplate(): string {
  return `# New suite
@version ${CURRENT_FORMAT_VERSION}
@author
Tags:

Describe what this suite of test cases covers and shares.

# Steps

## Log in as the test user
Shared preparation all cases in this suite start from.
`;
}

const STATUS_ICON: Record<string, string> = {
  success: "✅",
  failed: "❌",
  warning: "⚠️",
  skipped: "⏭️",
  running: "🔄",
  pending: "⬜",
};

export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  note: "note",
  feature: "feature request",
  bug: "bugfix required",
  docs: "docs update required",
};

/** Human-readable summary of a finished (or in-progress) run — meant to be
 * shared outside the extension, e.g. emailed. Written as `report.md`
 * alongside `run.json` whenever a run finishes. */
export function renderRunReport(doc: TestCaseVersion, run: RunFile): string {
  const byId = new Map(run.steps.map((s) => [s.stepId, s]));
  const lines: string[] = [];

  lines.push(`# ${doc.title} — Run Report`);
  lines.push("");
  lines.push(`- Version: v${run.testCaseVersion}`);
  lines.push(`- Status: ${run.status}`);
  lines.push(`- Started: ${run.startedAt}`);
  lines.push(`- Finished: ${run.finishedAt ?? "—"}`);
  lines.push("");
  lines.push("## Steps");
  lines.push("");

  doc.steps.forEach((step, index) => {
    const state = byId.get(step.id);
    const status = state?.status ?? "pending";
    lines.push(`### ${STATUS_ICON[status] ?? ""} ${index + 1}. ${step.title} (${status})`);
    if (state?.comment) {
      lines.push("");
      lines.push(`Comment: ${state.comment}`);
    }
    if (state?.notes.length) {
      lines.push("");
      lines.push("Notes:");
      for (const note of state.notes) lines.push(`- [${NOTE_TYPE_LABELS[note.type]}] ${note.text}`);
    }
    if (state?.tasks.length) {
      lines.push("");
      lines.push("Tasks:");
      for (const task of state.tasks) lines.push(`- [${task.done ? "x" : " "}] ${task.text}`);
    }
    if (state?.automatedResult?.error) {
      lines.push("");
      lines.push(`Error: ${state.automatedResult.error}`);
    }
    if (state?.automatedResult?.warnings.length) {
      lines.push("");
      lines.push("Warnings:");
      for (const w of state.automatedResult.warnings) lines.push(`- ${w}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

function hasStepSignal(state: RunStepState): boolean {
  return (
    state.status === "failed" ||
    state.status === "warning" ||
    state.comment.trim().length > 0 ||
    state.notes.length > 0 ||
    !!state.automatedResult?.error
  );
}

/**
 * Human-in-the-loop handoff artifact addressed to the LLM that built the
 * feature: what a human tester found while verifying it. Written as
 * `feedback.md` alongside `report.md` whenever a run finishes — but only
 * when there's something to act on. A clean silent pass returns `null` so
 * callers skip the write rather than producing empty-handoff noise.
 */
export function renderRunFeedback(doc: TestCaseVersion, run: RunFile): string | null {
  const byId = new Map(run.steps.map((s) => [s.stepId, s]));
  const signalSteps = doc.steps
    .map((step, index) => ({ step, index, state: byId.get(step.id) }))
    .filter(
      (s): s is { step: Step; index: number; state: RunStepState } => !!s.state && hasStepSignal(s.state),
    );

  if (signalSteps.length === 0) return null;

  const failedCount = run.steps.filter((s) => s.status === "failed").length;
  const warningCount = run.steps.filter((s) => s.status === "warning").length;
  const noteCount = run.steps.reduce((n, s) => n + s.notes.length, 0);

  const bugItems: string[] = [];
  const featureItems: string[] = [];
  const docsItems: string[] = [];
  const failedItems: string[] = [];

  for (const { step, index, state } of signalSteps) {
    const stepNum = index + 1;
    const hasBugNote = state.notes.some((n) => n.type === "bug");
    for (const note of state.notes) {
      if (note.type === "bug") {
        bugItems.push(`- **${step.title}** (step ${stepNum}, ${state.status}): ${note.text}`);
      } else if (note.type === "feature") {
        featureItems.push(`- **${step.title}** (step ${stepNum}): ${note.text}`);
      } else if (note.type === "docs") {
        docsItems.push(`- **${step.title}** (step ${stepNum}): ${note.text}`);
      }
    }
    if (state.status === "failed" && !hasBugNote) {
      const detail = [state.comment.trim(), state.automatedResult?.error]
        .filter((s): s is string => !!s)
        .join(" — ");
      failedItems.push(`- **${step.title}** (step ${stepNum})${detail ? `: ${detail}` : ""}`);
    }
  }

  const lines: string[] = [];
  lines.push(`# Feedback: ${doc.title} (v${run.testCaseVersion}, run ${run.id})`);
  lines.push("");
  lines.push(`Human verification run finished ${run.finishedAt ?? "—"} with status **${run.status}**.`);
  lines.push(`${failedCount} failed, ${warningCount} warnings, ${noteCount} feedback notes.`);
  lines.push("");
  lines.push(
    "This file was written by a human tester reviewing the feature. Address the " +
      "action items below. Step-by-step detail follows for context.",
  );
  lines.push("");
  lines.push("## Action items");

  const actionSections: Array<[string, string[]]> = [
    ["Bugfix required", bugItems],
    ["Feature requests", featureItems],
    ["Docs updates", docsItems],
    ["Failed steps", failedItems],
  ];
  for (const [heading, items] of actionSections) {
    if (items.length === 0) continue;
    lines.push("");
    lines.push(`### ${heading}`);
    lines.push(...items);
  }

  lines.push("");
  lines.push("## Step detail");

  for (const { step, index, state } of signalSteps) {
    lines.push("");
    lines.push(`### ${STATUS_ICON[state.status] ?? ""} ${index + 1}. ${step.title} (${state.status})`);
    if (step.expected) lines.push(`Expected: ${step.expected}`);
    if (state.comment) lines.push(`Comment: ${state.comment}`);
    if (state.notes.length > 0) {
      lines.push("Notes:");
      for (const note of state.notes) lines.push(`- [${NOTE_TYPE_LABELS[note.type]}] ${note.text}`);
    }
    if (state.automatedResult?.error) lines.push(`Automated error: ${state.automatedResult.error}`);
  }
  lines.push("");

  return lines.join("\n");
}

/** Derives the `feedback.md` handoff artifact for a free run from its raw
 * `notes.md` textarea content — regenerated in full on every save. */
export function renderFreeRunFeedback(freeRun: FreeRunFile, notes: string): string {
  return `# Free run feedback: ${freeRun.title}\n\nSession started ${freeRun.startedAt}, captured live (demo/unscripted testing).\n\n${notes}`;
}

/** Raw inner text of one top-level (`# `) section of a document, found with
 * the same splitting logic `parseCaseDocument` itself uses — `null` if the
 * heading isn't present. Operates on the whole raw text (title heading and
 * all), which is harmless: the title just becomes an unmatched section. */
function extractSectionRaw(markdown: string, headingName: string): string | null {
  const { sections } = splitTopSections(markdown, 1);
  const match = sections.find((s) => s.heading.trim().toLowerCase() === headingName.toLowerCase());
  return match ? match.content : null;
}

/** Start/end offsets of a top-level section's content — from right after
 * its heading line to right before the next top-level (`# `) heading, or
 * end of string. `null` if the heading isn't present. */
function sectionRange(markdown: string, headingName: string): { start: number; end: number } | null {
  const headingRe = new RegExp(`^# ${headingName}[ \\t]*\\r?\\n`, "im");
  const match = headingRe.exec(markdown);
  if (!match) return null;
  const start = match.index + match[0].length;
  const nextHeading = /^# /m.exec(markdown.slice(start));
  const end = nextHeading ? start + nextHeading.index : markdown.length;
  return { start, end };
}

/** Merges `content` into `markdown`'s top-level `headingName` section —
 * "prepend" inserts right after the heading (used for prep steps and
 * suite dependencies/prerequisites, which come "before" the case's own);
 * "append" inserts at the section's end (used for variables, so a case's
 * own duplicate-named variable declaration stays the one that's seen
 * first when re-parsed). Creates the section (placed right before
 * `# Steps`) if the case document doesn't already declare it. */
function mergeTopLevelSection(
  markdown: string,
  headingName: string,
  content: string,
  position: "prepend" | "append",
): string {
  const trimmed = content.trim();
  if (!trimmed) return markdown;
  const range = sectionRange(markdown, headingName);
  if (range) {
    if (position === "prepend") {
      return markdown.slice(0, range.start) + trimmed + "\n\n" + markdown.slice(range.start);
    }
    const before = markdown.slice(0, range.end).replace(/[ \t]*\n?$/, "");
    return `${before}\n\n${trimmed}\n\n${markdown.slice(range.end)}`;
  }
  const stepsMatch = /^# Steps[ \t]*\r?\n/im.exec(markdown);
  const insertAt = stepsMatch ? stepsMatch.index : markdown.length;
  return markdown.slice(0, insertAt) + `# ${headingName}\n\n${trimmed}\n\n` + markdown.slice(insertAt);
}

function prefixStepHeadings(stepsRaw: string): string {
  return stepsRaw.replace(/^##\s+/gm, "## Prep: ");
}

/**
 * Merges a suite's shared preparation (from its `suite.md`) into a case's
 * raw Markdown before it's parsed for a run — the run engine and `case.md`
 * freezing stay untouched; this just makes prep steps ordinary tracked
 * steps of the run. `suiteMarkdown: null` (standalone case) passes through
 * unchanged. Prep steps are prefixed `Prep: ` and inserted before the
 * case's own steps; suite variables are appended after the case's own
 * (case wins on a name clash); dependencies/prerequisites are concatenated
 * with the suite's first.
 */
export function buildRunSource(caseMarkdown: string, suiteMarkdown: string | null): string {
  if (!suiteMarkdown) return caseMarkdown;
  const normalizedCase = caseMarkdown.replace(/\r\n/g, "\n");
  const normalizedSuite = suiteMarkdown.replace(/\r\n/g, "\n");

  const suiteSteps = extractSectionRaw(normalizedSuite, "Steps");
  const suiteVariables = extractSectionRaw(normalizedSuite, "Variables");
  const suiteDependencies = extractSectionRaw(normalizedSuite, "Dependencies");
  const suitePrerequisites = extractSectionRaw(normalizedSuite, "Prerequisites");

  let result = normalizedCase;

  if (suiteSteps?.trim()) {
    result = mergeTopLevelSection(result, "Steps", prefixStepHeadings(suiteSteps), "prepend");
  }

  if (suiteVariables?.trim()) {
    const caseVarSection = extractSectionRaw(result, "Variables");
    const caseVarNames = new Set(
      caseVarSection ? parseVariables(caseVarSection).map((v) => v.name) : [],
    );
    const suiteVarSubsections = splitTopSections(suiteVariables, 2).sections.filter(
      (s) => !caseVarNames.has(s.heading.trim()),
    );
    if (suiteVarSubsections.length > 0) {
      const suiteVarText = suiteVarSubsections
        .map((s) => `## ${s.heading}\n${s.content}`.trim())
        .join("\n\n");
      result = mergeTopLevelSection(result, "Variables", suiteVarText, "append");
    }
  }

  if (suiteDependencies?.trim()) {
    result = mergeTopLevelSection(result, "Dependencies", suiteDependencies, "prepend");
  }

  if (suitePrerequisites?.trim()) {
    result = mergeTopLevelSection(result, "Prerequisites", suitePrerequisites, "prepend");
  }

  return result;
}

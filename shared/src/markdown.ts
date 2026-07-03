import type { RunFile, Step, StepType, TestCaseVersion } from "./types.js";

/**
 * Grammar (see README-less by design — this comment is the spec). The very
 * first `# ` heading in the file is special-cased as the case title;
 * every other heading level is one below what you'd naively expect, since
 * that first H1 already "used up" the top level:
 *
 *   # Case title
 *   Tags: auth, smoke
 *   Change note: Added SSO redirect check      (both lines optional)
 *
 *   Free text description.
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
 * (derived from the filename and file mtime) via `fallback`.
 */
export function parseCaseDocument(
  raw: string,
  fallback: { version: number; createdAt: string },
): TestCaseVersion {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  if (!lines[i]?.startsWith("# ")) {
    throw new Error('Test case Markdown must start with a level-1 heading, e.g. "# Case title".');
  }
  const title = lines[i].slice(2).trim();
  i++;

  let tags: string[] = [];
  let changeNote = "";
  while (i < lines.length) {
    const line = lines[i];
    const tagsMatch = /^Tags:\s*(.*)$/i.exec(line);
    const noteMatch = /^Change note:\s*(.*)$/i.exec(line);
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

  let dependencies: string[] = [];
  let prerequisites: string[] = [];
  let steps: Step[] = [];

  for (const section of topSections) {
    const name = section.heading.trim().toLowerCase();
    if (name === "dependencies") dependencies = parseBulletList(section.content);
    else if (name === "prerequisites" || name === "prerequirements")
      prerequisites = parseBulletList(section.content);
    else if (name === "steps") steps = parseSteps(section.content);
  }

  if (steps.length === 0) {
    throw new Error('No steps found — add a "# Steps" section with "## " step headings.');
  }

  return {
    version: fallback.version,
    createdAt: fallback.createdAt,
    changeNote,
    title,
    description,
    tags,
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

const STATUS_ICON: Record<string, string> = {
  success: "✅",
  failed: "❌",
  warning: "⚠️",
  skipped: "⏭️",
  running: "🔄",
  pending: "⬜",
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
      for (const note of state.notes) lines.push(`- ${note}`);
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

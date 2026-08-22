import {
  describeCounts,
  hasCaptureSignal,
  renderCaptureDigest,
  summarizeDigestItem,
  type CaptureCounts,
  type CaptureDigest,
} from "./capture.js";
import { COMMENT_AUDIENCES, VARIABLE_GENERATORS } from "./schemas.js";
import { stripViewerComment } from "./viewer-link.js";
import type {
  CommentAudience,
  FreeRunFile,
  RunComment,
  RunCommentDraft,
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
export const CURRENT_FORMAT_VERSION = "0.0.7";

/**
 * Grammar. There is no separate spec by design: this comment is it, sitting
 * against the parser that implements it, and `scripts/build-plugin.mjs`
 * lifts it verbatim into the plugin as `references/grammar.md` so the
 * authoring skills read the same words without needing this repo.
 *
 * The very
 * first `# ` heading in the file is special-cased as the case title;
 * every other heading level is one below what you'd naively expect, since
 * that first H1 already "used up" the top level:
 *
 *   # Case title
 *   @version 0.0.1
 *   @author Sergey Ryabenko
 *   @project Careerminds                       (the app under test — which
 *                                                repo/product this case
 *                                                belongs to, so a reader
 *                                                opening the file cold knows
 *                                                what they are looking at)
 *   Tags: auth, smoke
 *   Change note: Added SSO redirect check      (all five lines optional)
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
 *   or ISO text with arg `iso`), `page-url`, `page-origin`, `page-domain`
 *   (all three read the active tab when the run starts), `random-number`
 *   (arg `min-max`, default `0-999999`), `random-string` (arg = length,
 *   default 8).
 *
 *   `page-origin` is the one a `BASE_URL` wants:
 *
 *     ## BASE_URL
 *     The deployment under test — whichever one you have open.
 *     Generator: page-origin
 *     Default: https://staging.example.test
 *
 *   With the tester on `https://instance1.example.com`, every
 *   `%BASE_URL%/admin/reports` in the case resolves against that instance;
 *   on `http://localhost:3000` it resolves against theirs. The case names no
 *   environment, so it moves between them without being edited, and a run
 *   starts wherever the tester already was. It yields scheme + host + port,
 *   because the value is used as a prefix and a bare host is not something a
 *   browser can open. The `Default:` is the environment the project
 *   usually tests against: with no page behind the generator — a run
 *   started from a blank tab, the shared viewer page — the value falls
 *   back to it, and the case's addresses keep working cold.
 *   `page-domain` is the bare host, for a value that is
 *   *about* the domain — a tenant name, an email suffix — rather than an
 *   address; using it as a `BASE_URL` produces `example.com/admin`, which
 *   gets no Go control and drops the port.
 *
 *   `Match:` says which pages a page generator may read:
 *
 *     ## BASE_URL
 *     The org under test — whichever one you have open.
 *     Generator: page-origin
 *     Match: *.example.test
 *     Default: https://staging.example.test
 *
 *   A tab whose host does not fit the glob (`*` matches any run of
 *   characters, case-insensitively; a pattern containing `/` is checked
 *   against the whole value instead of the host) yields nothing, so
 *   opening the panel on an unrelated site cannot leak that site's
 *   address into a run — resolution falls through to the default
 *   instead. The run screen says which pattern refused the page and
 *   offers the refused value as a one-click override; a typed value
 *   always overrides everything.
 *
 *   Starting a run
 *   resolves every declared variable — the value typed before the run
 *   starts, else its generator when the generator yields something (a
 *   `page-*` generator with no page behind it yields nothing), else the
 *   declared default, else empty — and replaces every
 *   `%NAME%` placeholder anywhere in the rest of the document (title,
 *   description, step instructions, selectors, scripts) with the resolved
 *   value. A variable that resolves to nothing is not substituted at all:
 *   the step keeps the literal `%NAME%`. See `substituteVariables`.
 *
 *   # Dependencies                              (optional, bullet list)
 *   - Seeded test user
 *
 *   # Prerequisites                             (optional, bullet list)
 *   - Open https://app.example.com/admin/reports
 *   - API running locally: `npm run dev` in the app repo,
 *     which also starts the worker — wait for "ready" in its output
 *     - nested detail lines belong to their item too
 *
 *   An item is one flush-left `- ` bullet plus everything indented under it:
 *   wrapped prose and nested bullets stay part of the item they continue
 *   rather than becoming items of their own.
 *
 *   Anything the tester must *do* before step 1 belongs in Prerequisites,
 *   including where the run begins and starting any service locally — with
 *   the address and the command, so each is actionable rather than a
 *   reminder. A tester is usually already in the app, so the entry point
 *   earns a bullet here rather than a first step that spends a verdict on
 *   arriving. This block is rendered Markdown with no page behind it,
 *   unlike a step's `Where:`, so an address in it is absolute or built from
 *   a variable (`%BASE_URL%/admin/reports`) — a bare route has no origin to
 *   resolve against here. Dependencies is for what must
 *   already be true and is not the tester's to arrange: a deployed branch,
 *   a migration, an access level. The run screen renders both in one
 *   collapsed "Before you start" block, since the usual case is an
 *   environment that is already up.
 *
 *   # Steps
 *
 *   ## Step title
 *   Where: /admin/integrations                  (optional — the route or
 *                                                 screen the tester should
 *                                                 already be on before doing
 *                                                 this step, so "which app
 *                                                 am I in?" stays out of the
 *                                                 instructions prose)
 *   Kind: quick                                 (optional — marks this step
 *                                                 as part of the core happy
 *                                                 path. A "quick" run
 *                                                 executes only the marked
 *                                                 steps; a "full" run
 *                                                 executes every step. A case
 *                                                 is authored once, in full,
 *                                                 and the marks pick out the
 *                                                 subset worth running during
 *                                                 development.)
 *   Kind: extra                                 (optional — the opposite dial:
 *                                                 an optional side-check,
 *                                                 skipped by default. It stays
 *                                                 visible in the run, numbered
 *                                                 with a minor increment under
 *                                                 the ordinary step before it
 *                                                 — 2.1, 2.2 — and starts the
 *                                                 run already marked skipped;
 *                                                 the tester opts in by giving
 *                                                 it a verdict. For
 *                                                 conditionals ("only if a
 *                                                 second account exists"),
 *                                                 nice-to-verify checks, and
 *                                                 steps that keep arriving
 *                                                 skipped. A step has one
 *                                                 `Kind:` — quick or extra,
 *                                                 not both; any other value
 *                                                 is ignored.)
 *   Selector: #login-button                     (optional — scrolls this
 *                                                 into view and flashes it
 *                                                 in the page when the step
 *                                                 is focused, or on demand
 *                                                 via the Highlight button)
 *   Selector: [data-testid="login"] button      (optional fallbacks — repeat
 *   Selector: form .btn-primary                  the line; they are tried in
 *                                                 order and the first one
 *                                                 that matches something on
 *                                                 the page wins)
 *   Free text instructions (manual step — no code fence found).
 *
 *   `Where:`, `Selector:` and `Kind:` form a header block directly under
 *   the step title and may appear in any order; the first line that is none
 *   of them ends the header and begins the instructions.
 *
 *   A `Where:` that is a route (`/admin/x`), an absolute URL, or a local
 *   address (`localhost:3000/admin`) gets a Go control in the run screen
 *   that navigates the tab the run is using. A bare route resolves against
 *   whatever page is open, which is right when the tester is already in
 *   the app and refuses to guess when they are not — so a case that has to
 *   be certain declares a `BASE_URL` variable and writes
 *   `Where: %BASE_URL%/admin/x`, which substitutes to an absolute URL
 *   before the run starts. Prose (`the CRM's web console → Contacts`) is
 *   left alone; it names a place, not an address.
 *
 *   A single `Selector:` line is always one selector, even when it contains
 *   commas — `a, b` is a CSS selector *group*, and `querySelector` returns
 *   whichever of the two comes first in the document, not the one written
 *   first. Ordered fallback is what repeated lines buy you: write the most
 *   specific/stable handle first, then progressively looser ones for the
 *   dynamic containers and generated class names it might have to survive.
 *
 *   Every literal the tester must type is written as "**value**" — double
 *   quotes around a bolded run — e.g. `Put "**Buy milk**" in the task
 *   field`. The side panel turns each one into a control: clicking it arms
 *   the page so the next input, textarea or select the tester clicks
 *   receives the value, with a copy fallback. It takes both marks because
 *   either alone is something authors already write for other reasons —
 *   quotes for an error message being cited, bold for emphasis — and a
 *   control offering to type a quoted sentence fragment into the page is
 *   worse than no control. Backticks mean the opposite thing (a label or
 *   element to *find*), so those must not be swapped either. The pair is
 *   deliberately still readable as ordinary Markdown: these files are read
 *   on GitHub and in editors far more than they are run.
 *
 *   Anywhere in a step's prose — instructions, `### Expected`, `### Note` —
 *   a selector written as inline code (`` `#sync-btn` ``,
 *   `` `[data-testid="row"]` ``) renders in the side panel as a control
 *   that flashes that element, the same as the step's own `Selector:`.
 *   Nothing declares this; it is recognised from the text. A Markdown link
 *   with a fragment href does the same with prose for a label:
 *   `[the Sync button](#sync-crm-btn)`. Visible UI labels in backticks —
 *   which is how the step contract asks authors to quote them — are left
 *   alone; only text that could not be a label qualifies.
 *
 *   ### Expected                                (optional)
 *   What should happen — pass criteria only.
 *
 *   ### Note                                    (optional)
 *   Background the tester may want but must not have to read to judge
 *   pass/fail: rationale, regression history, caveats. Keeping it out of
 *   `### Expected` is the whole point — Expected stays scannable.
 *   `### Expected` and `### Note` may appear in either order.
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
  // The generated viewer-link comment is machine-written and belongs to the
  // file, not to the case — dropped here so no reader of the model ever has
  // to know it exists. See `stripViewerComment`.
  const lines = stripViewerComment(raw).replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  if (!lines[i]?.startsWith("# ")) {
    throw new Error('Test case Markdown must start with a level-1 heading, e.g. "# Case title".');
  }
  const title = lines[i].slice(2).trim();
  i++;

  let formatVersion = CURRENT_FORMAT_VERSION;
  let author = "";
  let project = "";
  let tags: string[] = [];
  let changeNote = "";
  while (i < lines.length) {
    const line = lines[i];
    const versionMatch = /^@version\s+(.*)$/i.exec(line);
    const authorMatch = /^@author\s+(.*)$/i.exec(line);
    const projectMatch = /^@project\s+(.*)$/i.exec(line);
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
    if (projectMatch) {
      project = projectMatch[1].trim();
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
    project,
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
const VARIABLE_MATCH_RE = /^Match:\s*(.*)$/i;

function parseOneVariable(name: string, body: string): TestCaseVariable {
  const descriptionLines: string[] = [];
  let defaultValue: string | undefined;
  let generator: VariableGenerator | undefined;
  let generatorArg: string | undefined;
  let match: string | undefined;

  for (const line of body.split("\n")) {
    const defaultMatch = VARIABLE_DEFAULT_RE.exec(line);
    const generatorMatch = VARIABLE_GENERATOR_RE.exec(line);
    const matchMatch = VARIABLE_MATCH_RE.exec(line);
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
    if (matchMatch) {
      match = matchMatch[1].trim() || undefined;
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
    match,
  };
}

const PLACEHOLDER_RE = /%([A-Za-z_][A-Za-z0-9_]*)%/g;

/** Replaces every `%NAME%` placeholder in `text` with its resolved value.
 *
 * A variable is only used when it actually has a value. A placeholder with
 * no matching entry in `values` — or whose value is blank — is left as
 * `%NAME%`, because the alternative is worse in both directions: blanking
 * it turns `Where: %BASE_URL%/admin` into `Where: /admin`, an instruction
 * that looks complete and is wrong, and there is no way for the tester
 * reading the run to tell that a value was ever meant to be there. Leaving
 * the placeholder says exactly what happened. */
export function substituteVariables(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (match, name: string) =>
    values[name]?.trim() ? values[name] : match,
  );
}

/**
 * The items of a `# Dependencies` / `# Prerequisites` section, one string per
 * item, continuation lines included.
 *
 * A top-level item is a flush-left(-ish, <2 spaces — CommonMark allows up to
 * three) `- ` or `* ` bullet. Everything else that is not blank belongs to
 * the item above it: wrapped prose, and nested bullets, which arrive indented
 * and stay part of their parent. Continuations are stored with the standard
 * two-space item indent stripped and real newlines kept, so an item is plain
 * Markdown relative to its own margin — `renderBulletList` puts the indent
 * back. The old version of this function kept only the bullet lines, which
 * silently truncated every item that wrapped.
 */
function parseBulletList(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split("\n")) {
    const indent = /^[ \t]*/.exec(line)![0].length;
    const trimmed = line.trim();
    if (indent < 2 && (trimmed.startsWith("- ") || trimmed.startsWith("* "))) {
      items.push(trimmed.slice(2).trim());
    } else if (items.length > 0 && trimmed !== "") {
      items[items.length - 1] += "\n" + line.replace(/^(?: {1,2}|\t)/, "").trimEnd();
    }
  }
  return items;
}

/** `parseBulletList`'s inverse: items back out as one Markdown list, each
 * item's continuation lines indented two spaces so they stay inside their
 * bullet. Every renderer that shows these lists goes through here — a
 * renderer that writes `- ${item}` flat breaks a multiline item back out of
 * its bullet, which is the truncation bug in a second form. */
export function renderBulletList(items: string[]): string {
  return items.map((item) => `- ${item.trim().replace(/\n/g, "\n  ")}`).join("\n");
}

function parseSteps(stepsSectionBody: string): Step[] {
  const { sections } = splitTopSections(stepsSectionBody, 2);
  return sections.map((s, index) => parseOneStep(s.heading, s.content, index));
}

const FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/;
const SUBSECTION_RE = /^###\s+(Expected|Note)\s*$/i;
const SELECTOR_RE = /^Selector:\s*(.*)$/i;
const WHERE_RE = /^Where:\s*(.*)$/i;
const KIND_RE = /^Kind:\s*(.*)$/i;

/** Splits a step body into its lead text and any `### Expected` / `### Note`
 * subsections. They may appear in either order, and either may be absent. */
function splitStepSubsections(text: string): {
  lead: string;
  expected?: string;
  note?: string;
} {
  const lead: string[] = [];
  const expected: string[] = [];
  const note: string[] = [];
  let current = lead;
  let sawExpected = false;
  let sawNote = false;

  for (const line of text.split("\n")) {
    const match = SUBSECTION_RE.exec(line);
    if (match) {
      if (match[1].toLowerCase() === "expected") {
        current = expected;
        sawExpected = true;
      } else {
        current = note;
        sawNote = true;
      }
      continue;
    }
    current.push(line);
  }

  return {
    lead: lead.join("\n").trim(),
    expected: sawExpected ? expected.join("\n").trim() || undefined : undefined,
    note: sawNote ? note.join("\n").trim() || undefined : undefined,
  };
}

function parseOneStep(title: string, body: string, index: number): Step {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  // `Selector:`/`Where:`/`Kind:` form a small header block at the top of a
  // step, in any order. The first line that is none of them ends the header.
  // `Selector:` may repeat: each line is one candidate, kept in document
  // order, and the highlighter walks them until one matches.
  const selectors: string[] = [];
  let where: string | undefined;
  let quick = false;
  let extra = false;
  for (; i < lines.length; i++) {
    const selectorMatch = SELECTOR_RE.exec(lines[i]);
    const whereMatch = WHERE_RE.exec(lines[i]);
    const kindMatch = KIND_RE.exec(lines[i]);
    if (selectorMatch) {
      const candidate = selectorMatch[1].trim();
      if (candidate) selectors.push(candidate);
    } else if (whereMatch) where = whereMatch[1].trim() || undefined;
    else if (kindMatch) {
      // One `Kind:` per step — a later line replaces an earlier one, so the
      // two marks stay mutually exclusive however the header is edited.
      const kind = kindMatch[1].trim().toLowerCase();
      quick = kind === "quick";
      extra = kind === "extra";
    } else break;
  }
  const bodyAfterHeader = lines.slice(i).join("\n");

  let script: string | undefined;
  let remaining = bodyAfterHeader;

  const fenceMatch = FENCE_RE.exec(bodyAfterHeader);
  if (fenceMatch) {
    script = fenceMatch[2].replace(/\n$/, "");
    remaining = (
      bodyAfterHeader.slice(0, fenceMatch.index) +
      bodyAfterHeader.slice(fenceMatch.index + fenceMatch[0].length)
    ).trim();
  }

  const { lead, expected, note } = splitStepSubsections(remaining);

  const type: StepType = script !== undefined ? "automated" : "manual";

  return {
    id: `step-${index + 1}`,
    order: index,
    title: title.trim(),
    type,
    instructions: lead || undefined,
    expected,
    script,
    selectors,
    where,
    quick,
    extra,
    note,
  };
}

/**
 * Display numbers for a step list where `Kind: extra` steps count as minor
 * increments under the ordinary step before them:
 *
 *   1  Open accounts page
 *   2  Create account
 *   2.1  Check account picture is set     (extra)
 *   2.2  Check "test connection" button   (extra)
 *   3  Create X in account
 *
 * One function, used by the run screen, the report, the feedback file and
 * the console log alike — two renderers numbering the same run differently
 * would make "step 2.1" unfindable in one of them. An extra step before any
 * ordinary step numbers from 0 (0.1), which reads as odd because it is: the
 * case has an optional check ahead of its first real step.
 */
export function stepNumberLabels(steps: Array<{ extra: boolean }>): string[] {
  let major = 0;
  let minor = 0;
  return steps.map((step) => {
    if (step.extra) {
      minor += 1;
      return `${major}.${minor}`;
    }
    major += 1;
    minor = 0;
    return `${major}`;
  });
}

/**
 * A parsed case back out as grammar-valid Markdown — the inverse of
 * `parseCaseDocument`.
 *
 * This exists for the builder in the viewer, where someone assembles a case
 * from form fields and needs a real `.md` file at the end of it. It lives
 * here, beside the parser and under the same doc comment that specifies the
 * grammar, because a serializer that drifts from its parser produces files
 * that look right and do not load.
 *
 * The property that must hold, and the one worth testing:
 * `parseCaseDocument(renderCaseMarkdown(doc))` returns `doc` again, for
 * everything the grammar can express. Fields the grammar has nowhere to put
 * — `version`, `createdAt`, which are derived from the filename and mtime —
 * are the deliberate exceptions.
 */
export function renderCaseMarkdown(doc: TestCaseVersion): string {
  const out: string[] = [];

  out.push(`# ${doc.title.trim() || "Untitled case"}`);
  out.push(`@version ${doc.formatVersion || CURRENT_FORMAT_VERSION}`);
  if (doc.author.trim()) out.push(`@author ${doc.author.trim()}`);
  if (doc.project.trim()) out.push(`@project ${doc.project.trim()}`);
  if (doc.tags.length > 0) out.push(`Tags: ${doc.tags.join(", ")}`);
  if (doc.changeNote.trim()) out.push(`Change note: ${doc.changeNote.trim()}`);

  if (doc.description.trim()) {
    out.push("");
    out.push(doc.description.trim());
  }

  if (doc.variables.length > 0) {
    out.push("");
    out.push("# Variables");
    for (const variable of doc.variables) {
      out.push("");
      out.push(`## ${variable.name.trim()}`);
      if (variable.description.trim()) out.push(variable.description.trim());
      if (variable.defaultValue?.trim()) out.push(`Default: ${variable.defaultValue.trim()}`);
      if (variable.generator) {
        out.push(
          `Generator: ${variable.generator}${
            variable.generatorArg?.trim() ? ` ${variable.generatorArg.trim()}` : ""
          }`,
        );
      }
    }
  }

  for (const [heading, items] of [
    ["Dependencies", doc.dependencies],
    ["Prerequisites", doc.prerequisites],
  ] as const) {
    if (items.length === 0) continue;
    out.push("");
    out.push(`# ${heading}`);
    out.push(renderBulletList(items));
  }

  out.push("");
  out.push("# Steps");

  for (const step of doc.steps) {
    out.push("");
    out.push(`## ${step.title.trim() || "Untitled step"}`);
    // `Where:`/`Selector:`/`Kind:` are a header block in any order; this
    // order is the one the grammar's own examples use.
    if (step.where?.trim()) out.push(`Where: ${step.where.trim()}`);
    for (const selector of step.selectors) {
      if (selector.trim()) out.push(`Selector: ${selector.trim()}`);
    }
    if (step.quick) out.push("Kind: quick");
    else if (step.extra) out.push("Kind: extra");
    if (step.instructions?.trim()) out.push(step.instructions.trim());
    if (step.script !== undefined) {
      // A fenced block in place of instructions is what makes a step
      // automated — see `parseOneStep`.
      out.push("```js");
      out.push(step.script.replace(/\n$/, ""));
      out.push("```");
    }
    if (step.expected?.trim()) {
      out.push("");
      out.push("### Expected");
      out.push(step.expected.trim());
    }
    if (step.note?.trim()) {
      out.push("");
      out.push("### Note");
      out.push(step.note.trim());
    }
  }

  return out.join("\n") + "\n";
}

/** Starter text for a brand new test case, shown in an empty editor. */
export function starterCaseTemplate(): string {
  return `# New test case
@version ${CURRENT_FORMAT_VERSION}
@author
@project
Tags:

Describe what this test case covers.

# Dependencies
-

# Prerequisites
-

# Steps

## First step
Where:
Selector:
Describe the single action the tester should take.

### Expected
Describe the observable result that makes this step pass.
`;
}

/** Starter text for a brand new suite, shown in an empty suite editor.
 * Steps are optional for a suite (shared preparation only), but the
 * template includes one example since most suites have at least one. */
export function starterSuiteTemplate(): string {
  return `# New suite
@version ${CURRENT_FORMAT_VERSION}
@author
@project
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

/** What each audience is called on screen and in the files. */
export const AUDIENCE_LABELS: Record<CommentAudience, string> = {
  developer: "Developer",
  product: "Product",
  "test-writer": "Test writer",
  docs: "Docs",
  ops: "Ops",
};

/** When to pick each one. Shown next to the checkbox in the panel, so the
 * choice is made from the description rather than from the word — "Product"
 * means nothing to a tester mid-run; "works, but should work differently"
 * does. */
export const AUDIENCE_HINTS: Record<CommentAudience, string> = {
  developer: "the app did something wrong",
  product: "it works, but should work differently",
  "test-writer": "the case was wrong, unclear, or missing something",
  docs: "the documentation is wrong or missing",
  ops: "environment or test data, not the app itself",
};

/** The heading each audience gets in `feedback.md`, addressed rather than
 * categorised: whoever picks the file up should be able to find their own
 * name in it. */
export const AUDIENCE_SECTIONS: Record<CommentAudience, string> = {
  developer: "For the developer",
  product: "For product",
  "test-writer": "For the test writer",
  docs: "For the docs writer",
  ops: "For ops",
};

/** `[Developer · Docs] ` — the prefix a comment carries in a rendered file.
 * Empty for an untagged comment, which is context and not addressed to
 * anyone. */
function audiencePrefix(comment: RunComment): string {
  if (comment.audiences.length === 0) return "";
  return `[${comment.audiences.map((a) => AUDIENCE_LABELS[a]).join(" · ")}] `;
}

/**
 * Everything the tester wrote on a step, including whatever was still in the
 * box.
 *
 * A comment that was typed but never Added is finished work as far as its
 * author is concerned — they said the thing. Dropping it because a button went
 * unpressed loses exactly the observation the run existed to collect, and
 * loses it silently, which is the worst way. So every reader goes through
 * here, and `Add` is only how you start writing the next one.
 */
export function stepComments(state: {
  comments: RunComment[];
  draft: RunCommentDraft | null;
}): RunComment[] {
  const draft = state.draft?.text.trim();
  if (!draft) return state.comments;
  return [
    ...state.comments,
    { id: DRAFT_COMMENT_ID, text: draft, audiences: state.draft!.audiences },
  ];
}

/** Marks the comment that came out of the box rather than the list. Stable, so
 * promoting a draft twice cannot produce two of it. */
export const DRAFT_COMMENT_ID = "comment-unsent";

/** The counts a step carries, as the report and feedback both phrase them. */
function stepCounts(state: RunStepState): CaptureCounts {
  return {
    consoleErrors: state.consoleErrors,
    consoleWarnings: state.consoleWarnings,
    networkFailures: state.networkFailures,
    requests: state.requests,
  };
}

/** "step 3 — Sync the contact", for cross-referencing a digest item back into
 * the step list above it. Returns "" for an entry that arrived outside any
 * step, which reads better than "step none". */
function stepLabeller(doc: TestCaseVersion): (stepId: string | null) => string {
  const labels = stepNumberLabels(doc.steps);
  const numbers = new Map(doc.steps.map((step, index) => [step.id, labels[index]]));
  return (stepId) => {
    if (!stepId) return "";
    const number = numbers.get(stepId);
    return number ? `step ${number}` : stepId;
  };
}

/**
 * Human-readable summary of a finished (or in-progress) run — meant to be
 * shared outside the extension, e.g. emailed. Written as `report.md`
 * alongside `run.json` whenever a run finishes.
 *
 * `digest` is the captured console/network output, and is passed **only when
 * the tester ticked the box at finish**. Per-step counts are printed either
 * way — knowing a step logged three errors is not the same as reading them,
 * and the count is what makes the un-attached case visible rather than silent.
 */
export function renderRunReport(
  doc: TestCaseVersion,
  run: RunFile,
  digest?: CaptureDigest | null,
): string {
  const byId = new Map(run.steps.map((s) => [s.stepId, s]));
  const labelStep = stepLabeller(doc);
  const lines: string[] = [];

  lines.push(`# ${doc.title} — Run Report`);
  lines.push("");
  if (doc.project) lines.push(`- Project: ${doc.project}`);
  lines.push(`- Version: v${run.testCaseVersion}`);
  // A quick run and a full run are not the same evidence — a report that
  // does not say which one it was invites "but it passed" about a pass that
  // only ever covered the happy path.
  lines.push(`- Coverage: ${run.tier === "quick" ? "quick (core steps only)" : "full"}`);
  // "Failed on staging" and "failed on local" are different findings; a
  // report that cannot tell them apart sends someone debugging the wrong
  // deployment. Omitted entirely when no environment was chosen — the
  // values may still have pointed anywhere, and naming none is honest.
  if (run.environment.trim()) lines.push(`- Environment: ${run.environment.trim()}`);
  lines.push(`- Status: ${run.status}`);
  lines.push(`- Started: ${run.startedAt}`);
  lines.push(`- Finished: ${run.finishedAt ?? "—"}`);
  lines.push("");
  if (run.comment.trim()) {
    // Above the steps, because it is context for all of them.
    lines.push("## Tester's note on this run");
    lines.push("");
    lines.push(run.comment.trim());
    lines.push("");
  }
  // Above the steps for the same reason as the comment: it is evidence about
  // the whole run, and a reader who stops after the first screen should have
  // seen it.
  if (digest) {
    lines.push(renderCaptureDigest(digest, labelStep));
  }
  lines.push("## Steps");
  lines.push("");

  const numberLabels = stepNumberLabels(doc.steps);
  doc.steps.forEach((step, index) => {
    const state = byId.get(step.id);
    const status = state?.status ?? "pending";
    lines.push(
      `### ${STATUS_ICON[status] ?? ""} ${numberLabels[index]}. ${step.title} (${status}${
        step.extra ? ", extra" : ""
      })`,
    );
    const comments = state ? stepComments(state) : [];
    if (comments.length) {
      lines.push("");
      lines.push("Comments:");
      for (const comment of comments) {
        lines.push(`- ${audiencePrefix(comment)}${comment.text}`);
      }
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
    if (state && hasCaptureSignal(stepCounts(state))) {
      lines.push("");
      lines.push(`Console: ${describeCounts(stepCounts(state))}`);
      // The step's own findings in one line each, so a reader stopped at a
      // failed step sees what the page said without scrolling back up to the
      // digest. The full text and stacks stay up there, deduplicated once.
      const own = digest?.items.filter((item) => item.firstStepId === step.id) ?? [];
      for (const item of own) lines.push(`- ${summarizeDigestItem(item)}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

function hasStepSignal(step: Step, state: RunStepState): boolean {
  return (
    state.status === "failed" ||
    state.status === "warning" ||
    // A skip the tester chose is a small vote against the step — repeated
    // across runs it is the test writer's cue to drop it or mark it
    // `Kind: extra`. An extra step arriving skipped is the default doing its
    // job, and says nothing.
    (state.status === "skipped" && !step.extra) ||
    stepComments(state).some((c) => c.text.trim().length > 0) ||
    !!state.automatedResult?.error ||
    // A console error during a step the tester marked passed is signal in its
    // own right, on the same argument as the run comment below: a green run
    // with a stack trace in it is exactly the finding that used to disappear.
    state.consoleErrors > 0
  );
}

/**
 * Human-in-the-loop handoff artifact addressed to the LLM that built the
 * feature: what a human tester found while verifying it. Written as
 * `feedback.md` alongside `report.md` whenever a run finishes — but only
 * when there's something to act on. A clean silent pass returns `null` so
 * callers skip the write rather than producing empty-handoff noise.
 *
 * A run-level comment counts as something to act on by itself. "Passed, but
 * the whole flow felt slow" is exactly the kind of finding that never
 * attaches to one step, and before the run comment existed it had nowhere
 * to go — so a run that passed while worrying the tester produced no
 * handoff at all.
 *
 * `digest` follows the same rule as in `renderRunReport`: passed only when the
 * tester agreed to attach captured output. Without it this file still says how
 * much was captured — a count is not content, and a reader that knows a log
 * exists can ask for it instead of assuming the page was quiet.
 */
export function renderRunFeedback(
  doc: TestCaseVersion,
  run: RunFile,
  digest?: CaptureDigest | null,
): string | null {
  const byId = new Map(run.steps.map((s) => [s.stepId, s]));
  const labelStep = stepLabeller(doc);
  const numberLabels = stepNumberLabels(doc.steps);
  const signalSteps = doc.steps
    .map((step, index) => ({ step, index, state: byId.get(step.id) }))
    .filter(
      (s): s is { step: Step; index: number; state: RunStepState } =>
        !!s.state && hasStepSignal(s.step, s.state),
    );

  const runComment = run.comment.trim();
  if (signalSteps.length === 0 && !runComment) return null;

  const failedCount = run.steps.filter((s) => s.status === "failed").length;
  const warningCount = run.steps.filter((s) => s.status === "warning").length;
  const skippedCount = signalSteps.filter(({ state }) => state.status === "skipped").length;
  const noteCount = run.steps.reduce((n, s) => n + stepComments(s).length, 0);

  const captured: CaptureCounts = {
    consoleErrors: run.steps.reduce((n, s) => n + s.consoleErrors, 0),
    consoleWarnings: run.steps.reduce((n, s) => n + s.consoleWarnings, 0),
    networkFailures: run.steps.reduce((n, s) => n + s.networkFailures, 0),
    requests: run.steps.reduce((n, s) => n + s.requests, 0),
  };

  // One bucket per audience, in the order the checkboxes appear, so a reader
  // scanning for their own section finds it in the same place every time.
  const addressed = new Map<CommentAudience, string[]>(COMMENT_AUDIENCES.map((a) => [a, []]));
  const failedItems: string[] = [];
  const skippedItems: string[] = [];
  const consoleItems: string[] = [];

  for (const { step, index, state } of signalSteps) {
    const stepNum = numberLabels[index];
    const comments = stepComments(state);
    const toDeveloper = comments.some((c) => c.audiences.includes("developer"));
    for (const comment of comments) {
      for (const audience of comment.audiences) {
        addressed
          .get(audience)!
          .push(`- **${step.title}** (step ${stepNum}, ${state.status}): ${comment.text}`);
      }
    }
    // A failure the tester did not address to anyone still has to reach the
    // developer — silence about a red step is not a decision to ignore it.
    if (state.status === "failed" && !toDeveloper) {
      const detail = [
        comments
          .map((c) => c.text.trim())
          .filter(Boolean)
          .join("; "),
        state.automatedResult?.error,
      ]
        .filter((s): s is string => !!s)
        .join(" — ");
      failedItems.push(`- **${step.title}** (step ${stepNum})${detail ? `: ${detail}` : ""}`);
    }
    // An extra step skipped is the default; an ordinary step skipped is the
    // tester declining work the case asked for, and the test writer is the
    // one who can act on that.
    if (state.status === "skipped" && !step.extra) {
      const detail = comments
        .map((c) => c.text.trim())
        .filter(Boolean)
        .join("; ");
      skippedItems.push(`- **${step.title}** (step ${stepNum})${detail ? `: ${detail}` : ""}`);
    }
    // The page throwing and the step failing are different statements, and
    // when they disagree the console one is the more precise: it names what
    // broke rather than what the tester could see of it. A request that came
    // back 500 is the same kind of statement — often the only one that names
    // the endpoint behind a button that "did nothing".
    for (const item of digest?.items ?? []) {
      if (item.firstStepId !== step.id) continue;
      if (item.level !== "error" && item.level !== "uncaught" && item.level !== "network") continue;
      consoleItems.push(
        `- **${step.title}** (step ${stepNum}, tester marked it ${state.status}): ` +
          summarizeDigestItem(item),
      );
    }
  }

  const lines: string[] = [];
  lines.push(`# Feedback: ${doc.title} (v${run.testCaseVersion}, run ${run.id})`);
  lines.push("");
  if (doc.project) lines.push(`Project: **${doc.project}**`);
  lines.push(
    `Human verification run finished ${run.finishedAt ?? "—"} with status **${run.status}**` +
      `${run.tier === "quick" ? ", covering the quick (core) steps only" : ""}.`,
  );
  lines.push(
    `${failedCount} failed, ${warningCount} warnings, ${noteCount} tester comments` +
      `${skippedCount > 0 ? `, ${skippedCount} ${skippedCount === 1 ? "step" : "steps"} skipped` : ""}.`,
  );
  if (hasCaptureSignal(captured)) {
    lines.push(
      digest
        ? `The page itself produced ${describeCounts(captured)} during the run; they are listed below.`
        : `The page itself produced ${describeCounts(captured)} during the run. The tester did ` +
            "not attach them, so they are **not** in this file or in `report.md`. `console.md` in " +
            "this run's folder holds them and is not yours to read — treat the omission as the " +
            "tester's decision, and ask if you need it.",
    );
  }
  lines.push("");
  const addressedCount = [...addressed.values()].reduce((n, items) => n + items.length, 0);
  const hasActionItems =
    addressedCount + failedItems.length + skippedItems.length + consoleItems.length > 0;
  lines.push(
    hasActionItems
      ? "This file was written by a human tester reviewing the feature. Each section below " +
          "is addressed to whoever the tester marked the comment for — take the ones that " +
          "are yours. Step-by-step detail follows for context."
      : "This file was written by a human tester reviewing the feature. Nothing " +
          "failed; what follows is what they wanted you to know anyway.",
  );

  if (runComment) {
    lines.push("");
    lines.push("## The tester's own words on this run");
    lines.push("");
    lines.push(runComment);
  }

  const actionSections: Array<{ heading: string; items: string[]; lead?: string }> = [
    ...COMMENT_AUDIENCES.map((audience) => ({
      heading: AUDIENCE_SECTIONS[audience],
      items: addressed.get(audience)!,
      // The one audience whose feedback is not only about this run: a tester
      // saying the case was unclear is sometimes reporting a defect in one
      // case and sometimes stating how cases for this app should always be
      // written. Only a reader can tell which, so the file asks rather than
      // deciding — see the check skill, which promotes the standing ones.
      lead:
        audience === "test-writer"
          ? "Fix the case where this is a one-off. Where it is how cases for this " +
            "project should *always* be written, promote it to a project rule instead."
          : undefined,
    })),
    { heading: "Failed steps the tester left uncommented", items: failedItems },
    {
      heading: "Steps the tester skipped",
      items: skippedItems,
      // Addressed to the test writer even without a comment: a skip is a
      // small vote against the step, and only across runs does it become a
      // verdict — which is why the lead asks for a pattern, not a reaction.
      lead:
        "For the test writer. One skip may be circumstance. A step that arrives skipped " +
        "run after run is not earning its place — mark it `Kind: extra` so it stops " +
        "demanding a verdict, or remove it.",
    },
    { heading: "Errors and failed requests from the page", items: consoleItems },
  ];
  // A comment-only handoff has nothing to list, and an empty "Action items"
  // heading reads as a bug in this renderer rather than as an all-clear.
  if (hasActionItems) {
    lines.push("");
    lines.push("## Action items");
    for (const { heading, items, lead } of actionSections) {
      if (items.length === 0) continue;
      lines.push("");
      lines.push(`### ${heading}`);
      if (lead) {
        lines.push("");
        lines.push(lead);
        lines.push("");
      }
      lines.push(...items);
    }
  }

  // The trace, when the tester asked for every request rather than only the
  // broken ones. Context rather than an action item: nothing here is wrong by
  // definition, and the value is in answering "what does this actually call"
  // without anyone having to reproduce the run with DevTools open.
  if (digest && digest.requests.length > 0) {
    lines.push("");
    lines.push("## What the page called");
    lines.push("");
    lines.push(
      "Every request made during the run, in the order they first happened, identical ones " +
        "collapsed. Query strings are redacted; no headers or bodies were captured.",
    );
    lines.push("");
    for (const item of digest.requests) {
      const where = labelStep(item.firstStepId);
      lines.push(
        `- ${item.text}${item.count > 1 ? ` ×${item.count}` : ""}${where ? ` (${where})` : ""}`,
      );
    }
    if (digest.omittedRequests > 0) {
      lines.push("");
      lines.push(
        `${digest.omittedRequests} further distinct ${
          digest.omittedRequests === 1 ? "request" : "requests"
        } not listed; \`console.md\` in this run's folder has them all.`,
      );
    }
  }

  if (signalSteps.length > 0) {
    lines.push("");
    lines.push("## Step detail");
  }

  for (const { step, index, state } of signalSteps) {
    lines.push("");
    lines.push(
      `### ${STATUS_ICON[state.status] ?? ""} ${numberLabels[index]}. ${step.title} (${state.status})`,
    );
    if (step.expected) lines.push(`Expected: ${step.expected}`);
    const detailComments = stepComments(state);
    if (detailComments.length > 0) {
      lines.push("Comments:");
      for (const comment of detailComments) {
        lines.push(`- ${audiencePrefix(comment)}${comment.text}`);
      }
    }
    if (state.automatedResult?.error) lines.push(`Automated error: ${state.automatedResult.error}`);
    if (hasCaptureSignal(stepCounts(state))) {
      lines.push(`Console: ${describeCounts(stepCounts(state))}`);
      for (const item of digest?.items ?? []) {
        if (item.firstStepId === step.id) lines.push(`- ${summarizeDigestItem(item)}`);
      }
    }
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
 * A Markdown link whose href is a selector rather than a place to go —
 * `[the Sync button](#sync-crm-btn)`, `[the row](selector:[data-testid=row])`.
 * In the panel these are Highlight controls; in a file someone reads, they
 * are links to nowhere, so the label is all that survives.
 */
const SELECTOR_LINK_RE = /\[([^\]\n]+)\]\((?:#[A-Za-z_-][\w-]*|selector:[^)\n]+)\)/g;

function proseForReader(text: string, values: Record<string, string>): string {
  return substituteVariables(text, values).replace(SELECTOR_LINK_RE, "$1");
}

/**
 * The case as a document for a person, rather than as something the
 * extension executes.
 *
 * A case file is written for two audiences at once and the second one has
 * always come off worse: hand `v3.md` to a manual tester, a reviewer, or a
 * ticket, and they get `Selector: [data-testid="sync"]` lines, `Kind: quick`
 * markers, `%BASE_URL%` placeholders, and steps whose entire content is a
 * block of JavaScript. None of that is wrong — it is just addressed to the
 * panel, not to them.
 *
 * What this strips, and why each one:
 *
 * - **Automated steps.** A fenced script is not an instruction; a person
 *   cannot carry it out. They are listed by title at the end instead of
 *   vanishing, because "this was checked, by a script" is worth knowing and
 *   a silently shortened case reads as if the coverage was never there.
 * - **`Selector:` and `Kind:`.** Both address the panel — one is what
 *   Highlight flashes, the other picks the quick subset. A reader executing
 *   by hand needs the step's words, not its handles.
 * - **`@version`**, the grammar's format version, which says nothing about
 *   the case.
 * - **`%VAR%` placeholders that have a literal default**, substituted so
 *   the reader sees the address they should open rather than a variable
 *   name. Variables with a generator, or with no value at all, cannot be
 *   resolved outside a run and are listed as things to decide first.
 *
 * What it deliberately keeps: `"**quoted values**"`, which read as quoted
 * emphasis in any Markdown viewer, and selectors written as inline code in
 * prose, since removing those mid-sentence leaves a sentence with a hole in
 * it — the one place where being addressed to the panel costs a reader
 * nothing.
 */
export function renderReadableCase(
  doc: TestCaseVersion,
  opts: { exportedAt?: string } = {},
): string {
  const runnable = doc.steps.filter((s) => s.type !== "automated");
  const automated = doc.steps.filter((s) => s.type === "automated");

  const resolved: Record<string, string> = {};
  const undecided: TestCaseVariable[] = [];
  for (const variable of doc.variables) {
    if (variable.defaultValue?.trim()) resolved[variable.name] = variable.defaultValue.trim();
    else undecided.push(variable);
  }
  const prose = (text: string) => proseForReader(text, resolved);

  const lines: string[] = [];
  lines.push(`# ${prose(doc.title)}`);
  lines.push("");
  if (doc.project) lines.push(`- Project: ${doc.project}`);
  if (doc.author) lines.push(`- Author: ${doc.author}`);
  if (doc.tags.length > 0) lines.push(`- Tags: ${doc.tags.join(", ")}`);
  lines.push(
    `- Case version: v${doc.version}${
      opts.exportedAt ? ` (exported ${opts.exportedAt.slice(0, 10)})` : ""
    }`,
  );
  lines.push("");

  if (doc.description.trim()) {
    lines.push(prose(doc.description.trim()));
    lines.push("");
  }

  if (doc.dependencies.length > 0 || doc.prerequisites.length > 0) {
    lines.push("## Before you start");
    lines.push("");
    if (doc.prerequisites.length > 0) {
      lines.push(renderBulletList(doc.prerequisites.map(prose)));
      lines.push("");
    }
    if (doc.dependencies.length > 0) {
      lines.push("These must already be true, and are not yours to arrange:");
      lines.push("");
      lines.push(renderBulletList(doc.dependencies.map(prose)));
      lines.push("");
    }
  }

  if (undecided.length > 0) {
    lines.push("## Decide these first");
    lines.push("");
    for (const variable of undecided) {
      const description = variable.description.trim();
      lines.push(`- **${variable.name}** — ${description || "no description given"}`);
    }
    lines.push("");
    lines.push(
      "They appear below as `%NAME%`. Write down what you used, so a rerun means the same thing.",
    );
    lines.push("");
  }

  lines.push("## Steps");
  lines.push("");

  if (runnable.length === 0) {
    lines.push("*Every step in this case is automated — there is nothing here to do by hand.*");
    lines.push("");
  }

  const runnableLabels = stepNumberLabels(runnable);
  runnable.forEach((step, index) => {
    lines.push(`### ${runnableLabels[index]}. ${prose(step.title)}`);
    lines.push("");
    if (step.extra) {
      lines.push("*Optional — a run skips this by default; do it if it applies and time allows.*");
      lines.push("");
    }
    if (step.where) {
      lines.push(`**Where:** ${prose(step.where)}`);
      lines.push("");
    }
    if (step.instructions?.trim()) {
      lines.push(prose(step.instructions.trim()));
      lines.push("");
    }
    if (step.expected?.trim()) {
      lines.push("**Expected**");
      lines.push("");
      lines.push(prose(step.expected.trim()));
      lines.push("");
    }
    if (step.note?.trim()) {
      lines.push("**Note**");
      lines.push("");
      lines.push(prose(step.note.trim()));
      lines.push("");
    }
  });

  if (automated.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push(
      `*${automated.length} automated step${automated.length === 1 ? "" : "s"} ` +
        `omitted — ${automated.length === 1 ? "it runs" : "they run"} as a script in the Enloop ` +
        `extension rather than by hand:*`,
    );
    lines.push("");
    for (const step of automated) lines.push(`- *${prose(step.title)}*`);
    lines.push("");
  }

  return lines.join("\n");
}

/** True when a step body's header block carries `Kind: quick`. Reads only
 * the header — the same lines `parseOneStep` reads — so a `Kind:` line in
 * the instructions prose is not a marker. */
function stepBodyIsQuick(body: string): boolean {
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    const kindMatch = KIND_RE.exec(line);
    if (kindMatch) return kindMatch[1].trim().toLowerCase() === "quick";
    if (!SELECTOR_RE.test(line) && !WHERE_RE.test(line)) return false;
  }
  return false;
}

/** Number of steps a quick run of this document would execute. */
export function countQuickSteps(markdown: string): number {
  const stepsRaw = extractSectionRaw(stripViewerComment(markdown).replace(/\r\n/g, "\n"), "Steps");
  if (!stepsRaw) return 0;
  return splitTopSections(stepsRaw, 2).sections.filter((s) => stepBodyIsQuick(s.content)).length;
}

/**
 * Drops every step not marked `Kind: quick`, returning the document a quick
 * run should freeze.
 *
 * This is text surgery on purpose, applied **before** the case is parsed and
 * before a suite is merged in. Filtering the text rather than the parsed
 * steps keeps two properties that matter:
 *
 * - The frozen `case.md` is exactly what was executed. A run never carries
 *   definitions for steps it skipped, so nothing downstream has to know that
 *   a step was filtered out.
 * - Step ids stay contiguous. Ids are positional (`step-${index + 1}`), so
 *   removing steps after parsing would leave gaps between the run's step ids
 *   and the frozen document's, and every join between `run.json` and
 *   `case.md` goes through those ids.
 *
 * Called before `buildRunSource`, so a suite's prep steps are never filtered
 * — a quick run that skips logging in is not a run.
 */
export function filterToQuickSteps(markdown: string): string {
  // Stripped before the surgery, not after: the comment sits past the last
  // step, so it would otherwise ride along inside that step's body and be
  // kept or dropped depending on whether that step happened to be quick.
  const normalized = stripViewerComment(markdown).replace(/\r\n/g, "\n");
  const range = sectionRange(normalized, "Steps");
  if (!range) return normalized;

  const stepsBody = normalized.slice(range.start, range.end);
  const kept = splitTopSections(stepsBody, 2)
    .sections.filter((s) => stepBodyIsQuick(s.content))
    .map((s) => `## ${s.heading}\n${s.content}`.trim());

  return normalized.slice(0, range.start) + kept.join("\n\n") + "\n\n" + normalized.slice(range.end);
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
  const normalizedCase = stripViewerComment(caseMarkdown).replace(/\r\n/g, "\n");
  const normalizedSuite = stripViewerComment(suiteMarkdown).replace(/\r\n/g, "\n");

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

import {
  parseCaseDocument,
  filterToQuickSteps,
  substituteVariables,
  CURRENT_FORMAT_VERSION,
} from "./markdown.js";
import { resolveVariableValues } from "./variables.js";
import type { TestCaseVersion } from "./types.js";

/**
 * The mechanical half of the step contract, as code.
 *
 * Authoring a case ends with two checks: does it parse the way its author
 * meant, and does it pass the contract's reject list. The first was a
 * throwaway Node script the agent wrote from scratch every time — against a
 * parser it first had to compile out of the Enloop repo, which is why
 * authoring needed that repo on disk at all. The second was the agent
 * re-reading its own output. Both are now this function, shipped inside the
 * plugin as a bundle, so a case can be validated with nothing but `node`.
 *
 * The split between `errors` and `warnings` is the important part and it is
 * not about severity. **Errors are what a machine can be certain about**: the
 * document did not parse as intended, a placeholder survived substitution, a
 * step has no `Where:`. **Warnings are where a human still decides**: a prose
 * `Where:` is wrong for `/admin/reports` and right for a terminal, and
 * nothing here can tell those apart. So warnings are printed to be read and
 * answered, never to be silenced by rewriting the case until the tool goes
 * quiet — that trades a real judgement for a green tick.
 *
 * The reject-list items that need to read the app's source — an invented
 * label, a selector that is not in the repo — are deliberately absent. They
 * cannot be checked here and pretending otherwise would make a pass mean
 * less than it does.
 */

export interface LintFinding {
  /** Reject-list rule this comes from, e.g. `2a` — so a finding can be read
   * against the contract rather than taken on faith. */
  rule: string;
  /** Step title, variable name, or a section name. Absent for whole-document
   * findings. */
  at?: string;
  message: string;
}

export interface LintResult {
  ok: boolean;
  errors: LintFinding[];
  warnings: LintFinding[];
  /** What the parser actually produced, for the author to read instead of
   * the source they just wrote. */
  doc: TestCaseVersion;
  quick: { marked: number; total: number; parses: boolean };
}

/** An address a Go control can use, or a placeholder that becomes one before
 * the run starts. Deliberately the same shape the run screen's
 * `looksNavigable` accepts, minus the page it would resolve against. */
const ADDRESS = /^(https?:\/\/|\/|%[A-Za-z_][A-Za-z0-9_]*%|localhost[:/]|127\.0\.0\.1[:/]|\[::1\])/;

/** A bare route sitting in prose — `- Open /admin/reports`. Backticked
 * spans are stripped before this runs, so `npm run dev` and paths inside
 * commands do not trip it. */
const BARE_ROUTE_IN_PROSE = /(^|\s)\/[A-Za-z][\w-]*(\/|\s|$)/;

const OPENS_SOMEWHERE = /\b(open|go to|navigate|browse|start at)\b/i;

/** Prose that restates the navigation a `Where:` line already provides. */
const RESTATES_NAVIGATION =
  /^(navigate|go)\b[^.]*\b(to|there)\b[^.]*\.?$|^open (the|this) (page|screen)\b[^.]*\.?$/i;

const UNMEASURABLE = /\b(quickly|properly|correctly|appropriately|as expected|successfully)\b/i;

function stripCode(text: string): string {
  return text.replace(/`[^`]*`/g, " ");
}

export function lintCase(raw: string, options: { expectProject?: string } = {}): LintResult {
  const errors: LintFinding[] = [];
  const warnings: LintFinding[] = [];
  const createdAt = new Date().toISOString();

  const declared = parseCaseDocument(raw, { version: 1, createdAt });
  const values = resolveVariableValues(declared.variables, {});
  const substituted = substituteVariables(raw, values);
  const doc = parseCaseDocument(substituted, { version: 1, createdAt });

  // --- the document parsed into something ---------------------------------

  if (!doc.title.trim()) {
    errors.push({ rule: "7", message: "No `# ` title line — the first heading is the case title." });
  }
  if (doc.steps.length === 0) {
    errors.push({ rule: "1", message: "No steps parsed. Check that `# Steps` is a top-level heading and each step is `## `." });
  }
  if (!doc.project.trim()) {
    errors.push({ rule: "reject", message: "No `@project` line naming the app under test." });
  } else if (!doc.title.startsWith(doc.project)) {
    errors.push({
      rule: "reject",
      message: `Title does not begin with the project prefix: expected "${doc.project}: …", got "${doc.title}".`,
    });
  }
  if (options.expectProject && doc.project.trim() !== options.expectProject.trim()) {
    errors.push({
      rule: "reject",
      message: `@project is "${doc.project}", expected "${options.expectProject}".`,
    });
  }

  // --- variables resolve ---------------------------------------------------

  // A placeholder left standing is only a defect when nothing declares it.
  // One the tester supplies by hand is *supposed* to survive authoring — the
  // panel resolves it when the run starts — so flagging it would push authors
  // to invent a default for a value they have no business guessing.
  const declaredNames = new Set(declared.variables.map((v) => v.name));
  const everyField = [
    doc.title,
    doc.description,
    ...doc.prerequisites,
    ...doc.dependencies,
    ...doc.steps.flatMap((s) => [
      s.title,
      s.instructions ?? "",
      s.expected ?? "",
      s.note ?? "",
      s.where ?? "",
      ...s.selectors,
    ]),
  ].join("\n");
  const undeclared = new Set(
    [...everyField.matchAll(/%([A-Za-z_][A-Za-z0-9_]*)%/g)]
      .map((m) => m[1])
      .filter((name) => !declaredNames.has(name)),
  );
  for (const name of undeclared) {
    errors.push({
      rule: "6",
      message: `%${name}% is used but never declared under \`# Variables\`, so it stays literal in the run — a typo, or a missing declaration.`,
    });
  }

  if (doc.formatVersion && doc.formatVersion !== CURRENT_FORMAT_VERSION) {
    warnings.push({
      rule: "7",
      message: `@version is ${doc.formatVersion}; this parser implements ${CURRENT_FORMAT_VERSION}. Re-read the grammar before trusting anything below.`,
    });
  }
  for (const variable of declared.variables) {
    const described = variable.description.trim().length > 0;
    if (!variable.defaultValue && !variable.generator && !described) {
      errors.push({
        rule: "6",
        at: variable.name,
        message: "No `Default:`, no `Generator:`, and no description saying how to obtain the value.",
      });
    } else if (!variable.defaultValue && !variable.generator) {
      warnings.push({
        rule: "6",
        at: variable.name,
        message: "No `Default:` and no `Generator:` — the description must say exactly where to get the value, before the run starts.",
      });
    }
    // A bare host used as an address prefix is the one generator mistake that
    // cannot be seen by reading the case: `page-domain` yields
    // `example.com/admin`, which has no scheme for a browser to open, no port
    // for a dev server, and gets no Go control. It reads perfectly right up
    // until someone runs it.
    if (variable.generator === "page-domain" && everyField.includes(`%${variable.name}%/`)) {
      warnings.push({
        rule: "2b",
        at: variable.name,
        message: `\`Generator: page-domain\` is the bare host, but %${variable.name}% is used as an address prefix — that resolves to \`example.com/path\`, with no scheme and no port. Use \`Generator: page-origin\`.`,
      });
    }
  }

  // --- where the run begins ------------------------------------------------

  const entryPoint = doc.prerequisites.find((p) => OPENS_SOMEWHERE.test(p));
  if (!entryPoint) {
    warnings.push({
      rule: "2a",
      at: "Prerequisites",
      message: "No prerequisite says where the run begins. The entry point belongs here as an absolute address, not in a first step spent on arriving.",
    });
  }
  for (const item of doc.prerequisites) {
    if (BARE_ROUTE_IN_PROSE.test(stripCode(item))) {
      errors.push({
        rule: "2a",
        at: "Prerequisites",
        message: `Bare route in a prerequisite: "${item.trim()}". This block has no open page to resolve against — use an absolute URL or %BASE_URL%/….`,
      });
    }
  }

  const firstStep = doc.steps[0];
  if (firstStep && !firstStep.expected?.trim() && OPENS_SOMEWHERE.test(firstStep.title)) {
    warnings.push({
      rule: "2a",
      at: firstStep.title,
      message: "Step 1 looks like it only opens the app. Move it to `# Prerequisites` unless arriving is what is under test.",
    });
  }

  // --- per step ------------------------------------------------------------

  let quickMarked = 0;
  for (const step of doc.steps) {
    const where = step.where?.trim() ?? "";
    if (step.quick) quickMarked++;

    if (!where) {
      errors.push({ rule: "2b", at: step.title, message: "No `Where:` line." });
    } else if (!ADDRESS.test(where)) {
      warnings.push({
        rule: "2b",
        at: step.title,
        message: `\`Where: ${where}\` is prose, so the step gets no Go control. Correct only if the place genuinely has no address.`,
      });
    }

    const instructions = step.instructions?.trim() ?? "";
    if (RESTATES_NAVIGATION.test(instructions)) {
      warnings.push({
        rule: "2c",
        at: step.title,
        message: `Instructions restate the navigation \`Where:\` already gives: "${instructions}". A step's instructions start at the action.`,
      });
    }
    if (/\bthen\b/i.test(instructions)) {
      warnings.push({
        rule: "1",
        at: step.title,
        message: "Instructions contain \"then\" — two actions in one verdict. Split unless it is one form being filled.",
      });
    }
    if (step.type === "manual" && step.selectors.length === 0) {
      warnings.push({
        rule: "3",
        at: step.title,
        message: "No `Selector:`. Every UI step carries one, taken from source — or a `### Note` saying the element has no stable handle.",
      });
    }
    for (const selector of step.selectors) {
      if (/^\s*(div|span|body|main)\b/i.test(selector) || /:nth-child|>\s*\w+\s*>/.test(selector)) {
        warnings.push({
          rule: "3",
          at: step.title,
          message: `Structural selector: \`${selector}\`. Use a data-testid, an id, or a stable aria-label.`,
        });
      }
    }

    const expected = step.expected?.trim() ?? "";
    if (!expected) {
      warnings.push({ rule: "4", at: step.title, message: "No `### Expected` block, so nothing says what Pass means." });
    } else {
      if (!expected.split("\n").some((line) => /^\s*[-*]\s+/.test(line))) {
        errors.push({ rule: "4", at: step.title, message: "`### Expected` is prose rather than bullets." });
      }
      if (/\b(why|used to|regression-checks?)\b/i.test(expected)) {
        warnings.push({ rule: "4", at: step.title, message: "`### Expected` carries rationale — move it to `### Note`." });
      }
      const adjective = UNMEASURABLE.exec(expected);
      if (adjective) {
        warnings.push({
          rule: "4",
          at: step.title,
          message: `\`### Expected\` says "${adjective[0]}" with no observable behind it.`,
        });
      }
    }
  }

  // --- the quick subset is a document of its own ---------------------------

  let quickParses = true;
  if (quickMarked > 0) {
    try {
      const quickDoc = parseCaseDocument(filterToQuickSteps(substituted), { version: 1, createdAt });
      quickParses = quickDoc.steps.length === quickMarked;
      if (!quickParses) {
        errors.push({
          rule: "3b",
          message: `A quick run would execute ${quickDoc.steps.length} steps, but ${quickMarked} carry \`Kind: quick\`. The filtered document does not parse to the marked subset.`,
        });
      }
    } catch (e) {
      quickParses = false;
      errors.push({ rule: "3b", message: `The quick subset fails to parse on its own: ${String(e)}` });
    }
  }
  if (quickMarked === 0 && doc.steps.length > 1) {
    warnings.push({
      rule: "3b",
      message: "No step carries `Kind: quick`, so this case is full-only. Correct for a case that is all edge cases; otherwise mark the core path.",
    });
  } else if (quickMarked > 0 && quickMarked === doc.steps.length && doc.steps.length > 3) {
    warnings.push({
      rule: "3b",
      message: "Every step is marked `Kind: quick`, so a quick run costs what a full one does. Correct for a quick-tier case, wrong for a full one.",
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    doc,
    quick: { marked: quickMarked, total: doc.steps.length, parses: quickParses },
  };
}

import {
  parseCaseDocument,
  filterToQuickSteps,
  substituteVariables,
  CURRENT_FORMAT_VERSION,
} from "./markdown.js";
import { resolveRunValues } from "./variables.js";
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
  /** The case as a first-time runner meets it — resolved with no page
   * behind the run, defaults applied. Informational, never findings: the
   * measure of the cold-runner bar, not its police. */
  cold: {
    /** Manual steps whose substituted `Where:` opens with no page behind
     * it: absolute, or a local address. */
    navigableSteps: number;
    uiSteps: number;
    /** Variables that end a cold resolution empty — a `page-*` generator
     * with no page and no `Default:` to fall back to. */
    unresolved: string[];
    /** Domains and variables that reach the run with no value from the
     * case itself and none from the project's environments — the questions
     * the case would ask. Zero is the bar; each name here is a lint error
     * already listed above. */
    asks: string[];
    /** Names the case leaves to the environment: no `Default:`, no
     * generator, provided by `environments.json`. Fine, and worth
     * knowing — a run without an environment picked will ask for them. */
    fromEnvironment: string[];
  };
}

export interface LintOptions {
  expectProject?: string;
  /** Domain and variable names the project's environments provide (from
   * `environments.json`, every environment's contract). A variable with
   * no default and no generator is only an error when nothing here
   * supplies it. Undefined = the caller could not read the file, which
   * is not the same as an empty contract. */
  environmentNames?: string[];
}

/** An origin a domain's `Default:` may be: scheme + host, optional port,
 * nothing after. `localhost:3000` is accepted scheme-less because that is
 * how everyone writes it and the Go control adds `http://`. */
const ORIGIN = /^(https?:\/\/[^\s/]+|localhost(:\d+)?|127\.0\.0\.1(:\d+)?|\[::1\](:\d+)?)\/?$/i;
const ORIGIN_WITH_PATH = /^(https?:\/\/[^\s/]+|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)\/\S+$/i;

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

const UNMEASURABLE =
  /\b(quickly|properly|correctly|appropriately|as expected|successfully|normally|as usual|as before)\b/i;

/** A prerequisite, variable or step that says who the tester is in the
 * app. Deliberately loose: this guards the case that never mentions an
 * account at all, not the shape of the mention. */
const LOGIN_HINT = /\b(log(ged)?[ -]?in|sign(ed)?[ -]?in|account|credentials?|password)\b/i;

/** A named place in prose — `Reports page`, `Sync Console screen`. The
 * capitalised word is what keeps "the page reloads" from firing. */
const PLACE_NAME = /\b[A-Z][\w-]*\s+(page|screen|tab|dialog|modal|console|dashboard)\b/;

const PROSE_LINK = /\[[^\]\n]+\]\([^)\s]+\)/;
const PLACEHOLDER = /%[A-Za-z_][A-Za-z0-9_]*%/;

/** Data the tester is left to find mid-run — the phrases that stand where
 * an exact record or a variable should be. */
const UNPREPARED = /\b(an existing|any|some|a valid|of your choice|your own|appropriate)\b/i;

/** An address that opens with no page behind it — what a first-time runner
 * starting from a blank tab can actually click. The substituted document is
 * the cold run (defaults applied, page generators empty), so this runs on
 * it as-is. */
const COLD_OPENABLE = /^(https?:\/\/|localhost[:/]|127\.0\.0\.1[:/]|\[::1\])/i;

function stripCode(text: string): string {
  return text.replace(/`[^`]*`/g, " ");
}

export function lintCase(raw: string, options: LintOptions = {}): LintResult {
  const errors: LintFinding[] = [];
  const warnings: LintFinding[] = [];
  const createdAt = new Date().toISOString();
  const environmentNames = new Set(options.environmentNames ?? []);
  const environmentsKnown = options.environmentNames !== undefined;

  const declared = parseCaseDocument(raw, { version: "1", createdAt });
  const values = resolveRunValues(declared, {});
  const substituted = substituteVariables(raw, values);
  const doc = parseCaseDocument(substituted, { version: "1", createdAt });

  // --- the document parsed into something ---------------------------------

  if (!doc.title.trim()) {
    errors.push({ rule: "7", message: "No `# ` title line — the first heading is the case title." });
  }
  if (doc.steps.length === 0) {
    errors.push({ rule: "1", message: "No steps parsed. Check that `# Steps` (or `# Steps: <group>`) is a top-level heading and each step is `## `." });
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
  const declaredNames = new Set([
    ...declared.domains.map((d) => d.name),
    ...declared.variables.map((v) => v.name),
  ]);
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
      message: `%${name}% is used but never declared under \`# Domains\` or \`# Variables\`, so it stays literal in the run — a typo, or a missing declaration.`,
    });
  }

  // --- domains -------------------------------------------------------------

  // One namespace: `%APP%` is looked up in both sections, so a name in both
  // is two declarations racing for one placeholder.
  const domainNames = new Set(declared.domains.map((d) => d.name));
  for (const variable of declared.variables) {
    if (domainNames.has(variable.name)) {
      errors.push({
        rule: "2b",
        at: variable.name,
        message: `\`${variable.name}\` is declared under both \`# Domains\` and \`# Variables\`. An address is a domain; keep the one declaration.`,
      });
    }
  }
  for (const domain of declared.domains) {
    const def = domain.defaultValue?.trim() ?? "";
    if (!def) {
      warnings.push({
        rule: "2b",
        at: domain.name,
        message: `Domain \`${domain.name}\` has no \`Default:\`, so a run from a blank tab, the shared viewer and a downloaded copy have no address for it. Default it to the deployment the project normally tests against — the default environment's address.`,
      });
    } else if (ORIGIN_WITH_PATH.test(def)) {
      warnings.push({
        rule: "2b",
        at: domain.name,
        message: `Domain \`${domain.name}\` defaults to \`${def}\`, which carries a path. A domain is an origin — scheme, host, port — and routes go on the \`%${domain.name}%/…\` references instead.`,
      });
    } else if (!ORIGIN.test(def)) {
      errors.push({
        rule: "2b",
        at: domain.name,
        message: `Domain \`${domain.name}\` defaults to \`${def}\`, which is not an origin a browser can open. Write \`https://host\`, \`http://host:port\` or \`localhost:port\`.`,
      });
    }
  }
  if (declared.domains.length > 1) {
    const unmatched = declared.domains.filter((d) => !d.match?.trim()).map((d) => d.name);
    if (unmatched.length > 0) {
      warnings.push({
        rule: "2b",
        at: "Domains",
        message: `Several domains, and ${unmatched.map((n) => `\`${n}\``).join(", ")} ${unmatched.length === 1 ? "carries" : "carry"} no \`Match:\`. With a pattern per domain the panel can tell which deployment the open tab is; without one, only the main domain follows the tab, and a run started from the wrong tab starts on the wrong address.`,
      });
    }
  }

  if (doc.formatVersion && doc.formatVersion !== CURRENT_FORMAT_VERSION) {
    warnings.push({
      rule: "7",
      message: `@version is ${doc.formatVersion}; this parser implements ${CURRENT_FORMAT_VERSION}. Re-read the grammar before trusting anything below.`,
    });
  }
  for (const variable of declared.variables) {
    // Every value is Enloop's to resolve, never the tester's to type: a
    // default, a generator, or the environments file. A description
    // telling the tester where to look used to pass here; it no longer
    // does, because "look it up before you start" is still a question.
    if (!variable.defaultValue?.trim() && !variable.generator && !environmentNames.has(variable.name)) {
      errors.push({
        rule: "6",
        at: variable.name,
        message:
          "No `Default:`, no `Generator:`, and no environment provides it — the run would have to ask. Give it a default (a fixture from the repo, a value from the rules file), a generator, or record it per environment: `enloop-case.mjs environments <data folder> \"<project>\" --variable NAME --env <name> --set NAME=value`." +
          (environmentsKnown ? "" : " (Pass --data-dir so environments.json is consulted.)"),
      });
    }
    if (variable.name === "BASE_URL" || (variable.generator === "page-origin" && everyField.includes(`%${variable.name}%/`))) {
      warnings.push({
        rule: "2b",
        at: variable.name,
        message: `\`${variable.name}\` is an address written as a variable — the pre-domains form. Declare it under \`# Domains\` (first entry = main domain; \`Default:\` and \`Match:\` carry over, drop \`Generator:\`) so environments can set it and the panel treats it as an address.`,
      });
    }
    if (variable.match && !variable.generator?.startsWith("page-")) {
      warnings.push({
        rule: "6",
        at: variable.name,
        message:
          "`Match:` gates what a page generator may read, and this variable has no page-* generator — the pattern never applies.",
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

  // --- the cold start ------------------------------------------------------

  // Whether someone who has never opened the app can click their way in: an
  // environment to resolve addresses against, a default for when no page is
  // behind the run, and an account to be.
  const namesAddresses =
    declared.steps.some((s) => ADDRESS.test(s.where?.trim() ?? "")) ||
    declared.prerequisites.some((p) => OPENS_SOMEWHERE.test(p));
  if (namesAddresses && declared.domains.length === 0 && !declaredNames.has("BASE_URL")) {
    warnings.push({
      rule: "2b",
      at: "Domains",
      message:
        "The case names addresses but declares no `# Domains`. Declare the deployment(s) it touches — `## APP` with a `Default:` origin — and build app addresses as `%APP%/…`; a literal absolute URL is right only for a page of a system the case does not otherwise name.",
    });
  }
  const mainDomain = declared.domains[0]?.name ?? (declaredNames.has("BASE_URL") ? "BASE_URL" : "APP");
  const saysWho =
    doc.prerequisites.some((p) => LOGIN_HINT.test(p)) ||
    declared.variables.some((v) => LOGIN_HINT.test(`${v.name} ${v.description}`)) ||
    doc.steps.some((s) => LOGIN_HINT.test(`${s.title} ${s.instructions ?? ""}`));
  if (!saysWho && doc.steps.some((s) => s.type === "manual")) {
    warnings.push({
      rule: "2d",
      at: "Prerequisites",
      message:
        "Nothing says who the tester is in the app — no prerequisite or variable mentions an account or a login. Name the account and where its credential lives, or answer that the app needs no login.",
    });
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
        message: `Bare route in a prerequisite: "${item.trim()}". This block has no open page to resolve against — use an absolute URL or %${mainDomain}%/….`,
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
  for (const [index, step] of doc.steps.entries()) {
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
    } else if (where.startsWith("/")) {
      warnings.push({
        rule: "2b",
        at: step.title,
        message: `\`Where: ${where}\` is a bare route — it resolves against the main domain in the panel and nowhere else. \`%${mainDomain}%${where}\` works from anywhere, and says which domain.`,
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

    if (step.type === "manual") {
      // The pre-substitution step, for what disappears when values resolve:
      // a placeholder in prose is an address-in-waiting, not a missing one.
      const declaredInstructions = declared.steps[index]?.instructions ?? "";
      const place = PLACE_NAME.exec(stripCode(instructions));
      if (place && !PROSE_LINK.test(declaredInstructions) && !PLACEHOLDER.test(declaredInstructions)) {
        warnings.push({
          rule: "2c",
          at: step.title,
          message: `"${place[0]}" is a named place with no address beside it — link it, or answer that it has none.`,
        });
      }
      const vague = UNPREPARED.exec(stripCode(instructions));
      if (vague) {
        warnings.push({
          rule: "6",
          at: step.title,
          message: `"${vague[0]}" leaves the tester to find test data mid-run. Name the exact record, or declare a variable that says how to obtain the value.`,
        });
      }
      for (const [label, text] of [
        ["the instructions", instructions],
        ["`### Expected`", expected],
      ] as const) {
        const bare = BARE_ROUTE_IN_PROSE.exec(stripCode(text));
        if (bare) {
          warnings.push({
            rule: "2c",
            at: step.title,
            message: `Bare route in ${label} ("${bare[0].trim()}") — a bare route is not a link anywhere the case renders. Make it \`%BASE_URL%\`-absolute.`,
          });
        }
      }
    }
  }

  // --- groups --------------------------------------------------------------

  // A group is a heading plus a goal plus steps; missing any of the three
  // it is a heading over nothing, and a reader is told a concern exists
  // that the case never proves.
  for (const group of doc.groups) {
    if (!group.goal.trim()) {
      errors.push({
        rule: "9",
        at: group.title,
        message: `\`# Steps: ${group.title}\` has no goal. Under the heading, before the first step, say what its steps prove together.`,
      });
    }
    if (!doc.steps.some((s) => s.group === group.title)) {
      errors.push({ rule: "9", at: group.title, message: "The group has no steps under it." });
    }
  }
  const groupHeadings = [...substituted.matchAll(/^# Steps:[ \t]*(.+?)[ \t]*$/gim)].map((m) => m[1]);
  for (const title of new Set(groupHeadings.filter((t, i) => groupHeadings.indexOf(t) !== i))) {
    errors.push({
      rule: "9",
      at: title,
      message: "This group heading appears twice. A group's steps sit together under one heading; merge them or name the second group differently.",
    });
  }
  if (doc.groups.length === 1 && doc.steps.every((s) => s.group)) {
    warnings.push({
      rule: "9",
      at: doc.groups[0].title,
      message: "Every step is in the one group, so the group is the case. Groups earn their headings when a case has several concerns; otherwise use a plain `# Steps` and let the description carry the goal.",
    });
  }

  // --- the quick subset is a document of its own ---------------------------

  let quickParses = true;
  if (quickMarked > 0) {
    try {
      const quickDoc = parseCaseDocument(filterToQuickSteps(substituted), { version: "1", createdAt });
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
  if (doc.steps[0]?.extra) {
    warnings.push({
      rule: "3b",
      at: doc.steps[0].title,
      message: "The first step is `Kind: extra`, so it numbers 0.1 — an optional check before any ordinary step exists. Put an ordinary step first, or unmark it.",
    });
  }

  // --- the cold-run readout ------------------------------------------------

  // `doc` is already the cold run — resolved with no page behind it, defaults
  // applied, page generators empty — so measuring it is free.
  const uiSteps = doc.steps.filter((s) => s.type === "manual");
  const navigableSteps = uiSteps.filter((s) => {
    const w = s.where?.trim() ?? "";
    return COLD_OPENABLE.test(w) && !/\s/.test(w);
  }).length;
  const fromEnvironment = [...declared.domains, ...declared.variables]
    .filter((v) => environmentNames.has(v.name))
    .map((v) => v.name);
  const asks = declared.variables
    .filter((v) => !v.defaultValue?.trim() && !v.generator && !environmentNames.has(v.name))
    .map((v) => v.name);
  const unresolved = [
    ...declared.domains.filter((d) => !(values[d.name] ?? "").trim() && !environmentNames.has(d.name)),
    ...declared.variables.filter((v) => v.generator && !(values[v.name] ?? "").trim()),
  ].map((v) => v.name);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    doc,
    quick: { marked: quickMarked, total: doc.steps.length, parses: quickParses },
    cold: { navigableSteps, uiSteps: uiSteps.length, unresolved, asks, fromEnvironment },
  };
}

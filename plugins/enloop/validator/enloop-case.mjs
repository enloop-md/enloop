#!/usr/bin/env node
/**
 * Enloop's case validator — the real parser, shipped with the plugin.
 *
 * Authoring happens inside the app under test, where the Enloop repo does not
 * exist, `npm install` has never run, and asking a user to clone something
 * before they can write a test case is the wrong answer. So the parser and the
 * linter travel with the skills as `lib.mjs`, bundled with no dependencies,
 * and this is the command the authoring skills run:
 *
 *   node enloop-case.mjs validate <case.md> [--project <name>] [--data-dir <folder>] [--findings-only]
 *   node enloop-case.mjs write <case.md> --data-dir <folder>   validate, then land it
 *                        [--project <name>] [--case <id> [--patch]] [--suite <suiteId>]
 *   node enloop-case.mjs environments <data folder> "<project>"   the deployments cases run
 *                        [--domain NAME] [--variable NAME]         against: read, or record
 *                        [--env <name> [--set NAME=value]...] [--default <name>]
 *   node enloop-case.mjs compat <old.md> <new.md>      can new replace old under a live run
 *   node enloop-case.mjs agent-status <data folder>    is any server watching the channel
 *   node enloop-case.mjs brief [--example]             the floor: a clean minimal case + the rules
 *   node enloop-case.mjs data-folder [--want <path>]   where this repo's cases go
 *   node enloop-case.mjs verify <data folder> <caseId> did the case land right
 *   node enloop-case.mjs rules <data folder> <project> this project's authoring rules
 *   node enloop-case.mjs ratings <data folder> <project> what testers starred: exemplary
 *                        [--limit N] [--min-runs N]           and poor steps, case ratings
 *   node enloop-case.mjs id "Project: Case title"      the case folder's id
 *   node enloop-case.mjs version                       the grammar format version
 *
 * `validate` exits 1 when something is certainly wrong and 0 when the only
 * findings are ones a human has to judge. Read the warnings either way; they
 * are the half of the step contract a machine cannot decide, and a case that
 * ships with them unread is exactly what the contract exists to prevent.
 *
 * Every command is here rather than in prose in the skills for one reason: an
 * instruction an agent has to follow costs its full length in context on every
 * single authoring session, and gets followed approximately. A command costs
 * its output, once, and does the same thing every time.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  lintCase,
  newTestCaseId,
  stepNumberLabels,
  nextMajorId,
  nextMinorId,
  versionIdFromFileName,
  withViewerComment,
  AGENT_PROTOCOL_VERSION,
  CURRENT_FORMAT_VERSION,
  environmentsFileSchema,
  emptyEnvironments,
  environmentsForProject,
  missingEnvironmentValues,
  newEnvironmentId,
  parseCaseDocument,
  runFileSchema,
  describeRating,
  isExemplaryRating,
  isPoorRating,
  ratingStars,
} from "./lib.mjs";

const [command, ...rest] = process.argv.slice(2);

function die(message) {
  console.error(message);
  process.exit(2);
}

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

/** `environments.json` at the data folder root, or an empty file when it
 * is absent or unreadable — the same degradation the panel applies. The
 * second value says which it was, because "no environments" and "could not
 * look" mean different things to the linter. */
function readEnvironments(dataDir) {
  const file = path.join(path.resolve(dataDir), "environments.json");
  try {
    const parsed = environmentsFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return { file, data: parsed.success ? parsed.data : emptyEnvironments(), known: parsed.success };
  } catch {
    return { file, data: emptyEnvironments(), known: isDir(dataDir) };
  }
}

/** The names a case may leave to its environments: the folder's whole
 * contract, since every environment has the same shape by construction. */
function environmentNamesOf(env) {
  return env.known ? [...env.data.domains, ...env.data.variables] : undefined;
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function entries(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

/**
 * The text of one step as it sits in a case file: from its `## title` line
 * under `# Steps` to the line before the next heading. `occurrence` picks
 * among steps that share a title. Text, not a re-render: the reader of a
 * rating wants the step exactly as the tester met it.
 */
function sliceStepSource(markdown, title, occurrence = 0) {
  const lines = markdown.split(/\r?\n/);
  let inSteps = false;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^# /.test(line)) {
      inSteps = /^# steps(?::.*)?$/i.test(line);
      continue;
    }
    if (!inSteps || !/^## /.test(line) || line.slice(3).trim() !== title) continue;
    if (seen++ < occurrence) continue;
    const block = [line];
    for (let j = i + 1; j < lines.length && !/^#{1,2} /.test(lines[j]); j++) block.push(lines[j]);
    return block.join("\n");
  }
  return `## ${title}\n(step text not found in the frozen case)`;
}

function show(label, findings) {
  if (findings.length === 0) return;
  console.log(`\n${label}`);
  for (const f of findings) {
    const at = f.at ? ` [${f.at}]` : "";
    console.log(`  (rule ${f.rule})${at} ${f.message}`);
  }
}

/** The cold-run readout, one line — printed by `validate` and repeated by
 * `write` so the landing report carries it without a second run. */
function coldLine(cold) {
  return (
    `cold run    ${cold.navigableSteps}/${cold.uiSteps} steps one-click · ` +
    `asks ${cold.asks.length} value${cold.asks.length === 1 ? "" : "s"} before start` +
    `${cold.asks.length ? ` (${cold.asks.join(", ")})` : ""} · ` +
    `unresolved: ${cold.unresolved.length ? cold.unresolved.join(", ") : "none"}` +
    `${cold.fromEnvironment?.length ? ` · from environment: ${cold.fromEnvironment.join(", ")}` : ""}`
  );
}

/** Which level of the layout `dir` names — shared by `data-folder`, which
 * reports it, and `write`, which corrects it before touching disk. */
function levelOf(dir) {
  const d = path.resolve(dir).replace(/\/+$/, "");
  if (["test-cases", "runs", "free-runs"].some((sub) => isDir(path.join(d, sub)))) {
    return { dir: d, state: "data" };
  }
  const parent = path.dirname(d);
  if (isDir(path.join(parent, "runs")) || isDir(path.join(parent, "free-runs"))) {
    return { dir: parent, state: "deep" };
  }
  // A fresh setup with cases written but nothing yet run has no `runs/`
  // sibling to detect. The giveaway is `<caseId>/versions/` children —
  // meaning this *is* `test-cases`, not the folder above it.
  if (entries(d).some((e) => isDir(path.join(d, e, "versions")))) {
    return { dir: parent, state: "deep" };
  }
  if (entries(d).length === 0) return { dir: d, state: "empty" };
  return { dir: d, state: "unrecognised" };
}

switch (command) {
  /**
   * Parse, lint, and show the document as the parser sees it.
   *
   * The parsed dump is the point of the first run: it is where a mis-indented
   * `Selector:` shows up as body prose and where two fallback selectors that
   * silently collapsed into one become visible. It is *not* the point of the
   * fourth run — by then the author has read it, and re-printing a 13-step
   * case costs more than every instruction in the skill put together. Hence
   * `--findings-only`: same checks, same exit code, just the part that
   * changed.
   */
  case "validate": {
    let file;
    for (let i = 0; i < rest.length && !file; i++) {
      // Skip flags, and skip the value belonging to the one flag that takes
      // one — otherwise a `--project Acme` makes Acme look like the filename.
      if (rest[i].startsWith("--")) {
        if (rest[i] === "--project" || rest[i] === "--data-dir") i++;
        continue;
      }
      file = rest[i];
    }
    if (!file) {
      die("usage: enloop-case.mjs validate <case.md> [--project <name>] [--data-dir <folder>] [--findings-only]");
    }
    const expectProject = flag("project");
    const findingsOnly = rest.includes("--findings-only");
    // Without the folder the linter cannot see which names the project's
    // environments provide, and reports every environment-supplied
    // variable as a question the case would ask.
    const environmentNames = flag("data-dir") ? environmentNamesOf(readEnvironments(flag("data-dir"))) : undefined;

    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch (e) {
      die(`Cannot read ${file}: ${e.message}`);
    }

    // A file that is not a case at all throws out of the parser. That is a
    // finding about the document, so it is reported like one — a Node stack
    // trace says nothing an author can act on and buries the one line that
    // does.
    let result;
    try {
      result = lintCase(raw, { expectProject, environmentNames });
    } catch (e) {
      console.error(`Cannot parse ${file}: ${e.message}`);
      process.exit(1);
    }
    const { doc, quick } = result;

    console.log(`title       ${doc.title}`);
    console.log(`project     ${doc.project || "(none)"}`);
    console.log(
      `format      @version ${doc.formatVersion || "(none)"} (parser is ${CURRENT_FORMAT_VERSION})`,
    );
    console.log(
      `counts      ${doc.steps.length} steps, ${quick.marked} marked quick, ` +
        `${doc.domains.length} domains, ${doc.variables.length} variables, ` +
        `${doc.dependencies.length} dependencies, ${doc.prerequisites.length} prerequisites`,
    );
    if (doc.domains.length > 0) {
      console.log(
        `domains     ${doc.domains.map((d, i) => `${d.name}${i === 0 ? " (main)" : ""}=${d.defaultValue ?? "(no default)"}`).join(", ")}`,
      );
    }
    // The measure of the cold-runner bar: what someone starting from a blank
    // tab can click, and what the case will ask them for first. Printed even
    // with --findings-only — a fix that costs a one-click step should show up
    // in the line, not slip past it.
    console.log(coldLine(result.cold));

    if (!findingsOnly) {
      if (doc.prerequisites.length > 0) {
        console.log("\nprerequisites");
        for (const p of doc.prerequisites) console.log(`  - ${p}`);
      }

      console.log("\nsteps as parsed");
      // The same labels every renderer uses: extra steps as minor increments
      // (2.1, 2.2), so what this prints is what the tester will see.
      const labels = stepNumberLabels(doc.steps);
      for (const [i, s] of doc.steps.entries()) {
        console.log(
          `  ${labels[i]}. ${s.title}${s.quick ? "  [quick]" : ""}${s.extra ? "  [extra]" : ""}${s.type === "automated" ? "  [automated]" : ""}`,
        );
        console.log(`     where     ${s.where ?? "(none)"}`);
        console.log(`     selectors ${s.selectors.length ? JSON.stringify(s.selectors) : "(none)"}`);
        console.log(
          `     expected  ${s.expected ? s.expected.replace(/\n/g, "\n               ") : "(none)"}`,
        );
        if (s.note) console.log(`     note      ${s.note.replace(/\n/g, "\n               ")}`);
      }
    }

    show("ERRORS — the document is wrong, fix before writing it", result.errors);
    show("WARNINGS — you decide; each one is a judgement the contract leaves open", result.warnings);

    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log(
        "\nNo findings. Still walk the by-eye list in step-contract.md for what only source can settle: invented labels, routes and selectors.",
      );
    }
    process.exit(result.ok ? 0 : 1);
  }

  /**
   * Can <new> replace <old> under a live run? The structural half only: same
   * step count, plus a per-step SAME/CHANGED report. Whether a CHANGED step
   * is allowed to change — whether the run has executed it yet — is the
   * caller's knowledge: the serve skill reads run.json, and the extension
   * re-verifies on its own before offering the swap. Exit 0 when counts
   * match regardless of CHANGED lines; 1 when they differ.
   */
  case "compat": {
    const files = rest.filter((a) => !a.startsWith("--"));
    if (files.length !== 2) die("usage: enloop-case.mjs compat <old.md> <new.md>");
    const docs = files.map((file) => {
      let raw;
      try {
        raw = readFileSync(file, "utf8");
      } catch (e) {
        die(`Cannot read ${file}: ${e.message}`);
      }
      try {
        return lintCase(raw).doc;
      } catch (e) {
        die(`Cannot parse ${file}: ${e.message}`);
      }
    });
    const [oldDoc, newDoc] = docs;
    console.log(`steps    ${oldDoc.steps.length} → ${newDoc.steps.length}`);
    if (oldDoc.steps.length !== newDoc.steps.length) {
      console.log("verdict  INCOMPATIBLE: step count changed");
      process.exit(1);
    }
    const norm = (v) => v ?? "";
    const changed = [];
    for (const [i, a] of oldDoc.steps.entries()) {
      const b = newDoc.steps[i];
      const diff = [];
      for (const field of ["title", "type", "instructions", "expected", "note", "script", "where"]) {
        if (norm(a[field]) !== norm(b[field])) diff.push(field);
      }
      if (a.quick !== b.quick) diff.push("quick");
      if (a.extra !== b.extra) diff.push("extra");
      if (JSON.stringify(a.selectors) !== JSON.stringify(b.selectors)) diff.push("selectors");
      if (diff.length === 0) {
        console.log(`${a.id}   SAME    ${a.title}`);
      } else {
        console.log(`${a.id}   CHANGED ${a.title}   (${diff.join(", ")})`);
        changed.push(a.id);
      }
    }
    console.log(
      changed.length === 0
        ? "verdict  IDENTICAL"
        : `verdict  COMPATIBLE-IF-UNRUN ${changed.join(", ")} — every CHANGED step must still be pending in the run`,
    );
    process.exit(0);
  }

  /**
   * Validate, then land — the only road into the folder.
   *
   * Landing a case used to be five model-sequenced steps: resolve the
   * folder level, derive the id, make the directories, write `meta.json`,
   * write the version file. Every one was a separate chance to skip or
   * improvise, and the layout was taught in prose precisely so it could be
   * hand-built wrong. This command owns the whole of it, writes nothing
   * when validation errors, and holds on any agent — including ones with
   * no hook to catch a stray Write.
   */
  case "write": {
    let file;
    const VALUED = new Set(["--data-dir", "--project", "--case", "--suite"]);
    for (let i = 0; i < rest.length && !file; i++) {
      if (rest[i].startsWith("--")) {
        if (VALUED.has(rest[i])) i++;
        continue;
      }
      file = rest[i];
    }
    const dataDirArg = flag("data-dir");
    if (!file || !dataDirArg) {
      die(
        "usage: enloop-case.mjs write <case.md> --data-dir <folder> [--project <name>] [--case <id> [--patch]] [--suite <suiteId>]",
      );
    }
    const intoCase = flag("case");
    const asPatch = rest.includes("--patch");
    const intoSuite = flag("suite");

    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch (e) {
      die(`Cannot read ${file}: ${e.message}`);
    }
    // The file lands with a viewer link inside it, so the person who asked
    // for the case can open it in the next ten seconds with nothing
    // installed. The parser strips the comment on every read, so the link
    // is never part of the case.
    raw = await withViewerComment(raw);
    const viewer = /https:\/\/\S+#c=\S+/.exec(raw)?.[0] ?? "";

    let result;
    try {
      result = lintCase(raw, {
        expectProject: flag("project"),
        environmentNames: environmentNamesOf(readEnvironments(dataDirArg)),
      });
    } catch (e) {
      console.error(`Cannot parse ${file}: ${e.message}`);
      console.error("Nothing was written.");
      process.exit(1);
    }
    show("ERRORS — nothing was written; fix these and re-run", result.errors);
    show("WARNINGS — you decide; each one is a judgement the contract leaves open", result.warnings);
    if (!result.ok) process.exit(1);

    if (!isDir(dataDirArg)) {
      console.error(
        `REFUSED  ${path.resolve(dataDirArg)} does not exist — resolve it with data-folder first. Nothing was written.`,
      );
      process.exit(1);
    }
    if (asPatch && !intoCase) {
      die("--patch needs --case <id>: a minor is a patch of an existing case's current version");
    }
    const resolved = levelOf(dataDirArg);
    if (resolved.state === "unrecognised") {
      console.error(
        `REFUSED  ${resolved.dir} has no Enloop layout in it — probably the wrong path. Nothing was written.`,
      );
      process.exit(1);
    }
    if (resolved.state === "deep") {
      console.log(`note     path pointed one level too deep; corrected to ${resolved.dir}`);
    }
    const casesRoot = path.join(resolved.dir, "test-cases");
    mkdirSync(casesRoot, { recursive: true });

    let versionFile;
    let landed;
    if (intoCase) {
      // The case may sit at the top level or inside a suite.
      const candidates = [
        path.join(casesRoot, intoCase),
        ...entries(casesRoot).map((e) => path.join(casesRoot, e, intoCase)),
      ];
      const caseDir = candidates.find((c) => isDir(path.join(c, "versions")));
      if (!caseDir) {
        console.error(`REFUSED  no case ${intoCase} under ${casesRoot}. Nothing was written.`);
        process.exit(1);
      }
      const ids = entries(path.join(caseDir, "versions"))
        .map((f) => versionIdFromFileName(f))
        .filter(Boolean);
      // Authoring lands the next major (v3), leaving any minors behind; a
      // mid-run patch (--patch, the serve path) lands the next minor of
      // whatever is current (v3 -> v3.1, v3.1 -> v3.2).
      const next = asPatch ? nextMinorId(ids) : nextMajorId(ids);
      versionFile = path.join(caseDir, "versions", `v${next}.md`);
      landed = `v${next} of ${intoCase}`;
    } else {
      let parent = casesRoot;
      if (intoSuite) {
        parent = path.join(casesRoot, intoSuite);
        if (!isDir(parent) || entries(parent).every((e) => e !== "suite.md")) {
          console.error(`REFUSED  ${parent} is not a suite (no suite.md). Nothing was written.`);
          process.exit(1);
        }
      }
      const id = newTestCaseId(result.doc.title);
      const caseDir = path.join(parent, id);
      mkdirSync(path.join(caseDir, "versions"), { recursive: true });
      const metaFile = path.join(caseDir, "meta.json");
      if (!entries(caseDir).includes("meta.json")) {
        writeFileSync(metaFile, `${JSON.stringify({ archived: false }, null, 2)}\n`, "utf8");
      }
      versionFile = path.join(caseDir, "versions", "v1.md");
      landed = id;
    }
    if (isDir(versionFile) || entries(path.dirname(versionFile)).includes(path.basename(versionFile))) {
      console.error(`REFUSED  ${versionFile} already exists. Nothing was written.`);
      process.exit(1);
    }
    writeFileSync(versionFile, raw, "utf8");

    console.log(`WROTE    ${versionFile}`);
    console.log(`landed   ${landed}`);
    if (viewer) console.log(`viewer   ${viewer}`);
    console.log(coldLine(result.cold));
    console.log("It appears in the Library on the panel's next refresh (⟳).");
    process.exit(0);
  }

  /**
   * The floor, pushed into context.
   *
   * The skills are pointers by design — the grammar, the contract and the
   * procedure live in files a session is told to read. A capable model
   * follows the pointers; a weak one writes from whatever is already in
   * front of it, which is how a case with no `# Steps` heading happens.
   * `brief` makes "whatever is in front of it" sufficient: one command
   * prints a minimal case that parses clean plus the rules that bind every
   * step. `--example` prints only the case, so a test can pipe it into
   * `validate` and fail the day it drifts from the grammar.
   */
  case "brief": {
    const example = `# Example: Save a widget
@version ${CURRENT_FORMAT_VERSION}
@project Example
@locations: localhost:3000, *.example.test
Goal: An admin can save a widget and see it listed
You will: fill in one form and check the table

Verifies the widget save path — and the shape of a minimal case.

# You will need
- Nothing beyond the browser: the account is in the case.

# Variables

## QA_EMAIL
The QA account — provided per environment (environments.json).
Default: qa.bot@example.test

## QA_PASSWORD
The QA account's password — provided per environment (environments.json).
Default: qa-bot-staging

# Prerequisites
- Open %DOMAIN%/admin/widgets
- Logged in as "**%QA_EMAIL%**", password "**%QA_PASSWORD%**"

# Steps

## Save the widget
Where: %DOMAIN%/admin/widgets
Kind: quick
Selector: [data-testid="save-widget"]
Put "**Blue widget**" in the \`Name\` field and click \`Save\`.

### Expected
- A \`Saved\` toast appears.
- The table lists \`Blue widget\`.`;

    if (rest.includes("--example")) {
      console.log(example);
      break;
    }
    console.log(`Enloop case brief — format ${CURRENT_FORMAT_VERSION}

A case is one Markdown file. The minimal valid shape, whole:

${example}

The hard rules — the step contract in one breath:

  0   A case is a goal. Goal: and You will: under the title, one line
      each, required; # You will need lists what the tester must have in
      hand before step 1.
  1   One step = one action = one verdict. No "then" in instructions.
  2   Every place is an address: %DOMAIN%/route in Where:, prerequisites
      and links. %DOMAIN% needs no declaration — it follows the tab the
      run starts from — and @locations: under the title names the hosts
      the case is meant for (\`localhost:3000, *.example.test\`), taken
      from the project's environments (\`environments <folder>
      "<project>"\`). Declare a domain under # Domains only for a second
      host the case touches: %DOMAIN%/orders, then %ADMIN%/audit.
      A value the run itself produces — a created record's id — never
      goes in an address: say where to click, give the shape in backticks.
  2d  Say who the tester is: account, role, and where the credential lives
      — a place to look, never a person to ask.
  3   Every UI step carries a Selector: read from this repo's source.
      Never invented, never a structural path.
  4   ### Expected is observable, binary bullets. Rationale goes to ### Note.
  6   Every value is resolved by Enloop before the run — a Default:, a
      Generator:, or the environments file — and never asked of the tester
      or the user. Values to type as "**value**", labels to find in
      \`backticks\`.
  7   No conditionals inside a step — a condition becomes its own step.
  8   Clean up what the run leaves behind, or say why not in a ### Note.
  9   A case with several concerns groups its steps: \`# Steps: <title>\`
      sections, each opening with its goal — what those steps prove
      together — before the first \`## \` step. Numbering runs through.

Every route, label and selector comes from source read in THIS session.

Iterate, then land — nothing reaches the folder any other way:

  node enloop-case.mjs validate <file> --data-dir <folder> --findings-only
  node enloop-case.mjs write <file> --data-dir <folder> --project "<name>"

The full grammar:  references/grammar.md, beside this validator
The contract:      references/step-contract.md
The procedure:     references/authoring.md — binding, brief or no brief`);
    break;
  }

  /**
   * Which folder this repo's cases belong in, and which level of it a path
   * named.
   *
   * Both questions are silent when wrong: a case in the wrong folder is a case
   * in another project's Library, and a case at the wrong level does not exist
   * as far as `FsaDataStore` is concerned. They were prose for an agent to
   * follow — two shell snippets and four branches of interpretation — which is
   * a resolution algorithm being executed by a language model on every single
   * authoring run.
   *
   * What is left to the model is the part that is genuinely a judgement: when
   * two candidates disagree, or nothing answers, this prints what it found and
   * exits non-zero so the skill has to ask rather than guess.
   */
  case "data-folder": {
    const want = flag("want");
    let root = process.cwd();
    try {
      root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // Not a git repo. The cwd is the best guess available.
    }

    const cases = (dataDir) =>
      entries(path.join(dataDir, "test-cases")).filter((e) =>
        isDir(path.join(dataDir, "test-cases", e)),
      ).length;

    const describe = (c) => {
      const notes = [];
      if (c.state === "deep") notes.push("path pointed one level too deep; corrected to the parent");
      if (c.state === "empty") notes.push("empty — create test-cases/ inside it and say that you did");
      if (c.state === "unrecognised") notes.push("no Enloop layout in it — probably the wrong path");
      if (c.state === "data") {
        const n = cases(c.dir);
        notes.push(`${n} case${n === 1 ? "" : "s"}`);
      }
      return `  ${c.dir}\n      ${c.origin}${notes.length ? ` — ${notes.join("; ")}` : ""}`;
    };

    // What the user said in this request settles it outright. That is how a
    // case goes somewhere other than the usual place without reconfiguring
    // anything.
    if (want) {
      if (!isDir(want)) {
        console.log(`NONE — ${path.resolve(want)} does not exist. Confirm the path before creating it.`);
        process.exit(1);
      }
      const resolved = levelOf(want);
      console.log(`RESOLVED ${resolved.dir}`);
      console.log(describe({ ...resolved, origin: "named in the request" }));
      console.log(`  write   ${path.join(resolved.dir, "test-cases", "<caseId>", "versions", "v1.md")}`);
      process.exit(0);
    }

    const candidates = [];
    const envValue = process.env.ENLOOP_DATA_DIR || process.env.ENLOOP_CASES_DIR || "";
    const envName = process.env.ENLOOP_DATA_DIR ? "ENLOOP_DATA_DIR" : "ENLOOP_CASES_DIR";
    if (envValue && !isDir(envValue)) {
      console.log(`$${envName} is set to ${envValue}, which is not a directory.`);
    } else if (envValue) {
      candidates.push({ ...levelOf(envValue), origin: `$${envName}` });
    }

    // A folder inside the repo is the shape to prefer when it exists: cases
    // are committed with the code they test, they arrive with a clone, and
    // nothing has to be configured per machine.
    for (const name of ["enloop", "test-cases", ".enloop"]) {
      const dir = path.join(root, name);
      if (!isDir(dir)) continue;
      const found = levelOf(dir);
      if (found.state === "unrecognised" || found.state === "empty") continue;
      if (candidates.some((c) => c.dir === found.dir)) continue;
      candidates.push({ ...found, origin: `in-repo folder (${path.relative(root, dir) || name}/)` });
    }

    const distinct = [...new Set(candidates.map((c) => c.dir))];

    if (distinct.length === 1) {
      console.log(`RESOLVED ${distinct[0]}`);
      for (const c of candidates) console.log(describe(c));
      console.log(`  write   ${path.join(distinct[0], "test-cases", "<caseId>", "versions", "v1.md")}`);
      process.exit(0);
    }

    if (distinct.length > 1) {
      // A genuine conflict rather than an error: the user may have a
      // per-project folder and a shared one and mean either.
      console.log("AMBIGUOUS — ask which, naming both paths and what each holds:");
      for (const c of candidates) console.log(describe(c));
      process.exit(1);
    }

    console.log("NONE — nothing names a data folder for this repo. Ask; do not fall back to a default.");
    console.log(`  offer   ${path.join(root, "enloop")} (in-repo, keeps cases with the code)`);
    console.log("  offer   to record the answer, so this is asked once per repo");
    process.exit(1);
  }

  /**
   * Did the case land where the extension will find it?
   *
   * Writing one level off fails silently — no error, and the case simply never
   * appears in the Library. This is the loop-closer, and it is one command
   * because two `ls` calls and a paragraph explaining how to read them is the
   * kind of check that gets skipped.
   */
  case "verify": {
    const [dataDir, caseId] = rest.filter((a) => !a.startsWith("--"));
    if (!dataDir || !caseId) die("usage: enloop-case.mjs verify <data folder> <caseId>");

    const dir = path.resolve(dataDir).replace(/\/+$/, "");
    const versions = path.join(dir, "test-cases", caseId, "versions");
    const files = entries(versions).filter((f) => versionIdFromFileName(f) !== null);

    if (files.length > 0) {
      for (const f of files.sort()) console.log(`OK  ${path.join(versions, f)}`);
      process.exit(0);
    }
    if (isDir(path.join(dir, caseId))) {
      console.log(`WRONG LEVEL  ${path.join(dir, caseId)}`);
      console.log(`  Move it to ${path.join(dir, "test-cases", caseId)} and say so in your report.`);
      process.exit(1);
    }
    console.log(`MISSING  nothing at ${versions}`);
    console.log(`  ${dir} holds: ${entries(dir).join(", ") || "(nothing)"}`);
    process.exit(1);
  }

  /**
   * How cases for one app must be written, accumulated from the runs of them.
   *
   * A tester who says "this case should have started from the admin dashboard"
   * is sometimes reporting one broken case and sometimes stating a rule every
   * case for this app should follow. The second kind is worth more than the
   * fix, and had nowhere to live: it went into one case's next version and was
   * re-learned from scratch by the next case anybody wrote.
   *
   * It lives beside the cases rather than in the app repo because that is the
   * one place both halves can reach — the extension has a handle on the data
   * folder and nothing else, and an agent authoring from the app repo has this
   * command. One file per project, because a folder serves several.
   *
   * Reading and locating are the same command on purpose: an authoring skill
   * that has to be told a path is an authoring skill that will be told the
   * wrong one.
   */
  /**
   * The deployments this project's cases run against, and the values that
   * differ between them — `environments.json` at the data folder root, the
   * same file the panel's Environments screen edits and its run picker
   * reads. The authoring skills read it to learn the domain names and the
   * default addresses a case must carry, and write to it when they derive
   * a deployment from the repo (`.env.example`, deploy config, README), so
   * the answer is recorded once instead of asked per case.
   *
   *   environments <folder> "<project>"                      print
   *   … --domain APP [--domain ADMIN]                         add to the contract
   *   … --variable QA_EMAIL                                   add to the contract
   *   … --env staging --set APP=https://… --set QA_EMAIL=…    create/fill one
   *   … --env staging --default                               the cold-run one
   *
   * Names are uppercased to the placeholder convention; an existing
   * environment is matched by name within the project, case-insensitively.
   * Exit 0 with the file printed after any change.
   */
  case "environments": {
    const positional = [];
    const VALUED = new Set(["--domain", "--variable", "--env", "--set"]);
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].startsWith("--")) {
        if (VALUED.has(rest[i])) i++;
        continue;
      }
      positional.push(rest[i]);
    }
    const [dataDir, ...projectParts] = positional;
    const project = projectParts.join(" ").trim();
    if (!dataDir || !project) {
      die(
        'usage: enloop-case.mjs environments <data folder> "<project>" [--domain NAME]... [--variable NAME]... [--env <name> [--set NAME=value]... [--default]]',
      );
    }
    if (!isDir(dataDir)) die(`${path.resolve(dataDir)} is not a directory.`);
    const env = readEnvironments(dataDir);
    const data = env.data;
    const normalize = (raw) =>
      raw
        .trim()
        .replace(/^%|%$/g, "")
        .replace(/[^A-Za-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
    const repeated = (name) =>
      rest.flatMap((a, i) => (a === `--${name}` && rest[i + 1] ? [rest[i + 1]] : []));

    let changed = false;
    for (const raw of repeated("domain")) {
      const name = normalize(raw);
      if (name && !data.domains.includes(name)) {
        data.domains.push(name);
        changed = true;
      }
    }
    for (const raw of repeated("variable")) {
      const name = normalize(raw);
      if (name && !data.variables.includes(name)) {
        data.variables.push(name);
        changed = true;
      }
    }
    const envName = flag("env");
    if (envName) {
      let target = environmentsForProject(data, project).find(
        (e) => e.name.trim().toLowerCase() === envName.trim().toLowerCase(),
      );
      if (!target) {
        target = { id: newEnvironmentId(), name: envName.trim(), project, domains: {}, values: {} };
        data.environments.push(target);
        changed = true;
      }
      for (const pair of repeated("set")) {
        const eq = pair.indexOf("=");
        if (eq === -1) die(`--set expects NAME=value, got ${pair}`);
        const name = normalize(pair.slice(0, eq));
        const value = pair.slice(eq + 1).trim();
        if (!name) continue;
        // A name not yet in the contract joins it: a domain when the value
        // is an address, a variable otherwise — the skill said what it is
        // by what it set.
        if (!data.domains.includes(name) && !data.variables.includes(name)) {
          if (/^(https?:\/\/|localhost|127\.0\.0\.1)/i.test(value)) data.domains.push(name);
          else data.variables.push(name);
        }
        if (data.domains.includes(name)) target.domains[name] = value;
        else target.values[name] = value;
        changed = true;
      }
      if (rest.includes("--default")) {
        for (const e of data.environments) {
          if (e === target) e.default = true;
          else if (environmentsForProject({ ...data, environments: [e] }, project).length) delete e.default;
        }
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(env.file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      console.log(`WROTE    ${env.file}`);
    } else {
      console.log(`PATH     ${env.file}${env.known ? "" : " (absent — nothing recorded yet)"}`);
    }
    const mine = environmentsForProject(data, project);
    console.log(`domains  ${data.domains.length ? data.domains.map((d, i) => (i === 0 ? `${d} (main)` : d)).join(", ") : "(none declared)"}`);
    console.log(`variables ${data.variables.length ? data.variables.join(", ") : "(none declared)"}`);
    if (mine.length === 0) {
      console.log(`environments (none for ${project})`);
    }
    for (const e of mine) {
      const missing = missingEnvironmentValues(data, e);
      console.log(
        `env      ${e.name}${e.default ? " (default)" : ""}${e.project ? "" : " (all projects)"}${missing.length ? ` — ${missing.length} empty: ${missing.join(", ")}` : ""}`,
      );
      for (const d of data.domains) console.log(`           ${d}=${e.domains[d] ?? ""}`);
      for (const v of data.variables) console.log(`           ${v}=${e.values[v] ?? ""}`);
    }
    // The case-side consequence, spelled out so a skill need not derive it:
    // which environment's addresses become each domain's `Default:`.
    const cold = mine.find((e) => e.default) ?? mine[0];
    if (cold) {
      console.log(
        `defaults ${data.domains.map((d) => `${d}=${cold.domains[d] ?? "(empty)"}`).join(", ") || "(no domains)"} — from "${cold.name}"${cold.default ? "" : " (first listed; mark one --default)"}`,
      );
    }
    break;
  }

  case "rules": {
    const [dataDir, ...projectParts] = rest.filter((a) => !a.startsWith("--"));
    const project = projectParts.join(" ").trim();
    if (!dataDir || !project) die('usage: enloop-case.mjs rules <data folder> "<project>"');

    const slug = project
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const file = path.join(path.resolve(dataDir).replace(/\/+$/, ""), "rules", `${slug}.md`);
    console.log(`PATH ${file}`);
    try {
      console.log("");
      console.log(readFileSync(file, "utf8").trimEnd());
    } catch {
      console.log("");
      console.log(`(no rules recorded for ${project} yet)`);
    }
    break;
  }

  /**
   * What testers thought of this project's cases as test writing — the
   * one-to-five stars the panel records on a step and on a run, collected
   * across every run in the folder and grouped by project.
   *
   * Rules say what a case must do; this says what a good one looked like.
   * A step five testers starred is the shape the next case should take, and
   * the step they gave one star to is the shape to avoid, and neither used
   * to reach the next authoring session at all: it sat in one run's
   * `run.json` and was read by nobody. The authoring skills run this next
   * to `rules`, and the check skill uses it to tell a lone opinion from a
   * pattern before promoting one to a rule.
   *
   * Every rated step is printed with its text as the run froze it, since a
   * rating without the step is a number without a lesson. Values are the
   * substituted ones; `%NAME%` placeholders do not survive freezing.
   *
   *   ratings <folder> "<project>"       exemplary and poor steps, case ratings
   *   … --limit N                        at most N steps per list (default 6)
   *   … --min-runs N                     ignore a step rated in fewer runs
   *
   * Exit 0 always; `(no ratings recorded …)` is the normal answer for a
   * project whose testers have not starred anything yet.
   */
  case "ratings": {
    const positional = [];
    let limit = 6;
    let minRuns = 1;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--limit") limit = Math.max(1, Number(rest[++i]) || 6);
      else if (a === "--min-runs") minRuns = Math.max(1, Number(rest[++i]) || 1);
      else if (a.startsWith("--")) die(`ratings: unknown flag ${a}`);
      else positional.push(a);
    }
    const [dataDir, ...projectParts] = positional;
    const project = projectParts.join(" ").trim();
    if (!dataDir || !project) {
      die('usage: enloop-case.mjs ratings <data folder> "<project>" [--limit N] [--min-runs N]');
    }
    const dir = path.resolve(dataDir).replace(/\/+$/, "");
    const runsRoot = path.join(dir, "runs");
    const wanted = project.toLowerCase();

    // One entry per case, one per (case, step title): a step keeps its
    // title across versions far more reliably than its id, and a rating is
    // about the step as the tester met it, not about a version number.
    const cases = new Map();
    const steps = new Map();
    let scanned = 0;
    let matched = 0;
    for (const caseId of entries(runsRoot)) {
      for (const runId of entries(path.join(runsRoot, caseId))) {
        const runDir = path.join(runsRoot, caseId, runId);
        let run;
        let raw;
        try {
          run = runFileSchema.parse(JSON.parse(readFileSync(path.join(runDir, "run.json"), "utf8")));
          raw = readFileSync(path.join(runDir, "case.md"), "utf8");
        } catch {
          continue;
        }
        scanned++;
        let doc;
        try {
          doc = parseCaseDocument(raw, { version: run.testCaseVersion, createdAt: run.startedAt });
        } catch {
          continue;
        }
        if ((doc.project ?? "").trim().toLowerCase() !== wanted) continue;
        matched++;

        const c = cases.get(caseId) ?? { caseId, title: doc.title, ratings: [] };
        c.title = doc.title;
        if (run.rating != null) {
          c.ratings.push({
            rating: run.rating,
            version: run.testCaseVersion,
            at: run.startedAt,
            comment: run.comment.trim(),
          });
        }
        cases.set(caseId, c);

        const byId = new Map(run.steps.map((st) => [st.stepId, st]));
        const seen = new Map();
        doc.steps.forEach((step, index) => {
          const occurrence = seen.get(step.title) ?? 0;
          seen.set(step.title, occurrence + 1);
          const state = byId.get(step.id);
          if (!state || state.rating == null) return;
          const key = `${caseId}\n${step.title}`;
          const entry = steps.get(key) ?? {
            caseId,
            caseTitle: doc.title,
            title: step.title,
            ratings: [],
            latestAt: "",
            source: "",
            number: "",
            comments: [],
          };
          entry.ratings.push(state.rating);
          if (run.startedAt >= entry.latestAt) {
            entry.latestAt = run.startedAt;
            entry.source = sliceStepSource(raw, step.title, occurrence);
            entry.number = String(index + 1);
            entry.caseTitle = doc.title;
          }
          for (const comment of state.comments) {
            const text = (comment.text ?? "").trim();
            if (text) entry.comments.push(text);
          }
          const draft = (state.draft?.text ?? "").trim();
          if (draft) entry.comments.push(draft);
          steps.set(key, entry);
        });
      }
    }

    const avg = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length;
    const ratedCases = [...cases.values()].filter((c) => c.ratings.length > 0);
    const ratedSteps = [...steps.values()].filter((e) => e.ratings.length >= minRuns);
    // Recent runs last in a case's list, so the latest opinion is the one a
    // reader's eye lands on.
    for (const c of ratedCases) c.ratings.sort((a, b) => a.at.localeCompare(b.at));

    console.log(`PROJECT ${project}`);
    console.log(
      `${matched} ${matched === 1 ? "run" : "runs"} of this project in ${runsRoot} (${scanned} scanned)`,
    );
    if (ratedCases.length === 0 && ratedSteps.length === 0) {
      console.log("");
      console.log(`(no ratings recorded for ${project} yet)`);
      break;
    }

    if (ratedCases.length > 0) {
      console.log("");
      console.log("## Cases, as rated by testers");
      console.log("");
      ratedCases.sort((a, b) => avg(b.ratings.map((r) => r.rating)) - avg(a.ratings.map((r) => r.rating)));
      for (const c of ratedCases) {
        const mean = avg(c.ratings.map((r) => r.rating));
        const latest = c.ratings[c.ratings.length - 1];
        console.log(
          `- ${ratingStars(Math.floor(mean))} ${mean.toFixed(1)} over ${c.ratings.length} ${
            c.ratings.length === 1 ? "run" : "runs"
          } — ${c.title} (case ${c.caseId}, latest v${latest.version})`,
        );
        const why = c.ratings.map((r) => r.comment).filter(Boolean);
        for (const text of why.slice(-2)) console.log(`  > ${text}`);
      }
    }

    const byMeanDesc = (a, b) => avg(b.ratings) - avg(a.ratings) || b.latestAt.localeCompare(a.latestAt);
    const exemplary = ratedSteps.filter((e) => isExemplaryRating(avg(e.ratings))).sort(byMeanDesc);
    const poor = ratedSteps.filter((e) => isPoorRating(avg(e.ratings))).sort((a, b) => -byMeanDesc(a, b));

    const printSteps = (heading, lead, list) => {
      if (list.length === 0) return;
      console.log("");
      console.log(`## ${heading}`);
      console.log("");
      console.log(lead);
      for (const e of list.slice(0, limit)) {
        const mean = avg(e.ratings);
        console.log("");
        console.log(
          `### ${
            e.ratings.length > 1
              ? `${ratingStars(Math.floor(mean))} ${mean.toFixed(1)}/5 over ${e.ratings.length} runs`
              : describeRating(e.ratings[0])
          } — step ${e.number} of "${e.caseTitle}" (case ${e.caseId})`,
        );
        console.log("");
        console.log("```markdown");
        console.log(e.source.trimEnd());
        console.log("```");
        const unique = [...new Set(e.comments)];
        if (unique.length > 0) {
          console.log("");
          console.log("The tester said:");
          for (const text of unique.slice(0, 4)) console.log(`- ${text}`);
        }
      }
      if (list.length > limit) {
        console.log("");
        console.log(`(${list.length - limit} more; pass --limit to see them)`);
      }
    };

    printSteps(
      "Steps testers rated highly — write the next ones like these",
      "The shape, the level of detail, what the Expected line names. Learn the pattern; do not paste the step.",
      exemplary,
    );
    printSteps(
      "Steps testers rated poorly — do not repeat these",
      "What was wrong is in the tester's words where they left any; otherwise judge the step against the contract.",
      poor,
    );
    break;
  }

  /**
   * Is any server — the enloopd daemon or a recent manual serve pass —
   * watching this folder's agent channel? Deterministic: watcher files
   * younger than 3 minutes count, matching both sides' freshness window.
   * Exit 0 with WATCHING lines, exit 1 with NONE. The authoring skills run
   * this after landing a case so the user hears, once, that the panel's
   * Ask-the-agent and Run buttons need a server — before they find out by
   * waiting.
   */
  case "agent-status": {
    const dataDir = rest.find((a) => !a.startsWith("--"));
    if (!dataDir) die("usage: enloop-case.mjs agent-status <data folder>");
    const watchersDir = path.join(dataDir, "agent", "watchers");
    const FRESH_MS = 180_000;
    const fresh = [];
    for (const name of entries(watchersDir)) {
      try {
        const file = path.join(watchersDir, name);
        const age = Date.now() - statSync(file).mtimeMs;
        if (age > FRESH_MS) continue;
        const watcher = JSON.parse(readFileSync(file, "utf8"));
        const proto = watcher.protocol ?? 1;
        fresh.push(
          `WATCHING ${watcher.kind ?? "unknown"} (${watcher.id ?? name}, ${Math.round(age / 1000)}s ago)` +
            (proto !== AGENT_PROTOCOL_VERSION
              ? `  ⚠ speaks channel protocol v${proto}; this plugin speaks v${AGENT_PROTOCOL_VERSION} — update the older side`
              : ""),
        );
      } catch {
        // Unreadable watcher file — not presence.
      }
    }
    // The extension declares its wire version in the heartbeat body; a
    // mismatch means plugin and extension shipped apart.
    try {
      const hb = JSON.parse(readFileSync(path.join(dataDir, "agent", "heartbeat.json"), "utf8"));
      const proto = hb.protocol ?? 1;
      if (proto !== AGENT_PROTOCOL_VERSION) {
        console.log(
          `MISMATCH extension ${hb.extension ?? "unknown"} speaks channel protocol v${proto}; ` +
            `this plugin speaks v${AGENT_PROTOCOL_VERSION} — update the older side`,
        );
      }
    } catch {
      // No heartbeat yet — the panel has not used this folder's channel.
    }
    if (fresh.length > 0) {
      for (const line of fresh) console.log(line);
      process.exit(0);
    }
    console.log("NONE     no server is watching this folder's agent channel");
    console.log(
      "         The panel's Ask-the-agent and Run buttons will wait until the enloopd",
    );
    console.log(
      "         daemon runs (docs/daemon.md) or /enloop:serve is invoked manually.",
    );
    process.exit(1);
  }

  case "id": {
    const title = rest.join(" ").trim();
    if (!title) die('usage: enloop-case.mjs id "Project: Case title"');
    console.log(newTestCaseId(title));
    break;
  }

  case "version":
    console.log(CURRENT_FORMAT_VERSION);
    console.log(`channel protocol ${AGENT_PROTOCOL_VERSION}`);
    break;

  default:
    die(
      "usage:\n" +
        "  enloop-case.mjs validate <case.md> [--project <name>] [--data-dir <folder>] [--findings-only]\n" +
        "  enloop-case.mjs write <case.md> --data-dir <folder> [--project <name>] [--case <id> [--patch]] [--suite <suiteId>]\n" +
        "  enloop-case.mjs compat <old.md> <new.md>\n" +
        "  enloop-case.mjs agent-status <data folder>\n" +
        "  enloop-case.mjs brief [--example]\n" +
        "  enloop-case.mjs data-folder [--want <path>]\n" +
        "  enloop-case.mjs verify <data folder> <caseId>\n" +
        '  enloop-case.mjs environments <data folder> "<project>" [--domain NAME] [--variable NAME] [--env <name> [--set NAME=value] [--default]]\n' +
        '  enloop-case.mjs rules <data folder> "<project>"\n' +
        '  enloop-case.mjs ratings <data folder> "<project>" [--limit N] [--min-runs N]\n' +
        '  enloop-case.mjs id "Project: Case title"\n' +
        "  enloop-case.mjs version",
    );
}

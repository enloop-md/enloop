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
 *                        [--env <name> [--set NAME=value]...] [--default]
 *                        [--temporary | --until YYYY-MM-DD] [--production | --no-production]
 *                        [--reach tsh|command|manual|none …] [--tsh "<pasted>"] [--lookup NAME="select …"]
 *   node enloop-case.mjs reach <data folder> "<project>" [--env <name> | --all]   can this
 *                                                      machine get to the environment's data
 *   node enloop-case.mjs lookup <data folder> "<project>" [--env <name>]   find a value
 *                        (--variable NAME | --sql "select …" | --all)      on the deployment
 *                        [--record] [--production]
 *   node enloop-case.mjs compat <old.md> <new.md>      can new replace old under a live run
 *   node enloop-case.mjs agent-status <data folder>    is any server watching the channel
 *   node enloop-case.mjs brief [--example]             the floor: a clean minimal case + the rules
 *   node enloop-case.mjs data-folder [--want <path>]   where this repo's cases go
 *   node enloop-case.mjs verify <data folder> <caseId> did the case land right
 *   node enloop-case.mjs rules <data folder> <project> this project's authoring rules
 *   node enloop-case.mjs ratings <data folder> <project> what testers starred: exemplary
 *                        [--limit N] [--min-runs N]           and poor steps, case ratings
 *   node enloop-case.mjs list-guides <data folder>     finished runs worth exporting
 *                        [--project <name>]                 as a guide, newest first
 *   node enloop-case.mjs export-guide <data folder> <caseId> [--run <runId>]   a run as
 *                        [--out <dir>] [--format md|html|both] [--force]        a guide
 *   node enloop-case.mjs export-guide <data folder> --free <freeRunId> [--out …] […]
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
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  mergeEnvironmentFiles,
  splitEnvironmentFiles,
  endOfDayIso,
  discoveryEnvironment,
  providersByName,
  describeReach,
  parseCaseDocument,
  runFileSchema,
  freeRunFileSchema,
  fileSlug,
  renderGuideMarkdown,
  renderGuideHtml,
  renderFreeRunGuideMarkdown,
  renderFreeRunGuideHtml,
  screenshotStem,
  describeRating,
  isExemplaryRating,
  isPoorRating,
  ratingStars,
} from "./lib.mjs";
import { probeReach, withTunnel, parseTshString, whyNotReadOnly, querySql } from "./reach.mjs";

const [command, ...rest] = process.argv.slice(2);

function die(message) {
  console.error(message);
  process.exit(2);
}

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

/** The positionals of `rest` — the data folder and the project name —
 * with each flag in `valued` skipping its value. A `--flag` that is in
 * neither set is refused by name before anything is read: a typo such as
 * `--proxxy` would otherwise drop its value into the project name and
 * quietly create a project called "Shop teleport.new". */
function positionalsOf(valued, booleans) {
  const out = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      if (valued.has(a)) i++;
      else if (!booleans.has(a)) die(`unknown flag ${a}`);
      continue;
    }
    out.push(a);
  }
  return out;
}

/** E7, wherever it matters: a deployment called prod is production
 * whether or not anyone flagged it — a hand-edited file or a panel rename
 * never went through the name match that `environments --env` applies. */
function isProduction(e) {
  return e.production ?? /\bprod(uction)?\b/i.test(e.name);
}

/** `environments.json` at the data folder root, or an empty file when it
 * is absent or unreadable — the same degradation the panel applies. The
 * second value says which it was, because "no environments" and "could not
 * look" mean different things to the linter. */
function readEnvironments(dataDir) {
  const root = path.resolve(dataDir);
  const file = path.join(root, "environments.json");
  // Temporary environments — this machine only, git-ignored, each with
  // an expiry. Merged in on read so every consumer sees one list; split
  // back out on write so nothing temporary reaches the committed file.
  const localFile = path.join(root, "environments.local.json");
  const parse = (p) => {
    try {
      const parsed = environmentsFileSchema.safeParse(JSON.parse(readFileSync(p, "utf8")));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };
  const shared = parse(file);
  const local = parse(localFile);
  return {
    file,
    localFile,
    data: mergeEnvironmentFiles(shared ?? emptyEnvironments(), local),
    known: shared ? true : isDir(dataDir),
  };
}

/** The counterpart of `readEnvironments`: one merged list back into its
 * two files. The local file is created only once something temporary
 * exists, and pruned of expired entries on every write. */
function writeEnvironments(env, data) {
  const { shared, local } = splitEnvironmentFiles(data);
  writeFileSync(env.file, `${JSON.stringify(shared, null, 2)}\n`, "utf8");
  let existsLocal = false;
  try {
    statSync(env.localFile);
    existsLocal = true;
  } catch {
    // Not there yet.
  }
  if (local.environments.length > 0 || existsLocal) {
    writeFileSync(env.localFile, `${JSON.stringify(local, null, 2)}\n`, "utf8");
  }
}

/**
 * The name recorded in a data folder's `project.json`, or `null`.
 *
 * The extension shows this instead of the directory name, which is the
 * whole reason to write one: the recommended layout puts an `enloop.md/`
 * in every repo, so a tester with four projects connected sees four
 * identical rows without it. Reported here so the skill can say which
 * project a candidate folder holds — and notice when a folder says nothing.
 */
function projectNameOf(dataDir) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(path.resolve(dataDir), "project.json"), "utf8"));
    const name = typeof parsed?.name === "string" ? parsed.name.trim() : "";
    return name || null;
  } catch {
    return null;
  }
}

/** The names a case may leave to its environments: the folder's whole
 * contract, since every environment has the same shape by construction. */
function environmentNamesOf(env) {
  return env.known ? [...env.data.domains, ...env.data.variables] : undefined;
}

/**
 * What the linter is told about the folder's environments: the contract's
 * names, and which environments of the case's project hold a value for
 * each. The second is why the project has to be known before the lint —
 * a value recorded on another project's staging is no help here — so the
 * document is parsed once for its `@project` when `--project` was not
 * given. Throws what `parseCaseDocument` throws; the caller already
 * reports that as "cannot parse".
 */
function environmentOptionsOf(raw, env, expectProject) {
  const environmentNames = environmentNamesOf(env);
  if (!environmentNames) return {};
  const project =
    expectProject ?? parseCaseDocument(raw, { version: "1", createdAt: new Date().toISOString() }).project;
  return {
    environmentNames,
    environmentProviders: providersByName(env.data, project ?? ""),
    environmentsOfProject: environmentsForProject(env.data, project ?? "").map((e) => e.name),
  };
}

/** Now, as ISO with the machine's offset — the same shape `endOfDayIso`
 * writes, so a `verifiedAt` beside an `expires` reads as one clock. */
function nowIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** The one line `environments` prints under an environment that has a
 * reach, and the one the panel's `describeReach` would say less of. */
function reachLine(reach) {
  if (reach.transport === "manual") return `manual: ${reach.note?.trim() || "(no note)"}`;
  let head;
  if (reach.transport === "tsh") {
    const who = [reach.dbUser, reach.dbName].filter(Boolean).join("@");
    head = `tsh ${reach.dbService ?? "(no service)"}${who ? ` as ${who}` : ""}${reach.proxy ? ` via ${reach.proxy}` : ""}`;
  } else {
    head = `command \`${reach.probe ?? ""}\``;
  }
  if (reach.verifyError) return `${head} — unreachable: ${reach.verifyError}`;
  if (reach.verifiedAt) return `${head} — verified ${reach.verifiedAt}`;
  return `${head} — not yet verified`;
}

/**
 * Probe one environment's reach and write the verdict into it (E10: the
 * result is recorded either way — a VPN that is down today is not a
 * reason to lose what the user typed). Returns the `reach` command's
 * status word and detail for the line it prints.
 */
async function probeInto(env, e, cwd) {
  const reach = e.reach;
  if (!reach) return { status: "UNPROBED", detail: "no reach recorded" };
  if (reach.transport === "manual") return { status: "UNPROBED", detail: `manual: ${reach.note?.trim() || "(no note)"}` };
  const result = await probeReach(reach, { cwd });
  if (result.ok) {
    reach.verifiedAt = nowIso();
    delete reach.verifyError;
    const head = reach.transport === "tsh" ? `tsh ${reach.dbService}` : "command";
    return { status: "REACHABLE", detail: `${head} (${result.detail})`, ok: true };
  }
  reach.verifyError = result.detail;
  return { status: result.needsLogin ? "LOGIN NEEDED" : "UNREACHABLE", detail: result.detail, ok: false };
}

/** The environment a `reach` or `lookup` acts on: `--env` by name, else
 * the project's discovery environment (E13 — never production unless it
 * was named). Exits when the name is unknown. */
function pickEnvironment(data, project, envName) {
  const mine = environmentsForProject(data, project);
  if (envName) {
    const found = mine.find((e) => e.name.trim().toLowerCase() === envName.trim().toLowerCase());
    if (!found) die(`no environment "${envName}" for ${project} (have: ${mine.map((e) => e.name).join(", ") || "none"})`);
    return found;
  }
  const chosen = discoveryEnvironment(data, project);
  if (!chosen) die(`no environment for ${project} — record one: enloop-case.mjs environments <folder> "${project}" --env <name> --set DOMAIN=…`);
  return chosen;
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
    `${cold.fromEnvironment?.length ? ` · from environment: ${cold.fromEnvironment.join(", ")}` : ""}` +
    `${cold.unprovided?.length ? ` · unprovided: ${cold.unprovided.join(", ")}` : ""}`
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

/** `path` parsed by `schema`, or `null` when it is missing, malformed, or
 * not the shape expected — the three cases a folder walk treats alike. */
function readJsonFile(file, schema) {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Every finished run in `runs/`, with its frozen `case.md` parsed where it
 * parses. A run with an unparseable `case.md` still counts — its screenshots
 * are real — but has no `doc`, so the caller cannot read its kind or
 * project. Shared by `list-guides` and `export-guide` so the two agree on
 * what "a run of this case" means.
 */
function finishedRuns(dir, onlyCaseId) {
  const runsRoot = path.join(dir, "runs");
  const out = [];
  for (const caseId of onlyCaseId ? [onlyCaseId] : entries(runsRoot)) {
    for (const runId of entries(path.join(runsRoot, caseId))) {
      const runDir = path.join(runsRoot, caseId, runId);
      const run = readJsonFile(path.join(runDir, "run.json"), runFileSchema);
      if (!run || run.finishedAt === null) continue;
      let doc = null;
      try {
        doc = parseCaseDocument(readFileSync(path.join(runDir, "case.md"), "utf8"), {
          version: run.testCaseVersion,
          createdAt: run.startedAt,
        });
      } catch {
        // Frozen text this parser no longer reads — listed, not exportable.
      }
      out.push({ caseId, runId, runDir, run, doc });
    }
  }
  return out.sort((a, b) => b.run.finishedAt.localeCompare(a.run.finishedAt));
}

/** Every finished free run in `free-runs/`, newest first. */
function finishedFreeRuns(dir, onlyId) {
  const root = path.join(dir, "free-runs");
  const out = [];
  for (const id of onlyId ? [onlyId] : entries(root)) {
    const freeDir = path.join(root, id);
    const free = readJsonFile(path.join(freeDir, "free-run.json"), freeRunFileSchema);
    if (!free || free.finishedAt === null) continue;
    out.push({ id, freeDir, free });
  }
  return out.sort((a, b) => b.free.finishedAt.localeCompare(a.free.finishedAt));
}

/**
 * Write a guide's files. `sourceDir` is the run's folder (its `screenshots/`
 * child holds the PNGs); `render(imageRef)` returns the renderer's output
 * for one format. Markdown gets relative `images/<stem>.png` references and
 * a copy of every PNG it referenced; HTML gets each PNG inlined as a data
 * URL, so the page travels as one file. A screenshot whose rendered PNG is
 * missing from disk is reported and referenced anyway — the record is the
 * truth about what the run took, and a broken image is a better clue than
 * a silently thinner guide.
 */
/** The files an export writes, and nothing else: what `--force` may remove. */
const GUIDE_ENTRIES = new Set(["README.md", "index.html", "images"]);

/** True when `dir` holds only what a previous export wrote — the one shape
 * of folder `--force` is allowed to empty. Anything else in it is somebody's
 * data, and a wrong `--out` must not cost them the folder. */
function looksLikeGuideFolder(dir) {
  for (const name of entries(dir)) {
    if (!GUIDE_ENTRIES.has(name)) return false;
    if (name === "images") {
      for (const image of entries(path.join(dir, "images"))) {
        if (!/^\d+\.png$/.test(image)) return false;
      }
    }
  }
  return true;
}

function writeGuide(outDir, sourceDir, format, render) {
  const pngOf = (shot) => path.join(sourceDir, "screenshots", `${screenshotStem(shot)}.png`);
  const missing = new Set();
  // Both formats walk the same run and say the same things; once is enough.
  const warned = new Set();
  const warn = (w) => {
    if (warned.has(w)) return;
    warned.add(w);
    console.log(`WARN ${w}`);
  };
  if (format === "md" || format === "both") {
    const referenced = new Map();
    const { text, warnings } = render.md((shot) => {
      referenced.set(screenshotStem(shot), pngOf(shot));
      return `images/${screenshotStem(shot)}.png`;
    });
    for (const w of warnings) warn(w);
    const readme = path.join(outDir, "README.md");
    writeFileSync(readme, text);
    console.log(`WROTE ${readme}`);
    if (referenced.size > 0) mkdirSync(path.join(outDir, "images"), { recursive: true });
    for (const [stem, src] of referenced) {
      const dest = path.join(outDir, "images", `${stem}.png`);
      try {
        copyFileSync(src, dest);
        console.log(`WROTE ${dest}`);
      } catch {
        missing.add(src);
      }
    }
  }
  if (format === "html" || format === "both") {
    const { text, warnings } = render.html((shot) => {
      try {
        return `data:image/png;base64,${readFileSync(pngOf(shot)).toString("base64")}`;
      } catch {
        missing.add(pngOf(shot));
        return "";
      }
    });
    for (const w of warnings) warn(w);
    const index = path.join(outDir, "index.html");
    writeFileSync(index, text);
    console.log(`WROTE ${index}`);
  }
  for (const src of missing) console.log(`WARN rendered screenshot missing on disk: ${src}`);
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
      // Without the folder the linter cannot see which names the project's
      // environments provide, and reports every environment-supplied
      // variable as a question the case would ask.
      const environment = flag("data-dir")
        ? environmentOptionsOf(raw, readEnvironments(flag("data-dir")), expectProject)
        : {};
      result = lintCase(raw, { expectProject, ...environment });
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
        ...environmentOptionsOf(raw, readEnvironments(dataDirArg), flag("project")),
      });
    } catch (e) {
      console.error(`Cannot parse ${file}: ${e.message}`);
      console.error("Nothing was written.");
      process.exit(1);
    }
    show("ERRORS — nothing was written; fix these and re-run", result.errors);
    show("WARNINGS — you decide; each one is a judgement the contract leaves open", result.warnings);
    if (!result.ok) {
      // The names the case leaves to the environment that no environment
      // of this project holds — the run would ask for them (E9). Named
      // again here, apart from the rule text, because this is the one
      // refusal whose fix is outside the case file.
      const unprovided = result.cold?.unprovided ?? [];
      if (unprovided.length) {
        console.error(
          `\nunprovided  ${unprovided.join(", ")} — no environment of this project has a value; ` +
            `record one (environments … --env <name> --set NAME=value, or --lookup) before writing.`,
        );
      }
      process.exit(1);
    }

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
Via: Admin → Widgets
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
      Where: is never the only way to a page: a step that moves to a new
      page carries Via: <menu path> as well, or Via: link only when the
      UI has no path — and then says where the link comes from.
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
  10  A step that changes the screen may carry a \`### Photo\` block —
      Crop:, Mark:, Point:, Callout:, Blur: selectors the runner resolves
      when it takes the picture — and \`%PHOTO_n%\` in the text where the
      n-th photo lands on export. A guide (\`@kind guide\`) needs them; a
      case may use them.

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

    /** Said once, after the folder is settled: a folder nobody named is a
     * row in the panel nobody can tell from the next repo's. Cheap to fix,
     * invisible until a second project is connected — so it is said here
     * rather than discovered then. */
    const nameHint = (dir) => {
      if (projectNameOf(dir)) return;
      console.log(`  name    ${path.join(dir, "project.json")} — { "name": "<project>" }`);
      console.log("          the panel shows this instead of the directory name; write it if absent");
    };

    const describe = (c) => {
      const notes = [];
      if (c.state === "deep") notes.push("path pointed one level too deep; corrected to the parent");
      if (c.state === "empty") notes.push("empty — create test-cases/ inside it and say that you did");
      if (c.state === "unrecognised") notes.push("no Enloop layout in it — probably the wrong path");
      if (c.state === "data") {
        const n = cases(c.dir);
        notes.push(`${n} case${n === 1 ? "" : "s"}`);
        // Which project this folder holds, in the folder's own words. A
        // path is not recognisable; "Acme Shop" is.
        const name = projectNameOf(c.dir);
        notes.push(name ? `named "${name}"` : "no project.json — the panel shows it as the directory name");
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
      nameHint(resolved.dir);
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
    for (const name of ["enloop.md", "enloop", "test-cases", ".enloop"]) {
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
      nameHint(distinct[0]);
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
    console.log(`  offer   ${path.join(root, "enloop.md")} (in-repo, keeps cases with the code)`);
    console.log('  offer   to name it: project.json — { "name": "<project>" } — so the panel');
    console.log("          shows the project rather than a fourth folder called enloop.md");
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
   *   … --env pr-42 --temporary | --until 2026-09-12          this machine, gone after
   *   … --env prod --production | --no-production             real people's data (E7)
   *   … --env staging --tsh "tsh login --proxy=… && tsh db connect S …"   how to get to
   *   … --env staging --reach tsh --proxy H --db-service S …               its data, then
   *   … --env office --reach command --probe "…" [--db-address "…"]        probed once
   *   … --env office --reach manual --note "VPN Office, then psql …"       (never probed)
   *   … --env staging --lookup QA_EMAIL="select …"            a query that finds a value
   *
   * Names are uppercased to the placeholder convention; an existing
   * environment is matched by name within the project, case-insensitively.
   * Exit 0 with the file printed after any change.
   */
  case "environments": {
    const VALUED = new Set([
      "--domain",
      "--variable",
      "--env",
      "--set",
      "--until",
      "--reach",
      "--proxy",
      "--db-service",
      "--db-user",
      "--db-name",
      "--db-protocol",
      "--probe",
      "--db-address",
      "--note",
      "--lookup",
      "--tsh",
    ]);
    const BOOLEAN = new Set(["--default", "--temporary", "--production", "--no-production"]);
    const [dataDir, ...projectParts] = positionalsOf(VALUED, BOOLEAN);
    const project = projectParts.join(" ").trim();
    if (!dataDir || !project) {
      die(
        'usage: enloop-case.mjs environments <data folder> "<project>" [--domain NAME]... [--variable NAME]...\n' +
          "         [--env <name> [--set NAME=value]... [--default] [--temporary | --until YYYY-MM-DD]\n" +
          "          [--production | --no-production] [--lookup NAME=\"select …\"]...\n" +
          '          [--tsh "<pasted tsh line>"] [--reach tsh --proxy H --db-service S [--db-user U] [--db-name N] [--db-protocol postgres|mysql]]\n' +
          '          [--reach command --probe "<cmd>" [--db-address "<cmd>"]] [--reach manual --note "<sentence>"] [--reach none]]',
      );
    }
    // Exit 1, not 2: these are refusals of what was asked, in the same
    // class as a lint error, and the skills read 1 as "fix and re-run".
    const refuse = (message) => {
      console.error(`REFUSED  ${message}`);
      process.exit(1);
    };
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
    // The environment being edited and the reach set on it this run, kept
    // outside the block because the probe happens after everything else
    // has been applied and just before the write.
    let target;
    let reach;
    if (envName) {
      target = environmentsForProject(data, project).find(
        (e) => e.name.trim().toLowerCase() === envName.trim().toLowerCase(),
      );
      if (!target) {
        target = { id: newEnvironmentId(), name: envName.trim(), project, domains: {}, values: {} };
        data.environments.push(target);
        changed = true;
      }
      // E5: temporary is "until I go home" unless a day was named. The
      // entry moves to the local file by the flag the writer splits on.
      const until = flag("until");
      if (until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(until)) die(`--until expects YYYY-MM-DD, got ${until}`);
      if (rest.includes("--temporary") || until) {
        const expires = endOfDayIso(until);
        // The writer prunes expired entries, so recording one would print
        // a name that lands in neither file.
        if (Date.parse(expires) < Date.now()) {
          refuse(`--until ${until} is already past — a temporary environment that has expired is not recorded.`);
        }
        target.local = true;
        target.expires = expires;
        delete target.default;
        changed = true;
      }
      // E7: the flag is explicit, but a deployment called prod is one
      // whether or not anyone said so — matched once, when the entry has
      // never been told either way, so --no-production sticks.
      if (rest.includes("--production")) {
        target.production = true;
        changed = true;
      } else if (rest.includes("--no-production")) {
        target.production = false;
        changed = true;
      } else if (target.production === undefined && isProduction(target)) {
        target.production = true;
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
        if (target.local) refuse(`${target.name} is temporary — a temporary environment is never the default.`);
        for (const e of data.environments) {
          if (e === target) e.default = true;
          else if (environmentsForProject({ ...data, environments: [e] }, project).length) delete e.default;
        }
        changed = true;
      }
      // E11: a lookup is refused before it is written, so the file never
      // holds a query the lookup command would then refuse to run.
      for (const pair of repeated("lookup")) {
        const eq = pair.indexOf("=");
        if (eq === -1) die(`--lookup expects NAME="select …", got ${pair}`);
        const name = normalize(pair.slice(0, eq));
        const sql = pair.slice(eq + 1).trim();
        if (!name) continue;
        const why = whyNotReadOnly(sql);
        if (why) refuse(`--lookup ${name}: ${why}. Nothing was written.`);
        if (!data.domains.includes(name) && !data.variables.includes(name)) data.variables.push(name);
        target.lookups ??= {};
        target.lookups[name] = sql;
        changed = true;
      }
      // Reach: a pasted tsh line, explicit flags, or both (flags refine
      // the paste). The fields alone amend the reach already recorded —
      // the way to add the proxy a paste lacked. Anything new is probed
      // once and the verdict recorded either way (E10).
      const transport = flag("reach");
      const pasted = flag("tsh");
      const FIELDS = [
        ["proxy", "proxy"],
        ["db-service", "dbService"],
        ["db-user", "dbUser"],
        ["db-name", "dbName"],
        ["db-protocol", "dbProtocol"],
        ["probe", "probe"],
        ["db-address", "dbAddress"],
        ["note", "note"],
      ];
      const given = FIELDS.filter(([name]) => flag(name) !== undefined);
      if (transport === "none") {
        if (pasted) refuse("--reach none and --tsh together say two things. Nothing was written.");
        if (given.length) refuse(`--reach none and --${given[0][0]} together say two things. Nothing was written.`);
        if (target.reach) {
          delete target.reach;
          changed = true;
        }
      } else if (pasted !== undefined || transport !== undefined || given.length) {
        if (pasted !== undefined) {
          try {
            reach = parseTshString(pasted);
          } catch (e) {
            refuse(`--tsh: ${e.message}. Nothing was written.`);
          }
          if (transport !== undefined && transport !== "tsh") {
            refuse(`--tsh gives a tsh reach; --reach ${transport} says otherwise. Nothing was written.`);
          }
        } else if (transport === undefined) {
          if (!target.reach) {
            refuse(`--${given[0][0]} needs --reach tsh (or --tsh "…"): ${target.name} has no reach to amend. Nothing was written.`);
          }
          // The old verdict is about the old fields; the probe below
          // records a fresh one.
          const { verifiedAt, verifyError, ...kept } = target.reach;
          reach = kept;
        } else if (!["tsh", "command", "manual"].includes(transport)) {
          die(`--reach expects tsh, command, manual or none, got ${transport}`);
        } else {
          reach = { transport };
        }
        for (const [name, key] of given) reach[key] = flag(name);
        if (reach.dbProtocol !== undefined && !["postgres", "mysql"].includes(reach.dbProtocol)) {
          die(`--db-protocol expects postgres or mysql, got ${reach.dbProtocol}`);
        }
        // tsh remembers the proxy of its last login, so a service alone is
        // a reach; a proxy alone is a login with the service still to be
        // named — the probe says so. Neither is nothing.
        if (reach.transport === "tsh" && !reach.proxy && !reach.dbService) {
          refuse("a tsh reach needs --db-service (and usually --proxy). Nothing was written.");
        }
        if (reach.transport === "command" && !reach.probe) refuse("a command reach needs --probe. Nothing was written.");
        if (reach.transport === "manual" && !reach.note) refuse("a manual reach needs --note. Nothing was written.");
        target.reach = reach;
        changed = true;
      }
    }
    if (changed) {
      if (reach && target && reach.transport !== "manual") {
        const verdict = await probeInto(env, target, path.resolve(dataDir));
        console.log(`probe    ${verdict.status.padEnd(13)} ${target.name}  ${verdict.detail}`);
      }
      writeEnvironments(env, data);
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
      const marks =
        `${e.default ? " (default)" : ""}${isProduction(e) ? " (production)" : ""}` +
        `${e.local ? ` (temporary, until ${e.expires ? e.expires.slice(0, 10) : "?"})` : ""}` +
        `${e.project ? "" : " (all projects)"}`;
      console.log(`env      ${e.name}${marks}${missing.length ? ` — ${missing.length} empty: ${missing.join(", ")}` : ""}`);
      for (const d of data.domains) console.log(`           ${d}=${e.domains[d] ?? ""}`);
      for (const v of data.variables) console.log(`           ${v}=${e.values[v] ?? ""}`);
      if (e.reach) console.log(`           reach    ${reachLine(e.reach)}`);
      for (const [name, sql] of Object.entries(e.lookups ?? {})) console.log(`           lookup   ${name} = ${sql}`);
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

  /**
   * Can this machine get to an environment's data right now? One line per
   * environment, the verdict written back into its reach (E10). Exit 0
   * when everything probed is reachable. `LOGIN NEEDED` is the one
   * verdict an agent cannot act on: the line says what the user runs.
   *
   *   reach <folder> "<project>"                one environment (E13: the default,
   *   reach <folder> "<project>" --env staging   else the first non-production)
   *   reach <folder> "<project>" --all           every environment of the project
   */
  case "reach": {
    const [dataDir, ...projectParts] = positionalsOf(new Set(["--env"]), new Set(["--all"]));
    const project = projectParts.join(" ").trim();
    if (!dataDir || !project) die('usage: enloop-case.mjs reach <data folder> "<project>" [--env <name> | --all]');
    if (!isDir(dataDir)) die(`${path.resolve(dataDir)} is not a directory.`);
    const env = readEnvironments(dataDir);
    const targets = rest.includes("--all")
      ? environmentsForProject(env.data, project)
      : [pickEnvironment(env.data, project, flag("env"))];
    if (targets.length === 0) die(`no environment for ${project}`);
    const width = Math.max(...targets.map((e) => e.name.length)) + 2;
    let allOk = true;
    let changed = false;
    for (const e of targets) {
      const verdict = await probeInto(env, e, path.resolve(dataDir));
      if (verdict.ok !== undefined) {
        changed = true;
        if (!verdict.ok) allOk = false;
      }
      console.log(`${verdict.status.padEnd(14)}${e.name.padEnd(width)}${verdict.detail}`);
    }
    if (changed) writeEnvironments(env, env.data);
    process.exit(allOk ? 0 : 1);
  }

  /**
   * Find a value on a deployment instead of asking anyone for it: the
   * environment's recorded query for a variable, or an ad-hoc `--sql`,
   * run through its reach. Read-only by construction (E11) and refused
   * before anything is opened when it is not. Production is opt-in per
   * call and never recorded (E7): a value found there stays with whoever
   * ran the command.
   *
   *   lookup <folder> "<project>" --env staging --variable QA_EMAIL [--record]
   *   lookup <folder> "<project>" --env staging --sql "select … limit 1"
   *   lookup <folder> "<project>" --env staging --all --record       every lookup it has
   *   lookup <folder> "<project>" --env prod --variable QA_EMAIL --production
   */
  case "lookup": {
    const [dataDir, ...projectParts] = positionalsOf(
      new Set(["--env", "--variable", "--sql"]),
      new Set(["--all", "--record", "--production"]),
    );
    const project = projectParts.join(" ").trim();
    const variable = flag("variable");
    const adHoc = flag("sql");
    const all = rest.includes("--all");
    const record = rest.includes("--record");
    if (!dataDir || !project || [variable, adHoc, all ? "all" : undefined].filter((x) => x !== undefined).length !== 1) {
      die(
        'usage: enloop-case.mjs lookup <data folder> "<project>" [--env <name>] (--variable NAME | --sql "select …" | --all) [--record] [--production]',
      );
    }
    if (!isDir(dataDir)) die(`${path.resolve(dataDir)} is not a directory.`);
    const refuse = (message) => {
      console.error(`REFUSED  ${message}`);
      process.exit(1);
    };
    if (record && adHoc !== undefined) refuse("--record needs --variable: an ad-hoc query has no name to record under.");
    const env = readEnvironments(dataDir);
    const data = env.data;
    const target = pickEnvironment(data, project, flag("env"));
    if (isProduction(target) && !rest.includes("--production")) {
      refuse(`${target.name} is production — pass --production to query it. A value found there is never recorded.`);
    }
    if (isProduction(target) && record) {
      refuse(`--record is refused on ${target.name}: it is production, and a value found there is not recorded — it stays with the tester.`);
    }
    const normalize = (raw) => raw.trim().replace(/^%|%$/g, "").toUpperCase();
    // Which queries run: one named, one ad-hoc, or every lookup recorded.
    // A named lookup missing on this environment is borrowed from another
    // of the project's — the schema is the same on every deployment; only
    // the answer differs.
    const jobs = [];
    if (adHoc !== undefined) jobs.push({ name: null, sql: adHoc });
    else if (all) {
      for (const [name, sql] of Object.entries(target.lookups ?? {})) jobs.push({ name, sql });
      if (jobs.length === 0) refuse(`${target.name} has no lookups recorded — add one: environments … --env ${target.name} --lookup NAME="select …"`);
    } else {
      const name = normalize(variable);
      let sql = target.lookups?.[name];
      if (!sql) {
        const donor = environmentsForProject(data, project).find((e) => e.lookups?.[name]);
        if (!donor) {
          refuse(
            `no lookup recorded for ${name} on ${target.name} — record one: environments <folder> "${project}" --env ${target.name} --lookup ${name}="select …"`,
          );
        }
        sql = donor.lookups[name];
        console.log(`note     using the ${name} query recorded on ${donor.name}`);
      }
      jobs.push({ name, sql });
    }
    for (const job of jobs) {
      const why = whyNotReadOnly(job.sql);
      if (why) refuse(`${job.name ?? "--sql"}: ${why}. Nothing was run.`);
    }
    if (!target.reach) {
      refuse(`${target.name} has no reach — record how to get to its data (environments … --reach) or the value itself (--set).`);
    }
    let failed = false;
    let wrote = false;
    try {
      await withTunnel(target.reach, { cwd: path.resolve(dataDir) }, async ({ host, port }) => {
        for (const job of jobs) {
          const label = job.name ? `${job.name}=` : "";
          let result;
          try {
            result = await querySql(target.reach, { host, port }, job.sql, { cwd: path.resolve(dataDir) });
          } catch (e) {
            console.log(`FAILED  ${job.name ?? "--sql"}  ${e.message}`);
            failed = true;
            continue;
          }
          if (result.value === null || !result.value.trim()) {
            console.log(`EMPTY  ${job.name ?? "--sql"}`);
            failed = true;
            continue;
          }
          console.log(`VALUE  ${label}${result.value}`);
          if (record && job.name) {
            if (!data.domains.includes(job.name) && !data.variables.includes(job.name)) data.variables.push(job.name);
            if (data.domains.includes(job.name)) target.domains[job.name] = result.value;
            else target.values[job.name] = result.value;
            wrote = true;
          }
        }
      });
    } catch (e) {
      refuse(`${e.needsLogin ? "LOGIN NEEDED  " : ""}${e.message}`);
    }
    if (wrote) {
      writeEnvironments(env, data);
      console.log(`WROTE    ${target.local ? env.localFile : env.file}`);
    }
    process.exit(failed ? 1 : 0);
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

  /**
   * What is worth exporting as a guide: every finished run that took a
   * screenshot, every finished run of a `@kind guide` case (a guide with
   * no pictures is still a guide — the steps carry it), and every finished
   * free run with screenshots. Newest first, because the run somebody
   * wants to export is almost always the one they just finished. The
   * `export-guide` skill reads this to pick a run instead of asking.
   */
  case "list-guides": {
    const positional = [];
    let project = "";
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--project") project = (rest[++i] ?? "").trim().toLowerCase();
      else if (a.startsWith("--")) die(`list-guides: unknown flag ${a}`);
      else positional.push(a);
    }
    const [dataDir] = positional;
    if (!dataDir) die('usage: enloop-case.mjs list-guides <data folder> [--project "<name>"]');
    const dir = path.resolve(dataDir).replace(/\/+$/, "");

    const rows = [];
    for (const { caseId, runId, run, doc } of finishedRuns(dir)) {
      const kind = doc?.kind ?? "case";
      if (run.screenshots.length === 0 && kind !== "guide") continue;
      if (project && (doc?.project ?? "").trim().toLowerCase() !== project) continue;
      rows.push({
        type: "run",
        caseId,
        id: runId,
        at: run.finishedAt,
        n: run.screenshots.length,
        kind,
        title: doc?.title ?? run.testCaseTitle,
      });
    }
    // A free run belongs to no project; `--project` asks for a project's
    // runs, so free runs stay out of a filtered list.
    if (!project) {
      for (const { id, free } of finishedFreeRuns(dir)) {
        if (free.screenshots.length === 0) continue;
        rows.push({ type: "free", caseId: "-", id, at: free.finishedAt, n: free.screenshots.length, kind: "-", title: free.title });
      }
    }
    rows.sort((a, b) => b.at.localeCompare(a.at));
    if (rows.length === 0) {
      console.log("NONE");
      process.exit(1);
    }
    const width = (key) => Math.max(...rows.map((r) => String(r[key]).length));
    const w = { caseId: width("caseId"), id: width("id"), at: width("at"), n: width("n"), kind: width("kind") };
    for (const r of rows) {
      console.log(
        `${r.type.padEnd(4)}  ${r.caseId.padEnd(w.caseId)}  ${r.id.padEnd(w.id)}  ${r.at.padEnd(w.at)}  ` +
          `${String(r.n).padStart(w.n)} screenshots  ${r.kind.padEnd(w.kind)}  ${r.title}`,
      );
    }
    break;
  }

  /**
   * A finished run written out as a user guide — Markdown with an `images/`
   * folder beside it, an HTML page with the pictures inlined, or both. The
   * prose is the frozen `case.md` of that run, so the guide describes the
   * version the tester actually walked, with the screenshots they actually
   * took. Which run: the one named, else the newest finished run with
   * screenshots, else the newest finished run at all — a guide case run
   * without photos still reads as a guide. The output folder is never
   * merged into: a guide is a whole, and stale images from a previous
   * export beside a fresh README are the kind of wrong nobody notices.
   */
  case "export-guide": {
    const positional = [];
    let runId;
    let freeId;
    let outFlag;
    let format = "md";
    let force = false;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--run") runId = rest[++i];
      else if (a === "--free") freeId = rest[++i];
      else if (a === "--out") outFlag = rest[++i];
      else if (a === "--format") format = rest[++i];
      else if (a === "--force") force = true;
      else if (a.startsWith("--")) die(`export-guide: unknown flag ${a}`);
      else positional.push(a);
    }
    const [dataDir, caseId] = positional;
    const usage =
      "usage: enloop-case.mjs export-guide <data folder> <caseId> [--run <runId>] [--out <dir>] [--format md|html|both] [--force]\n" +
      "       enloop-case.mjs export-guide <data folder> --free <freeRunId> [--out <dir>] [--format md|html|both] [--force]";
    if (!dataDir || (!caseId && !freeId) || (caseId && freeId)) die(usage);
    if (!["md", "html", "both"].includes(format)) die(`export-guide: --format must be md, html or both, not ${format}`);
    const dir = path.resolve(dataDir).replace(/\/+$/, "");

    let title;
    let sourceDir;
    let render;
    if (freeId) {
      const [found] = finishedFreeRuns(dir, freeId);
      if (!found) {
        console.log(`NO RUN  no finished free run ${freeId} in ${path.join(dir, "free-runs")}`);
        process.exit(1);
      }
      let notes = "";
      try {
        notes = readFileSync(path.join(found.freeDir, "notes.md"), "utf8");
      } catch {
        // A session with no notes is only its screenshots.
      }
      title = found.free.title.trim() || "Free run";
      sourceDir = found.freeDir;
      render = {
        md: (imageRef) => renderFreeRunGuideMarkdown(found.free, notes, { imageRef }),
        html: (imageRef) => renderFreeRunGuideHtml(found.free, notes, { imageRef }),
      };
    } else {
      const runs = finishedRuns(dir, caseId).filter((r) => r.doc !== null);
      const chosen = runId
        ? runs.find((r) => r.runId === runId)
        : (runs.find((r) => r.run.screenshots.length > 0) ?? runs[0]);
      if (!chosen) {
        console.log(
          runId
            ? `NO RUN  no finished run ${runId} of ${caseId} with a readable case.md in ${path.join(dir, "runs", caseId)}`
            : `NO RUN  no finished run of ${caseId} in ${path.join(dir, "runs", caseId)}`,
        );
        process.exit(1);
      }
      title = chosen.doc.title;
      sourceDir = chosen.runDir;
      render = {
        md: (imageRef) => renderGuideMarkdown(chosen.doc, chosen.run, { imageRef }),
        html: (imageRef) => renderGuideHtml(chosen.doc, chosen.run, { imageRef }),
      };
    }

    const outDir = outFlag ? path.resolve(outFlag) : path.join(dir, "guides", fileSlug(title));
    if (entries(outDir).length > 0) {
      if (!force) {
        console.log(`EXISTS ${outDir}`);
        process.exit(1);
      }
      if (!looksLikeGuideFolder(outDir)) {
        console.log(`EXISTS ${outDir} (not an Enloop guide folder — --force only replaces a previous export; choose an empty --out)`);
        process.exit(1);
      }
      for (const name of entries(outDir)) rmSync(path.join(outDir, name), { recursive: true, force: true });
    }
    mkdirSync(outDir, { recursive: true });
    writeGuide(outDir, sourceDir, format, render);
    console.log(`GUIDE ${outDir}`);
    break;
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
        '  enloop-case.mjs environments <data folder> "<project>" [--domain NAME] [--variable NAME] [--env <name> [--set NAME=value] [--default]\n' +
        '                  [--temporary | --until YYYY-MM-DD] [--production | --no-production] [--lookup NAME="select …"]\n' +
        '                  [--tsh "<pasted tsh line>"] [--reach tsh --proxy H --db-service S [--db-user U] [--db-name N] [--db-protocol postgres|mysql]]\n' +
        '                  [--reach command --probe "<cmd>" [--db-address "<cmd>"]] [--reach manual --note "<sentence>"] [--reach none]]\n' +
        '  enloop-case.mjs reach <data folder> "<project>" [--env <name> | --all]\n' +
        '  enloop-case.mjs lookup <data folder> "<project>" [--env <name>] (--variable NAME | --sql "select …" | --all) [--record] [--production]\n' +
        '  enloop-case.mjs rules <data folder> "<project>"\n' +
        '  enloop-case.mjs ratings <data folder> "<project>" [--limit N] [--min-runs N]\n' +
        '  enloop-case.mjs list-guides <data folder> [--project "<name>"]\n' +
        "  enloop-case.mjs export-guide <data folder> <caseId> [--run <runId>] [--out <dir>] [--format md|html|both] [--force]\n" +
        "  enloop-case.mjs export-guide <data folder> --free <freeRunId> [--out <dir>] [--format md|html|both] [--force]\n" +
        '  enloop-case.mjs id "Project: Case title"\n' +
        "  enloop-case.mjs version",
    );
}

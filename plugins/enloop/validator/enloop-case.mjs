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
 *   node enloop-case.mjs validate <case.md> [--project <name>] [--findings-only]
 *   node enloop-case.mjs data-folder [--want <path>]   where this repo's cases go
 *   node enloop-case.mjs verify <data folder> <caseId> did the case land right
 *   node enloop-case.mjs rules <data folder> <project> this project's authoring rules
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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { lintCase, newTestCaseId, CURRENT_FORMAT_VERSION } from "./lib.mjs";

const [command, ...rest] = process.argv.slice(2);

function die(message) {
  console.error(message);
  process.exit(2);
}

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
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

function show(label, findings) {
  if (findings.length === 0) return;
  console.log(`\n${label}`);
  for (const f of findings) {
    const at = f.at ? ` [${f.at}]` : "";
    console.log(`  (rule ${f.rule})${at} ${f.message}`);
  }
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
        if (rest[i] === "--project") i++;
        continue;
      }
      file = rest[i];
    }
    if (!file) {
      die("usage: enloop-case.mjs validate <case.md> [--project <name>] [--findings-only]");
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
      result = lintCase(raw, { expectProject });
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
        `${doc.variables.length} variables, ${doc.dependencies.length} dependencies, ` +
        `${doc.prerequisites.length} prerequisites`,
    );
    // The measure of the cold-runner bar: what someone starting from a blank
    // tab can click, and what the case will ask them for first. Printed even
    // with --findings-only — a fix that costs a one-click step should show up
    // in the line, not slip past it.
    const { cold } = result;
    console.log(
      `cold run    ${cold.navigableSteps}/${cold.uiSteps} steps one-click · ` +
        `asks ${cold.asks.length} value${cold.asks.length === 1 ? "" : "s"} before start` +
        `${cold.asks.length ? ` (${cold.asks.join(", ")})` : ""} · ` +
        `unresolved: ${cold.unresolved.length ? cold.unresolved.join(", ") : "none"}`,
    );

    if (!findingsOnly) {
      if (doc.prerequisites.length > 0) {
        console.log("\nprerequisites");
        for (const p of doc.prerequisites) console.log(`  - ${p}`);
      }

      console.log("\nsteps as parsed");
      for (const [i, s] of doc.steps.entries()) {
        console.log(
          `  ${i + 1}. ${s.title}${s.quick ? "  [quick]" : ""}${s.type === "automated" ? "  [automated]" : ""}`,
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

    /** Which level of the layout does `dir` name? */
    const level = (dir) => {
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
    };

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
      const resolved = level(want);
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
      candidates.push({ ...level(envValue), origin: `$${envName}` });
    }

    // A folder inside the repo is the shape to prefer when it exists: cases
    // are committed with the code they test, they arrive with a clone, and
    // nothing has to be configured per machine.
    for (const name of ["enloop", "test-cases", ".enloop"]) {
      const dir = path.join(root, name);
      if (!isDir(dir)) continue;
      const found = level(dir);
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
    const files = entries(versions).filter((f) => /^v\d+\.md$/.test(f));

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

  case "id": {
    const title = rest.join(" ").trim();
    if (!title) die('usage: enloop-case.mjs id "Project: Case title"');
    console.log(newTestCaseId(title));
    break;
  }

  case "version":
    console.log(CURRENT_FORMAT_VERSION);
    break;

  default:
    die(
      "usage:\n" +
        "  enloop-case.mjs validate <case.md> [--project <name>] [--findings-only]\n" +
        "  enloop-case.mjs data-folder [--want <path>]\n" +
        "  enloop-case.mjs verify <data folder> <caseId>\n" +
        '  enloop-case.mjs rules <data folder> "<project>"\n' +
        '  enloop-case.mjs id "Project: Case title"\n' +
        "  enloop-case.mjs version",
    );
}

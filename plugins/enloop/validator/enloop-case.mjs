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
 *   node enloop-case.mjs validate path/to/case.md   parse it, lint it, show it
 *   node enloop-case.mjs id "Project: Case title"   the case folder's id
 *   node enloop-case.mjs version                    the grammar format version
 *
 * `validate` exits 1 when something is certainly wrong and 0 when the only
 * findings are ones a human has to judge. Read the warnings either way; they
 * are the half of the step contract a machine cannot decide, and a case that
 * ships with them unread is exactly what the contract exists to prevent.
 */
import { readFileSync } from "node:fs";
import { lintCase, newTestCaseId, CURRENT_FORMAT_VERSION } from "./lib.mjs";

const [command, ...rest] = process.argv.slice(2);

function die(message) {
  console.error(message);
  process.exit(2);
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
  case "validate": {
    const file = rest.find((a) => !a.startsWith("--"));
    if (!file) die("usage: enloop-case.mjs validate <case.md> [--project <name>]");
    const projectFlag = rest.indexOf("--project");
    const expectProject = projectFlag === -1 ? undefined : rest[projectFlag + 1];

    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch (e) {
      die(`Cannot read ${file}: ${e.message}`);
    }

    const result = lintCase(raw, { expectProject });
    const { doc, quick } = result;

    console.log(`title       ${doc.title}`);
    console.log(`project     ${doc.project || "(none)"}`);
    console.log(`format      @version ${doc.formatVersion || "(none)"} (parser is ${CURRENT_FORMAT_VERSION})`);
    console.log(
      `counts      ${doc.steps.length} steps, ${quick.marked} marked quick, ` +
        `${doc.variables.length} variables, ${doc.dependencies.length} dependencies, ` +
        `${doc.prerequisites.length} prerequisites`,
    );

    if (doc.prerequisites.length > 0) {
      console.log("\nprerequisites");
      for (const p of doc.prerequisites) console.log(`  - ${p}`);
    }

    console.log("\nsteps as parsed");
    for (const [i, s] of doc.steps.entries()) {
      console.log(`  ${i + 1}. ${s.title}${s.quick ? "  [quick]" : ""}${s.type === "automated" ? "  [automated]" : ""}`);
      console.log(`     where     ${s.where ?? "(none)"}`);
      console.log(`     selectors ${s.selectors.length ? JSON.stringify(s.selectors) : "(none)"}`);
      console.log(`     expected  ${s.expected ? s.expected.replace(/\n/g, "\n               ") : "(none)"}`);
      if (s.note) console.log(`     note      ${s.note.replace(/\n/g, "\n               ")}`);
    }

    show("ERRORS — the document is wrong, fix before writing it", result.errors);
    show("WARNINGS — you decide; each one is a judgement the contract leaves open", result.warnings);

    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log("\nNo findings. Still walk the reject list for what only source can settle: invented labels, routes and selectors.");
    }
    process.exit(result.ok ? 0 : 1);
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
        "  enloop-case.mjs validate <case.md> [--project <name>]\n" +
        '  enloop-case.mjs id "Project: Case title"\n' +
        "  enloop-case.mjs version",
    );
}

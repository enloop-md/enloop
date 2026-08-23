#!/usr/bin/env node
/**
 * PostToolUse guard: any case file an agent writes must parse.
 *
 * The authoring skills end with "validate — never skip this", and the first
 * real-world failure was a session that skipped it anyway: it wrote
 * free-form Markdown assembled from the skill text's own vocabulary, and the
 * extension refused the file. Prose guardrails bind only the models that
 * read them; this hook is the same guardrail as code. It fires after every
 * Write/Edit, does nothing unless the path is a case version
 * (`versions/v<n>.md`), and on parse **errors** exits 2 — which feeds them
 * straight back to the model that just wrote the file, whichever model that
 * is.
 *
 * Warnings never block. They are the contract's judgement calls — a prose
 * `Where:` is wrong for a route and right for a terminal — and the skills
 * own answering them. Errors block because they are certainties: a case
 * with no steps is not an opinion.
 *
 * The gate is `versions/v<n>.md` anywhere, not only under `test-cases/`:
 * misplaced case files exist (the incident's first write landed in a
 * `cases/` folder), and content is corrected cheapest at the moment it is
 * written. A file that is deliberately not a case does not belong in a
 * `versions/` folder, and the message says so.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CASE_FILE = /\/versions\/v\d+(?:\.\d+)?\.md$/;

let filePath = "";
let sessionId = "";
let sessionCwd = "";
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  filePath = input?.tool_input?.file_path ?? "";
  sessionId = input?.session_id ?? "";
  sessionCwd = input?.cwd ?? "";
} catch {
  process.exit(0);
}
if (!CASE_FILE.test(String(filePath).replace(/\\/g, "/"))) process.exit(0);

let raw;
try {
  raw = readFileSync(filePath, "utf8");
} catch {
  // Deleted or unreadable — nothing to judge.
  process.exit(0);
}

let lintCase;
try {
  ({ lintCase } = await import(new URL("../validator/lib.mjs", import.meta.url).href));
} catch {
  // The plugin install is broken. That is a real problem, but taking every
  // write hostage over it helps nobody — the skills still validate.
  process.exit(0);
}

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
function fail(verdict, head) {
  console.error(
    `Enloop: the case file just written ${verdict}.\n${head}\n\n` +
      `Fix the file until this passes, then continue:\n\n` +
      `  node "${pluginRoot}validator/enloop-case.mjs" validate "${filePath}" --findings-only\n\n` +
      `The grammar is ${pluginRoot}references/grammar.md — read it before rewriting; ` +
      `the full procedure is the enloop:quick / enloop:full skill. If this file is ` +
      `deliberately not an Enloop test case, keep it out of a versions/ folder.`,
  );
  process.exit(2);
}

let result;
try {
  result = lintCase(raw);
} catch (e) {
  fail(
    "will not load in the extension — it does not parse as a case",
    `The parser rejects it outright: ${e?.message ?? e}`,
  );
}

if (result.errors.length > 0) {
  fail(
    "breaks the case contract's machine-certain rules — the authoring skills would refuse to ship it",
    "ERRORS:\n" +
      result.errors
        .map((f) => `  (rule ${f.rule})${f.at ? ` [${f.at}]` : ""} ${f.message}`)
        .join("\n"),
  );
}

// A valid version just landed — stamp the case's authoring provenance
// beside it. The model cannot know its own session id, but this hook is
// handed it, which makes here the one reliable place to record which
// session (and which repo, on which machine) authored the latest version.
// `enloopd` reads this to answer a tester's question by resuming that very
// session headlessly (claude -p --resume <id> --fork-session) — the
// context a looping serve session used to exist for, recovered on demand.
// Best-effort by design: a failed stamp must never block a valid write.
try {
  if (sessionId) {
    const caseDir = path.dirname(path.dirname(path.resolve(String(filePath))));
    writeFileSync(
      path.join(caseDir, "context.json"),
      `${JSON.stringify(
        {
          sessionId,
          cwd: sessionCwd,
          host: hostname(),
          // Login and session store both live in the config dir; recording
          // it is what keeps three isolated per-project setups isolated
          // when one daemon serves them all.
          ...(process.env.CLAUDE_CONFIG_DIR
            ? { claudeConfigDir: process.env.CLAUDE_CONFIG_DIR }
            : {}),
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
} catch {
  // Read-only folder, odd layout — the case landed, that is what matters.
}
process.exit(0);

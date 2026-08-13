#!/usr/bin/env node
/**
 * The eval matrix: does the authoring loop hold on this model?
 *
 * Every guard in the plugin narrows what a weak model can break; none of
 * them can say "quick works on Haiku". Only running it on Haiku says that —
 * per model, per release, because instruction-following is empirical and a
 * new model breaks assumptions no guard anticipated.
 *
 * Per model: copy the fixture app to a temp dir, make it a git repo, run
 * the skill headless, then assert with the tools the plugin already ships —
 * the case landed where `verify` looks, `validate` exits clean, and every
 * test handle the case names exists in the fixture source (the invented-
 * specifics check no static guard can make).
 *
 *   node evals/run.mjs                        # default models
 *   node evals/run.mjs --models haiku,sonnet,opus
 *   node evals/run.mjs --keep                 # keep temp dirs for reading
 *
 * Needs the `claude` CLI on PATH with the enloop plugin enabled in the
 * active config — see evals/README.md. This is a local harness, not CI.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const keep = args.includes("--keep");
const models = (flag("models") ?? "haiku,sonnet").split(",").map((m) => m.trim());
const prompt = flag("prompt") ?? "/enloop:quick the coupon banner";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = path.join(root, "evals", "fixture-app");
const validator = path.join(root, "plugins", "enloop", "validator", "enloop-case.mjs");

function git(cwd, ...argv) {
  const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${argv.join(" ")}: ${r.stderr}`);
}

/** Every file under `dir`, concatenated — the haystack the case's selectors
 * must be found in. The fixture is small on purpose. */
function sourceText(dir) {
  let text = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    text += entry.isDirectory() ? sourceText(p) : readFileSync(p, "utf8");
  }
  return text;
}

const rows = [];
for (const model of models) {
  const tmp = mkdtempSync(path.join(tmpdir(), `enloop-eval-${model.replace(/[^\w-]/g, "_")}-`));
  cpSync(fixture, tmp, { recursive: true });
  git(tmp, "init", "-q");
  git(tmp, "add", "-A");
  git(tmp, "-c", "user.email=eval@enloop.test", "-c", "user.name=Enloop Eval", "commit", "-qm", "fixture");

  process.stderr.write(`running ${model} … `);
  const session = spawnSync(
    "claude",
    ["-p", prompt, "--model", model, "--dangerously-skip-permissions"],
    {
      cwd: tmp,
      encoding: "utf8",
      timeout: 20 * 60_000,
      env: { ...process.env, ENLOOP_PROJECT: "Fixture Shop" },
    },
  );
  process.stderr.write("done\n");

  const row = { model, landed: 0, valid: "—", warnings: "—", cold: "—", handles: "—", ok: false };
  if (session.error) {
    row.cold = `claude CLI failed: ${session.error.message}`;
  } else {
    const casesDir = path.join(tmp, "enloop", "test-cases");
    const landedIds = existsSync(casesDir)
      ? readdirSync(casesDir).filter((d) => existsSync(path.join(casesDir, d, "versions", "v1.md")))
      : [];
    row.landed = landedIds.length;

    if (landedIds.length === 1) {
      const v1 = path.join(casesDir, landedIds[0], "versions", "v1.md");
      const val = spawnSync(
        "node",
        [validator, "validate", v1, "--project", "Fixture Shop", "--findings-only"],
        { encoding: "utf8" },
      );
      row.valid = val.status === 0 ? "clean" : "ERRORS";
      row.warnings = String((val.stdout.split("WARNINGS")[1]?.match(/\(rule /g) ?? []).length);
      row.cold = /cold run\s+(.*)/.exec(val.stdout)?.[1] ?? "—";

      // The invented-specifics check: every handle the case names must
      // exist in the fixture's source. A selector that greps nowhere was
      // recalled, not read.
      const caseText = readFileSync(v1, "utf8");
      const handles = [
        ...caseText.matchAll(/data-testid="([^"]+)"/g),
      ].map((m) => m[1]);
      const src = sourceText(path.join(tmp, "src"));
      const invented = [...new Set(handles)].filter((h) => !src.includes(`"${h}"`));
      row.handles = invented.length
        ? `INVENTED: ${invented.join(", ")}`
        : `${new Set(handles).size} real`;
      row.ok = val.status === 0 && invented.length === 0;
    }
  }
  rows.push(row);

  if (keep || !row.ok) {
    console.error(`  ${model}: workspace kept at ${tmp}`);
    if (!row.ok && session.stdout) {
      console.error(`  last of the session's output:\n    ${session.stdout.trim().split("\n").slice(-6).join("\n    ")}`);
    }
  } else {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("\nmodel        landed  validate  warnings  handles           cold run");
for (const r of rows) {
  console.log(
    `${r.model.padEnd(12)} ${String(r.landed).padEnd(7)} ${String(r.valid).padEnd(9)} ` +
      `${String(r.warnings).padEnd(9)} ${String(r.handles).padEnd(17)} ${r.cold}`,
  );
}
const failed = rows.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`\n${failed.length} of ${rows.length} model(s) failed — that is the matrix working, not broken.`);
}
process.exit(failed.length === 0 ? 0 : 1);

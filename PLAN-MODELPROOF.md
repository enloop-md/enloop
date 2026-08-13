# Enloop on any model — the model-proofing plan

Status: **items 1–2 built (2026-08-13); 3–4 outstanding. Written 2026-08-13.**

Scope split: [`PLAN-AUTHORING.md`](PLAN-AUTHORING.md) owns what a finished
case must contain. This document owns making the **write → run → check loop
survive a weak interpreter** — a skill is a program executed by a model, and
the weaker the model, the more approximate the execution. Born from the
incident PLAN-AUTHORING item 8 records: a Haiku session invoked
`/enloop:full` correctly and skipped the whole procedure, because every step
of it was prose.

The governing principle is already written in `enloop-case.mjs`'s header:
*an instruction is followed approximately; a command does the same thing
every time.* Each item here moves one piece of correctness from
"the model remembers" to "the harness enforces" — or, where nothing can
enforce (reading source honestly), to "the matrix measures".

Four items, ordered by enforcement strength. One commit per item.

---

## 1. `write` — the one road into the folder — **implemented 2026-08-13**

### The problem

Landing a case is currently five model-sequenced steps: resolve the folder
level, derive the id, make the directories, write `meta.json`, write
`versions/v1.md`, then `verify`. The Haiku transcript is a map of what that
costs: the case written into the plugin cache, moved to the wrong level,
the id shape reverse-engineered from sibling folders, `validate` never run.
Every separate step is a separate chance to skip or improvise — and in
Codex there is no hook to catch the result.

### The decision

One subcommand, and the skills document **no other way** to land a case:

    node enloop-case.mjs write <file> --data-dir <dir> [--project <name>]
                                      [--case <id>] [--suite <suiteId>]

- **Validates first.** Errors → print findings, write nothing, exit 1.
  Warnings print and do not block, as everywhere.
- **New case**: id from `newTestCaseId(title)`,
  `test-cases/[<suite>/]<id>/{meta.json, versions/v1.md}`; `meta.json`
  only when absent. `--suite` targets an existing suite folder (one whose
  dir holds `suite.md`) and refuses a non-suite.
- **`--case <id>`**: the next `versions/v<n+1>.md` in that case's folder,
  found at either level (top or inside a suite); previous versions never
  touched. This is what `check` fixes ride on.
- **Path defense**: the same `level()` correction `data-folder` applies —
  a path one level too deep is corrected, an empty dir is bootstrapped
  with `test-cases/`, an unrecognised layout refuses.
- Prints the absolute path written, the id (or new version number), and
  the `cold run` line.

The gate works identically under Codex, where the guard hook cannot: a
model that skips the command lands **no case** — a visible failure — rather
than a malformed one. The skills stop describing the folder layout at all;
a layout nobody teaches is a layout nobody hand-builds.

### Where it lands

`plugins/enloop/validator/enloop-case.mjs` (the subcommand; `level()`
hoisted out of the `data-folder` case), `references/authoring.md` §10
rewritten around it, `skills/check/SKILL.md` §6/§7 fix-writing switched to
`--case`, `docs/skills.md`.

### Check

New case via `write` into a fresh dir: folder, meta, v1 exist; `verify`
agrees; second `write --case` lands v2 and leaves v1 byte-identical. A file
with errors: exit 1 and **nothing on disk**. A `--data-dir` pointed at
`test-cases/` directly: corrected, not nested. `--suite` at a non-suite:
refused.

---

## 2. `brief` — push the floor into context — **implemented 2026-08-13** (landed at 60 lines, the example being nearly half; the ~50 was the aspiration, the example earning its lines is the point)

### The problem

The skills are thin pointers by design (token economy), and a pointer chain
is exactly what a weak model does not follow: Haiku's first tool call after
the skill text loaded was already the `Write`. Everything that would have
prevented the garbage lived one `Read` away and was never fetched. Models
follow one concrete command far more reliably than "read these three files
in full" — so the floor must be *pushed* into context, not wait to be
pulled.

### The decision

    node enloop-case.mjs brief

prints, in ~40 lines: a **concrete minimal case that lints clean** (real
values, not `<placeholders>` — a skeleton that cannot be validated is a
skeleton that drifts), the hard rules at one line each, the two commands
(`validate --findings-only` while iterating, `write` to land), and the
paths to the grammar, the contract and the procedure. `brief --example`
prints only the example case, so a test can pipe it straight into
`validate` and fail the build the day it stops lint-clean.

`skills/quick/SKILL.md` and `skills/full/SKILL.md` gain a "First, print
the brief" section with the exact command line, ahead of the
read-the-procedure step. The procedure still applies in full; the brief is
the floor under a session that follows nothing else.

### Where it lands

`enloop-case.mjs`, both authoring SKILL.md files, plugin version 0.14.0
(this item and item 1 together are the plugin's user-visible change).

### Check

`brief --example | validate` (via a temp file): zero errors, `cold run
1/1 · asks 0`. `brief` output stays under ~50 lines — it is a floor, not a
second copy of the docs.

---

## 3. Say which models the skills want

### The problem

Nothing anywhere says the authoring skills assume a capable model, so a
config pinned to a small one (a cost-saving default, exactly the
IDEALPOSTCODE setup) walks into the incident with no warning.

### The decision

One honest paragraph in the docs, not a mechanism — there is no supported
way for a skill to know what model runs it, and pretending otherwise is a
guard that lies. The paragraph says: **quick** and **full** read a codebase
and follow a multi-file procedure, and want a Sonnet-class model or better;
below that, expect the guard hook and the `write` gate to hold the shape,
and expect `check` to catch invented routes and selectors only *after* a
run has paid for them. **check**, **setup** and **instrument** tolerate
smaller models better.

### Where it lands

`docs/skills.md` (primary), one line in `docs/claude-code.md` and
`docs/codex.md` pointing at it.

### Check

By eye; there is nothing to run.

---

## 4. The eval matrix — measure instead of hope

### The problem

Instruction-following is empirical. Every guard above narrows the damage a
weak model can do; none of them can say "quick works on Haiku". Only
running it on Haiku says that — per model, per release, because a new model
breaks assumptions no guard anticipated.

### The decision

A local harness, not CI — it needs the `claude` CLI, an API key, and the
plugin enabled in the active config, none of which belong in a public
repo's actions:

- **`evals/fixture-app/`** — a committed, fictional "Fixture Shop": a
  router file and two components carrying `data-testid`s, enough surface
  for `/enloop:quick` to derive real routes, labels and selectors. Ships
  with an in-repo `enloop/` data folder and a rules file carrying
  `Base URL:`, and the runner sets `ENLOOP_PROJECT`, so a headless session
  never has a question to ask.
- **`evals/run.mjs`** — per model: copy the fixture to a temp dir,
  `git init` + commit it, invoke
  `claude -p "/enloop:quick the coupon banner" --model <m>` headless with
  permissions granted, then assert with the tools this repo already ships:
  exactly one case landed where `verify` looks; `validate` exits 0; every
  `Selector:` in the case greps in the fixture source (the invented-
  specifics check no static guard can make); the `cold run` line parses.
  Prints one row per model, exits nonzero if any hard assertion failed.
- **`evals/README.md`** — prerequisites, invocation, how to read a row,
  and the standing instruction: run the matrix before tagging a plugin
  release, and when a new model ships.

### Check

Run the matrix for one strong and one weak model; the strong row passes;
whatever the weak row shows **is the result** — the matrix reporting a
failure honestly is it working.

---

## Executing this plan

Items land 1 → 4, one commit each, `npm run typecheck` before each; item 2
carries the plugin bump to 0.14.0. Regenerate nothing — no grammar change
anywhere here. Fixtures for items 1–2 live in the scratch area; the eval
fixture is committed, fictional, and never names a real client. Update the
Status line and mark headings `— implemented <date>` as items land, the way
the sibling plans do.

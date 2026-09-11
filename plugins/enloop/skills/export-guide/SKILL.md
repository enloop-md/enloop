---
name: export-guide
description: Export a finished Enloop run or free run as a user guide — a folder with `README.md` and images, or a single HTML page with the screenshots inlined. Use after a guide (or any run with screenshots) has been finished in the extension and the user asks to export, publish or hand over the guide, the walkthrough, the how-to, or "the run with its screenshots".
disable-model-invocation: true
allowed-tools: Read Edit Bash(node *) Bash(ls *)
---

# Export a guide

A run is finished in the extension and has its screenshots. This skill turns
it into the deliverable: a folder anyone can read, or one HTML file anyone
can open. The rendering is deterministic and lives in the validator; this
skill's job is to pick the right run, run the command, and tidy the prose
in the file it produced.

$ARGUMENTS optionally names the run (a run id, a case title or id, or
`free <id>`), a format (`html`, `md`, `both`), and an output folder
(`to <dir>` / `--out <dir>`). Nothing at all means: the newest candidate,
Markdown, the default folder.

## 1. Resolve the data folder

The plugin is two levels above this skill's folder and holds `validator/`
and `references/` (under Claude Code it is also `$CLAUDE_PLUGIN_ROOT`):

```bash
ENLOOP_PLUGIN="<that directory>"
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" data-folder
```

`RESOLVED` prints the folder; use it as `$DATA_DIR`. `AMBIGUOUS` or `NONE`
exits non-zero and means you must ask — `references/data-folder.md` at the
plugin root says how. State the folder you resolved, in one line, before
anything else: the wrong folder does not error, it lists somebody else's
runs.

## 2. Find the run

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" list-guides "$DATA_DIR"
```

Add `--project "<name>"` when the user named a project or the folder holds
several. It prints one line per candidate, newest first — finished runs
with at least one screenshot or whose frozen case is `@kind guide`, and
finished free runs with screenshots:

```
run   <caseId>  <runId>      <finishedAt>  <n> screenshots  <kind>  <title>
free  -         <freeRunId>  <finishedAt>  <n> screenshots  -       <title>
```

- **One candidate** → use it, and say which.
- **Several** → match $ARGUMENTS against the titles and ids. When that
  does not settle it, ask **one closed question** listing each candidate's
  title, date and screenshot count, and wait for the answer.
- **`NONE`** (exit 1) → say so and stop. There is nothing to export until
  a run with screenshots, or a run of a guide, has been finished in the
  panel.

## 3. Settle the format and the destination

- Format from $ARGUMENTS: `html` (one `index.html` with every image
  inlined), `md` (a `README.md` beside an `images/` folder — the default),
  or `both`.
- `--out <dir>` only when the user named a destination. Otherwise the
  export goes to `<data folder>/guides/<slug>/`, which is where guides are
  meant to live: `runs/` is git-ignored, `guides/` is the deliverable.

## 4. Export

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" export-guide "$DATA_DIR" <caseId> --run <runId> --format md
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" export-guide "$DATA_DIR" --free <freeRunId> --format html
```

`--run` may be left off to take the case's newest finished run with
screenshots (else its newest finished run); `--out <dir>` overrides the
destination; `--format md|html|both`.

- **`EXISTS <path>`** (exit 1): the destination already has files. Ask
  before re-running with `--force`, which empties the folder first — the
  previous export may have hand edits in it.
- **`NO RUN`** (exit 1): the case has no finished run. Say so; nothing to
  export.
- Every **`WARN`** line is a sentence the reader will miss — usually a
  `%PHOTO_n%` whose photo was discarded or never taken, dropped from the
  text. Repeat each one to the user verbatim.
- `WROTE <abs path>` per file, and a last line `GUIDE <abs dir>`.

## 5. Read the result once, and fix the prose in it

Open the produced `README.md` (or `index.html`) once. Two kinds of change
are yours to make, **in the exported file only** — never in the case, never
in the run. Wording fixes after export belong to the export; the case is
what it was when it ran.

- **What the user asked for**: a renamed heading, a sentence added, a
  step's wording.
- **Tester voice that leaked through**: a sentence that says "verify",
  "assert", "check that" or "test", or that names a component, class,
  route parameter, ticket, branch, environment or selector. Rewrite it
  for a reader who is using the app, not testing it.

Leave the figures, their captions and their legends alone; they came from
the run. Say what you changed, sentence by sentence.

## 6. Report

Absolute paths: the guide folder, and each file in it. Repeat the `WARN`
lines. If the export is Markdown, say that `images/` must travel with
`README.md`; if HTML, that the one file is self-contained and opens
offline.

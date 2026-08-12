---
name: check
description: Triage a finished Enloop test run from inside the app repo being tested. Reads the run's feedback.md/report.md, then decides for each failure, warning and tester comment whether it is an app bug (with the file and line), a defect in the test case itself, or an environment/data problem — fixes what it owns, and promotes standing feedback into this project's authoring rules. Use after a run has been executed in the extension and the user asks to check/review/triage the run, the results, or the feedback — e.g. "check the last run", "what did the run find", "triage run failures". Not for authoring a case; those are the enloop:quick and enloop:full skills.
disable-model-invocation: true
allowed-tools: Read Grep Glob Write Edit Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(rg *) Bash(ls *) Bash(cat *) Bash(node *)
---

# Check a test run

A run finished in the extension. This skill turns its output into
decisions, from inside the repo of the app under test.

The one judgement that matters, made per finding: **did the app do
something wrong, or did the case ask for something wrong?** Answering it
requires reading the app's source at the point of failure. A triage that
just restates what the tester wrote is worthless — they already know what
they saw.

$ARGUMENTS optionally names the run: a run id, a case title or id, or
nothing at all (meaning the most recent finished run).

## 1. Resolve where things live

Two roots. Never hardcode either.

- **App repo** — where you are now: the repo root
  (`git rev-parse --show-toplevel`). The place a
  bug gets confirmed and fixed.
- **Data folder** — where this repo's cases and runs live. Ask the plugin,
  which is two levels above this skill's folder and holds `validator/` and
  `references/` (under Claude Code it is also `$CLAUDE_PLUGIN_ROOT`):

  ```bash
  ENLOOP_PLUGIN="<that directory>"
  node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" data-folder
  ```

  `RESOLVED` prints the folder; use it. `AMBIGUOUS` or `NONE` exits non-zero
  and means you must ask — read `references/data-folder.md` at the plugin
  root for how. Resolve **per repo**: with several folders connected, the run
  you are looking for is in the one this repo writes to, and a user-level
  default may name a different one. Pointing at the wrong folder — or the
  wrong level of the right one — does not error; it reports "no runs found"
  for a case that ran fine.

Those are the only two paths this skill needs. Everything about Enloop
itself — the grammar, the parser — ships with the plugin you are reading
from, so there is nothing to install and no environment variable to ask the
user for.

## 2. Find the run

Runs live under the data folder in a fixed layout:

```
<data folder>/runs/<testCaseId>/<runId>/case.md       the exact case text that was run (frozen)
                                       /run.json      per-step status and comments
                                       /report.md     human-readable summary of every step
                                       /feedback.md   action items — written only when there is signal
<data folder>/free-runs/<freeRunId>/free-run.json     unscripted session
                                   /notes.md
                                   /feedback.md
```

Run ids sort chronologically (`run-<ISO timestamp>-<hex>`), so the newest
run is the last entry. `$DATA_DIR` is what you resolved in step 1:

```bash
ls -d "$DATA_DIR"/runs/*/*/ 2>/dev/null | sort | tail -5
ls -d "$DATA_DIR"/free-runs/*/ 2>/dev/null | sort | tail -3
```

Match $ARGUMENTS against the paths. With no argument, take the newest run
whose `run.json` has `finishedAt` set — and say which one you picked, with
its date, before doing anything else. Picking the wrong run wastes the
whole triage.

If both listings come back empty, do not conclude the case was never run
until you have confirmed `$DATA_DIR` is right — `ls "$DATA_DIR"` should
show `test-cases`/`runs`/`free-runs`. An empty result from a wrong path
looks exactly like a case that was never executed. Once the path is
confirmed, say so plainly: the case exists but has no runs.

## 3. Read the run

**`feedback.md` first** when present — it is already the distilled action
list, written by the extension when the run finished, and its sections are
**addressed**: *For the developer*, *For product*, *For the test writer*,
*For the docs writer*, *For ops*. Take every section, not only the one that
sounds like yours; you are the one triaging all of them.

Then read, always:

- **`run.json`** — the authoritative per-step state. `status` per step
  (`success` / `failed` / `warning` / `skipped` / `pending`), the step's
  `comments` — each with the `audiences` the tester ticked, or none at all —
  and `automatedResult.error` for automated steps.

  **An audience is the tester's hypothesis, not a verdict.** "For the
  developer" says they thought the app misbehaved; confirming that against
  source is still your job, and it is routine for a comment addressed to the
  developer to turn out to be a case defect, or the reverse. Use it as the
  order to check things in, never as the answer.
- **`run.json`'s own `comment` and `tier`**, before any of the steps:
  - `comment` is the tester's account of the run as a whole — "ran against
    an old build", "felt slow throughout". It routinely reframes what the
    step failures mean, and a run whose *only* signal is that comment still
    produces a `feedback.md`. Read it first, not last.
  - `tier` is `quick` or `full`. A quick run executed only the steps marked
    `Kind: quick`, so a pass means the core path works — **never report it
    as the case passing**. Say which tier you read. Its frozen `case.md`
    contains only the steps that ran, so step numbers will not line up with
    the case's own versions; go by step title, not by number.
- **`case.md`** — the frozen text that was actually executed, with
  variables already substituted. Read it against `run.json`: a step's
  `### Expected` is the claim, its status is the verdict.

A `pending` status at the end of a run means the tester stopped there.
That is a finding — usually a blocker earlier in the case — not an
omission to skip over.

### What the page itself said

A run may also carry what the page printed while it was being driven — console
lines, uncaught errors, and its requests: either only the ones that failed or
came back 4xx/5xx, or every request it made, depending on what the tester asked
for. Capture is off unless they turned it on, so most runs have none of this.

- **`run.json` per step: `consoleErrors`, `consoleWarnings`,
  `networkFailures`, `requests`.** Always present, always readable. A console
  error during a step the tester marked **passed** is a finding in its own
  right: a green run with a stack trace in it is exactly what nobody notices.
  `requests` is every request the step made and is nonzero only when the tester
  asked for the whole trace; it is context, not a finding — a step that worked
  still made forty of them.
- **The `## Console and network` section of `report.md`** — a deduplicated
  digest, present only when the tester ticked *Include console output in the
  report* at finish. `×N` is an occurrence count, not N separate problems. Its
  **Requests the page made** subsection, and the matching *What the page
  called* section in `feedback.md`, are the trace of what the app actually
  called during the run — the fastest way to find the endpoint behind a button
  that did nothing, and worth reading before grepping for one.
- **`console.md` in the run folder — do not read it.** It is the full log, and
  the tester deciding not to attach it is a decision about data that may
  include a customer's. If `feedback.md` says output was captured and not
  attached, say so in your report and ask for it; do not route around the
  checkbox by opening the file that is sitting right there. Reading it anyway
  is the locally helpful thing to do and it makes the checkbox a lie.

When triaging, keep *the page threw* and *the step failed* apart. They usually
coincide; when they do not, the console error is the more precise statement of
what broke, and the step's verdict is what the tester could see of it.

## 4. Triage every finding

For each failed step, warning step, and non-empty comment, land on exactly
one verdict. Do not batch them into a general impression.

### App bug

The app's behaviour contradicts what its own source says it should do.

Confirm it in this repo before calling it one: find the handler, component
or template behind the step's `Where:` and `Selector:`, read the path the
tester exercised, and identify the specific line where behaviour diverges
from the step's `### Expected`. Cite `path/to/file.ext:123`.

If the case was written for a branch, check whether the branch is what was
actually running — `git log --oneline -3` plus what the tester recorded.
A bug reproduced against the wrong build is not a bug.

### Case defect

The step was wrong, stale, or unanswerable. The common ones, in order of
frequency:

- A `Selector:` that no longer exists in source (renamed `data-testid`,
  removed element).
- A `Where:` route that moved or now redirects.
- An `### Expected` bullet that was never observable — an adjective, or a
  claim about state the tester cannot see from that screen.
- Test data the step assumed but never established.
- A step that silently required a manual setup step somebody had to invent.

Grep this repo for the exact selector or route before concluding it is
stale. `rg "data-testid=\"sync-events\"" -n` settles it in one call.

### Environment or data

Wrong branch deployed, missing migration, absent fixture, insufficient
permissions, an integration in a bad state. Real, but it invalidates the
step's result rather than proving anything about the code — say what has
to be true for a rerun to mean something.

### Not reproducible from here

Say so plainly and name what you would need. This is a legitimate verdict
and much better than a confident guess. Never invent a mechanism to
explain a failure you could not locate in source.

## 5. Sweep the case for staleness

Independent of the findings, check every `Where:` and `Selector:` in
`case.md` — including the ones on steps that passed — still exists in this
repo's source. A selector that changed under a passing step is a step that
will fail on the next run for a reason nobody will remember.

Report each stale reference with the source that replaced it, if you can
find it.

A step may carry several `Selector:` lines — fallbacks, tried in order
until one matches. Check them all: a dead *first* selector is invisible in
a run that passed on the second, and left alone it decays into a step with
no working handle at all. Removing one that no longer exists in source is
a legitimate fix in the new version.

Note steps that carry no `Selector:` at all, too. Those run without
Highlight, which is the feature that makes a case fast to execute. If
there are several, offer the **instrument** skill to add the handles, then a
new case version to use them.

While you are here, check the case's header: `@project` present and
matching this repo, and the title prefixed with it. A case that predates
those conventions gets them in the new version you are about to write —
that is what makes it findable in a Library holding several products.

## 6. Act on what you own

**Case defects — fix them.** The case is yours to correct. Write a new
version alongside the existing ones, never editing a previous version in
place:

```
$DATA_DIR/test-cases/<testCaseId>/versions/v<n+1>.md
```

Read the current highest `v<n>.md`, apply the fix, and add a
`Change note:` line under the title saying what changed and which run
prompted it. Before writing, put the edited case through the validator that
ships with the plugin — a fix that reintroduces a contract violation is not a
fix:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" validate <the edited file> --findings-only
```

`--findings-only` because you are checking an edit, not reading a document
for the first time. For the half it cannot see, read
`../../references/step-contract.md` (the plugin's references folder) and walk
its by-eye list over the steps you touched. The `@version` line stays as it
is unless the grammar itself changed.

**App bugs — report precisely, then ask.** Give file, line, the mechanism,
and the fix you would make. Do not edit app source as part of triage: the
user may want a ticket, a different fix, or a discussion first. If they
say go, fix it then.

**Environment problems — state the precondition** the rerun needs. If it
belongs in the case as a `# Dependencies` or `# Prerequisites` entry,
that is a case defect too; fix it under the rule above.

### Standing rules — the part that outlives this run

A comment addressed **to the test writer** is one of two things, and only a
reader can tell which:

- **A one-off.** This case's step 4 was wrong. Fix it in the new version and
  you are done.
- **A rule.** *Every* case for this app should have done it differently —
  "always start from the admin dashboard, never the marketing site", "our
  selects are custom components, so `Selector:` must point at the wrapper",
  "never assume the seeded demo tenant; it is wiped nightly".

The second kind is worth more than the fix and used to be thrown away: it
went into one case's next version and was learned again from scratch by the
next case anyone wrote. Promote it:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" rules "$DATA_DIR" "<project>"
```

It prints the file's path and whatever is already in it. Add the rule there,
in the imperative, one bullet per rule, each saying what to do rather than
what went wrong — a rule that reads as a complaint about one case will not be
followed when writing the next. Merge with what is there instead of appending
a near-duplicate, and delete a rule the app has outgrown; this file is read in
full before every case this project ever gets, so its length is a cost
everyone pays.

Be conservative. One tester's preference is not a project rule, and a rules
file that accumulates every passing remark becomes an instruction nobody can
follow. When it is genuinely unclear, fix the case and **say in your report
that you considered it a rule and did not promote it** — that puts the
judgement in front of the person who can settle it.

The **quick** and **full** skills read this file before authoring and must
obey it, so a rule you write here is enforced from the next case onward.

## 7. Report

Lead with the verdict on the run as a whole in one line: what it proves
about the feature, and whether the failures are the app's or the case's.

Then, per finding:

- Step number and title, and its status.
- The verdict — app bug / case defect / environment / not reproducible.
- The evidence: `file:line` for a bug, the grep result for a stale
  selector, the missing precondition for an environment problem.
- What you did about it, or what you propose.

Close with:

- Any new case version you wrote, and the id to find it under.
- Stale selectors and routes found in the staleness sweep.
- Whether the run's result should be trusted at all — a run against the
  wrong build or missing fixtures proves nothing, and saying so is more
  useful than triaging its noise.

Do not claim to have verified a fix. Nothing was rerun; a fixed case and a
patched bug both need another pass through the extension.

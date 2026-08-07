---
name: check
description: Triage a finished Enloop test run from inside the app repo being tested. Reads the run's feedback.md/report.md, then decides for each failure, warning and tester note whether it is an app bug (with the file and line), a defect in the test case itself, or an environment/data problem — and fixes what it owns. Use after a run has been executed in the extension and the user asks to check/review/triage the run, the results, or the feedback — e.g. "check the last run", "what did the run find", "triage run failures". Not for authoring a case; those are the enloop:quick and enloop:full skills.
disable-model-invocation: true
allowed-tools: Read Grep Glob Write Edit Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(rg *) Bash(ls *) Bash(cat *) Bash(node *) Bash(npx tsc *) Bash(openssl rand *)
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
- **Data folder** — where this repo's cases and runs live. Resolve it by
  following `references/data-folder.md` (at the plugin root, one level above
  this skill's folder — if it is not there, search the plugin directory for
  `data-folder.md`), which you must read now. Resolve it the same way the
  quick and full skills do, per repo: with several folders connected, the run you are
  looking for is in the one this repo writes to, and a user-level default
  may name a different one. Pointing at the wrong folder — or the wrong
  level of the right one — does not error; it reports "no runs found" for a
  case that ran fine.

```bash
echo "ENLOOP_HOME=${ENLOOP_HOME:-unset}"
```

If `ENLOOP_HOME` is unset, ask for the path and tell the user to add it to
their settings `env` block so it is a one-time cost.

## 2. Find the run

Runs live under the data folder in a fixed layout:

```
<data folder>/runs/<testCaseId>/<runId>/case.md       the exact case text that was run (frozen)
                                       /run.json      per-step status, comments, notes, tasks
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
list (bugs, feature requests, docs gaps, failed steps), written by the
extension when the run finished. It exists only when a run had signal; a
silent clean pass has none, and that is itself the answer.

Then read, always:

- **`run.json`** — the authoritative per-step state. `status` per step
  (`success` / `failed` / `warning` / `skipped` / `pending`), free-text
  `comment`, typed `notes` (`bug` / `feature` / `docs` / `note`), `tasks`,
  and `automatedResult.error` for automated steps.
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

## 4. Triage every finding

For each failed step, warning step, `bug` note, and non-empty comment,
land on exactly one verdict. Do not batch them into a general impression.

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
prompted it. Before writing, read
`../../references/step-contract.md` (the plugin's references folder) and check the
edited steps against its reject list — a fix that reintroduces a contract
violation is not a fix. The `@version` line stays as it is unless the
grammar itself changed.

**App bugs — report precisely, then ask.** Give file, line, the mechanism,
and the fix you would make. Do not edit app source as part of triage: the
user may want a ticket, a different fix, or a discussion first. If they
say go, fix it then.

**Environment problems — state the precondition** the rerun needs. If it
belongs in the case as a `# Dependencies` or `# Prerequisites` entry,
that is a case defect too; fix it under the rule above.

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

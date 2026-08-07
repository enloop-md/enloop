# Enloop tooling — workflow plan

Status: **items 3 and 4 built; 1, 2 and 5 outstanding; 6 parked.** Written
2026-08-04.

Scope split: [`PLAN-BACKEND.md`](PLAN-BACKEND.md) owns the hosted backend —
accounts, projects, the HTTP API, environments. This document owns the skills
and the extension workflow. Items here that need a schema column say so
explicitly, so the backend plan can pick them up rather than discovering them.

Six items. **3 and 4 are built** (2026-08-04) and their sections are kept as
the record of what was decided and why. 1, 2 and 5 remain outstanding. 1 and 2
are a pair: the first takes a capability away from `/enloop:setup`, the second
gives it a proper home. 5 is independent of the other four and is extension
work, not skill work. **6 is parked** — low priority, recorded so the idea
stops being re-litigated, not queued.

---

## 1. `/enloop:setup` writes documentation, never code

### The problem

`/enloop:setup` currently declares `allowed-tools: Read Grep Glob Edit Write …`
— unrestricted write access to the repo it runs in. Nothing in the skill body
tells it to edit source, and its steps only ever touch `CLAUDE.md` and
`.claude/settings.json`, but the *permission* is there, and a skill that is
allowed to edit application code eventually will: a step that "just fixes" a
stripped test attribute in `vite.config.ts`, a helpful rename while it is in
the file.

That matters more for setup than for other skills because setup is the one a
user runs on a repo they have not yet decided to trust Enloop with. It should
be the safest thing in the plugin, and a user should be able to say yes to it
without reading it first.

### The rule

**Setup may create and edit Markdown. Nothing else.**

- `CLAUDE.md` — the `## Enloop` section. This is the deliverable and stays.
- `.claude/test-map.md` — allowed, same reason.
- Application source, configs, lockfiles, CI files — never, under any framing.

### Consequences to work through

- **Frontmatter.** Narrow to `Edit(*.md) Write(*.md)`, and verify the harness
  actually enforces a glob there rather than silently granting the unscoped
  tool. If it does not enforce it, the frontmatter is documentation and the
  body rule is the real control — worth knowing which, and saying so in the
  skill.
- **`.claude/settings.json` is JSON, so step 6 has to change.** Setup stops
  writing env values and instead prints the exact block to paste, or hands off
  to `/update-config`, which is the skill that owns settings and asks properly.
  This is a small regression in convenience and the right trade: the value of
  "setup cannot touch anything but docs" is that it needs no review, and one
  JSON exception destroys that claim.
- **Detection stays.** Reading `vite.config.ts` to check whether the build
  strips test attributes is a read, and still setup's job. It reports; it does
  not fix. The fix is a `/enloop:review` finding (item 2).
- Say the constraint in the skill's own description, not just its tools, so a
  user skimming `/help` sees it.

### Check

Run setup on a dirty repo and confirm `git status` shows only `.md` paths.
Worth an explicit line in the skill's report: *"Files changed: CLAUDE.md.
This skill does not modify code."*

---

## 2. `/enloop:review` — read the code, produce a plan

### The problem

Between "the repo has no test handles" and "the repo is instrumented" there is
a judgement step nobody owns. `/enloop:instrument` edits source, so running it
to *find out* how much work there is means either accepting a diff or throwing
one away. `/enloop:setup` is now (item 1) documentation-only. Neither answers
"how far is this repo from being testable, and what would it take?"

### Shape

Read-only. `allowed-tools` has no `Edit`/`Write` except to its own output file.
The deliverable is a Markdown plan at
`${CLAUDE_PROJECT_DIR}/.claude/enloop-review.md`, which a human reads and then
either acts on with `/enloop:instrument` or files as work.

What it reviews, against the rules already written down rather than invented
here — the `## Enloop` section installed by setup, `references/step-contract.md`,
and the four Highlight constraints in `skills/instrument/SKILL.md`:

1. **Selector coverage.** Per screen: which interactive controls and asserted
   containers have a stable handle, which do not. A ratio per screen is more
   actionable than a repo-wide number, because instrumenting is done per screen.
2. **Convention conformance.** Attributes that disagree with the repo's
   dominant convention; values derived from visible text; list rows sharing one
   testid with no per-row addressing; testids duplicating an existing `id`.
3. **Reachability.** Screens rendering inside an `<iframe>` or behind a shadow
   root, which no attribute fixes and which must be known *before* someone
   writes a case against them.
4. **Build stripping.** Whether test attributes survive the production build,
   and which environment the testers actually hit.
5. **Startability.** What a tester must run to get the app up — the input
   `# Prerequisites` needs. Sourced from `package.json` scripts, `Procfile`,
   `docker-compose.yml`, the README's local-setup section.

### Output format

Ordered by payoff, not by directory. Each finding: what, where (`file:line`),
why it matters for a run, and the specific edit that fixes it — enough that
`/enloop:instrument` can execute the plan without re-deriving it.

An explicit **"do not instrument"** list matters as much as the to-do list:
screens nobody writes cases against, admin tools behind a feature flag,
third-party embeds. Without it the reader assumes the plan is exhaustive and
the ratio in item 1 looks worse than it is.

### Boundaries

- Never edits source. If the user says "just fix it", it says which skill does
  that and stops. A read-only tool that sometimes writes is a read-only tool
  nobody can trust.
- Does not write cases. It reports what would make cases writable.
- Idempotent: re-running regenerates the file, and the diff between two runs is
  the progress report.

### Open question

Should the review file be committed? It is derived, it goes stale, and it will
be read as an audit finding. Leaning yes with a `Generated:` date at the top,
same as `.claude/test-map.md` — the value of a teammate seeing it outweighs the
staleness, provided the date is prominent.

---

## 3. A comment on the whole run — **implemented 2026-08-04**

### The problem

Every observation a tester makes has to be attached to a step, because that is
the only place the UI accepts text. The things people actually want to say at
the end — "the whole flow feels slow on staging", "I ran this against an old
build", "passed, but I had to retry the sync twice and I do not know why" —
belong to the run, not to any one step. They currently get crammed into the
last step's comment, where `/enloop:check` reads them as a finding about that
step and misjudges them.

### Design

A comment box in the finish bar of `RunScreen`, above the Finish/Abort buttons,
free text, optional. Saved with the run, not with a step.

- `RunFile` gains `comment: string` (default `""`). It is on-disk state in
  `run.json`, so the schema change is additive and old runs read as `""` —
  the same upgrade shape as legacy string notes in `runNoteOrLegacySchema`.
- `finishRun` takes the comment, or `updateRun({ comment })` saves it before
  finishing so a long comment is not lost if the panel closes. Prefer the
  second: losing typed text is worse than an extra write.
- `renderRunReport` puts it directly under the status block, before Steps —
  it is context for everything below it.
- `renderRunFeedback` puts it under the summary line and **treats a non-empty
  run comment as feedback signal in its own right**, so a run that passed but
  worried the tester still produces a `feedback.md`. Today `hasStepSignal` can
  only see step-level signal, so that run is silently clean.
- Editable while the run is in progress, read-only once finished, like step
  comments.

**Backend note:** `run.comment text not null default ''`, and
`POST /runs/{id}/finish` accepts it (`PLAN-BACKEND.md` §4.4, §6.2).

### Open question

One free-text comment, or the typed notes (`note`/`feature`/`bug`/`docs`) at
run level too? Start with free text. Typed notes exist to route step findings
into action items; a run-level note is usually narrative, and adding four
categories to the finish bar buys structure nobody asked for.

---

## 4. Quick and acceptance cases — **implemented 2026-08-04 (option B)**

### The problem

Authoring is the expensive part — of tokens and of the user's attention. A full
case derives every route, label and selector from source and covers the seams;
that is right before a release and disproportionate when a developer wants to
check that the thing they just built works at all. The result is that during
development nobody writes a case, so the loop that Enloop exists to close is
skipped exactly when it would be cheapest to run.

So: two levels of coverage. **Quick** — happy path, minutes to run, written in
one pass. **Acceptance** — the current full case, edge cases, error states,
cleanup.

### Two ways to model it, and a recommendation

**Option A — two separate cases.** `@kind quick` / `@kind acceptance` as a
meta line, Library filter, and `/enloop:write --quick`. Simple, and each case
reads cleanly on its own. But the feature gets authored twice, which spends
tokens to save tokens, and the two drift: the quick case still asserts on a
button the acceptance case knows was renamed.

**Option B — one case, tiered steps (recommended).** The case is authored once,
in full. Steps carry an optional `Kind: quick` marker, and starting a run
offers **Quick** or **Full**; a quick run materialises only the marked steps.

B is better on the axis the user actually raised. The token cost is paid once,
there is one document to keep true, and "which steps are the core path?" is a
judgement the author is already making while writing. It also composes with
suites: a suite's prep steps are always included, since a quick run that skips
logging in is not a run.

What B needs:

- Grammar: `Kind: quick` in the step header block, alongside `Where:` and
  `Selector:`. Absent means acceptance-only. Format version bump.
- `composeRunSource`/run creation filters steps by tier **before** freezing
  `case.md`, so the frozen artifact is exactly what was executed and step ids
  stay contiguous (`step-1..N`) rather than gapped — the run record must not
  need to know about steps that were never run.
- `run.tier` (`quick` | `full`) recorded and shown on the run, in the report,
  and in run history. A quick pass and a full pass are not the same evidence,
  and a history that cannot distinguish them is misleading.
- The case detail screen shows both counts: *"12 steps · 4 quick"*.
- `/enloop:write` gains a mode. Quick mode is a genuinely different budget:
  *(Superseded: the mode shipped as two skills, `/enloop:quick` and
  `/enloop:full`, rather than a flag on one.)*
  no full app-map build, only the screens on the happy path, fewer variables,
  and it marks the steps it writes as `Kind: quick`. Acceptance mode is
  today's behaviour and additionally fills in around an existing quick case
  rather than restarting from scratch.
- `/enloop:check` should say which tier a run used before judging coverage —
  "passed" on a quick run does not mean the case passed.

**Backend note:** `case_version.quick_step_count int`, `run.tier text`
(`PLAN-BACKEND.md` §4.2, §4.4). The server's step indexer stays as-is; tiering
is a client-side filter, consistent with §3.3.

### Open questions

- **Does a quick run count as a pass?** For a release checklist, no. Suggest:
  a case's "last passed" is tracked per tier, and any release-facing view reads
  the full-tier value.
- **Should a failing quick run block writing the acceptance case?** Probably —
  no point spending the acceptance budget on a feature that does not work yet.
  That is a report line in `/enloop:write`, not a mechanism.

---

## 5. Capture the page's console during a run

### The problem

A run records what the tester can see, and the console is the one place where
the most useful evidence of a bug is both cheap to collect and invisible by
default: an uncaught `TypeError` behind a button that appears to do nothing, a
401 logged by a fetch wrapper, a framework warning that explains why a list
renders twice. Today the only route into a run is a tester noticing, opening
DevTools, and pasting text into a step comment — which means it happens on the
runs where someone already suspected a problem, and never on the green ones.

Automated steps do surface their own thrown errors, but only their own: an
error thrown by the page's code a tick after the step's script returned is not
theirs and is lost.

### Why monkeypatching, and why it needs a reload

Reading the console properly means `chrome.debugger` / CDP, which shows the
"Enloop started debugging this browser" banner and fights with a DevTools
window the tester may well have open. That is too much tax for a background
convenience. So instead: **wrap `console.*` in the page's own MAIN world**,
keeping the original methods and calling through, and forward a copy to the
extension.

Two constraints fall out of that, and they are what forces the reload:

- The wrapper must be installed **before any page script runs**. Later, and it
  misses everything logged during load — usually the interesting part — and
  any module that captured `console.error` into a local at import time keeps
  bypassing the wrapper forever.
- MV3's only guarantee of `runAt: "document_start"` in `world: "MAIN"` is a
  registered content script (`chrome.scripting.registerContentScripts`), and a
  registration takes effect **on the next navigation**. `executeScript` into a
  page that is already loaded runs far too late to be worth doing.

So the current page's console is already past capture at the moment the toggle
is flipped. That is a fact about the page, not a limitation to paper over —
the UI should say it plainly rather than silently capturing a partial log that
the tester will later read as complete.

**Turning it off does not need a reload, and should not ask for one.** The
wrapper stays installed on already-loaded pages, but an ISOLATED-world
companion relays the enabled flag in (a `CustomEvent` on `document`, since
MAIN world cannot read `chrome.storage`), and a disabled wrapper simply calls
through without forwarding. On → next load. Off → immediately. Worth stating
in the UI, because an asymmetry that is explained reads as a design and an
asymmetry that is not reads as a bug.

### The toggle, and the notice

In `SettingsScreen`, a new **Console capture** section, default **off**:

> ☐ Capture console output during runs
> Wraps `console.log`/`warn`/`error` on pages you run cases against and files
> what they print with the run. Off by default; console output can contain
> tokens and customer data, and runs are written to a folder people commit.

When the toggle goes on, the panel shows an inline notice under it:

> **Reload the page to start capturing.** This page's console has already run.
> Enloop can only wrap it from the next page load. **[Reload page]**

The button calls `chrome.tabs.reload(tabId)` on the active tab. The notice
must be driven by **fact, not by a timestamp heuristic** — ping the active tab
with `chrome.scripting.executeScript({ world: "MAIN", func: () => !!window.__enloopConsole })`
and show the notice whenever the answer is `false`. It then clears itself on a
reload, stays up if the tester ignores it, and reappears correctly when they
switch to a tab loaded before the toggle went on, which a stored `enabledAt`
would get wrong in exactly that case.

The same notice belongs at the top of `RunScreen` while a run is in progress
with capture on and no wrapper in the active tab — Settings is not where
someone is looking when the evidence is being lost.

### Registration lifecycle

- On enable: `chrome.scripting.registerContentScripts([{ id: "enloop-console",
  matches: ["<all_urls>"], js: ["console-capture.js"], world: "MAIN",
  runAt: "document_start" }])`, plus the ISOLATED companion that relays state
  and forwards messages to the extension.
- On disable: `unregisterContentScripts`. Registrations **persist across
  browser restarts**, so leaving one behind means Enloop injects into every
  page of a user who turned the feature off. Reconcile on startup in
  `background/index.ts` — read the flag, make the registration match it.
- No new permissions: `scripting` and `<all_urls>` are already in
  `manifest.config.ts`. The feature adds no install-time prompt, which is
  precisely why the default has to be off and the copy has to be honest.

### What is captured

`log`, `info`, `warn`, `error`, `debug`, plus `window.onerror` and
`unhandledrejection` — uncaught errors matter most and in some frameworks
never reach `console.error` at all. Each entry: level, timestamp, page URL,
and arguments run through a bounded formatter (cycle-safe, `Error` → message +
stack, DOM nodes → tag + testid, each argument truncated).

**`fetch` and XHR patch the same way, and are the obvious second cut.** Same
shim, same `document_start` MAIN-world injection, same reload constraint, same
toggle — wrap `window.fetch` and `XMLHttpRequest.prototype.open/send`, keep the
original, and forward method, URL, status and duration. It is the other half of
the same evidence: a button that did nothing because a request 500'd shows up
in the network log and often nowhere else.

It is a second cut rather than part of the first for one reason: **the privacy
story is genuinely different.** Console output leaks whatever the app chose to
print; requests carry auth headers, cookies and request bodies by design. So
if this is built: never capture headers or bodies, capture failures and
4xx/5xx only rather than every request, redact query strings by default, and
give it its own toggle rather than riding on the console one — a tester who
agreed to capture logs has not agreed to capture traffic.

### Where it lands

Not in `run.json`. That file is rewritten on every step patch, and console
volume is unbounded — a chatty app would turn every keystroke into a
multi-megabyte write.

- **`console.md` in the run folder**, next to `case.md` and `run.json`,
  append-only, grouped by step. `RunStore` gains
  `appendConsole(testCaseId, runId, entries)`; `FsaDataStore` appends, and the
  hosted store (`PLAN-BACKEND.md` §4.4) takes a batch endpoint.
- **Per-step counts in `run.json`**: `runStepStateSchema` gains
  `consoleErrors: number` and `consoleWarnings: number`, both
  `.default(0)` so runs written before this parse unchanged — the same upgrade
  shape as `comment` and `tier`. Counts live in state so the report and
  `/enloop:check` can point at a step without parsing the artifact.

Entries are stamped with the step that was running when they arrived; anything
logged between steps attaches to the step that just finished. A cap per run
(order of 2000 entries or 512 KB) drops oldest with an explicit
`… N entries dropped` marker — a noisy app must not be able to make a run
unsavable, and silent truncation would be worse than the cap.

### Report and feedback

- `renderRunReport`: a per-step line when counts are non-zero
  (*"Console: 2 errors, 1 warning"*), and the errors themselves under the step.
- `renderRunFeedback`: **a console error during a step the tester marked
  passed is signal in its own right**, on the same argument as the run comment
  in §3. A green run with a stack trace in it is exactly the finding that
  currently disappears.
- `/enloop:check` must distinguish *the page threw* from *the step failed*:
  they usually coincide, and when they do not, the console error is the more
  precise statement of what broke.

### Attaching it to what the LLM reads — opt in, at the end of the run

Capturing is one decision; **handing the log to a model is a second one**, and
it is made at a different time with different information. At finish the
tester knows whether the run was interesting, and the log exists to be looked
at rather than guessed about. So: a checkbox in the finish bar of `RunScreen`,
next to the run comment from §3, which is already the end-of-run surface.

> ☐ Include console output in the report (12 errors, 40 warnings)

- **`runFileSchema` gains `consoleInReport: boolean`, `.default(false)`.** On
  disk, so `/enloop:check` and any later reader see the tester's decision
  rather than re-deciding it.
- **Default it checked when the run captured at least one error or uncaught
  exception, unchecked otherwise.** A clean log is noise; a log with a stack
  trace in it is the reason the feature exists. Defaulting off in both cases
  would mean the box only ever gets ticked by someone who already knew what
  they were looking for, which is the failure mode §5 opens with.
- **What gets attached is a digest, not the raw log.** Errors, warnings and
  uncaught exceptions; deduplicated by normalized message with an occurrence
  count and the step each first appeared in; stack frames from the app's own
  origin kept and vendor frames collapsed; hard-capped. A raw log is mostly
  repetition, and repetition in a prompt is both expensive and actively
  misleading — fifty identical React warnings read as fifty problems.
- `renderRunReport` embeds the digest under the run comment when the box is
  ticked. `console.md` stays on disk either way; the checkbox governs what
  crosses into the report, not what is kept.

**The rule for `/enloop:check`:** read the digest in the report; when the box
was unticked, note that a console log exists and was not attached, and **do
not go read `console.md` anyway.** A tester who declined to share a log that
may contain a customer's data has made a decision, and a skill that routes
around it makes the checkbox a lie. Worth stating in the skill body, not just
here — the file is sitting right there in the run folder, and reading it is
the locally helpful thing to do.

### Check

Enable → notice appears → reload → run a case → `console.error("boom")` from
DevTools mid-step → it is in `console.md` under that step and counted in
`run.json`. Then the negatives, which are the ones that actually bite:
disable → `chrome.scripting.getRegisteredContentScripts()` is empty; restart
Chrome with it disabled and confirm it stays empty; and confirm a page whose
own code reads `console.error.toString()` or reassigns `console` still works.

**Backend note:** run-scoped console storage — a `run_console_entry` table or
a `console_body text` on `run`, plus `run_step.console_errors` /
`console_warnings int not null default 0`, and
`run.console_in_report boolean not null default false`
(`PLAN-BACKEND.md` §4.4). Prefer the text blob: entries are only ever written
in batches and read whole.

### Open questions

- **Global toggle, or per-run capture?** Per-run is the better default — you
  want the log for a run and not for the rest of your browsing — but it puts
  the reload at the start of every run, which is worse in practice. Start
  global; revisit if the noise is bad.
- **Levels.** Capturing `log`/`info` on a chatty app buries the two levels
  anyone reads. Suggest: capture all levels but store `warn`/`error`/uncaught
  by default, with an "include log and info" checkbox that appears once the
  toggle is on.
- **Free runs.** They should capture too — an unscripted session is exactly
  where an unexplained console error is worth having. Entries attach to the
  session rather than a step, and land in `notes.md`'s sibling.
- **Does the attach checkbox survive an aborted run?** An abort is where the
  console log is most likely to explain what happened, and also where the
  tester is least inclined to fill in a finish bar. Suggest: Abort attaches the
  digest whenever there were errors, without asking.

---

## 6. Standalone suite builder — **low priority, not important**

### The problem

The extension cannot be used without the skills. Cases are Markdown in a
grammar nobody reads first, and the panel's own editor is a bare textarea over
that grammar: real authoring happens in `/enloop:write`, from the app repo,
where the routes and selectors can be derived from source. That coupling is
deliberate and stays — a hand-written case with invented selectors is the
failure mode the whole loop exists to avoid.

It does mean the extension alone has no path from "installed" to "running
something", which the bundled example case now covers for evaluation but not
for use. Someone who wants a small suite of their own — a smoke path they
already know by heart, a checklist for a release — has to install Claude Code
and a plugin to get it.

### Shape, if it is ever built

A guided builder in the panel that produces the same Markdown the skills
produce, so nothing downstream learns a second format:

- **Step by step, in the page.** Add a step, then pick its element by clicking
  it in the tab rather than typing a selector — the panel already injects into
  the page for Highlight and value insertion, so the missing piece is a picker
  that walks up from the clicked node to the most stable handle it can find
  (`data-testid`, `id`, `name`, `aria-label`), and refuses to emit a
  structural path rather than emitting a fragile one.
- **`Where:` captured, not typed** — the tab's current URL, offered as a
  route once a `BASE_URL` variable exists.
- **Expected written by the author**, one bullet per line. No generation:
  this is the part a human has to mean.
- **Output is a case file** in `test-cases/`, indistinguishable from a
  written one, which `/enloop:check` can then fix later if the case turns out
  to be the thing that is wrong.

### Why it is not a priority

It builds a second authoring path that is strictly worse than the first for
the case that matters — a case derived from the diff of what actually changed
— and it competes for the same attention as the backend. The evaluation gap it
would close is already closed by the example case. Revisit only if real
demand shows up from people who want the runner without the loop, and treat
the picker as the interesting half: it is also what `/enloop:instrument` would
want in order to show you what it is about to tag.

# Enloop tooling — workflow plan

Status: **items 3, 4 and 5 built; 8 is the next one to build; 1, 2 and 7
outstanding; 6 parked.** Written 2026-08-04.

Scope split: [`PLAN-BACKEND.md`](PLAN-BACKEND.md) owns the hosted backend —
accounts, projects, the HTTP API, environments. This document owns the skills
and the extension workflow. Items here that need a schema column say so
explicitly, so the backend plan can pick them up rather than discovering them.

Eight items. **3 and 4 are built** (2026-08-04) and **5 is built** (2026-08-08,
including the network cut it describes as a second pass); their sections are
kept as the record of what was decided and why, with what changed on the way
recorded under each. **8 is high priority and next** — it is the one item here
that changes the quality of every case written from now on, rather than what
happens around a case. 1 and 2 remain outstanding, and they are a pair: the
first takes a capability away from `/enloop:setup`, the second gives it a proper
home. **7 is outstanding** and extends 5 — it is the revisit 5 asked for, and
the only item that changes something already shipped. **6 is parked** — low
priority, recorded so the idea stops being re-litigated, not queued.

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

## 5. Capture the page's console during a run — **implemented 2026-08-08, with the network cut**

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

### What changed on the way in

Six deviations from the design above, each because the design was wrong about
something rather than because it was inconvenient:

1. **Registration is against the origins the tester has granted, not
   `<all_urls>`.** This document claimed `<all_urls>` was already in the
   manifest, but it is in `optional_host_permissions` — a list of what may be
   asked for, not of what was given. Chrome will not register a content script
   for a host the extension cannot access. So `background/capture.ts` builds
   `matches` from `chrome.permissions.getAll()` and re-syncs on
   `permissions.onAdded`/`onRemoved`. Consequence worth knowing: capture starts
   on a site the moment that site is granted, and never before.
2. **Two files, not one.** `console.jsonl` is appended live (the record);
   `console.md` is rendered from it when the run finishes (for people). The
   digest needs the entries back, and parsing them out of prose we had just
   written would have been a parser to maintain for nothing.
3. **The cap stops capture instead of dropping the oldest entries.** Entries
   are already on disk when a cap is reached, and the earliest ones — the load
   — are the most valuable, so evicting them would have spent the budget on
   exactly the wrong half. Both the entry cap and the byte cap write a `notice`
   line into the log, so a capped log never reads as a quiet page.
4. **Per-step counts are folded into `run.json` when the run finishes**, not on
   every append. They are only read after a run ends, and rewriting `run.json`
   every few seconds would have fought the step patches for the same file.
5. **The network cut was built at the same time, with its own toggle** — as
   section 5 asked. Query strings are redacted from page URLs as well as
   request URLs; the same risk applies and the two paths share one redactor.
6. **The digest sits in one `## Console and network` section** with short
   per-step lines pointing into it, rather than the full text under each step:
   deduplication is the whole value, and splitting it across steps un-dedupes
   it.

### The open questions, answered

- **Global toggle, not per-run** — as suggested, and the revisit it asked for is
  **item 7**, which turns out to be a bookkeeping change rather than the
  reload-per-run trade this section feared.
- **Levels:** every level is captured and every level is kept in `console.md`.
  The proposed "include log and info" checkbox turned out to be unnecessary,
  because the digest — the only thing that ever reaches a prompt — drops
  `log`/`info`/`debug` on its own and says how many it dropped.
- **Free runs capture**, into `console.md` next to `notes.md`, grouped under the
  session. Nothing from there reaches `feedback.md`: a free run has no finish
  bar to ask the question in, and an unasked question is not consent.
- **An aborted run needs no special case.** The checkbox already defaults to
  ticked whenever an error was captured, and abort persists whatever it says —
  so an abandoned run keeps its digest without being asked, and a tester who
  explicitly unticked the box is still obeyed.

### Check

Enable → notice appears → reload → run a case → `console.error("boom")` from
DevTools mid-step → it is in `console.md` under that step and counted in
`run.json`. Then the negatives, which are the ones that actually bite:
disable → `chrome.scripting.getRegisteredContentScripts()` is empty; restart
Chrome with it disabled and confirm it stays empty; and confirm a page whose
own code reads `console.error.toString()` or reassigns `console` still works.

**Backend note:** run-scoped console storage — a `run_console_entry` table or
a `console_body text` on `run`, plus `run_step.console_errors` /
`console_warnings` / `network_failures int not null default 0`, and
`run.console_in_report boolean not null default false`
(`PLAN-BACKEND.md` §4.4). Prefer the text blob: entries are only ever written
in batches and read whole — that is exactly what the local store's
`console.jsonl` turned out to be, so the batch endpoint is an append to it.

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

---

## 7. Capture per run, and the option to keep every request

Extends item 5, which is built. Two changes, and they land together because the
second one is only tolerable once the first exists.

### The problem

**The global toggle answers one question and then answers it for everything.**
Once capture is on, every run against a granted site captures, and so does every
page in the window between runs — so a tester who wanted the console for one
flaky case collects output from every other case they touch that afternoon, and
`console.md` files pile up in runs nobody was ever suspicious about. Going the
other way is worse: deciding mid-flow that *this* run needs watching means
leaving the run, opening Settings, coming back, and reloading the page — four
moves at the exact moment the tester had decided to look at something.

**And only failures are recorded.** That was the right first cut for privacy,
but it leaves one common question unanswerable. A button that did nothing
because **no request was sent at all** looks identical, in the log, to a button
that did nothing because the page threw somewhere unrelated. Absence of a
request is evidence, and only a record of all of them can show it.

### The split that makes per-run cheap

Item 5's own open question assumed per-run capture meant a reload at the start of
every run. It does not, because two different decisions are riding on one
toggle:

- **Arming** — installing the wrapper. Browser-wide, per granted origin, and it
  only takes effect on the next page load. This is Settings' job and stays
  there, reload notice and all.
- **Recording** — whether entries arriving now are kept for *this* run. Instant,
  per run, no reload, because the wrapper is already installed and merely stops
  or starts forwarding.

Item 5 already built the second half: the wrapper forwards, the service worker
refuses everything when no target is set, and switching capture off reaches
loaded pages immediately. So per-run capture is a UI-and-bookkeeping change over
machinery that exists.

**Rejected: register at run start, unregister at finish.** It would make
"capture during runs" literally true, and it costs a reload at the start of
every run — which is not merely a delay, it destroys the state the run's
prerequisites just established: a seeded form, an SPA route, an open modal, a
session the tester logged into by hand. A reload that resets the app under the
tester is worse than a wrapper sitting idle on pages nobody is recording.

### The run-start surface

The pre-run screen already asks two things — variable values, and quick or full.
Capture becomes a third block on it:

> **Capture during this run**
> ☐ Console output ☐ Failed requests ☐ Every request *(verbose)*

- **Defaults come from Settings**, which becomes "what new runs start with", so
  a tester who always wants console output sets it once and never sees the
  question again.
- **When capture is not armed the boxes are disabled**, with one line saying why
  and an *Arm capture* affordance next to it. Nobody should have to learn the
  word "registration" to find out why a checkbox is grey.
- **The same block at free-run start**, for the same reason capture covers free
  runs at all.

Settings keeps the reload notice, because the reload belongs to installation, not
to recording — and the copy has to say that plainly, or the two toggles read as
duplicates of the run-start ones.

### Where the choice is recorded

On the run: `runFileSchema` gains
`capture: { console: boolean; requests: "none" | "failed" | "all" }`, defaulted
so runs written before this parse unchanged. On disk rather than in panel state,
for three reasons:

1. A run resumed after the panel closed — or after a browser restart — must keep
   recording what it was recording, and panel state does not survive either.
2. `report.md` can then say what was *not* captured. "The console was quiet" and
   "the console was not being watched" are different sentences, and item 5
   currently cannot tell them apart in a run with no console section.
3. `/enloop:check` needs that same distinction, and it reads files.

`useCapture` then gates on the run's own flags rather than the global setting,
and sets the worker's target only when the run says so.

### Every request

A third *state*, not a fourth checkbox: `requests` is `none`, `failed` or `all`.
"All" includes failures by definition, and two independent booleans would permit
the nonsense of "every request except the failed ones".

A successful request forwards as a new level, `request`, kept distinct from
`network` (which stays the failure level) so that nothing downstream has to read
a status code to know what kind of line it is holding.

Three things must not happen, and each one is a design constraint rather than a
detail:

1. **Successes must not starve errors.** The per-run caps are shared, and an app
   that polls can produce hundreds of 200s a minute — a cap filled with those
   means the `TypeError` arrives after capture has already stopped. So `request`
   entries get their own sub-budget (order of 500) and are dropped when it is
   spent, leaving console lines and failures their full allowance. This is the
   part most likely to be got wrong, because it only shows up on a busy app.
2. **Successes must not enter the digest.** The digest is what a model reads;
   fifty 200s in it is fifty lines of nothing, and it would push the one error
   out under the item cap.
3. **`console.md` must not become a request log with a run buried in it.** So
   successes are **rolled up per step at render time** — one line per
   method + path + status, with a count and a duration range — while failures
   stay verbatim and in time order where they happened. `console.jsonl` keeps
   every line either way: the roll-up is a rendering decision, which is what
   makes it revisable without changing what was captured.

Per-step counts in `run.json` gain `requests: number`, counting all of them,
failures included. That count is what answers "did this step send anything at
all" — the question that motivated the option in the first place.

Headers and bodies are still never captured, and query strings are still
redacted. "All requests" widens *which* requests are recorded; it never widens
*what* is recorded about one.

### What this touches

- `public/console-capture.js` — the state event carries
  `requests: "none" | "failed" | "all"`; the `fetch`/XHR wrappers emit `request`
  for a success when it is `all`.
- `lib/capture.ts` — `CaptureSettings` becomes arming plus defaults for new
  runs; the per-run flags travel with the target.
- `background/capture.ts` — **unchanged**, which is the point: the target already
  decides what is kept.
- `shared/src/capture.ts` — the new level, the sub-budget, the roll-up in
  `renderCaptureLog`, and one line in `buildCaptureDigest` to ignore `request`.
- `sidepanel/useCapture.ts` — gate on the run's flags instead of the setting.
- The pre-run screen, the free-run start, and `SettingsScreen`.

### Check

Arm capture, reload the page, start a run with all three boxes off →
`console.jsonl` is never created. Start a second run with console on and requests
`all` → both streams are recorded, and a third run started afterwards comes up
with the Settings defaults rather than the previous run's choices. Resume a run
mid-flight after closing the panel and confirm it is still recording what it was
started with, not what Settings currently says.

Then the volume case, which is the one that will actually bite: run against an
app that polls, confirm the per-step roll-up in `console.md` is a handful of
lines rather than hundreds, and confirm that an error logged after 600 successful
requests is still in the log.

### Open questions

- **Does arming have to be browser-wide?** A registration is per origin, and a
  case usually knows the origin it runs against (`Where:`, a `BASE_URL`
  variable). Arming could follow the case's own origins instead of every granted
  site, which would make "capture during runs" nearly true. It needs the origin
  to be knowable before the run starts, which is not reliably the case today.
- **Slow requests as their own signal.** With every request recorded, a
  four-second 200 becomes visible for the first time, and "felt slow throughout"
  would finally have evidence under it. A threshold — say 2s — could forward a
  line the digest keeps. Unclear whether that is a level of its own or a flag on
  `request`.
- **Should a run's capture flags show in the run history?** A finished run that
  captured nothing and one whose log was captured but never attached currently
  look identical in the list, and both look like a run with a quiet page.

**Backend note:** `run.capture_console boolean not null default false`,
`run.capture_requests text not null default 'none'`, and
`run_step.requests int not null default 0`, alongside item 5's columns
(`PLAN-BACKEND.md` §4.4). The per-run flags are also what a hosted run needs in
order to report what it was watching, so they are not a local-mode detail.

---

## 8. Per-project authoring rules, kept in the folder — **high priority**

### The problem

Every project has a handful of facts that decide whether a case is any good,
and none of them are written down anywhere the loop can reach.

"Reach the admin area through the sidebar, never by typing the URL — the route
guard redirects on a cold load." "Our test handles are `data-qa`, not
`data-testid`." "Never use `admin@` — it is the shared demo account and other
people are logged into it." "The Contacts grid is inside an iframe, so no
selector will find it." "Every case must end by deleting what it created,
because the seed data is not reset between runs." "We call them *placements*,
not *jobs*."

Today those live in three places, none of which work:

- **In a person's head**, which means every case an agent writes re-makes the
  same mistake, and a tester reviews the same correction every time.
- **In the repo's `CLAUDE.md`**, where `/enloop:setup` puts the selector
  convention. That reaches Claude Code sessions in that repo and nothing else —
  not Codex, not the panel, not the tester reading a case, and not a colleague
  who cloned the repo and opened the Library.
- **Inside individual cases**, copied by hand into `# Prerequisites` and step
  notes, where they go stale one case at a time.

The result is that `/enloop:check` fixes the same class of case defect over and
over. It fixes the case; nothing fixes the rule.

### What a rules file is, and is not

**It is:** the project-specific conventions a case must follow to be worth
running — how to navigate, what to call things, which accounts and data are
fair game, what every case in this project must include, and which parts of the
app cannot be reached or automated at all.

**It is not:**

- **Not a second grammar.** The case format in `shared/src/markdown.ts` is not
  negotiable — a case that violates it does not parse. Rules refine what a
  well-formed case *says*; they never change what a case *is*, and a rule that
  tries to is ignored.
- **Not a lint engine**, in this pass. A few lines are structured enough for the
  panel to check mechanically (see below); the rest is prose addressed to
  whoever — human or model — is writing the next case.
- **Not a place for secrets.** The file is committed, on purpose. Credentials,
  client names and customer data belong nowhere near it, and the panel's editor
  says so above the textarea rather than in a doc nobody opens.

### Where it lives

**`rules.md` at the root of the storage folder**, next to `test-cases/`,
`runs/` and the `.gitignore` the panel already writes.

That location is the whole point, and it follows directly from
`PLAN-STORAGES.md`: a storage inside an app repo means the cases are committed
with the code they test. The rules belong in exactly the same commit, for
exactly the same reason — a colleague who clones the repo gets the conventions
along with the cases, and a rule change arrives as a reviewable diff in a pull
request instead of as a message in a chat.

`runs/` and `free-runs/` stay ignored; `rules.md` is tracked. Nothing about the
existing `.gitignore` needs to change, which is worth checking rather than
assuming when this is built.

**One storage, one file.** Where a folder serves several products — a central
Library rather than a repo-local one — the file is scoped inside itself with
`# Project: <name>` sections that apply only to cases carrying that `@project`,
and everything outside such a section applies to all of them. Reusing the
document's own section splitting (`splitTopSections`) rather than inventing
per-project files keeps the thing a person edits down to one, and keeps the
diff in one place.

### Shape

The same split the case grammar already uses: a small block of structured lines
that a machine can act on, then prose for everything that needs a sentence.

```markdown
# Enloop rules — Careerminds

Reviewed: 2026-08-08

Selector attribute: data-qa
Base URL: https://staging.careerminds.test
Require cleanup step: yes

# Navigation

Reach the admin area through the sidebar. Typing `/admin` directly hits a route
guard that redirects to the dashboard on a cold load, so a case written that way
fails for everyone except the person who wrote it.

# Accounts and data

Use `qa+%TIMESTAMP%@careerminds.test`. Never `admin@` — it is shared, and
somebody else is always logged into it.

# Known traps

The Contacts grid renders in an iframe. Highlight cannot reach it and an
automated step cannot script it; write those steps manually and say so.

# Vocabulary

Placements, not jobs. Candidates, not users.
```

The structured lines are the ones worth agreeing on now, because everything
downstream keys off them: `Selector attribute` is what `/enloop:instrument`
emits and what `/enloop:review` (item 2) measures against, `Base URL` is what a
`Where:` line is relative to, and `Require cleanup step` is the first thing the
panel could check mechanically without anybody arguing about taste.

### Who reads it, and in what order

1. **`/enloop:quick` and `/enloop:full`, before drafting anything.** This is the
   primary consumer and the reason the item is high priority: it is the cheapest
   possible way to stop an agent re-deriving — and re-getting-wrong — the same
   five facts on every case.
2. **`/enloop:check`, while triaging.** Whether a finding is an app bug or a
   case defect frequently depends on a rule. A case that used the URL instead of
   the sidebar is a case defect *because the rules say so*, and without them the
   skill argues it from first principles every time and sometimes decides the
   app is at fault.
3. **`/enloop:instrument`**, for `Selector attribute`.
4. **The panel**, which renders them on the project and offers the editor.

Precedence, stated once so it never has to be re-argued: **grammar beats rules,
rules beat the plugin's general guidance** (`references/authoring.md`,
`step-contract.md`), **and observed code beats a rule that contradicts it** — in
which case the skill says so and offers to fix the rule, rather than quietly
following a line that has gone stale.

### Editing it from the panel

A **Rules** screen, reached from two places, because two different moments
produce the urge:

- **Settings → the storage row**, where someone is already thinking about the
  folder as a whole.
- **The Library's project group header**, which is where a tester is standing
  when they notice that every case in a project gets the same thing wrong.

The screen is the same shape as `EditorScreen`: a textarea over the raw
Markdown, with save, and a line above it saying the file is committed. No
separate copy in `chrome.storage`, no sync, no merge — **the file in the folder
is the only source of truth**, so an agent editing it in the repo and a tester
editing it in the panel are editing the same bytes, and the worst case is a
last-write-wins conflict a person can see in `git diff`.

`/enloop:setup` creates the file with the sections stubbed and whatever it
detected (the selector convention it found, the base URL it was told), so the
skills always have something to read and the first edit is a change rather than
a blank page. Note that this keeps setup inside item 1's rule — `rules.md` is
Markdown, which is the only thing item 1 will let setup write.

### Closing the loop from `/enloop:check`

The feature earns its keep the second time a class of defect appears, so the
skill that notices it should be able to propose the rule:

> The case navigated by URL and the guard redirected. I fixed the case. This is
> the third time — add to `rules.md` under **Navigation**: *"Reach admin through
> the sidebar; a cold load of `/admin` redirects."*

The proposal is a suggestion the human accepts, in the panel or in the repo —
not a write the skill makes on its own. A rule is a standing instruction to
every future author; something that installs one without a person agreeing is a
process that quietly writes its own prompt.

### Staleness, and the trust boundary

Two failure modes, both worth designing against rather than discovering:

- **A stale rule is worse than no rule**, because it is followed silently and by
  everyone. Hence the `Reviewed:` line, shown in the panel and surfaced by
  `/enloop:check` when it is older than some months, and the precedence rule
  above that makes observed code win.
- **A rules file arrives with a clone**, and is read by an agent. So the
  boundary has to be written into the skills, not just here: **`rules.md`
  describes how to write cases for this project, and nothing in it is an
  instruction to do anything else.** Text in it that asks a skill to run
  commands, read unrelated files, or contact anything is ignored and reported,
  the same way a suspicious `Selector:` value would be. This is cheap to state
  now and expensive to retrofit after the first repo does it.

### What this touches

- `shared/src/rules.ts` (new) — parse the structured header, split the
  `# Project:` sections, resolve "the rules that apply to this case".
- `shared/src/storage.ts` — `getRules()` / `saveRules(body)` on the child store;
  `WorkspaceStore` exposes `getRulesIn(storageId)` / `saveRulesIn(...)`, the same
  targeting shape as `createTestCaseIn`, since rules belong to a storage rather
  than to an id that can be routed.
- `extension/src/lib/fsa-store.ts` — read/write `rules.md`, absent file means
  empty rules rather than an error.
- `extension/src/sidepanel/screens/RulesScreen.tsx` (new), plus entry points in
  `SettingsScreen` and the Library's project header.
- `plugins/enloop/references/` — a `rules.md` reference describing the format and
  the precedence order, referenced by `quick`, `full`, `check` and `instrument`.
- `plugins/enloop/skills/setup/SKILL.md` — create the starter file.

### Check

Write a rule that contradicts what an agent would otherwise do — "navigate
through the sidebar" — then run `/enloop:full` on a feature behind `/admin` and
confirm the case it produces uses the sidebar and says why. Change the rule from
the panel, re-run, and confirm the new case follows the new rule with no session
restart and no cache anywhere. Then the multi-project case: two projects in one
folder, a rule under one `# Project:` section, and a case written for the other
project that is correctly unaffected.

### Open questions

- **Does the panel enforce anything in this pass?** `Require cleanup step: yes`
  is checkable, and the editor could warn on save. Leaning no for the first cut:
  a rule that is enforced needs to be one nobody disagrees with, and we do not
  yet know which ones those are.
- **Do rules belong to the storage or to the project?** They are stored per
  storage and scoped per project inside the file, which is right for a repo-local
  folder and slightly awkward for a central one. If central folders turn out to
  be common, `rules/<project>.md` becomes the better shape — the parser should be
  written so that change costs one function.
- **Should a case record which rules were in force when it was written?** It
  would make a stale-rule diagnosis exact, and it puts a `Rules version:` line in
  the case grammar, which is a real cost to pay for a diagnostic.

**Backend note:** hosted storage needs the same thing per project — a
`project.rules_body text not null default ''` with a `rules_reviewed_at`, plus
`GET`/`PUT /projects/{id}/rules` (`PLAN-BACKEND.md` §4.2 and §6.2). One column,
because the file is the unit of editing; parsing stays in TypeScript, on the D5
rule that PHP only ever indexes.

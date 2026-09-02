# Enloop hardening — tests, CI, and the gaps under the design

Status: **nothing built. Written 2026-08-24.** Source: a full-codebase audit
(shared, extension, daemon, plugins, tooling) run on 2026-08-24 against a
working tree that included the uncommitted post-0.12.0 changes. Line numbers
below were read from that tree — **re-verify each reference before editing;
treat them as "near here", not gospel.**

Scope split: [`PLAN-DAEMON.md`](PLAN-DAEMON.md) owns what enloopd *is*;
items 7–8 here fix how the built daemon keeps its own protocol promises.
[`PLAN-TOOLING.md`](PLAN-TOOLING.md) owns the skills workflow;
[`PLAN-AUTHORING.md`](PLAN-AUTHORING.md) owns case content. This document
owns something none of them claim: **enforcement**. The audit's one-line
verdict was that the design reasoning is well above average and almost none
of it is enforced by anything — no test suite anywhere in the repo, no CI on
the extension or daemon, race rules argued in prose but implemented with
non-atomic writes, a provenance guard that is a `String.includes`.

Eleven items. **1 and 2 first, in that order** — item 1 is the safety net
every other item's "Check" section leans on, and item 2 is what makes the
net run without being remembered. 3–4 are small correctness/security fixes
that go test-first once 1 exists. 5–6 are the extension's two real risks.
7–8 are the daemon's. 9 is release automation. 10 is the recorded backlog
of smaller cleanups so they stop being re-discovered by every future audit.
**11 is the one feature item** — feedback export for runs with no backend —
kept here rather than in a feature plan because it closes the same loop the
rest of this document hardens: what happens to a tester's verdicts when no
agent is there to receive them.

The technology choices themselves were audited and pass: side panel + FSA +
file-as-IPC, hand-rolled line-oriented parser, raw-TS shared package, React
19 + Vite + Tailwind 4 are all coherent for a local-first tool. Nothing in
this plan replaces a technology; everything hardens what exists.

---

## 1. A test suite, starting where the data can't be reconstructed

### The problem

There is no `*.test.*` file and no `test` script in any workspace. The only
verification anywhere is `evals/run.mjs` (local-only, costs API money) and
the manual `enloop-demo` live check. Meanwhile `shared/src/markdown.ts` is
the highest-churn file in the repo (24 of 92 commits touch it), it defines a
versioned file format users commit next to their code, and its own doc
comment names the property nobody checks — near `markdown.ts:657`: *"The
property that must hold, and the one worth testing:
`parseCaseDocument(renderCaseMarkdown(doc))` returns `doc` again."*

That property is violated today (item 3). A round-trip test would have
caught it the day it was introduced.

### The change

Add **vitest** at the workspace root, with the first suite in `shared/`:

- **The round-trip property**, exactly as the doc comment states it, run
  over a committed fixture corpus. Build the corpus from: the README
  example, the extension's bundled example case, every fenced case in
  `docs/case-format.md`, plus hand-written edge cases (suite prep steps,
  `Match:`, multiple `Selector:` lines, automated steps, `Kind: quick`, a
  step whose `### Expected` contains a fenced code block).
- **Pure-function coverage** for the load-bearing helpers, all testable
  with no browser: `checkRunCompat`, `compareVersionIds` / `nextMajorId`,
  `substituteVariables` / `resolveVariableValues`, `filterToQuickSteps` /
  `countQuickSteps`, `buildRunSource`, `lintCase`.
- **Daemon store/protocol tests** on a tmpdir (`node:test` semantics but
  keep vitest for one runner): claim/yield arbitration, terminal-artifact
  precedence, orphan reaping, the tool jail, provenance (items 7–8 land
  test-first against these).
- Root script: `"test": "vitest run"` plus per-workspace projects config.

Not in scope for this item: extension component tests, and `FsaDataStore`
I/O tests. The latter is worth doing later against OPFS
(`navigator.storage.getDirectory()` gives a real
`FileSystemDirectoryHandle` in browser-mode vitest — the class needs
nothing else, and someone already left a "tests" escape hatch in
`touchHeartbeat` near `fsa-store.ts:1244`). Record it, don't block on it.

### Check

`npm test` at the root runs green in under a minute with no network, no
credentials, no browser. The round-trip test **fails** before item 3's fix
lands and passes after — commit them in that order so the log proves the
net works.

---

## 2. CI that runs on every PR

### The problem

A PR touching only `extension/` or `daemon/` runs **zero checks**.
`pages.yml` runs the root typecheck but only on paths under `viewer/**` or
`shared/**`; `plugin.yml` typechecks only `shared`. Both are correctly
path-filtered for their own purpose — deploys and plugin drift — and
neither is a CI gate for the product.

### The change

One `.github/workflows/ci.yml`, triggered on every PR and every push to
`master`, no path filter: `npm ci`, `npm run typecheck`, `npm test`. Keep
the existing workflows' habit of a comment block explaining why the job
exists — the audit called those out as exemplary.

Also fold in the plugin gate's blind spot: `plugin.yml` proves the
committed validator bundle is *current* (rebuild + `git diff
--exit-code`) but not *correct* — after the diff check it only runs
`version` and one `id` smoke call. Add a step running
`plugins/enloop/validator/enloop-case.mjs validate` over a small committed
good/bad fixture set, asserting exit codes and rule ids.

### Check

Open a PR that only edits a file under `daemon/src/` and confirm a check
runs and its status gates the merge. Break a fixture case on a branch and
confirm `plugin.yml` (or ci.yml) goes red.

---

## 3. Parser round-trip losses — `Match:` and the fence scan

### The problem

Two silent-corruption bugs in `shared/src/markdown.ts`, both of the kind
only a round-trip test surfaces:

- **`Match:` is parsed but never re-serialized.** `parseVariables` reads
  `Match:` into `TestCaseVariable.match` (near `:435-448`);
  `renderCaseMarkdown` (near `:679-691`) emits `## NAME`, description,
  `Default:`, `Generator:` — and drops `Match:`. The viewer's builder
  serializes through `renderCaseMarkdown` (`viewer/src/builder.ts:11`), so
  editing any case there silently strips the host glob that stops a
  page-origin generator leaking an unrelated site's origin. A security
  control that disappears on edit.
- **The fence regex reads subsections.** `FENCE_RE` (near `:510`) runs
  against the whole step body *before* `splitStepSubsections` (near
  `:595`). A manual step whose `### Expected` quotes a JSON payload or
  shell block in a fence gets that fence lifted out and becomes
  `type: "automated"` — a thing the tester reads turns into a script the
  panel executes.

### The change

- Emit `Match:` in `renderCaseMarkdown`, in the position the grammar doc
  comment specifies (and if the comment doesn't specify a position, fix
  the comment in the same commit — it is the published spec, per
  README's contributing rules; bump `CURRENT_FORMAT_VERSION` only if a
  document's *parse* changes, which this does not).
- Split subsections first; look for a fence only in the lead text, and
  anchor it to line start (`/^```/m`) so an inline mention of backticks
  can't match.

One decision to make while in the file, then record in the grammar
comment either way: `parseBulletList` (near `:487`) treats indent < 2 as
top-level where CommonMark allows up to three spaces. Either widen to
`< 4` or document the deviation as intended. Don't leave it undecided.

### Check

Round-trip test over the fixture corpus goes green, including a fixture
with `Match:` and a fixture with a fenced block inside `### Expected`
that must stay `type: "manual"`.

---

## 4. The viewer must not render `javascript:` links

### The problem

`renderLink` in `shared/src/html.ts` (near `:161-172`) emits
`<a href="...">` for any Markdown link href that isn't `#…` or
`selector:…` — no scheme check. The viewer reads the case out of
`location.hash` and injects the rendered body via `innerHTML`
(`viewer/src/main.ts` near `:71` and `:217`). A shared "case link" is
untrusted input by design — that's the product's whole sharing story — so
a crafted link produces a clickable `javascript:` URL on the viewer's own
origin. The extension is unaffected only by accident (it renders through
react-markdown, which sanitizes).

### The change

Allowlist `http:`, `https:`, `mailto:` (and scheme-relative/relative
paths) in `renderLink` and `renderWhere`; anything else renders the label
as plain text, not a link. Do it in `shared/src/html.ts` so the viewer,
the downloaded standalone file, and anything else that ever uses the
shared renderer are all covered by one change. Mind the standalone-file
constraint from the README: if any of this lands inside `attachCasePage`,
it must stay self-contained.

While in the file, two adjacent one-liners from the audit: escape
`</script` when interpolating the serialized function into the page (near
`:844`, `.replace(/<\/script/gi, "<\\/script")`), and pin
`build.target: 'es2022'` in `extension/vite.config.ts` so esbuild never
hoists a helper out of `attachCasePage`'s serialized body (the daemon
config already pins its target; the extension pins nothing).

### Check

A unit test feeding `[x](javascript:alert(1))` through the renderer
asserts no `<a` with that href is produced. Manually: paste such a case
into the viewer via the hash and confirm the label renders as text.

---

## 5. `run.json` gets a mutex and atomic writes

### The problem

`run.json` is the one file holding data nobody can reconstruct — the
tester's verdicts and notes. It is written by read-modify-write from
several concurrent sources: `updateStep` (near `fsa-store.ts:717-738`),
the debounced comment save in `RunScreen`, `chainAutomatedFrom`'s
per-step writes (`run-engine.ts` near `:110-131`), and `appendConsole` on
a 2.5s timer. Interleaved read-modify-writes lose verdicts silently. On
top of that, `writeTextFile`/`writeJson` (`fs-utils.ts` near `:169-178`)
truncate then write — a crash or lapsed grant mid-write leaves a
truncated `run.json` or `case.md` (the frozen run source).

### The change

- **Per-run serialization** in `FsaDataStore`: a promise-chain mutex keyed
  by run id, wrapping every read-modify-write of `run.json`. The exact
  pattern already exists and is proven in `background/capture.ts` (near
  `:83-95`) — reuse its shape, don't invent a lock.
- **Atomic writes** for `run.json` and `case.md`: write `<name>.tmp` in
  the same directory, then `FileSystemFileHandle.move()` (Chrome 111+,
  fine for an MV3 extension) to the real name. Other files (console logs,
  channel artifacts) can keep the cheap path.

### Check

A browser-mode vitest against OPFS (or, until that harness exists, a
temporary dev-only stress hook) fires `updateStep`, a comment save, and
`appendConsole` concurrently ×100 and asserts no verdict is lost and the
file always parses. If the OPFS harness is deferred, at minimum assert by
code review that every `run.json` write site goes through the mutex —
grep for `writeJson` callers touching `run.json`.

---

## 6. Case scripts stop running before anyone reads them

### The problem

An automated step is arbitrary JavaScript from a Markdown file, executed
in the page's MAIN world with the tester's authenticated session.
Reopening an `in_progress` run auto-chains on mount (`RunScreen.tsx` near
`:78-84` → `chainAutomatedFrom`, `run-engine.ts` near `:110-131`) — so
opening the panel can execute scripts before the tester has seen them.
The implicit trust claim "a case file is trusted code because the user
picked the folder" was defensible when humans wrote cases; cases are now
agent-authored by design, and enloopd can even land patches into the
folder. The claim needs to become explicit UI, not an assumption.

### The change

- **No auto-chain on mount.** Reopening an in-progress run at an
  automated step shows the step with a *Run* button; chaining continues
  as today only from an explicit click within the session.
- **First-contact confirmation.** The first time a given case (identify
  by case id) is about to execute an automated step in this browser
  profile, show a one-time gate: "this case runs scripts on `<host>`",
  with the script text expandable, Confirm/Cancel. Persist the consent in
  `chrome.storage.local` keyed by case id + a hash of the case's script
  bodies, so an agent-patched script re-prompts.

Keep the MAIN-world/blob execution mechanism itself — the audit endorsed
its reasoning (`automation.ts` near `:36-46`); the fix is consent, not
mechanism.

### Check

Manual, with the bundled example case: start a run, close the panel
mid-automated-sequence, reopen — nothing executes until *Run* is clicked.
Edit the case's script on disk, reopen — the confirmation re-appears.

---

## 7. The daemon's protocol keeps its own promises

### The problem

`docs/daemon.md` argues the file protocol's race rules carefully; the
implementation doesn't hold them:

- **Watcher identity is per-host, not per-process**: `watcherId =
  \`enloopd-${host}\`` (`daemon/src/config.ts` near `:166`), while the
  docs explicitly endorse running two daemons. Both pass their own claim
  re-check (the ack owner id matches both), so both answer the same
  question (double API spend) and both spawn the same command.
- **Writes are not atomic**: `writeJson` is bare `writeFileSync`
  (`daemon/src/store.ts` near `:49-52`), and `readJson` maps unparseable
  JSON to `null` — indistinguishable from *absent*, i.e. "unclaimed". On
  the synced folders the docs endorse, every race reopens.
- **Claim arbitration is a 2s sleep** (`answer.ts` near `:61-68`), not
  exclusion.
- **Head-of-line blocking**: one question is awaited inline for up to 10
  minutes, during which no `touchWatcher` runs — the panel's freshness
  window is 180s (`fsa-store.ts` near `:112`), so a *working* daemon
  renders as "nobody is listening", the exact state 0.12.0 built UI for.

### The change

Test-first against item 1's tmpdir harness:

- Watcher id becomes `enloopd-<host>-<pid>-<random>`, plus a
  **per-dataDir lockfile** so a second daemon on the same folder refuses
  to start (this also becomes the supervision singleton — see the
  consequence below).
- All daemon JSON writes go `.tmp` + `rename()`. `readJson` distinguishes
  *absent* (free) from *unparseable* (unknown — skip, retry next tick,
  warn).
- Ack claims use `open(..., 'wx')` — exclusive-create is the one atomic
  primitive every filesystem gives — keeping the re-read as
  belt-and-braces.
- Heartbeat/watcher touch moves to its own timer, independent of the
  answering work; answering moves off-tick with a bounded in-flight set
  so command ticks and kills aren't starved.
- Smaller, same files: handle `SIGTERM` like `SIGINT` and drop own ack on
  exit; wall-clock timeout (`AbortSignal.timeout`) on the API backend to
  match the CLI backend's; skip questions whose panel heartbeat has been
  stale > N minutes (today they're answered and billed hours after the
  tester left); parse CLI flags through the same zod schema as the config
  file (`--defer-seconds abc` currently becomes `NaN` and silently
  disables deferral).

Consequence for supervision (recorded here, small enough to do in the
same pass): ship a `systemd` unit example in `docs/daemon.md` next to the
cron recipe, and derive `DAEMON_VERSION` from `package.json` via a build
`define` instead of the hand-synced constant (`config.ts` near `:62-64`).

### Check

tmpdir tests: two daemons on one dataDir — second refuses to start; a
truncated `ack.json` is treated as unknown, not free; a simulated 10-minute
answer does not let the watcher file go stale (assert mtime keeps
advancing). Manual: `kill` (SIGTERM) mid-answer, restart, confirm the
question is retried within a tick, not blocked for 15 minutes.

---

## 8. Command provenance becomes exact, and the jail becomes real

### The problem

The security story of the command channel is "the daemon only runs what
the case author wrote". The implementation is `frozen.includes(command)`
over the whole case markdown, **falling back to the latest stored
version** when the frozen source is missing (`daemon/src/commands.ts`
near `:43-59`) — so any prose fragment in any version is executable, any
prefix of an authored command is executable, and a version an LLM just
landed via `land_patch` instantly becomes a provenance source. The
read-tool jail compares `path.resolve` prefixes (`backends/api.ts` near
`:46-52`) — a symlink under the repo escapes it.

### The change

- **Provenance = exact match against parsed command blocks of the frozen
  run case only.** Parse the frozen `case.md` with the shared parser,
  collect the automated-step scripts / setup-command blocks, compare
  trimmed-exact. No fallback to latest; a run without a frozen source
  gets no commands.
- **Jail via realpath**: `realpathSync` both roots and the target before
  the prefix check, and refuse symlinked targets outright.
- **Docs**: state in `docs/daemon.md`'s config section that `cliArgs`
  must never contain permission-skipping flags — the brief embeds tester
  free text and hostile-page HTML, and a headless `claude -p` with
  loosened permissions inside the user's repo is the plausible injection
  chain. Delimit the untrusted regions (tester text, `page.html`) in
  `brief.ts` with explicit markers while there.

### Check

tmpdir tests: a `request.json` whose command is (a) a sentence from the
case prose, (b) a prefix of a real command, (c) a command present only in
a *later* version — all three refused; the real command from the frozen
source runs. A symlink inside the repo pointing at `~/.ssh` is refused by
the jail test.

---

## 9. Releases become a workflow, not a ritual

### The problem

The zip users install is produced by a hand-run `zip`; nothing ties a
published zip to a commit; the version lives by hand in
`extension/package.json`, the manifest, and `daemon/src/config.ts`.
There is no `release.yml`. (The zips in the repo root are *not* tracked —
`.gitignore` covers them — they're just local clutter.)

### The change

A tag-triggered `.github/workflows/release.yml`: build the extension, zip
`extension/dist`, attach to a GitHub Release, and **fail if versions
disagree** — tag vs `extension/package.json` vs manifest vs
`DAEMON_VERSION` (moot once item 7's `define` lands) vs
`AGENT_PROTOCOL_VERSION` compatibility note. Local builds emit zips to a
git-ignored `dist-releases/` instead of the root.

### Check

Push a tag on a branch where the manifest version was deliberately left
behind — the workflow fails on the consistency step. Push a correct tag —
a Release appears with the zip attached, byte-identical to a local
`npm run build` + zip of the same commit.

---

## 10. The recorded backlog — smaller findings, so they stay found

Not queued as their own items; recorded so no future audit re-discovers
them, in rough value order. Each is independent and small.

- **Plugin bundle is 87% zod for two arrays.** `markdown.ts` imports
  `COMMENT_AUDIENCES` / `VARIABLE_GENERATORS` from `schemas.ts`, dragging
  all of zod into the 166 KB "dependency-free" validator bundle. Move the
  two literal arrays to a leaf module with no zod import; bundle drops to
  ~25 KB. (`plugin.yml`'s diff gate re-commits the smaller bundle.)
- **Daemon bundle contains two zod runtimes** — classic `zod` in
  `config.ts`, `zod/v4` in `backends/api.ts`. Standardize on one entry;
  align the three workspaces' zod pins to `^3.25.0` while there. A
  tracked pre-req before ever attempting zod v4 proper:
  `z.record(z.string())` in `schemas.ts` is a hard v4 break.
- **Case schemas are decorative.** `testCaseVersionSchema`/`stepSchema`
  are only `z.infer`ed, never `.parse`d, so their invariants can't fail.
  Decide once: enforce at the end of `parseCaseDocument`, or downgrade to
  plain interfaces. Related composability fix: split the legacy-migration
  `.transform()` out of `runStepStateSchema` so `runSchema`/`runStepSchema`
  stop hand-mirroring ~12 fields each.
- **Step-header grammar is implemented twice** — `parseOneStep` and
  `stepBodyIsQuick` walk the same `Selector:`/`Where:`/`Kind:` header
  independently. Extract one `parseStepHeader` used by both.
- **`extension/src/lib/root-handle.ts` is dead** — a complete unused
  second copy of the connect API. Delete it and fix the stale comment in
  `types/file-system-access.d.ts`.
- **Nav stack discards itself** — `isScreen` in `nav-state.ts` has no
  `environments` case, so opening Environments and closing the panel
  throws away the whole saved stack. One-line fix.
- **Agent channel never prunes** — `listQuestions`/`listCommands`
  enumerate every directory ever created, every 3s while pending. Add a
  retention sweep on run finish (sharding by run is the bigger option;
  sweep first). Also: daemon writes `status.json` synchronously at exit
  next to `exit-code` so the panel's display derives from one source, and
  the panel backs off from 3s polling once `watcher === null`.
- **`useAgentChannel.refresh` swallows all errors** — a lapsed grant
  mid-run freezes the list at "Waiting for an agent…" forever. Surface a
  stale state after N consecutive failures.
- **`insert-value.ts` cross-frame release** trusts `postMessage` from any
  origin with no nonce — pass a per-invocation token. And drop the 60s
  armed-state default to ~20s, cancel on panel unload.
- **Split the two giants** when next touched, not before: `fsa-store.ts`
  (1253 lines, five interfaces, seams already marked by section comments)
  and `RunScreen.tsx` (1220 lines, 9 state hooks → extract `useRun` +
  per-component files).
- **Evals record nothing.** Commit a dated `evals/RESULTS.md` per plugin
  release (which models passed, which skills covered); add an
  `npm run evals` root script; make `row.ok` respect the `cold` check it
  already prints.
- **`DataStoreProvider` context value** is a fresh object every render
  and `useWorkspace` rebuilds closures per call — `useMemo` both. Move
  the default-storage id from `localStorage` to `chrome.storage.local`
  for consistency.

---

## 11. Feedback leaves a backend-less machine as one emailable file

### The problem

On a QA machine there is no backend at all — no daemon, no Claude Code or
Codex install, no session. The run still works (the extension needs none of
them), and on finish the panel writes `report.md` and `feedback.md` into
the run's folder (`fsa-store.ts` near `:833-836`) and tells the tester:
*"Feedback saved to feedback.md in this run's folder — point Claude Code at
it"* (`RunScreen.tsx` near `:370`). On that machine the instruction is
useless twice over: there is no Claude Code to point, and the file is
buried in a nested run directory of a connected folder the tester never
browses. The verdicts, comments and failure notes a QA person just spent
their attention producing are stranded on their disk.

The 0.12.0 watcher-presence work means the panel already *knows* when
nobody is listening — it just has nothing to offer in that state beyond
the hint.

### The change

An **Export feedback** action on the finished-run screen that produces
**one self-contained file via a browser download** — something a QA person
can save to their desktop and attach to an email without ever seeing the
connected folder.

- **Content**: the same rendered feedback the run already produces
  (`renderRunFeedback` / `renderFreeRunFeedback` in `shared/src/markdown.ts`),
  extended to be self-contained: case title, id and version, run id and
  dates, the environment values the run resolved, and the console/capture
  digests inlined — nothing in the file may reference a sibling file the
  email won't carry. One Markdown file, no binary attachments; if
  screenshots prove necessary in practice, a zip bundle is the recorded
  extension, not the v1.
- **Filename** carries the identity the inbox needs:
  `enloop-feedback-<case-slug>-<run-date>.md`.
- **Visibility**: always available in the finished-run screen; *offered
  prominently* (next to the existing hint) when the watcher state says no
  agent is listening — that is the state where it's the only exit for the
  data. Cover free runs too.
- **Mechanism**: an anchor-download from the side panel (no new
  permissions; `chrome.downloads` not needed).

### The consequence that makes it a loop, not a dead end

The file's whole value is what happens on the developer's machine:
`/enloop:check` must accept a **standalone feedback file path** as its
input, not only a run inside a connected folder — the developer saves the
attachment anywhere and runs `/enloop:check <file>`. The export format and
the skill's expectations are one contract; change them in the same commit,
and say in the exported file's own header what to do with it (one line:
"run `/enloop:check` on this file, or reply to the tester"), so the file
explains itself to whoever it gets forwarded to.

### Check

On a profile with no daemon and no CLI: finish a run with one failed step
and a comment, export, and confirm the downloaded file names the case and
run, contains the verdicts, comments and console digest, and references no
sibling files. Then on a dev machine: `/enloop:check` pointed at the bare
downloaded file (outside any connected folder) triages it identically to
the same run read from the folder.

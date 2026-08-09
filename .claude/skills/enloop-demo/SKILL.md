---
name: enloop-demo
description: Generate a working, live-verified example — a standalone test case, a suite (shared prep steps across cases), or a free run — for the Enloop Chrome extension and drop it into the connected private/test-cases folder. Use this whenever the user asks for an example/demo test case, suite, or free run, wants "something to try in the browser", or wants to demonstrate a case-Markdown grammar feature (variables, selectors, automated steps, dependencies, suite prep-step merging, ...) — especially right after that feature was just added to shared/src/markdown.ts. Do not hand-write and hand off an example without running this skill's validation steps; an example that merely "looks right" is not the deliverable here.
---

# Generate an example test case

Produces one real, runnable artifact — a standalone case, a suite plus a
case inside it, or a free run — written as valid Markdown/JSON, parsed and
substituted with the actual parser (not eyeballed), and — if it has any
automated (fenced-script) steps — proven to pass against the real target
page in Chrome before it's written to disk. "I wrote some Markdown that
looks plausible" is not done; "I ran it and watched it pass" is done.

## When this applies

- The user asks for an example/demo/sample test case, suite, or free run.
- A new case-Markdown grammar feature was just implemented (check `git
  diff` / recent conversation) and needs something concrete to exercise it
  — including suite-specific grammar (`suite.md`, prep-step merging via
  `buildRunSource`).
- The user wants to try a feature "in the browser" or "in real life".

## Steps (standalone case — the default)

### 1. Figure out what to demonstrate

If the user names a feature, use it. Otherwise infer it from the most
recent grammar change (`git diff shared/src/markdown.ts` or the
conversation) — that's usually why this skill just got invoked. If what's
being demonstrated is suite prep-step merging or a free run instead of an
ordinary case feature, skip to the matching section below instead of
following the rest of this list.

### 2. Re-read the current grammar before writing anything

The grammar lives as a doc comment at the top of `shared/src/markdown.ts`
and evolves over time — don't rely on memory of what fields exist
(`@version`/`@author`/`@project`, `# Variables`, `Selector:` — which may
repeat for ordered fallbacks — `### Expected`, fenced code = automated
step, etc.). Read it fresh every time.

### 3. Pick a safe target page

The example needs a real page to interact with. Prefer, in this order:

1. A page that echoes input back with **no persistence** — e.g.
   `demoqa.com/text-box` (fills fields, reads them back from `#output`).
   Rerunnable indefinitely, nothing to clean up.
2. A page whose flow is **fully reversible within the run** — e.g.
   `the-internet.herokuapp.com/login` (log in, then log out as the last
   step), so a rerun starts from the same state.

Avoid anything with real accounts, rate limits, CAPTCHAs, or side effects
that outlive the run. If unsure whether a candidate site's DOM/behavior
matches what you assume, check it live (see step 5) before committing to
it — don't guess selectors from memory.

### 4. Write the case Markdown

Follow the grammar exactly. Keep the scenario legible: a real title, a
short description of what it demonstrates, and steps that isolate the
feature being shown rather than burying it in unrelated setup.

Every literal the tester has to type is written as `"**value**"` — quoted
*and* bolded — exactly as it should be entered: ``Type "**Buy milk**" into
the field``, ``Enter "**%EMAIL%**"``, ``Set `Priority` to "**High**"``.
Backticks stay for things to *find* on screen (a visible label, a selector);
quoted bold is for things to *type*. The side panel turns each marked value
into a control that inserts it into the next field the tester clicks, so on
a demo case — whose job is to show the product working — an unmarked value
is a feature that silently does not appear. Full rule and the
label-vs-value table:
`plugins/enloop/references/step-contract.md` §6.

Title these `Enloop demo: <what it shows>` and set `@project Enloop demo`,
the same convention the quick and full skills follow for a real app. It is what
keeps generated examples distinguishable from real cases in a Library that
holds both — which is exactly the situation this repo's own data folder is
in.

### 5. Validate parsing for real — never skip this

Hand-written Markdown is exactly the kind of thing that silently
mis-parses (wrong heading level, a label regex that doesn't match, etc.).
Prove it parses before trusting it:

```bash
npm run build:plugin                                    # only if shared/src changed
node plugins/enloop/validator/enloop-case.mjs validate <scratch file>
```

That is the same command the shipped skills run, against the same bundle
users get — so validating this way also smoke-tests the artifact. It prints
the document as parsed and splits its findings into errors (certainly wrong)
and warnings (yours to judge). Check the counts against what you intended,
read every finding, and never edit a case just to quiet a warning.

Automated steps are the one thing it does not show you: print the
substituted `script` bodies yourself before step 6, since those are what you
are about to run in a live page.

### 6. Live-verify every automated step in Chrome — never skip this either

For each fenced-script step, with the placeholders already substituted to
concrete values (from step 5):
- Load the browser tools if not already loaded (`ToolSearch` with
  `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool`
  at minimum).
- Get tab context, navigate to the target page.
- Run the exact resolved script via `javascript_tool`, using the same
  `api.fail` convention the real harness uses (a local `const api = {
  fail: (msg) => { throw new Error(msg); } }` stub is enough to catch
  failures the same way).
- If a step reads back a result (e.g. waits for a confirmation element),
  confirm that check actually passes against the live DOM — don't assume
  selector names from memory; query the page first if unsure
  (`document.querySelectorAll(sel).length` is a cheap sanity check,
  especially for sites that reuse the same id on both an input and its
  output element).

If a step fails, fix the script and rerun it live — don't write a file you
haven't watched pass.

Note: Claude in Chrome refuses to interact with `chrome://` URLs, so
loading the extension itself as an unpacked extension (`chrome://extensions`)
can't be automated — this step only needs a normal page tab, which works
fine. Only the extension's own side panel is out of reach.

### 7. Write the files

`private/` is local, git-ignored connected-folder data (see repo's
`.gitignore`) — it's fine to write into it directly without asking.

Mirror the exact layout `FsaDataStore` expects (`extension/src/lib/fsa-store.ts`):

```
private/test-cases/test-cases/<id>/meta.json
private/test-cases/test-cases/<id>/versions/v1.md
```

`<id>` mirrors `newTestCaseId` in `shared/src/id.ts`: `slugify(title)` (lowercase,
non-alnum → `-`, trimmed, ≤40 chars) + `-` + 8 hex chars, e.g. via
`openssl rand -hex4`.

`meta.json`:
```json
{
  "archived": false
}
```

`versions/v1.md`: the validated (pre-substitution — placeholders stay
literal in the stored version; substitution happens per-run) Markdown from
step 4/5.

### 8. Rebuild

```bash
npm run build
```

Confirm `extension/dist` timestamps actually moved. If the user already
has this loaded as an unpacked extension in Chrome, tell them to hit
reload on `chrome://extensions` and reopen the side panel — a build alone
doesn't refresh an already-loaded extension.

### 9. Report

Tell the user: the case title (so they can find it in the Library), what
it demonstrates, which target page it uses, and that the automated
step(s) were confirmed passing live — not just parsed.

---

## Suites: shared prep steps across cases

A suite is a physical folder holding a `suite.md` (reuses the exact case
grammar — title/`@version`/`@author`/`@project`/`Tags:`, description, `# Variables`,
`# Dependencies`, `# Prerequisites`, `# Steps` — but steps are **optional**)
plus one or more case subfolders. What's worth demonstrating here isn't
the suite alone (an empty folder proves nothing) — it's that a case
inside the suite inherits the suite's prep steps/variables/dependencies
when a run starts. Always generate a suite **and** at least one case
inside it together.

Follow steps 1–3 above unchanged (figure out the angle, re-read the
grammar — this time also read `buildRunSource` and its helpers in
`shared/src/markdown.ts`, since that's the merge logic being demonstrated
— and pick a safe target page if the case has automated steps).

### Write suite.md and the case Markdown

- `suite.md`: title, description, and whichever of `# Variables` /
  `# Dependencies` / `# Prerequisites` / `# Steps` you want to demonstrate
  merging. Prep steps should read like real shared setup (e.g. "Log in as
  the test user"), not placeholders.
- The case's own Markdown: at least one step of its own, so the merge is
  visibly "suite steps + case steps" rather than suite-only. If
  demonstrating variable inheritance, declare one variable only in the
  suite and, optionally, one with the *same name* in the case to show the
  case's value wins.

### Validate parsing and the merge for real — never skip this

Same scratch-build approach as step 5 above
(`cd shared && npx tsc -p tsconfig.json --noEmit false --outDir dist --declaration false`),
then a throwaway Node script against `shared/dist/markdown.js` that:
- parses `suite.md` with `parseCaseDocument(text, fallback, { requireSteps: false })`
  and confirms it accepts zero or more steps as intended,
- parses the case's own Markdown normally (steps still required for a case),
- calls `buildRunSource(caseMarkdown, suiteMarkdown)` and parses the
  result, then asserts: suite steps appear first and are prefixed
  `Prep: `, the case's own steps follow in their original order, suite
  variables are present, and a same-named case variable's value won (not
  the suite's).

Delete `shared/dist` and the script afterward.

If the case has automated steps, live-verify them per step 6 above using
the *merged and substituted* script text (from `buildRunSource` +
`substituteVariables`), not the case's standalone text.

### Write the files

```
private/test-cases/test-cases/<suiteId>/suite.md
private/test-cases/test-cases/<suiteId>/meta.json          { "archived": false }
private/test-cases/test-cases/<suiteId>/<caseId>/meta.json { "archived": false }
private/test-cases/test-cases/<suiteId>/<caseId>/versions/v1.md
```

Both `<suiteId>` and `<caseId>` use the same `newTestCaseId(title)` scheme
as standalone cases (slug + 8 hex chars) — suite ids and case ids share
one global id space, so no extra bookkeeping is needed to keep them
distinct.

Rebuild (step 8) and report (step 9), additionally telling the user the
suite's title/id and which case lives inside it.

---

## Free runs: unscripted capture (no grammar, no automated steps)

A free run is the simplest artifact this skill produces: a title plus a
plain Markdown notes blob, with no case grammar, no steps, and nothing to
parse or live-verify in Chrome. Use this when the user specifically asks
for a free-run example rather than a grammar feature demo.

### Write the files

```
private/test-cases/free-runs/<freeRunId>/free-run.json
private/test-cases/free-runs/<freeRunId>/notes.md
private/test-cases/free-runs/<freeRunId>/feedback.md
```

`<freeRunId>` mirrors `newFreeRunId` in `shared/src/id.ts`: `free-` +
an ISO timestamp with `:`/`.` replaced by `-` + `-` + 8 hex chars.

`free-run.json` (schema: `freeRunFileSchema` in `shared/src/schemas.ts`):
```json
{
  "id": "<freeRunId>",
  "title": "<title>",
  "startedAt": "<ISO timestamp>",
  "finishedAt": "<ISO timestamp, or null for an in-progress example>"
}
```

`notes.md`: whatever demo content the user wants captured, as plain
Markdown — this is the only free-text field, so make it read like a real
tester's reaction, not lorem ipsum.

`feedback.md`: derive it exactly the way `renderFreeRunFeedback` in
`shared/src/markdown.ts` does — don't hand-format it, since the extension
regenerates this file from `free-run.json` + `notes.md` on every save and
a hand-written mismatch would look like a bug:
```
# Free run feedback: <title>

Session started <startedAt>, captured live (demo/unscripted testing).

<notes.md content>
```

Rebuild (step 8) and report (step 9) — no live-verification step applies
since there's no parser or automated step involved.

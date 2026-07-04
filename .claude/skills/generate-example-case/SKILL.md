---
name: generate-example-case
description: Generate a working, live-verified example test case for the Test Case Manager Chrome extension and drop it into the connected private/test-cases folder. Use this whenever the user asks for an example test case, a demo case, "something to try in the browser", or wants to demonstrate a case-Markdown grammar feature (variables, selectors, automated steps, dependencies, ...) — especially right after that feature was just added to shared/src/markdown.ts. Do not hand-write and hand off an example without running this skill's validation steps; an example that merely "looks right" is not the deliverable here.
---

# Generate an example test case

Produces one real, runnable test case: valid case Markdown, parsed and
substituted with the actual parser (not eyeballed), and — if it has any
automated (fenced-script) steps — proven to pass against the real target
page in Chrome before it's written to disk. "I wrote some Markdown that
looks plausible" is not done; "I ran it and watched it pass" is done.

## When this applies

- The user asks for an example/demo/sample test case.
- A new case-Markdown grammar feature was just implemented (check `git
  diff` / recent conversation) and needs something concrete to exercise it.
- The user wants to try a feature "in the browser" or "in real life".

## Steps

### 1. Figure out what to demonstrate

If the user names a feature, use it. Otherwise infer it from the most
recent grammar change (`git diff shared/src/markdown.ts` or the
conversation) — that's usually why this skill just got invoked.

### 2. Re-read the current grammar before writing anything

The grammar lives as a doc comment at the top of `shared/src/markdown.ts`
and evolves over time — don't rely on memory of what fields exist
(`@version`/`@author`, `# Variables`, `Selector:`, `### Expected`, fenced
code = automated step, etc.). Read it fresh every time.

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

### 5. Validate parsing for real — never skip this

Hand-written Markdown is exactly the kind of thing that silently
mis-parses (wrong heading level, a label regex that doesn't match, etc.).
Prove it parses before trusting it:

```bash
cd shared && npx tsc -p tsconfig.json --noEmit false --outDir dist --declaration false
```

Then run a throwaway Node script against `shared/dist/markdown.js` (and
`shared/dist/variables.js` if variables are involved) that:
- calls `parseCaseDocument` on the raw text and checks step/variable
  counts match what you intended,
- if there are variables, calls `resolveVariableValues` +
  `substituteVariables` and confirms no `%NAME%` placeholders remain
  (`!/%[A-Za-z_]+%/.test(substituted)`), then re-parses the substituted
  text to confirm it's still valid,
- prints the final automated-step scripts so you can eyeball the
  substituted values.

Delete `shared/dist` and the throwaway script afterward — they're
scratch, not source.

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

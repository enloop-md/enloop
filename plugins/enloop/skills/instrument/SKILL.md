---
name: instrument
description: Add stable test selectors (data-testid or the repo's existing equivalent) to elements in the app repo you are currently in, so Enloop's Highlight can find them during a run. Follows the repo's existing convention rather than introducing one, touches attributes only, and verifies the attribute survives the production build. Use when the user asks to add test ids/selectors/test handles to a screen or component, or to fix elements that enloop:write or enloop:check reported as having no stable selector — e.g. "add test ids to the sync console", "instrument this form". Not for writing or triaging cases; those are enloop:write and enloop:check.
disable-model-invocation: true
allowed-tools: Read Grep Glob Edit Write Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(rg *) Bash(ls *) Bash(npm run *) Bash(npx tsc *)
---

# Instrument elements for Highlight

Enloop's Highlight button runs `document.querySelector(selector)` in the
top frame of the active tab, scrolls the match into view and flashes it.
That is the whole mechanism, and it dictates what a usable selector is.

This skill backfills those handles in the app's source. It edits the app
under test, so the bar is: **attribute-only changes, no behaviour change,
no restructuring, minimal diff.** A selector sweep that also "tidies" a
component is a selector sweep nobody will merge.

$ARGUMENTS is the target: a screen, route, component path, feature name, a
case id whose steps lack selectors, or nothing — meaning the elements the
last `enloop:write` or `enloop:check` reported as missing a stable handle.

## What Highlight can and cannot resolve

Four consequences of `document.querySelector` in the top frame. Design
every selector around them, and flag any target that violates one instead
of emitting a selector that will silently never match:

1. **No iframes.** Content inside an `<iframe>` is unreachable. If the
   target screen renders in one — an embedded editor, a payment widget, a
   legacy page in a frame — say so and stop; no attribute fixes that.
2. **No shadow DOM.** Web components with a closed or open shadow root
   hide their internals. Instrument the host element instead, and say the
   inner controls cannot be reached.
3. **First match wins.** A `data-testid` repeated across every row of a
   list always highlights row one. Lists need either a per-row unique
   value or a container handle — see rule 4 below.
4. **Static string, no variables at highlight time.** The selector in a
   step is substituted from `%VARS%` before the run, not evaluated against
   the DOM. Selectors that depend on runtime ids only work if the case
   declares that id as a variable.

A step may carry several `Selector:` lines, tried in order until one
matches. That is a safety net for elements whose position in the DOM moves
— a modal or portal — not a substitute for a stable handle. Adding the
handle here is what lets a case name one selector and be right.

## 1. Detect the existing convention — never introduce a second one

The worst outcome here is a repo with `data-testid` in some files,
`data-test` in others, and `data-cy` in a third set. Count first:

```bash
rg -c 'data-testid=' --stats | tail -3
rg -o 'data-(testid|test-id|test|cy|qa|e2e)=' -N --no-filename | sort | uniq -c | sort -rn
```

Adopt whichever already dominates. Only if the repo has **none** do you
pick, and then pick `data-testid`, the widest-supported default.

Then learn the naming shape from existing values, not from your own taste:

```bash
rg -o 'data-testid="([^"]+)"' -r '$1' --no-filename | sort -u | head -40
```

Match what you see — kebab vs camel vs dotted, whether names are prefixed
by screen (`sync-console.submit`) or bare (`submit`). Consistency with the
existing 200 matters more than any naming scheme being objectively better.

## 2. Check the attribute survives the production build

**Do this before editing anything.** Several toolchains strip test
attributes from production bundles. If the environment your testers hit is
a production build, every selector you add resolves in dev and nowhere
else — a full day's work that fails silently at exactly the wrong moment.

```bash
rg -n 'react-remove-properties|removeDataTestId|data-testid' \
  --glob '*config*' --glob 'babel*' --glob 'vite.config.*' --glob 'webpack*' \
  --glob 'next.config.*' --glob 'nuxt.config.*' --glob 'vue.config.*'
```

Also check Vue's `compilerOptions`/`comments` handling and any Angular or
Svelte preprocessor doing the same. If stripping is configured, stop and
tell the user: either the config gets an exception for the environment
under test, or the selectors must be `id`s instead. Do not quietly proceed.

## 3. Choose what to instrument

Instrument what a test needs to **find**, not everything that renders.
Blanket-tagging every `div` produces a large diff, a review nobody
completes, and no more testability than a focused one.

In scope:

- Interactive controls a step acts on — buttons, links, inputs, selects,
  toggles, tabs, menu items.
- Containers a step's `### Expected` asserts about — a results table, an
  empty-state block, a toast/flash region, an error summary.
- List rows, per rule 4 below.

Out of scope: layout wrappers, purely decorative elements, anything no
step would ever reference, and anything that **already has a stable
handle**. An existing `id`, a meaningful `name` on a form control, or a
stable `aria-label` is already usable — leave it alone and record it. This
skill is idempotent: running it twice must produce an empty second diff.

## 4. Lists and repeated elements

The single most common way an added selector turns out useless. Give the
list a container handle and each row a value that distinguishes it:

```jsx
<tbody data-testid="connections-table">
  {rows.map((row) => (
    <tr key={row.id} data-testid="connection-row" data-connection-id={row.id}>
```

That yields three usable selectors: `[data-testid="connections-table"]`
for "the table rendered", `[data-testid="connection-row"]` for "the first
row" (and counting in an automated step), and
`[data-connection-id="%CONNECTION_ID%"]` for a specific row the case
declares as a variable.

Never bake a row's index into the testid — `connection-row-3` changes
meaning the moment sorting or filtering does.

## 5. Never derive the value from visible text

`data-testid="save-changes"` derived from a button reading "Save changes"
breaks when the copy changes or the app is translated, which is precisely
the coupling a testid exists to avoid. Name it for the element's **role in
the flow**: `submit-connection`, `sync-events`, `confirm-delete`.

Likewise, do not add a testid whose value duplicates an existing `id` on
the same element. Use the `id`.

## 6. Apply the edits

Attributes only. Do not reformat, do not reorder props, do not rename
anything, do not touch classes or logic. Each edit adds exactly one
attribute to one element.

Where a component wraps another and forwards props, add the attribute at
the call site so it lands on the rendered DOM node — and verify it
actually forwards through to the DOM rather than being swallowed by the
wrapper's prop handling. A testid that never reaches the DOM is the second
most common failure here after list rows.

## 7. Verify

Three checks, all cheap:

```bash
npm run typecheck   # or the repo's equivalent — tsc, lint, whatever exists
git diff --stat
git diff | rg -c '^\+' 
```

Then read `git diff` in full yourself. Every `+` line must be the same
line as its `-` line plus one attribute. Any hunk that isn't — a
reformatted block, a changed import — is a mistake to revert before
reporting.

If the repo has a component or snapshot test suite, run it: snapshot tests
fail on added attributes, and updating those snapshots is part of this
change, not a follow-up someone else discovers.

## 8. Record what you added

Update `${CLAUDE_PROJECT_DIR}/.claude/test-map.md` — the app map
`enloop:write` builds and reads — with the new selectors, each against its
screen and source file. Skipping this means the next case-writing session
rediscovers them by grep. If no map exists yet, don't build one here; just
say so.

## 9. Offer the convention for future code

A backfill decays. The durable half of this is making new UI arrive
already instrumented, which is what `/enloop:setup` installs in the app
repo's `CLAUDE.md`.

Check whether that section exists:

```bash
rg -n '^## Enloop' CLAUDE.md
```

If it does, and the convention you detected in step 1 matches what it
says, there is nothing to do here — say so. If it disagrees with what the
code actually does, that is worth raising: one of the two is wrong, and
the code usually wins.

If there is no such section, offer `/enloop:setup` rather than writing a
convention yourself. It also records the project name, which cases need
and this skill has no reason to know about.

## 10. Report

- The convention you detected and followed, and the count of existing
  usages that established it.
- Every selector added, grouped by screen: the value, the element, and the
  file.
- What you deliberately skipped, and why — already had a stable handle,
  out of scope, unreachable behind an iframe or shadow root.
- Anything that blocks Highlight regardless of attributes, from the four
  constraints at the top. This is the part the user cannot discover
  without running a case and watching it fail.
- Whether the production build strips these, and what you verified.

Then say what is now writable: the steps in an existing case that could
gain a `Selector:` on their next version, via `enloop:check`.

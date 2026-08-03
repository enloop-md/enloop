---
name: setup
description: Prepare the app repo you are currently in for Enloop — record the project name, and install the test-selector convention into the repo's CLAUDE.md so every element and action a test needs to find (buttons, links, inputs, containers) arrives already labelled instead of being backfilled later. Use when the user asks to set up / configure / onboard Enloop for a project, wants new UI to be written with test handles by default, or is writing their first case from a repo. Run once per repo. Not for adding attributes to existing code — that is enloop:instrument, which this skill hands off to.
disable-model-invocation: true
allowed-tools: Read Grep Glob Edit Write Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(git remote *) Bash(rg *) Bash(ls *) Bash(cat *) Bash(basename *)
---

# Set up a repo for Enloop

One-time preparation of the app repo, so that everything afterwards —
writing cases, running them, triaging them — has what it needs. Two
deliverables:

1. **The project name is recorded**, so every case written from this repo
   is findable in a Library holding several products' cases.
2. **The selector convention is written into the repo's `CLAUDE.md`**, so
   new UI is authored with test handles already on it.

The second is the durable one. `/enloop:instrument` backfills handles onto
code that already exists; that work decays the moment someone ships a new
screen without them. A convention in `CLAUDE.md` is read into every session
in this repo, which is the only mechanism that keeps new code instrumented
without anyone remembering to ask.

$ARGUMENTS may name the project. Otherwise it is derived and confirmed in
step 2.

## 1. Confirm where you are

```bash
git rev-parse --show-toplevel
echo "ENLOOP_HOME=${ENLOOP_HOME:-unset}"
```

This must run in the **app repo under test**, not the Enloop repo. If
`${CLAUDE_PROJECT_DIR}` equals `$ENLOOP_HOME`, stop: there is nothing to
set up there.

If `ENLOOP_HOME` is unset, note it — step 6 fixes it. Do not stop for it;
the CLAUDE.md work does not depend on it.

## 2. Establish the project name

The name that prefixes every case title and fills the `@project` line, so
a tester scanning the side panel can tell this app's cases from another's.

Candidates, in order — offer the best one and let the user correct it:

```bash
basename "$(git rev-parse --show-toplevel)"
git remote get-url origin 2>/dev/null
rg -o '"name":\s*"[^"]+"' package.json 2>/dev/null | head -1
```

Choose the name a **human** would use for the product, not the repo slug:
`Careerminds`, not `careerminds-web-v2`. It appears in every case title, so
long names cost the tester screen width in a narrow side panel — prefer
one or two words.

Confirm it with the user before writing it anywhere. Getting this wrong is
cheap to fix today and expensive later: it is baked into the titles of
every case written from here, and changing it means new versions of all of
them.

## 3. Detect the selector convention

Never introduce a second convention into a repo that already has one.
Count what is there:

```bash
rg -o 'data-(testid|test-id|test|cy|qa|e2e)=' -N --no-filename | sort | uniq -c | sort -rn
rg -o 'data-testid="([^"]+)"' -r '$1' --no-filename | sort -u | head -30
```

Adopt whichever attribute dominates, and learn the naming shape from the
existing values — kebab vs camel, bare (`submit`) vs screen-prefixed
(`sync-console.submit`). Consistency with the existing 200 beats any
scheme being objectively better.

Only if the repo has **none** do you pick, and then pick `data-testid`.

## 4. Check the attribute survives the production build

If testers hit a production build and that build strips test attributes,
the convention you are about to install produces selectors that resolve in
dev and nowhere else.

```bash
rg -n 'react-remove-properties|removeDataTestId|data-testid' \
  --glob '*config*' --glob 'babel*' --glob 'vite.config.*' --glob 'webpack*' \
  --glob 'next.config.*' --glob 'nuxt.config.*' --glob 'vue.config.*'
```

If stripping is configured, say so and resolve it with the user before
writing the convention: either the config gains an exception for the
environment under test, or the convention becomes "use `id`". Installing a
convention whose output is stripped is worse than installing none, because
it looks done.

## 5. Write the convention into `CLAUDE.md`

`CLAUDE.md` is the user's file and is read into every session in this repo.
**Show the block and get explicit approval before writing it.** If the file
has no `## Enloop` section, append one; if it has one, update it in place —
running this skill twice must not produce two sections.

Adjust the block to the convention detected in step 3 — attribute name,
naming shape, and any framework specifics. The text below is the shape, not
a script to paste blindly:

```markdown
## Enloop

Manual test cases for this app are written with `/enloop:write` and run in
the Enloop Chrome side panel, which finds elements with
`document.querySelector` and flashes them for the tester.

Project: <the name from step 2>

### Test selectors

Every element a test needs to *find* carries `data-testid`:

- Interactive controls — buttons, links, form inputs, selects, toggles,
  tabs, menu items.
- Containers a test asserts about — a results table, an empty state, a
  toast or flash region, an error summary, a modal root.
- List rows: the list gets one testid, each row a shared row testid plus a
  `data-<entity>-id="<id>"` attribute for addressing a specific row. Never
  bake a row index into the value — it changes meaning when sorting does.

Name the value for the element's **role in the flow**
(`submit-connection`, `sync-events`, `confirm-delete`), never for its
visible text — copy changes and gets translated, which is the coupling a
testid exists to avoid. If the element already has a stable `id` or a
meaningful `name`, use that and add nothing.

Add the attribute when the element is written. Backfilling it later means
re-reading a component someone has already finished thinking about.

### What the side panel cannot reach

Selectors are matched in the top frame only, so an element inside an
`<iframe>` or a shadow root is unreachable regardless of attributes — for
those, instrument the host element and expect the tester to work manually
inside it. `querySelector` returns the first match, so a value repeated
across rows always resolves to row one.
```

Two things to keep when you adapt it: the **naming rule** (role, not
visible text) and the **list-row rule**. Those are where added selectors
most often turn out useless.

If the repo has no `CLAUDE.md` at all, offer to create one containing just
this section, and say that Claude Code reads it automatically in this repo.

## 6. Wire the environment (offer, don't assume)

The skills resolve three values. Show the user what is missing and offer to
add it to `${CLAUDE_PROJECT_DIR}/.claude/settings.json`:

```json
{
  "env": {
    "ENLOOP_HOME": "/path/to/enloop",
    "ENLOOP_DATA_DIR": "/path/to/the/folder/you/connected",
    "ENLOOP_PROJECT": "<the name from step 2>"
  }
}
```

- `ENLOOP_HOME` — the Enloop repo, where the case grammar lives. Without
  it, `/enloop:write` asks every time.
- `ENLOOP_DATA_DIR` — the folder connected in the extension. This is the
  one users most often point one level too deep; read
  `${CLAUDE_SKILL_DIR}/../../references/data-folder.md` and run its
  detection before writing anything into settings, so you record a value
  that resolves cleanly rather than one the next skill has to correct.
- `ENLOOP_PROJECT` — belt and braces with the `CLAUDE.md` line, and the
  value `/enloop:write` checks first.

`ENLOOP_HOME` and `ENLOOP_DATA_DIR` are usually machine-specific, so if
`.claude/settings.json` is committed, put them in `settings.local.json`
instead and leave only `ENLOOP_PROJECT` in the shared file. Say which you
did and why.

## 7. Offer the first backfill

The convention now covers new code; existing screens are still bare. End by
offering `/enloop:instrument` scoped to whatever the user plans to write a
case against first — not the whole app, which produces a diff nobody
reviews.

Do not run it yourself as part of setup. It edits application source, and
that deserves its own turn with its own review.

## 8. Report

- The project name recorded, and where it was written.
- The selector convention detected (with the usage count that established
  it) or chosen, and that it now lives in `CLAUDE.md`.
- Whether the production build strips test attributes, and what you
  verified.
- Which env values were already set, which you added, and to which file.
- What is not yet instrumented, and the `/enloop:instrument` invocation to
  fix the part that matters first.

Then say what is now possible: `/enloop:write <ticket>` from this repo
writes a case titled `<Project>: ...`, carrying `@project`, into the
connected folder.

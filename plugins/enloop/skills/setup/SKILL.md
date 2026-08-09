---
name: setup
description: Prepare the app repo you are currently in for Enloop — record the project name, and install the test-selector convention into the repo's agent instructions (AGENTS.md or CLAUDE.md) so every element and action a test needs to find (buttons, links, inputs, containers) arrives already labelled instead of being backfilled later. Use when the user asks to set up / configure / onboard Enloop for a project, wants new UI to be written with test handles by default, or is writing their first case from a repo. Run once per repo. Not for adding attributes to existing code — that is enloop:instrument, which this skill hands off to.
disable-model-invocation: true
allowed-tools: Read Grep Glob Edit Write Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(git remote *) Bash(rg *) Bash(ls *) Bash(cat *) Bash(basename *)
---

# Set up a repo for Enloop

One-time preparation of the app repo, so that everything afterwards —
writing cases, running them, triaging them — has what it needs. Two
deliverables:

1. **The project name is recorded**, so every case written from this repo
   is findable in a Library holding several products' cases.
2. **The selector convention is written into the repo's agent instructions**
   (`AGENTS.md` or `CLAUDE.md`, see step 5), so new UI is authored with test
   handles already on it.

The second is the durable one. The **instrument** skill backfills handles onto
code that already exists; that work decays the moment someone ships a new
screen without them. A convention in the repo's agent instructions is read
into every session in this repo, which is the only mechanism that keeps new
code instrumented without anyone remembering to ask.

$ARGUMENTS may name the project. Otherwise it is derived and confirmed in
step 2.

## 1. Confirm where you are

```bash
git rev-parse --show-toplevel
```

This must run in the **app repo under test**, not the Enloop repo. If this
repo has both `shared/src/markdown.ts` and `plugins/enloop/skills/`, it is
Enloop itself — stop, there is nothing to set up there.

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

## 5. Write the convention into the repo's agent instructions

The convention has to be read into every session in this repo, by whichever
agent the user runs. That file is `AGENTS.md` for Codex and `CLAUDE.md` for
Claude Code, and **Claude Code does not read `AGENTS.md`** — so writing one
file and hoping is how a convention silently stops applying.

Resolve the target like this, and say which branch you took:

1. Both files exist → write the section into `AGENTS.md`. If `CLAUDE.md`
   does not already pull it in, offer to add the one-line import `@AGENTS.md`
   rather than a second copy of the block. Two copies drift, and the one that
   is stale is the one being read.
2. Only one exists → write the section into it, unchanged.
3. Neither exists → create `AGENTS.md` with the section, since every agent
   but Claude Code reads it, and offer a `CLAUDE.md` containing `@AGENTS.md`
   so Claude Code sessions get it too.

**Show the block and get explicit approval before writing it.** If the target
has no `## Enloop` section, append one; if it has one, update it in place —
running this skill twice must not produce two sections, in either file.

Adjust the block to the convention detected in step 3 — attribute name,
naming shape, and any framework specifics. The text below is the shape, not
a script to paste blindly:

```markdown
## Enloop

Manual test cases for this app are written with the Enloop **quick** and
**full** skills (`/enloop:quick` / `/enloop:full` in Claude Code, `$quick` /
`$full` in Codex) and run in the
Enloop Chrome side panel, which finds elements with `document.querySelector`
and flashes them for the tester.

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

If the repo has neither instructions file, create the one branch 3 above
names, containing just this section, and say plainly which agent reads which
file — the user is about to rely on it being read automatically.

## 6. Wire the environment (offer, don't assume)

The skills resolve three values from the environment. Where they are written
depends on the agent, so ask which one the user runs rather than assuming —
and offer only that one.

**Settle the data folder for *this* repo first.** One agent config serves
every repo the user works in, so a folder recorded at user level is right for
one project and wrong for the rest — and the extension now connects several
at once, so both shapes are legitimate. Offer the two, with the trade named:

- **A folder inside this repo** — `<repo>/enloop/`. Cases are committed with
  the code they test and arrive with a clone; the extension writes a
  `.gitignore` there so run history stays local. Offer to create it.
- **An external folder**, shared with other projects — one Library across
  several products, at the cost of a machine-specific path that has to be
  recorded per repo.

Whichever they pick, record it **per repo and machine-locally**, never in a
committed file: `.claude/settings.local.json` under Claude Code, a `.envrc`
line or their own per-project environment under Codex. A path that lands in
a teammate's checkout is wrong on their machine by definition.

**Claude Code** — `<repo root>/.claude/settings.json`:

```json
{
  "env": {
    "ENLOOP_DATA_DIR": "/path/to/the/folder/you/connected",
    "ENLOOP_PROJECT": "<the name from step 2>"
  }
}
```

**Codex** — Codex takes these from the shell rather than from a per-repo
settings file, so the durable home is the user's shell profile or a
project-level `.envrc` if they use direnv:

```bash
export ENLOOP_DATA_DIR=/path/to/the/folder/you/connected
export ENLOOP_PROJECT="<the name from step 2>"
```

Never write to a shell profile without asking — it is outside the repo and
outside what the user pointed this skill at. Show the lines and let them
paste, unless they ask you to do it.

**Two variables, and both are optional.** Installing the plugin installs
everything the skills need to run — the grammar and the parser ship inside
it. What is left is where cases go and what this app is called, and each of
those has an answer without configuration. Never add a third asking where
Enloop itself lives; there is no such setting any more.

- `ENLOOP_DATA_DIR` — the folder *this repo* writes to, chosen above. It is
  the one users most often point one level too deep, so check the value
  before recording it — `validator/enloop-case.mjs data-folder --want <path>`
  at the plugin root prints the level it actually names, corrected. Record
  what that prints, not what you were handed, so the next skill has nothing
  to fix. Leave it unset when the repo has its own `enloop/` folder —
  the authoring skills find that without configuration, and an unset variable
  cannot go stale.
- `ENLOOP_PROJECT` — belt and braces with the agent-instructions line, and
  the value the authoring skills check first.

`ENLOOP_DATA_DIR` is machine-specific. Under Claude Code, if
`.claude/settings.json` is committed, put it in `settings.local.json` and
leave only `ENLOOP_PROJECT` in the shared file. Under Codex the shell
handles that separation already. Say which you did and why.

## 7. Offer the first backfill

The convention now covers new code; existing screens are still bare. End by
offering the **instrument** skill scoped to whatever the user plans to write a
case against first — not the whole app, which produces a diff nobody
reviews.

Do not run it yourself as part of setup. It edits application source, and
that deserves its own turn with its own review.

## 8. Report

- The project name recorded, and where it was written.
- The selector convention detected (with the usage count that established
  it) or chosen, and which instructions file it now lives in.
- Whether the production build strips test attributes, and what you
  verified.
- Which env values were already set, which you added, and to which file.
- What is not yet instrumented, and the **instrument** skill invocation to
  fix the part that matters first.

Then say what is now possible: **quick** for a two-minute case or **full**
for the complete one, given a ticket, from this repo
writes a case titled `<Project>: ...`, carrying `@project`, into the
connected folder.

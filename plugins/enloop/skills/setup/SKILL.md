---
name: setup
description: Prepare the app repo you are currently in for Enloop — record the project name, the deployments its cases run against (domains and environments: local, staging, prod), and install the test-selector convention into the repo's agent instructions (AGENTS.md or CLAUDE.md) so every element and action a test needs to find (buttons, links, inputs, containers) arrives already labelled instead of being backfilled later. Use when the user asks to set up / configure / onboard Enloop for a project, wants new UI to be written with test handles by default, or is writing their first case from a repo. Run once per repo. Not for adding attributes to existing code — that is enloop:instrument, which this skill hands off to.
disable-model-invocation: true
allowed-tools: Read Grep Glob Edit Write Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(git remote *) Bash(rg *) Bash(ls *) Bash(cat *) Bash(basename *) Bash(node *)
---

# Set up a repo for Enloop

One-time preparation of the app repo, so that everything afterwards —
writing cases, running them, triaging them — has what it needs. Three
deliverables:

1. **The project name is recorded**, so every case written from this repo
   is findable in a Library holding several products' cases.
2. **The deployments are recorded as environments** — the domain names
   the app is made of (`DOMAIN`, and `ADMIN` when the console is its own
   host) and the address of each in local, staging, prod — so every case
   names the right hosts in its `@locations:` line, the panel offers the
   environments before a run, and no skill and no run ever asks for an
   address again.
3. **The selector convention is written into the repo's agent instructions**
   (`AGENTS.md` or `CLAUDE.md`, see step 6), so new UI is authored with test
   handles already on it.

The last is the durable one. The **instrument** skill backfills handles onto
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

## 3. Record the deployments as environments

An app is reachable at several addresses — `http://localhost:3000`, a
staging host, production — and often *is* several hosts at once: the app
and an admin console, a marketing site and the product it signs into, one
host per tenant. Every case builds its addresses on `%DOMAIN%` — the tab
the run starts from, or the **environment** the tester picks — names the
hosts it is meant for in an `@locations:` line, and declares a domain
only for a second host (`%ADMIN%/audit`). This step records both,
once, in the data folder's `environments.json` — the file the panel's
Environments screen edits and the authoring skills read.

Resolve the plugin and the folder the way every skill does:

```bash
ENLOOP_PLUGIN="<the installed plugin root, two levels above this skill>"
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" data-folder
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "<project name>"
```

`data-folder` prints the folder — `AMBIGUOUS`/`NONE` mean ask rather than
guess; `references/data-folder.md` at the plugin root says how.
`environments` prints what is already recorded for this project.

Then **derive the deployments from the repo** — the same way the authoring
skills derive routes, and for the same reason: a remembered address is an
invented one.

```bash
rg -n -i '(APP|BASE|PUBLIC|SITE|API|ADMIN|FRONTEND|BACKEND)_?URL|HOST(NAME)?=' .env.example .env.* 2>/dev/null
rg -n -i 'baseURL|baseUrl' playwright.config.* cypress.config.* 2>/dev/null
rg -n -i 'ports:|hostname|VIRTUAL_HOST|\.localhost' docker-compose*.yml compose*.yml 2>/dev/null
rg -n -i 'staging|production|prod\.|demo\.' README.md fly.toml vercel.json netlify.toml app.yaml 2>/dev/null | head -20
```

From that, decide:

- **The domain names.** `DOMAIN` for the app under test — the name every
  case uses without declaring it. A second name only for a host that is
  genuinely separate — an admin console on its own host, a second tenant,
  the site the flow starts from. A path under the same host is a route,
  not a domain.
- **The environments.** One per deployment you can name an address for —
  `local` from the dev server port, `staging` and `prod` from the deploy
  config or README. Which one is the **default** — the deployment cases
  are normally run against, whose host leads every case's `@locations:`
  line and whose addresses become a declared domain's `Default:`:
  staging when there is one, local when the project has nothing deployed,
  never prod unless the user says so.

Show the user what you derived and where each address came from, in one
block, and confirm it once. This is the one moment in Enloop where an
address is put to a person — because it is written once here and read by
every case after — so make it cheap: propose the complete set, let them
correct a value, do not ask open questions.

Record it:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "<project name>" \
  --domain DOMAIN --domain ADMIN \
  --env local --set DOMAIN=http://localhost:3000 --set ADMIN=http://localhost:3001
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "<project name>" \
  --env staging --set DOMAIN=https://staging.example.test --set ADMIN=https://admin.staging.example.test --default
```

Write a `README.md` into the data folder if there is none — three
sentences a teammate who clones the repo can follow with nothing else:
install the extension (the Chrome Web Store link), open the side panel,
connect this folder or the repository that holds it; and that any case
can be opened in a browser without the extension via the viewer link
inside the file. This is the whole onboarding for a QA engineer who
arrives after you.

Environments are scoped to the project name, so one folder serving
several repos keeps each product's staging apart. Values that differ per
deployment and are not addresses — the QA account, a tenant id — belong
here too (`--variable QA_EMAIL --env staging --set QA_EMAIL=…`); take them
from seeds and fixtures, or leave the value empty and say so in the
report. What is empty shows as a hole in the panel's Environments screen,
which is where a teammate fills it.

**The rules file.** Cases also read `rules/<project>.md` in the data
folder — the prose rules the **check** skill accumulates from runs. Print
it (`enloop-case.mjs rules "$DATA_DIR" "<project name>"`); if it does not
exist, create it with the sections stubbed for the **check** skill to fill
later:

```markdown
# Enloop rules — <project name>

# Navigation

# Accounts and data

# Known traps

# Vocabulary
```

An older rules file may carry a `Base URL: <origin>` line from before
environments existed. Move its value into the default environment's `APP`
address and delete the line; the environments file is the one source now.
Leave every rule in the file alone: the rules belong to the **check**
skill and the user.

## 4. Detect the selector convention

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

## 5. Check the attribute survives the production build

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

## 6. Write the convention into the repo's agent instructions

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

Adjust the block to the convention detected in step 4 — attribute name,
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

## 7. Wire the environment (offer, don't assume)

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

## 8. Offer the first backfill

The convention now covers new code; existing screens are still bare. End by
offering the **instrument** skill scoped to whatever the user plans to write a
case against first — not the whole app, which produces a diff nobody
reviews.

Do not run it yourself as part of setup. It edits application source, and
that deserves its own turn with its own review.

## 9. Report

- The project name recorded, and where it was written.
- The domains and environments recorded — each address and the repo file
  it came from, which environment is the default, and every value left
  empty for someone to fill in the panel's Environments screen.
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

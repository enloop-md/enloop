# Authoring a test case

<!-- Shared by the quick and full skills. One procedure, two tiers: the skill
     that sent you here has already told you which one you are writing, and
     that is the only thing that differs. Both must resolve the folder, derive
     every specific from source, and validate with the real parser. -->

This is the procedure. **The tier — quick or full — comes from the skill that
sent you here**, and it changes three things and nothing else:

| | quick | full |
| --- | --- | --- |
| Coverage | the happy path only | edge cases, error states, cleanup |
| App map (§6) | read only the screens the path touches; do not build or refresh the cached map | build or refresh it |
| `Kind: quick` | on every step | on the core path only |

Everything below applies to both. Two failure modes the procedure exists to
prevent, whichever tier you are in:

1. **Invented specifics.** A route, button label, or selector recalled from
   conversation rather than read from the app's source. These look
   authoritative and waste the tester's time when wrong.
2. **Prose that offloads thinking onto the tester.** Multi-action steps,
   rationale mixed into pass criteria, test data discovered mid-run.

The deliverable is a case that obeys this project's rules, parses with the
real parser, and passes the step contract's by-eye list. A case that merely
reads well is not done.

## 1. Resolve where things live

Three paths, and only one of them is ever the user's to configure.

- **App repo** — where you are now: the repo root
  (`git rev-parse --show-toplevel`). Source of
  every route, label and selector.
- **The plugin** — where you are reading this from: you opened this file at
  an absolute path, its directory is the plugin's `references/`, and the
  plugin root is one level above (`$CLAUDE_PLUGIN_ROOT` under Claude Code).
  It carries the grammar and the real parser, so authoring needs nothing but
  `node`. Confirm it before relying on it:

  ```bash
  ENLOOP_PLUGIN="<the directory holding this references/ folder>"
  node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" version
  ```

  If that fails the plugin is installed wrong: say so and stop. Never write a
  case you cannot validate, and never ask the user to clone Enloop or set a
  variable pointing at it.
- **Data folder** — where this repo's cases live. Ask for it:

  ```bash
  node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" data-folder
  ```

  `RESOLVED` prints the folder and the exact path to write to; use it.
  `AMBIGUOUS` and `NONE` exit non-zero and mean you must **ask** rather than
  guess — read `data-folder.md`, beside this file, for how to ask well and
  what to offer. If the user named a folder in this request, pass it as
  `--want <path>`; that wins outright.

  Both failure modes are silent when wrong: a case in the wrong folder is a
  case in another project's Library, and a case at the wrong level is in
  nobody's.

Verify each path exists before continuing. If the repo you are in *is*
Enloop itself — it has both `shared/src/markdown.ts` and
`plugins/enloop/skills/` — then there is no app under test here and the user
wants the `enloop-demo` skill, not this one.

Then resolve the **project name** — the app under test. One data folder
serves every repo a user writes cases from, so a Library without it is a
flat list of titles with no way to tell which product each belongs to. In
order:

1. `$ENLOOP_PROJECT`, if set.
2. An `## Enloop` section in the repo's agent instructions file — what
   the **setup** skill writes. Read the `Project:` line there.
3. Ask the user, offering the repo directory name as the default, and tell
   them the **setup** skill records it once so this question stops recurring.

Use it verbatim, including capitalisation. It goes in two places in the
finished case (step 8): the `@project` line and the title prefix.

## 2. Read this project's rules

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" rules "$DATA_DIR" "<project name>"
```

Rules this app's cases must follow, accumulated by the **check** skill from
what testers said about earlier runs — where a run begins, how this app's
selectors have to be written, which fixtures cannot be trusted. They are how
Enloop gets better at *this* project rather than in general, and they are the
one input here that came from someone who has actually run these cases.

The top of the file may carry **structured lines**, and one matters here:
`Base URL: <origin>` — the environment this project's cases normally run
against. It becomes the `Default:` of the case's `BASE_URL` variable in
step 8. The prose sections bind as rules; the structured line is data.

**They are binding.** A rule outranks a habit and outranks anything below in
this file that is not the grammar. If you believe one is wrong, say so in your
report and follow it anyway; changing it is the user's call, and a rule
silently ignored is worse than no rules file at all.

`(no rules recorded for … yet)` is the normal answer for a new project. Do not
invent any, and do not write to this file — promoting a rule is the check
skill's job, because it is the one that has seen the run that justified it.

## 3. Read the grammar the plugin ships

Read `$ENLOOP_PLUGIN/references/grammar.md` — lifted verbatim from the doc
comment above the parser, so the words you read and the code that will judge
your output cannot disagree. The grammar changes between releases: **read it
every time**, never from memory.

Its heading carries the format version, which is what goes in the case's
`@version` line. If it disagrees with anything below, the grammar wins — say
so in your report rather than silently following this file.

## 4. Read the step contract

Read `step-contract.md`, beside this file in the plugin's `references/`
folder, in full. It defines what a step must look like and ends with the
by-eye list you will check against in step 9b. It is the whole point of this
skill.

## 5. Establish scope

Turn $ARGUMENTS into a concrete change set. In order of preference:

1. **A branch or ticket** → `git diff main...HEAD --stat` then the diff
   itself for the interesting files. This is the normal case: cases are
   written to verify a branch before merge.
2. **A ticket id with no branch checked out** → `git log --all --grep
   <id> --oneline`, then diff that range.
3. **A feature name** → locate its entry points by search.

Read the actual diff. The case must cover what changed, including the
seams where a change meets existing behaviour, not a generic tour of the
feature area.

State the scope back to the user in one line before writing anything, so a
wrong interpretation costs seconds rather than a whole case.

## 6. Build or refresh the app map

The expensive part of authoring is learning the app's surface. Do it once
and cache it at `<repo root>/.claude/test-map.md`.

**If it exists**, read it, and spot-check two or three entries against
source before trusting it. Note its `Generated:` date — if the diff from
step 5 touches routing or UI files, refresh those sections.

**If it does not exist**, build it. Detect the stack first, then apply the
matching recipe:

| Stack signal | Routes | Labels | Selectors |
| --- | --- | --- | --- |
| `#[Route(` in PHP | `rg "#\[Route\(" src --type php` | Twig templates, translation catalogues | `id=`/`data-testid` in `templates/` |
| React Router | the router config file (e.g. `Routing.tsx`) | i18n catalogues, JSX text | `data-testid`, `id`, `aria-label` in components |
| Rails | `config/routes.rb` | `config/locales/*.yml` | ERB templates |
| Django | `urls.py` | templates, `gettext` calls | templates |

Write the map as a flat table — route, screen name, key elements with
their selectors, and the file each came from. Keep it under ~200 lines;
it is an index, not a mirror of the source. Commit it: teammates and
later runs get it free.

Then, for the specific screens this case touches, read the actual
component or template. The map tells you where to look; it does not
replace looking.

## 7. Derive every specific from source

Hard rule: **every route, button label, field label, message string and
selector in the case must be one you have read in this repo during this
session.** No exceptions and no recall.

Practically, for each step you intend to write:

- Route → the router config or route attribute. A route is the address of a
  place, and contract rule 2 wants one for every place the case names: the
  entry point in `# Prerequisites`, every step's `Where:`, and any screen or
  record mentioned in prose. For the app under test, write every one of
  them `%BASE_URL%/<route>` — `Where:` included — so the address works
  from a cold start; a literal absolute URL is for another system's pages.
- Visible label → the JSX/template/i18n entry. Quote it exactly, including
  capitalisation, in backticks.
- Value the tester types → as `"**value**"`, quoted *and* bolded, exactly
  as it should be entered (contract rule 6). Backticks are for labels to
  find; quoted bold is for values to type, and the panel makes those
  insertable into the page — including into selects.
- Selector → `data-testid` first, then `id`, then a stable `aria-label`.
  Never a structural path. Where the element sits in a modal, drawer or
  portal, or its handle is new in this branch and may not be deployed
  where the tester runs, add a second `Selector:` line as a fallback —
  see the contract's rule 3 for when this earns its keep and when it is
  just noise.
- Expected message text → the string literal in source, not a paraphrase.

If a needed element has no stable selector, do not invent one. Write the
step without a `Selector:`, add a `### Note` saying the element lacks a
test handle, and mention it in your final report as a suggested
`data-testid`. Collect these — the report ends by offering
the **instrument** skill to add them, which is the only way those steps ever
gain a working Highlight.

## 8. Write the case

The grammar from step 3 defines every section and where it goes. What it does
not say, and this skill does:

- **Title** — `<Project>: <what this verifies>`, e.g.
  `Careerminds: Sync a contact to the CRM`. The prefix is what makes the
  case findable in a panel listing several products' cases at once; the rest
  must tell it from its siblings. Include the ticket id when there is one.
  Do not re-prefix a title that already starts with the project name.
- **`@project`** — the project name from step 1, *as well as* the title
  prefix. The prefix serves the Library list; this line serves anyone reading
  the raw Markdown, and is what the run report and `feedback.md` carry back
  to the repo. Both, always. `@version` is the format version from step 3;
  `Tags:` takes the ticket id, the feature area, and `manual`.
- **Description** — what this verifies and why it exists now (which branch
  or ticket). Two or three sentences.
- **`# Variables`** — declare `BASE_URL` in every case, generator and
  default together:

      ## BASE_URL
      The deployment under test — whichever one you have open.
      Generator: page-origin
      Default: https://staging.example.test

  The generator follows whatever deployment the tester has open; the
  default is what a blank tab, the shared viewer and a downloaded page
  resolve. Take the `Default:` from the rules file's `Base URL:` line
  (step 2). When there is none, ask the user once, use the answer, and
  offer the **setup** skill so the next case does not ask again. One
  variable then moves the whole case between environments.
- **`# Prerequisites`** — the entry point first (contract rule 2a), then
  **who the tester is in the app** (contract rule 2d) — account, role, and
  where the credential lives, copied from the rules file's *Accounts and
  data* section rather than assumed — then data that must exist, then
  **every service the tester has to start themselves**, each with the
  command and the directory to run it in:

      - Open %BASE_URL%/admin/integrations
      - Logged in as %QA_EMAIL% (role `Administrator`) — password: vault
        item `staging QA bot`
      - API running locally: `npm run dev` in the app repo
      - Worker running: `php bin/console messenger:consume async`

  Read those commands out of the repo — `package.json` scripts, `Procfile`,
  `docker-compose.yml`, the README's local-setup section — the same way you
  derive routes and selectors. A remembered start command is an invented
  specific like any other, and this is where a tester looks when something
  doesn't respond. The section renders collapsed, so listing what is usually
  already running costs nothing.
- **`# Steps`** — per the contract, with `Kind: quick` on the core path
  (rule 3b) and cleanup steps at the end.

Write it to a scratch file first. It is not going into the cases folder
until it parses clean and passes the by-eye list.

## 9. Validate — never skip this

### 9a. Parse with the real parser

Hand-written Markdown mis-parses silently — a heading at the wrong level,
a label line that does not match its regex. The parser that will read this
case in the panel ships with the plugin, so run it against your scratch
file:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" validate <scratch file> --project "<project name>"
```

No build step, no `npm install`, no copy of the Enloop repo — the bundle is
the same parser the extension uses, built from the same source as the
grammar you read in step 3.

It prints **the document as parsed** — every step's title, `where`,
`selectors`, `expected` and `note` — and that printout is the point of the
first run. Read it against what you meant to write, because this is where a
mis-indented `Selector:` shows up as body prose, and where two fallback
selectors that silently collapsed into one become visible.

**On every re-run after a fix, add `--findings-only`.** Same checks, same
exit code, without re-printing a document you have already read — which on a
long case costs more than every instruction in this skill put together.

Then read its findings:

- **ERRORS** mean the document is wrong and the tool is sure: a step with no
  `Where:`, an `### Expected` that is prose rather than bullets, a `%NAME%`
  nothing declares, a title missing its project prefix, a quick subset that
  does not parse to the steps you marked. Fix and re-run. Exit code 1.
- **WARNINGS** are the judgements the contract leaves to you — a prose
  `Where:`, a step with no `Selector:`, an unmeasurable adjective in
  `### Expected`. Answer each one. Some are correct for your case; a
  third-party console has no route, and a HubSpot card has no DOM to carry a
  `data-testid`. **Never edit a case just to silence one** — that trades a
  real judgement for a green tick.

Check the counts on the first lines against what you intended: steps,
variables, dependencies, prerequisites, and how many are marked quick.

`validate` cannot see your app, so it says nothing about the specifics that
matter most: a label you invented, a route that does not exist, a selector
that is not in this repo. Those are step 9b's job and yours.

### 9b. Walk the by-eye list

At the end of the step contract, under *Checking a finished case*. It is
only the items no tool can settle — the mechanical half is what you just
ran, so do not re-check those by hand. Fix what it catches and re-validate
with `--findings-only`. Do not rationalise a hit.

## 10. Land the case

One command, and it is the only way a case reaches the folder:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" write <scratch file> --data-dir "$DATA_DIR" --project "<project name>"
```

It validates again and writes **nothing** on errors. On success it derives
the id, creates `test-cases/<id>/` with `meta.json` and `versions/v1.md`
where `FsaDataStore` reads, prints the absolute path it wrote, and repeats
the `cold run` line for your report. `--suite <suiteId>` lands the case
inside an existing suite instead.

Revising an existing case: add `--case <id>` and it writes
`versions/v<n+1>.md` beside the existing versions — put a `Change note:`
line under the title describing the delta. Previous versions are never
edited; the history is the audit trail.

**Never build the layout by hand.** The id shape, the `test-cases/` level
and `meta.json` are this command's job, and a case assembled manually is
how files land where no Library looks. Placeholders stay literal in the
stored file — `%NAME%` is substituted per run, not at authoring time.

## 11. Report

Tell the user:

- The case title (with its project prefix) and its id — it sorts to the top
  of the Library, which is ordered by last update.
- **The absolute path you wrote to.** One line, so a misplaced case is caught
  here rather than as an empty Library later.
- The scope it covers, the screens it touches, how many steps, and how many
  are marked `Kind: quick` — so they know a quick run is available and what
  it covers.
- **The `cold run` line from the validator, verbatim** — how much of the
  case a first-time runner can click, and what it asks for before starting.
- **Questions the case will ask before a run: N (names).** For each value
  in that list, say why it cannot have a `Default:` or a `Generator:` —
  zero is the norm, and every exception is a decision to defend.
- Anything you could not derive from source — elements with no stable
  selector, values the tester must supply, steps you could not make binary.
  Be specific; this is the list that decides whether the case is trustworthy.
- Whether the app map was built fresh or reused.

Do not claim the case was executed. It was parsed and linted, not run.

Finish by telling them the next step: run it in the extension, then
the **check** skill, back here, to triage what it found. If any step had to go
without a `Selector:`, offer the **instrument** skill first — Highlight is
dead weight on those steps until the elements have handles. If you had to
ask for the project name in step 1, offer the **setup** skill so the next case
in this repo does not ask again.

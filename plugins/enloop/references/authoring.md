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
3. Derive it and say so: the `name` in `package.json` / `composer.json` /
   `pyproject.toml` (the last path segment, without a scope), else the
   repo directory name, title-cased. State the choice in the report and
   offer the **setup** skill, which records it once. Ask only when the
   repo has no manifest and no directory name worth using.

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

The prose sections bind as rules. An older rules file may still carry a
`Base URL: <origin>` structured line — the pre-domains way of recording the
deployment cases default to. Read it as the main domain's address only when
the environments file below has nothing, and record it there so it is not
needed again.

**They are binding.** A rule outranks a habit and outranks anything below in
this file that is not the grammar. If you believe one is wrong, say so in your
report and follow it anyway; changing it is the user's call, and a rule
silently ignored is worse than no rules file at all.

`(no rules recorded for … yet)` is the normal answer for a new project. Do not
invent any, and do not write to this file — promoting a rule is the check
skill's job, because it is the one that has seen the run that justified it.

### 2b. Read this project's environments

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "<project name>"
```

The deployments this project's cases run against — `environments.json` in
the data folder, the same file the panel's Environments screen edits and
its run picker reads. It prints the **domain names** the project declares
(`DOMAIN` for the app under test; `ADMIN` and the like only for a second
host), the **variable names** environments provide, every environment for
this project with its values, and a `defaults` line: the addresses that
become the case's `@locations:` hosts and any declared domain's `Default:`
in step 8.

`(none declared)` is the normal answer for a project nobody has set up yet.
It is not a reason to ask. Derive the deployments from the repo the same way
you derive routes: `.env.example` / `.env.*` (`APP_URL`, `BASE_URL`,
`NEXT_PUBLIC_*_URL`, `VITE_*_URL`), `docker-compose*.yml` ports and
hostnames, deploy config (`fly.toml`, `vercel.json`, `netlify.toml`,
`app.yaml`, Helm values, `Procfile` + a hosting README), a Playwright or
Cypress config's `baseURL`, the README's "staging"/"demo"/"local
development" sections. Then **record** what you found so the next case —
and the panel — finds it:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "<project name>" \
  --domain DOMAIN --env local --set DOMAIN=http://localhost:3000
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "<project name>" \
  --env staging --set DOMAIN=https://staging.example.test --default
```

The app under test is `DOMAIN` — the name every case uses undeclared; an
admin console on its own host, a second tenant, a marketing site the flow
signs in from, each get a name of their own. Mark the deployment the project normally
tests against `--default`; when nothing says which, staging beats local
beats prod, and say so in the report. A value that differs per deployment
and is not an address — a QA account, a tenant id — is recorded the same
way (`--variable QA_EMAIL --env staging --set QA_EMAIL=…`). What you could
not find stays empty in that environment, listed in the report as a hole;
it is never a question to the user and never a blank in the case.

### 2c. Read what this project's testers rated

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" ratings "$DATA_DIR" "<project name>"
```

Rules say what a case must do; this says what a good one looked like. The
panel lets a tester put one to five stars on a step and on a case, and this
command collects them across every run in the folder: the cases testers
rated, the steps they rated highly — printed in full, as the run froze them
— and the steps they rated poorly, with what the tester said was wrong.

Use it as the style guide the contract cannot be:

- **A highly rated step is the shape to write in** — its level of detail,
  what its `Expected` names, how it phrases the action. Learn the pattern
  and write new steps to it. Do not paste the step: its values are the
  substituted ones from one run, and its route belongs to its own screen.
- **A poorly rated step is the shape to avoid.** Where the tester said why,
  that reason is a defect to keep out of every step you write today; where
  they did not, read the step against the contract and work out which rule
  it broke.
- **A highly rated case is the one to model a new case on** when the
  feature is similar — same depth, same split between quick and full.

One rating is an opinion; the same shape starred in several runs is a
style. When the ratings and a rule disagree, the rule wins — say so in your
report, so the user can settle it in the rules file.

`(no ratings recorded for … yet)` is the normal answer for a project whose
testers have not starred anything, and changes nothing about what follows.
Never write ratings yourself; they are the tester's.

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
  record mentioned in prose. Write every one of them `%DOMAIN%/<route>` —
  `Where:` included — so the address follows the tab the run starts from
  and the panel can colour it by `@locations`; a route on a second host
  uses that host's declared name (`%ADMIN%/audit`). A scenario may walk
  between hosts step by step; a literal absolute URL is only for a page of
  a system the case does not otherwise declare. A route that carries a
  value the run produces (`/user.php?user=<id>`) is not an address at all:
  `Where:` is the page it is reached from, and the shape goes in backticks
  in the instructions (contract rule 2, last section).
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
- **`Goal:`** — one plain line under the title: what finishing this case
  proves, for someone who has never seen the app. Required. It is pinned
  on the run screen for the whole run, so it is short: `Goal: A user can
  sign in with either of their two email addresses`.
- **`You will:`** — one line on the shape of the work, read before Start:
  `You will: log in and out several times, change the primary and
  secondary email`. Required.
- **`# You will need`** — what must be in the tester's hands before step
  1: a mailbox that receives codes, a second browser, a phone. Omit the
  section when the answer is nothing; never put entry points or services
  here — those are `# Prerequisites`.
- **Description** — why this case exists now (which branch or ticket) and
  any background. Two or three sentences. Not the goal; that has its line.
- **`@locations:`** — under the title, the hosts this case is meant to run
  on, as comma-separated globs taken from the environments of step 2b:
  the local port, the staging host, prod as a wildcard when the case may
  run there. The first entry without a `*` is what a cold reader starts
  from, so put the default environment's host first:

      @locations: localhost:3000, staging.example.test, *.example.com

  Nothing in the case names an address beyond this line: `%DOMAIN%` is
  filled from the tab the run starts from (or the environment the tester
  picks), and the panel shows every address green when it fits one of
  these hosts and red when it does not.
- **`# Domains`** — only when the case touches a **second** host: an
  admin console on its own host, a second tenant, the site the flow signs
  in from. One entry each, with a `Default:` copied from the `defaults`
  line of step 2b and a `Match:` glob so a run started from that host's
  tab fills it:

      # Domains

      ## ADMIN
      The admin console.
      Match: admin.*.example.test
      Default: https://admin.staging.example.test

  A path under the app's own host is a route on `%DOMAIN%`, never a
  domain. A domain is not a variable: no `Generator:` line, and never
  `BASE_URL` under `# Variables` — that is the pre-`DOMAIN` spelling, and
  the linter flags it.
- **`# Variables`** — only values that are not addresses, and every one
  resolved by you: a `Default:` read from the repo (a seeded record, a
  fixture value, the rules file's *Accounts and data* section), a
  `Generator:` for what must be fresh, or a name the project's
  environments provide (step 2b) for what differs per deployment. **Never
  ask the user for a value, and never leave one for the tester** — a
  variable with none of the three is a linter error. When the repo cannot
  tell you, write the best candidate you found as the `Default:` and mark
  it as an assumption in the report. A value the run itself produces — a
  created record's id — is not a variable and gets no invented default:
  refer to the record by what the tester can see, and keep the value out
  of every address (contract rule 6).
- **`# Prerequisites`** — the entry point first (contract rule 2a), then
  **who the tester is in the app** (contract rule 2d) — account, role, and
  where the credential lives, copied from the rules file's *Accounts and
  data* section rather than assumed — then data that must exist, then
  **every service the tester has to start themselves**, each with the
  command and the directory to run it in:

      - Open %DOMAIN%/admin/integrations
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
  (rule 3b), `Kind: extra` on optional side-checks and conditionals
  (rule 3c), and cleanup steps at the end.
- **Groups**, when the scope has several concerns (rule 9): one
  `# Steps: <title>` section per concern, opening with its goal — what its
  steps prove together — before the first step. An email refactoring is
  *Log in*, *Restore password*, *Change the address*; a one-concern ticket
  is a plain `# Steps`. Shared setup goes in a plain `# Steps` before the
  first group, cleanup in one after the last.

Write it to a scratch file first. It is not going into the cases folder
until it parses clean and passes the by-eye list.

## 9. Validate — never skip this

### 9a. Parse with the real parser

Hand-written Markdown mis-parses silently — a heading at the wrong level,
a label line that does not match its regex. The parser that will read this
case in the panel ships with the plugin, so run it against your scratch
file:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" validate <scratch file> --project "<project name>" --data-dir "$DATA_DIR"
```

No build step, no `npm install`, no copy of the Enloop repo — the bundle is
the same parser the extension uses, built from the same source as the
grammar you read in step 3. `--data-dir` lets it read the project's
environments, so a variable those provide is not reported as a question
the case would ask.

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
domains (and which is main), variables, dependencies, prerequisites, and
how many are marked quick.

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

Revising an existing case: add `--case <id>` and it writes the next
major version (`v<n+1>.md`) beside the existing ones — minors like `v3.1`
are mid-run patches landed by the serve skill's `--patch`, and an authored
revision always moves past them to the next whole number — put a `Change note:`
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
  case a first-time runner can click, what it asks for before starting
  (always zero: the validator refuses anything else), and which names come
  from the project's environments.
- **The domains it declares and where their defaults came from** — the
  environments file, or the repo files you derived them from and then
  recorded. Name every environment you created or filled, and every value
  that is still empty in one of them.
- **Values you assumed.** Every `Default:` that came from your best
  reading of the repo rather than from a fixture, the rules file or the
  environments — so the user corrects a guess once, in the environments
  file or the rules, rather than discovering it in a run.
- Anything you could not derive from source — elements with no stable
  selector, values the tester must supply, steps you could not make binary.
  Be specific; this is the list that decides whether the case is trustworthy.
- **Which rated steps or cases you modelled on**, when the project had any
  — one line naming them, so the user can see the ratings doing their job
  and correct a pattern they no longer want followed.
- Whether the app map was built fresh or reused.
- **Whether an agent is serving the folder.** Run
  `node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" agent-status "$DATA_DIR"`.
  If it prints `WATCHING`, say nothing — everything in the panel just
  works. If it prints `NONE`, relay one line: authoring and running cases
  need no agent, but the panel's **Ask the agent** and command **Run**
  buttons will sit waiting until the enloopd daemon is started
  (docs/daemon.md in the Enloop repo) or `/enloop:serve` is run manually
  when something is pending.

Do not claim the case was executed. It was parsed and linted, not run.

Finish with how to run it — in this order, because the first needs
nothing installed. The `write` command printed a `viewer` line: give
that link first ("open this in any browser to read and tick off the
case"). Then the extension: install it from the Chrome Web Store
(https://chromewebstore.google.com/detail/enloopmd-managing-human-a/fnpjeaabeckcihomnmeoapclokikanod),
open the side panel, and connect `<the data folder, or the repo that
holds it>` — the case is already in the Library. Then the **check**
skill, back here, to triage what the run found. If any step had to go
without a `Selector:`, offer the **instrument** skill first — Highlight is
dead weight on those steps until the elements have handles. If you had to
ask for the project name in step 1, offer the **setup** skill so the next case
in this repo does not ask again.

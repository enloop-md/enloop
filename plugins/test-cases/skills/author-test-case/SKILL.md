---
name: author-test-case
description: Write a manual test case for the Test Case Manager extension covering a feature, ticket, or branch in the app repo you are currently in. Every route, UI label and selector is derived from that repo's source rather than recalled, and the finished case is parsed with the real grammar parser before it is written. Use when the user asks to write/author/generate a test case, QA checklist, or manual verification plan for a ticket or branch — e.g. "write a test case for PROJ-1234", "make a QA case for this branch". Not for demo/example cases exercising the grammar itself; that is generate-example-case, which only runs inside the test-assistant repo.
disable-model-invocation: true
allowed-tools: Read Grep Glob Write Edit Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(rg *) Bash(node *) Bash(npx tsc *) Bash(mkdir -p *) Bash(openssl rand *)
---

# Author a test case

Produces one real test case, written into the Test Case Manager's cases
folder, that a tester can execute without stopping to think. Two failure
modes this skill exists to prevent:

1. **Invented specifics.** A route, button label, or selector recalled
   from conversation rather than read from the app's source. These look
   authoritative and waste the tester's time when wrong.
2. **Prose that offloads thinking onto the tester.** Multi-action steps,
   rationale mixed into pass criteria, test data discovered mid-run.

The deliverable is a case that parses with the real parser and passes the
step contract's reject list. A case that merely reads well is not done.

$ARGUMENTS is the scope: a ticket id, a branch, a feature name, or a
free-text description. If it is empty, ask what to cover before doing
anything else.

## 1. Resolve where things live

Two roots. Never hardcode either.

- **App repo** — where you are now: `${CLAUDE_PROJECT_DIR}`. Source of
  every route, label and selector.
- **Test Case Manager repo** — `$TCM_HOME`. Source of the grammar, and
  parent of the cases folder.

```bash
echo "TCM_HOME=${TCM_HOME:-unset} TCM_CASES_DIR=${TCM_CASES_DIR:-unset}"
```

If `TCM_HOME` is unset, ask the user for the path and tell them to add it
to their settings `env` block so this is a one-time cost:

```json
{ "env": { "TCM_HOME": "/path/to/test-assistant" } }
```

Cases are written to `$TCM_CASES_DIR`, defaulting to
`$TCM_HOME/private/test-cases` when unset.

Verify both roots exist before continuing. If `${CLAUDE_PROJECT_DIR}` and
`$TCM_HOME` are the same directory, you are in the wrong repo — that means
the user wants `generate-example-case`, not this skill.

## 2. Read the grammar fresh from source

The grammar is a doc comment at the top of
`$TCM_HOME/shared/src/markdown.ts`. It changes. **Read it every time** —
never write a case from a remembered version of the grammar, and never
copy the grammar into this skill.

Note the value of `CURRENT_FORMAT_VERSION` there; it goes in the case's
`@version` line. If what you read disagrees with anything below, the
source file wins — say so in your report rather than silently following
this file.

## 3. Read the step contract

Read `${CLAUDE_SKILL_DIR}/references/step-contract.md` in full. It defines
what a step must look like and carries the reject list you will check
against in step 8. It is the whole point of this skill.

## 4. Establish scope

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

## 5. Build or refresh the app map

The expensive part of authoring is learning the app's surface. Do it once
and cache it at `${CLAUDE_PROJECT_DIR}/.claude/test-map.md`.

**If it exists**, read it, and spot-check two or three entries against
source before trusting it. Note its `Generated:` date — if the diff from
step 4 touches routing or UI files, refresh those sections.

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

## 6. Derive every specific from source

Hard rule: **every route, button label, field label, message string and
selector in the case must be one you have read in this repo during this
session.** No exceptions and no recall.

Practically, for each step you intend to write:

- Route → the router config or route attribute.
- Visible label → the JSX/template/i18n entry. Quote it exactly, including
  capitalisation, in backticks.
- Selector → `data-testid` first, then `id`, then a stable `aria-label`.
  Never a structural path.
- Expected message text → the string literal in source, not a paraphrase.

If a needed element has no stable selector, do not invent one. Write the
step without a `Selector:`, add a `### Note` saying the element lacks a
test handle, and mention it in your final report as a suggested
`data-testid`.

## 7. Write the case

Follow the grammar from step 2 and the contract from step 3. Structure:

- **Title** — specific enough to find in a Library list. Include the
  ticket id when there is one.
- **`@version`** — the `CURRENT_FORMAT_VERSION` you read in step 2.
- **`Tags:`** — ticket id, feature area, and `manual`.
- **Description** — what this verifies and why it exists now (which branch
  or ticket). Two or three sentences.
- **`# Variables`** — every value the tester supplies. Contract rule 6:
  each gets a `Default:`, a `Generator:`, or explicit acquisition steps.
- **`# Dependencies`** — what must be true of the environment: deployed
  branch, migrations, access levels, running workers.
- **`# Prerequisites`** — what must be true of the data before step 1.
- **`# Steps`** — per the contract. Cleanup steps at the end.

Write it to a scratch file first. It is not going into the cases folder
until it parses and passes the reject list.

## 8. Validate — never skip this

### 8a. Parse with the real parser

Hand-written Markdown mis-parses silently — a heading at the wrong level,
a label line that does not match its regex.

```bash
cd "$TCM_HOME/shared" && npx tsc -p tsconfig.json --noEmit false --outDir dist --declaration false
```

Then run a throwaway Node script against `$TCM_HOME/shared/dist/markdown.js`
that:

- calls `parseCaseDocument(raw, { version: 1, createdAt: new Date().toISOString() })`
  and asserts the step count, variable count, dependency and prerequisite
  counts match what you intended,
- asserts every step you gave a `Where:`/`Selector:`/`### Note` actually
  came back with those fields populated (a mis-indented header line
  silently becomes body prose — this check is what catches it),
- if there are variables, calls `resolveVariableValues` +
  `substituteVariables` from `dist/variables.js` and asserts no `%NAME%`
  survives: `!/%[A-Za-z_]+%/.test(substituted)`,
- prints each step's title, `where`, `selector` and `expected` so you can
  read the parsed result rather than the source you just wrote.

Delete `$TCM_HOME/shared/dist` and the script afterward. They are scratch,
not source — and leaving a stale `dist` in that repo is confusing.

### 8b. Run the reject list

Walk the reject list at the end of the step contract against every step.
Fix what it catches and re-parse. Do not rationalise a hit; the list is
deliberately mechanical.

## 9. Write the files

```
$TCM_CASES_DIR/test-cases/<id>/meta.json          {"archived": false}
$TCM_CASES_DIR/test-cases/<id>/versions/v1.md     the validated Markdown
```

`<id>` follows `newTestCaseId` in `$TCM_HOME/shared/src/id.ts`: the title
lowercased with every non-alphanumeric run replaced by `-`, trimmed of
leading/trailing `-`, cut to 40 characters, then `-` and 8 hex characters
(`openssl rand -hex 4`).

Placeholders stay literal in the stored file — `%NAME%` is substituted per
run, not at authoring time.

If you are revising an existing case rather than creating one, write
`versions/v<n+1>.md` alongside the existing versions and put a
`Change note:` line under the title describing the delta. Never edit a
previous version in place; the version history is the audit trail.

## 10. Report

Tell the user:

- The case title and its id, so they can find it in the Library.
- What scope it covers (branch/ticket) and how many steps.
- Which screens it touches.
- Anything you could not derive from source — elements with no stable
  selector, values the tester must supply, steps you could not make
  binary. Be specific; this is the list that decides whether the case is
  trustworthy.
- Whether the app map was built fresh or reused.

Do not claim the case was executed. It was parsed and linted, not run.

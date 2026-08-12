# Enloop authoring — the cold-runner bar

Status: **items 1–2 built (2026-08-12); 3–6 outstanding. Written 2026-08-12.** Builds on the uncommitted
format-0.0.5 work (the `page-origin` generator and the request-capture pass):
land that first, then execute this plan on top of it.

Scope split: [`PLAN-TOOLING.md`](PLAN-TOOLING.md) owns the workflow *around* a
case — skills, runs, capture. This document owns **what a finished case must
contain** so that reading it is enough to run it. It leans on two decisions
already made there: item 4 (one case, `Kind: quick` tiers — unchanged here)
and item 8 (per-project rules in the data folder — this plan adopts its
structured `Base URL:` line as the first one actually implemented).

Seven items. 1–6 are code and reference edits, ordered so each builds on the
previous; 7 is a decision record with no code of its own. One commit per item.

---

## The bar, stated once — decided, do not re-litigate

**A case must be executable by someone who has never seen the system, is not
technical, and has no one to ask.** Concretely, two invariants:

1. **Every place is one click away** — in the extension's run screen, in the
   shared viewer page, and in the downloaded standalone file. Not "findable",
   not "resolvable if the right tab happens to be open": a link that works
   from a cold start.
2. **Every value is already in hand** — the address of the environment, the
   account and where its credential lives, every literal to type, every
   record the case operates on. The run asks the tester **zero questions** by
   default; a variable the tester must supply is the documented exception,
   never the norm.

**Effort levels change coverage, never this bar.** `quick` and `full` differ
in how much of the app they cover and how much source they read — a quick
case is *smaller*, and every step it does have meets the same two invariants.
The token cost of the bar itself is held near zero by making cached artifacts
carry the expensive facts (item 7 does the accounting).

The step contract already *says* most of this ("no inference, no hunting, no
deciding") and cases still miss it, because three mechanisms undercut it. The
next section names them; items 1–6 remove them.

## Why cases miss the bar today

Every one of these was verified against the working tree on 2026-08-12.

- **The canonical `Where:` form only works for someone already in the app.**
  The contract (rule 2b) prefers bare routes — `Where: /admin/reports` — and
  the Go control resolves them against the run tab's current origin,
  refusing on a blank tab (`extension/src/lib/navigate.ts:51-57`, "Open the
  app in this tab first"). The viewer is stricter still: `renderWhere` links
  only when the *resolved* text is an absolute URL
  (`shared/src/html.ts:278-286`), and the viewer never runs generators — it
  prefills declared defaults only (`shared/src/html.ts:270-276`). So the
  house-style case renders in the viewer with **no clickable navigation at
  all**. This is the literal "I have to find the page manually".
- **The new `BASE_URL` pattern still breaks cold.** 0.0.5 adds
  `Generator: page-origin`, but `resolveVariableValues` runs a declared
  generator *instead of* the default even when the generator yields nothing
  (`shared/src/variables.ts:96-110`; `page-origin` returns `""` without a
  page). On a blank tab, `BASE_URL` with both a generator and a `Default:`
  resolves to `""`, the placeholder survives substitution, and every
  `%BASE_URL%/…` address in the case is dead.
- **Nothing says who you are in the app.** Rule 2a demands the entry URL;
  no rule demands the account, the role, or where the credential lives. A
  first-time runner is stopped by the login screen before step 1.
- **The "no hunting, no guessing" rules that live only in the by-eye list
  don't survive cheap sessions.** A place named in prose with no address
  (rule 2c), data discovered mid-run ("an existing contact", "any company" —
  rule 6): `shared/src/lint.ts` checks none of them, so a session that skimps
  on the by-eye pass ships them, and nothing downstream ever objects.
- **A plain-text variable address never becomes a link in the viewer.** The
  contract's own prerequisite form — `- Open %BASE_URL%/admin/reports` —
  renders as text with value chips in the viewer (`withVariableSpans`), not
  as a link, even when `BASE_URL` has a default. (The extension is fine
  post-substitution: the frozen run text holds a literal absolute URL and
  remark-gfm autolinks it, `extension/src/components/Markdown.tsx:12`.)

---

## 1. A generator that yields nothing falls back to the default — **implemented 2026-08-12**

### The problem

`Generator:` and `Default:` on the same variable is exactly the right
declaration for `BASE_URL` — "whichever deployment you have open, else the
usual one" — and today the generator's empty answer shadows the default.

### The change — `shared/src/variables.ts`

In `resolveVariableValues`, replace the resolution expression:

```ts
resolved[variable.name] =
  provided[variable.name] ??
  ((variable.generator ? generateVariableValue(variable, context) : "") ||
    variable.defaultValue ||
    "");
```

An explicitly provided value still wins, **including an intentionally blank
one** (`??` keeps `""` from `provided`); a generator that yields a value
wins over the default; a generator with nothing behind it — any `page-*`
generator without a page — falls through to `Default:`. `random-*` and
`timestamp` never yield empty, so nothing else changes. Update the function's
doc comment to this order.

Update the grammar doc comment in `shared/src/markdown.ts` (the "Starting a
run resolves every declared variable" sentence): the precedence is *the value
typed before the run starts, else the generator when it yields something,
else the declared default, else empty* — which also fixes that sentence's
current order, which never matched the code. Fold into the pending 0.0.5
bump — no new format version — and regenerate the plugin's `grammar.md` with
`node scripts/build-plugin.mjs` in the same commit (CI fails on drift).

### Consequences

- `lintCase` substitutes with no page context (`shared/src/lint.ts:84-86`),
  so after this change **lint's substituted document is precisely the cold
  run** — a case's defaults applied, its page generators empty. Item 4's
  cold readout is built directly on that.
- The viewer needs nothing: `initialValues` already reads only defaults,
  which now agrees with what a cold extension run resolves.

### Check

Fixture case with `BASE_URL` (`Generator: page-origin` + `Default:
https://staging.example.test`) and a `Where: %BASE_URL%/admin/reports`. Run
`node plugins/enloop/validator/enloop-case.mjs validate <fixture>`: the
printed document shows the substituted absolute URL, not `%BASE_URL%`.
`npm run typecheck` passes.

---

## 2. One address form: `%BASE_URL%/route`, everywhere — **implemented 2026-08-12**

### The problem

The contract draws a distinction — bare routes in `Where:`, absolute
addresses in prerequisites and links — that exists to serve a tester already
in the app. With item 1 in place, `%BASE_URL%` + `page-origin` +
`Default:` serves that tester identically (their open tab's origin wins) and
also serves the blank tab, the viewer, and the person on another machine.
Bare routes retain exactly one advantage: fewer characters. That is not
worth a second rule and a broken cold start.

### The decision

**Every address belonging to the app under test is written
`%BASE_URL%/route` — in `Where:`, in prerequisites, in prose links.** Every
case declares `BASE_URL`:

```markdown
## BASE_URL
The deployment under test — whichever one you have open.
Generator: page-origin
Default: https://staging.example.test
```

The `Default:` is the environment the project normally tests against, and it
comes **from the project's rules file** — the first structured line of
`rules/<project>.md` in the data folder, exactly the shape PLAN-TOOLING
item 8 sketched:

```markdown
Base URL: https://staging.example.test
```

When the rules file has no such line, the authoring skill asks the user once,
uses the answer, and points at `setup` to record it. External systems keep
their own literal absolute URLs or per-run variables (`%CONTACT_URL%`), as
today. Bare routes are demoted to a lint warning (item 4), not an error —
existing cases keep parsing and get upgraded by the sweep (item 6).

### Where it lands

- `plugins/enloop/references/step-contract.md` — rewrite rule 2's frame:
  the intro sentence gains the persona ("a tester **who has never seen the
  system** can execute without thinking…"); 2a and 2b collapse their
  bare-vs-absolute split into the single `%BASE_URL%` form; 2b keeps the
  prose-`Where:` escape hatch for places with no address. Update both
  affected entries in *Checking a finished case*.
- `plugins/enloop/references/authoring.md` — §2 gains "read the structured
  `Base URL:` line"; §7's route bullet and §8's `# Variables` bullet switch
  to "always declare `BASE_URL` with generator *and* default"; §8's
  Prerequisites example updates.
- `plugins/enloop/skills/setup/SKILL.md` — setup asks for / detects the
  usual test environment and writes the `Base URL:` line into
  `rules/<project>.md`, creating that file with stub sections when absent.
  Markdown only, which keeps it inside PLAN-TOOLING item 1's rule; creating
  the stub is item 8's own design.
- Grammar doc comment in `shared/src/markdown.ts` — the `BASE_URL` example
  gains the `Default:` line and one sentence on why (cold runs and the
  viewer read it). Same 0.0.5 fold, regenerate `grammar.md`.
- Docs: `docs/case-format.md` (extend the new page-origin section with the
  `Default:` half of the pattern), `README.md` example (`Where:
  /admin/sync-console` → `%BASE_URL%/admin/sync-console` plus the variable
  block), `docs/skills.md` where it restates the procedure.
- `shared/src/example-case.ts` — if its `Where:` lines are bare routes,
  convert; it targets a public practice site, so its `BASE_URL` default is
  that site.

### Check

The fixture from item 1 extended to the canonical form validates with zero
address warnings. A second fixture with a bare `Where: /admin/x` draws the
new warning from item 4. README and case-format examples paste-validate
clean (they are what people copy).

---

## 3. The case says who you are

### The problem

The entry URL without the account is an invitation to a login screen. For
the author the login is ambient state; for a first-time runner it is the
first unanswerable question, and today no rule, no skill step, and no lint
line mentions it.

### The decision

New contract rule **2d — the case states who the tester is in the app**:

- A prerequisite names the account and role in the app's own words, with the
  login address a link and the credential's **location** — a vault item, a
  seed command, a fixtures file — never a person to ask:

  ```markdown
  # Prerequisites
  - Logged in at %BASE_URL%/login as %QA_EMAIL% (role `Administrator`) —
    password: vault item `staging QA bot`
  ```

- When login **is** what's under test, it is steps, as today.
- When the app has none, the case says nothing and the author answers the
  lint warning once (item 4).
- **Never a real production credential in a case file.** A throwaway
  test-environment credential in a `Default:` is the team's call, made in
  the rules file's *Accounts and data* section — which is also where the
  account facts come from at authoring time, so the skill copies instead of
  guessing (`admin@` bans, `qa+%TIMESTAMP%@` conventions — the check skill
  already promotes these; authoring must translate them into the concrete
  prerequisite, not assume them known).

### Where it lands

`step-contract.md` (rule 2d + one by-eye item: *"the account's credential
location is a place, not a person"*), `authoring.md` §8's Prerequisites
bullet (account line, sourced from the rules file), item 4's lint check,
`docs/case-format.md`'s prerequisites paragraph.

### Check

Fixture with UI steps and no login-ish prerequisite → exactly one new
warning; adding the account line silences it; a no-login public-site case
keeps the warning and the author's answer in the report is the documented
outcome.

---

## 4. Lint: the bar as code, plus the cold-run readout

### The problem

Everything the by-eye list alone guards is only as good as the session's
diligence, and the user's experience says that is not good enough. The split
stays what `lint.ts`'s header declares — **errors are machine-certain,
warnings are judgements printed to be answered** — but far more of the
contract belongs in the warning list, and the lint should also *measure* the
bar, not only police it.

### New checks — `shared/src/lint.ts`

All warnings (each has a legitimate "correct for this case" answer), rule
ids tied to the contract:

| id | fires when | message gist |
| --- | --- | --- |
| 2b | `Where:` starts with `/` | one-click only when the tab is already on the app — `%BASE_URL%/…` works from anywhere |
| 2b | any `Where:`/prerequisite/link address in the doc, and no `BASE_URL` declared | the case names addresses but no environment; declare `BASE_URL` |
| 2b | `BASE_URL` declared without `Default:` | cold runs and the viewer have no address to fall back to |
| 2d | ≥1 manual step, and no prerequisite or variable matches `/\b(log(ged)?[ -]?in|sign(ed)?[ -]?in|account|credentials?|password)\b/i` | nothing says who the tester is in the app |
| 2c | instructions (code-stripped) match `/\b[A-Z][\w-]*\s+(page|screen|tab|dialog|modal|console|dashboard)\b/` and the step carries no Markdown link and no `%NAME%` in prose | a place is named with no address beside it |
| 6 | instructions (code-stripped) match `/\b(an existing|any|some|a valid|of your choice|your own|appropriate)\b/i` | test data discovered mid-run — name the exact record or add a variable saying how to obtain it |
| 2a/2c | `BARE_ROUTE_IN_PROSE` extended to step instructions and `### Expected` (today it only covers prerequisites, where it stays an **error**) | a bare route in prose is not a link anywhere |
| 4 | `UNMEASURABLE` gains `\b(normally|as usual|as before)\b` | unchanged shape |

The 2c place-name pattern deliberately requires a capitalized name
(`Reports page`, `Sync Console screen`) so "the page reloads" never fires.
Tune against the fixtures, not in the abstract.

### The cold-run readout — new field on `LintResult`

```ts
cold: {
  /** Manual steps whose substituted `Where:` is openable with no page behind
   * it: /^https?:\/\//i, localhost, 127.0.0.1, [::1]. */
  navigableSteps: number;
  uiSteps: number;
  /** Variables that end a cold resolution empty: page-* generator with no
   * page and no default, or nothing declared at all. */
  unresolved: string[];
  /** Variables the tester must type before starting (no default, no
   * generator) — the questions the case will ask. */
  asks: string[];
}
```

Computed from the already-substituted document — after item 1 that *is* the
cold simulation, no new machinery. The openable test is a small local
`COLD_OPENABLE` regex; do **not** import the extension's `looksNavigable`
(shared stays dependency-clean; the duplication is deliberate, same as the
`ADDRESS` comment already says).

The validator (`plugins/enloop/validator/lib.mjs` output path) prints it
after the counts line, informational, present even with `--findings-only`:

```
Cold run: 9/12 steps one-click · asks 1 value before start (TICKET_ID) · unresolved: none
```

Suites inherit all of this wherever `lintCase` already runs on `suite.md`;
nothing suite-specific is added.

### Check

A fixture per new check fires it exactly once; the canonical case from
item 2 fires none and reads `N/N steps one-click · asks 0 values`.
`npm run typecheck`. Existing fixtures still produce their old findings
(no removed checks).

---

## 5. Links wherever the case renders

### The problem

The viewer is the surface a first-time runner actually gets (the case rides
inside the link), and it is the surface with the fewest links. Two
render-time upgrades close it — both in the spirit the selector-in-prose
feature set: **old cases gain the links on next render, authors learn no new
markup.**

### The changes — `shared/src/html.ts`

- **`renderWhere` falls back to `BASE_URL`.** When the resolved `Where:` is
  not absolute but starts with `/` and `values.BASE_URL` resolves absolute,
  link to `new URL(resolvedWhere, resolvedBase)`. Legacy bare-route cases
  become navigable in the viewer the moment `BASE_URL` has a value.
- **A plain-text variable address becomes a link.** Where the inline
  renderer currently turns `%NAME%` into a value chip: when the token plus
  its immediate un-spaced suffix (`%BASE_URL%/admin/reports`) resolves to an
  absolute URL, wrap the chip run in `<a href="<resolved>"
  data-href="<original>" target="_blank">`. The contract's own prerequisite
  form then works as written, with no rule change.

Both are build-time HTML generation — `attachCasePage`'s self-containment
constraint (README, repository-layout section) is untouched, but re-verify
the downloaded standalone file anyway since it shares this code.

The extension needs nothing: run text is substituted when the run is frozen
(`extension/src/lib/fsa-store.ts:561`) and remark-gfm autolinks the
resulting absolute URLs.

**Decided against, recorded so it stays decided:** a run-screen fallback
that resolves legacy bare-route `Where:` lines against `BASE_URL`. Runs do
not record resolved variable values (`shared/src/schemas.ts` has no such
field — substitution happens before freezing), so the value is simply not
there to use; adding it to `run.json` for this alone is schema cost for a
case shape item 6's sweep is retiring anyway.

### Check

Open the item-2 fixture in the viewer (`npm run dev:viewer`): every `Where:`
is a working link, the entry prerequisite is a working link, both open the
practice environment. Clear the `BASE_URL` field in the viewer's variables
form → the links degrade to text, not to broken hrefs. Repeat on the
downloaded standalone file. A legacy fixture with bare routes gains links
when `BASE_URL` is filled in.

---

## 6. Skills carry the bar; check learns to sweep without a run

### The changes

- **`plugins/enloop/references/authoring.md`** — §11's report gains two
  mandatory lines, copied from the validator verbatim: the `Cold run:`
  readout, and *"Questions the case will ask before a run: N (names)"*. A
  case reported with asks > 0 must say why each cannot have a default or
  generator. No changes to the quick/full tier table: the bar is
  tier-independent by construction, which is the point.
- **`plugins/enloop/skills/check/SKILL.md`** — two additions:
  - §5's staleness sweep also runs the validator on the case's **latest
    stored version** (not only the frozen `case.md`) and treats new
    address/account/data warnings and a degraded `Cold run:` line as case
    defects to fix in `v<n+1>`, the §6 path that already exists.
  - A new invocation form: **`/enloop:check case <id-or-title>`** — no run
    reading at all; resolve the case, sweep staleness against source, run
    the validator, fix what it owns, write `v<n+1>` with a `Change note:`.
    This is the cheap, deliberate upgrade path for a Library written before
    this plan: no app-map build, no coverage changes, a few hundred lines of
    reading per case. Document it in §2's argument resolution and in
    `docs/skills.md`.
- **`plugins/enloop/skills/setup/SKILL.md`** — already covered by item 2
  (Base URL into the rules stub); add the *Accounts and data* stub section
  in the same edit.
- **`docs/skills.md`** — the report-contents paragraph and the new check
  mode.

### Check

In an app repo with one legacy bare-route case: `/enloop:check case <title>`
produces `v2` in the same case folder — addresses in `%BASE_URL%` form,
account prerequisite present or explicitly answered, validator clean, cold
readout `N/N` — and the report names the run-less mode it used. `versions/v1.md`
is untouched.

---

## 7. Effort levels — decided

**Two authoring tiers, `quick` and `full`, remain the only ones.**
PLAN-TOOLING item 4 stands unchanged. Specifically rejected, and parked
here so it stops being re-litigated: a below-quick "draft" tier that skips
reading source. Every specific in a case being read from the repo *in that
session* is the trust the whole product sells; a tier that relaxes it
re-introduces invented specifics, the failure mode the skills exist to
prevent. A cheaper case is a **smaller** case, never a less-derived one —
and quick already is that tier.

Where the tokens actually go, and why this plan adds ~nothing per case:

| Cost | Paid when | Cached where |
| --- | --- | --- |
| App surface (routes, labels, selectors) | first full case per area | `.claude/test-map.md`, committed in the app repo |
| Project facts (base URL, accounts, navigation traps, vocabulary) | once, by setup + check promotions | `rules/<project>.md` in the data folder |
| The bar's enforcement | never (deterministic) | `lintCase` + validator, plain `node` |
| Rendering the links | never (render-time) | `shared/src/html.ts` |

The additions this plan makes to an authored case — the `BASE_URL` block,
one account prerequisite, `%BASE_URL%` prefixes — are copied from the rules
file, not derived; marginal agent cost is a few lines of reading that §2
already does. The knobs that exist for saving tokens, by name: the tier
(coverage); map reuse vs refresh (tier-defined); `--findings-only` on
re-validation; `/enloop:check case` (sweep without run-triage); and running
the plan itself on a cheaper model, which these files' exactness is for.

---

## Executing this plan

Read first, in this order: `plugins/enloop/references/step-contract.md`,
`plugins/enloop/references/authoring.md`, the grammar doc comment atop
`shared/src/markdown.ts`, `shared/src/lint.ts`, `shared/src/variables.ts`,
`shared/src/html.ts`, `extension/src/lib/navigate.ts`,
`plugins/enloop/validator/enloop-case.mjs` and `validator/lib.mjs`,
`plugins/enloop/skills/setup/SKILL.md` and `skills/check/SKILL.md`, and
PLAN-TOOLING items 4 and 8.

- Items land in order 1 → 6; item 7 needs no code. Do not start before the
  in-flight 0.0.5/capture work is committed; rebase this work onto it, never
  interleave.
- **One commit per item**, message in the repo's imperative, no-prefix style
  (for item 1, e.g.: `Fall back to the default when a generator has nothing`).
- Any commit touching the `markdown.ts` doc comment regenerates
  `plugins/enloop/references/grammar.md` via `node scripts/build-plugin.mjs`
  — CI fails when they disagree. `npm run typecheck` before every commit.
- Fixtures used by the checks live in the scratch area, not the repo; the
  repo's own examples (README, `docs/case-format.md`, `example-case.ts`)
  are updated in item 2 and double as living fixtures.
- Examples stay on the fictional CRM/mailer admin app; no real client
  routes, names, or credentials anywhere in this repo.
- After each item, update this file's **Status** line and mark the item's
  heading `— implemented <date>`, the way PLAN-TOOLING records its own.

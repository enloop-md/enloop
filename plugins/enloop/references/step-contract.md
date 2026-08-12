# The step contract
<!-- Read by the quick and full skills. Also the reference enloop-demo
     should follow for any case it writes.

     Every rule here is one an author has to apply while writing. The
     reasoning behind the less obvious ones lives in rationale.md, which
     nothing loads at authoring time — a justification that changes no output
     is not worth its weight in every session's context. -->

The rule every step in an authored test case must satisfy. The goal is a
case a tester who has never seen the system can execute without thinking —
no inference, no hunting, no deciding, no one to ask. If a tester has to
stop and work something out, the case is wrong, not the tester.

Read this before writing any step, and check every finished step against
the by-eye list at the bottom.

## 1. One step = one action = one observable result

A step is the unit a tester marks Pass or Fail. If a step contains two
things that could independently fail, it cannot be marked honestly.

Bad — seven actions, one verdict:

> Navigate to `/admin/integrations`. Click `Add connection`. Leave `Kind`
> at its default, check `Enabled`, set `Name` to %CONNECTION_NAME%, fill
> the required `Client ID` / `Client Secret` / `Endpoint URL` fields, and
> click `Save`.

Good — the arrival is a prerequisite, and each action gets its own verdict:

> # Prerequisites
> - Open %BASE_URL%/admin/integrations
>
> ## Open the new-connection form
> Where: %BASE_URL%/admin/integrations
> Selector: button[data-testid="add-connection"]
> Click `Add connection`.
>
> ### Expected
> - A form appears with `Kind`, `Enabled`, `Name`, `Client ID`,
>   `Client Secret` and `Endpoint URL` fields.
>
> ## Save the new connection
> Where: %BASE_URL%/admin/integrations
> Selector: button[data-testid="save-connection"]
> Click `Save`.
>
> ### Expected
> - The form closes and the connections table lists %CONNECTION_NAME%.

Filling a single form is one step even though it touches several fields —
the fields are one action with one result. Navigating, opening a form, and
submitting it are three.

**Test:** if the instructions contain " then ", " and then ", or a
numbered list of more than about three keystroke-level actions, split it.

## 2. Every place is an address

A tester should never have to know where something lives. *Navigate to the
Reports page* makes them recall a menu path or hunt for it; an address
makes them click. **Every place a case names carries its address** — in a
`Where:` line, in a prerequisite, or as a link — and for the app under
test, the address is always written in one form:

    %BASE_URL%/admin/reports

with `BASE_URL` declared in every case:

    ## BASE_URL
    The deployment under test — whichever one you have open.
    Generator: page-origin
    Default: https://staging.example.test

One form, three readers. A tester already in the app gets their own tab's
origin — the generator. A blank tab, the shared viewer page and a
downloaded file get the project's usual environment — the default. And the
steps themselves name no environment, so the case moves between
deployments without being edited. Another system's page keeps its own
literal absolute URL or a per-run variable (`%CONTACT_URL%`). A bare
route — `Where: /admin/reports` — is the legacy form: it resolves only
against a tab already on the app, and the linter says so. Prose alone is
for places that genuinely have no address.

### 2a. The entry point is a prerequisite, not a step

Most runs start with the tester already in the app, often on the very screen
the case is about. A case whose step 1 is `## Open the Reports page` spends
its first Pass/Fail on something that was true before the run began. Put it
where "what had to be true before step 1" already lives:

    # Prerequisites
    - Open %BASE_URL%/admin/reports

Step 1 is then the first thing the case actually verifies, and its `Where:`
still names the route — so a tester who wasn't there after all gets the Go
control anyway, one line down.

**An address in a prerequisite must resolve absolute.** That block is
rendered Markdown with no page behind it, so a bare `/admin/reports` has no
origin to resolve against: it points at the side panel itself, and at the
repo host when the file is read on GitHub. The standard
`%BASE_URL%/admin/reports` substitutes to an absolute URL before anything
renders; a literal absolute URL is for another system's page.

Keep navigation as a step only when arriving at the page *is* what is under
test — a redirect, a deep link, a permission gate on first load. Then it has
a real `### Expected` and earns its verdict.

### 2b. Every step's `Where:` names its route

`Where:` is the route or screen the tester must already be on. Never make
them infer location from prose, and never let a step begin somewhere the
previous step didn't leave them.

    ## Sync the customer's events
    Where: %BASE_URL%/admin/sync-console
    Selector: #sync-events-btn

**Write it as an address whenever the place has one.** A `Where:` that
substitutes to an absolute URL, or a local address like
`localhost:3000/admin`, gets a Go control in the run screen that navigates
the tab the run is using — one click instead of retyping a path. Prose
gets nothing.

For the app under test that address is `Where: %BASE_URL%/admin/sync` —
rule 2's one form, substituted before the run starts, so Go works from a
blank tab and the viewer has a real URL to link. A bare `/admin/sync`
resolves only against whatever page the tester already has open, and
refuses when there is none; it survives in older cases, not in new ones.

Prose is the last resort, not the default for everything outside the app. A
third-party console has URLs too, and the record inside it has a URL that
differs every run — which is what variables are for:

    Where: %CONTACT_URL%                       (a variable holding the record's URL)
    Where: the CRM's web console → Contacts    (only when nothing addressable exists)
    Where: terminal, in the deployed app's project root

A step whose `Where:` differs from the previous step's is a move, and that
line is how the tester makes it. So it must be an address there above all: a
prose `Where:` on a step that changes location leaves them to find their own
way, silently.

### 2c. A place named in prose carries its link

The `Where:` line already says where the tester is and hands them Go, so
instructions that restate it — *Navigate to the settings page.* — add a
sentence and no address. Delete them. A step's instructions start at the
action.

When prose names a *second* place, link it:

    Open [the contact record](%CONTACT_URL%) in a second tab.
    Confirm the job cleared in [the worker dashboard](https://jobs.example.com/queues).

`%BASE_URL%`-built or literal absolute, for the same reason as 2a. And a
fragment href is not a page link: `[the Sync button](#sync-btn)` is a
Highlight control, per rule 3.

### 2d. The case says who the tester is

The entry URL without the account is an invitation to a login screen — the
first unanswerable question a first-time runner hits. When the app needs a
login, a prerequisite names the account, its role in the app's own words,
and where the credential lives:

    # Prerequisites
    - Logged in at %BASE_URL%/login as %QA_EMAIL% (role `Administrator`) —
      password: vault item `staging QA bot`

**The credential's location is a place, not a person.** A vault item, a
seed command, a fixtures file — never "ask Alex". A real production
credential never goes in a case file; a throwaway test-environment one in
a variable's `Default:` is the team's call, made once in the rules file's
*Accounts and data* section — which is also where the account facts come
from at authoring time, so an author copies instead of guessing.

When login *is* what is under test, it is steps, as today. When the app
has no login, the case says nothing and the author answers the linter's
question once.

## 3. Every UI step carries a `Selector:`

The extension scrolls the selector into view and flashes it. This is the
single highest-value field in the grammar for "don't make me think", and
it is the one most often skipped.

Take the selector from source — a `data-testid`, an `id`, a stable
`aria-label`. Never invent one, and never use a brittle structural path
like `div > div:nth-child(3) > button`. If the element genuinely has no
stable handle, that is a finding worth a `### Note` and often worth a
`data-testid` in the app; say so rather than guessing.

### Fallbacks: repeat the line, best handle first

`Selector:` may appear several times on one step. Highlight tries them in
order and stops at the first that matches:

    Selector: [data-testid="sync-console"]
    Selector: #sync-console
    Selector: .modal--sync [role="tablist"]

Write a fallback when — and only when — the first selector can genuinely
miss: the element lives in a **modal, drawer or portal** that renders under a
different root; the exact handle is **in your branch but may not be deployed**
where the tester runs; or it is a **framework-generated class or id**, stable
within a build but not across them.

Do not pad a step with three variations of the same reliable handle — every
fallback is a claim that the one above it can fail. Two entries is usually
the whole of it.

**Most specific and most stable first, loosest last.** A loose selector
first will match something *plausible* and flash the wrong element, which is
worse than not matching at all.

**One line is always one selector, even with commas.** `.a, .b` is a CSS
group, and the browser returns whichever comes first in the *document*, not
the one you wrote first. Ordered fallback needs separate lines.

### Selectors named in prose are clickable too

The side panel turns a selector written as inline code anywhere in a
step's instructions, `### Expected` or `### Note` into a Highlight
control. So a step that mentions a second element in passing —

    Confirm the row appears in `[data-testid="connections-table"]`.

— gives the tester a way to find that element without it competing with
the step's own `Selector:`, which stays the element the step *acts on*.
For prose instead of a raw selector, link it: `[the Sync button](#sync-btn)`.

This changes nothing about how you write. Keep quoting visible labels in
backticks (`` `Save changes` ``) — those are left as plain code, because
only text that could not be a label is treated as a selector. The one
thing to avoid is inventing a selector for prose value.

## 3b. Mark the core path with `Kind: quick`

A case is authored once, in full. `Kind: quick` on a step says it is part of
the core path, and a **quick run** executes only the marked steps — the
version a developer runs against their own branch in two minutes, without
anyone writing a second case.

Mark a step when a failure there means the feature does not work at all:

    ## Sync the contact
    Where: %BASE_URL%/admin/sync-console
    Kind: quick
    Selector: #sync-crm-mailer-btn
    Click `Sync CRM → Mailer`.

Do not mark: edge cases, error states, permission variants, empty states,
regression checks for old bugs, or anything about a second actor. Those are
why the full case exists.

Cleanup steps are the one judgement call. Mark them if the quick path leaves
state behind — a quick run that cannot be repeated is worse than a slow one,
and rule 8 does not stop applying because the run was short.

Aim for **3–7 marked steps**. One is not a path; if half the case is marked,
nothing has been decided and a quick run costs what a full one does. Suite
prep steps are never filtered, so do not mark them to "make sure they run" —
they always do.

A case with no marks is full-only, which is a fine answer for a case that is
all edge cases.

## 4. `### Expected` is pass criteria only

Bullets. Observable. Binary. A tester reading only the Expected block must
be able to decide Pass or Fail without reading anything else.

Bad — assertion buried in rationale and history:

> ### Expected
> The modal opens immediately and finishes loading within a few seconds — it
> must NOT hang, spin indefinitely or time out. (This regression-checks a
> real bug: the lookup used to walk the whole account's event history…)

Good:

> ### Expected
> - The modal opens and finishes loading (spinner gone) within 5 seconds.
> - Two columns are shown, headed `CRM` and `Mailer`.
> - Each column lists that system's calls, emails, tasks and meetings,
>   newest first.
> - A system with no matching record shows `No events found.` rather than
>   an error.
>
> ### Note
> Regression check. The lookup used to walk the account's entire event
> history before filtering to one customer, which could exhaust the
> request's time limit. Now bounded to 24 months with a hard page cap.

Prefer exact quoted strings, counts, and thresholds over adjectives. "The
button shows a spinner" is checkable; "the UI responds appropriately" is
not. Where a duration matters, give a number.

## 5. Rationale goes in `### Note`, never in Expected

`### Note` is for what a tester might want but must not need: why the
check exists, what bug it guards, a caveat about flaky data. It is
rendered dimmed and is explicitly skippable.

## 6. Test data is resolved before the run, never during it

Every variable in `# Variables` gets one of:

- a `Default:` literal, or
- a `Generator:` line, or
- a description saying **exactly how to obtain the value**, including
  where to look.

Bad:

> ## TEST_COMPANY_QUERY
> Name or domain of a company that exists in the CRM but has no matching
> local Organization record yet.

That is a research task, mid-run. Good:

> ## TEST_COMPANY_QUERY
> Name or domain of a CRM company with no matching local Organization.
> To find one: Sync Console → search `Company` → pick any result whose
> local column reads `(not found)`. Record it here before starting the run.
> Default: Acme Corp

### Every literal a tester types is quoted and bolded

Any value they must enter — into a field, a select, a search box, a command
— is written as `"**value**"`: double quotes around a bolded run, holding
exactly what should be typed.

    Put "**Buy milk**" in the task title field.
    Set `Priority` to "**High**".
    Search for "**qa.bot@example.com**".

Not: *Put value Buy milk in input.* Where the value ends is then the
tester's guess.

The markup is not decoration — the panel turns each one into a control that
inserts the value into the next field the tester clicks. It takes **both**
marks because either alone is something people already write for other
reasons, and this is a different mark from backticks:

| Mark | Means | Panel behaviour |
| --- | --- | --- |
| `"**quoted bold**"` | a value to **type** | insertable into a field |
| `` `backticked` `` | a label or heading to **find** on screen | plain text |
| `` `#selector` `` | an element to **find** in the DOM | Highlight control |
| `**bold**` alone | emphasis | plain text |
| `"quoted"` alone | ordinary punctuation | plain text |

So: ``Set `Priority` to "**High**"`` — `Priority` is the field's visible
label, `"**High**"` is the option to choose. Marking the label as a value or
backticking the value inverts both behaviours. (Why this pair and not a
sigil: `rationale.md`.)

For a value that comes from a variable, mark up the placeholder:
`Enter "**%TEST_EMAIL%**"`. It is substituted before the run, so the tester
sees and inserts the real value.

Values are insertable wherever they appear in a running case — instructions,
`### Expected`, `### Note`.

## 7. No conditionals inside a step

"If a second enabled account exists, do X" makes the tester decide. Make
it its own step whose title states the condition, so it can be marked
Skipped as a first-class outcome:

> ## (Only if a second enabled connection exists) Account-scoped webhook stays scoped

## 8. State cleanup explicitly

If the run leaves anything behind — a created account, a synced record, a
changed CRM property — the last steps must undo it, or a `### Note` on
the creating step must say what is left and why that's acceptable. A case
that can't be run twice in a row is a case that will be run once.

---

## Checking a finished case

Two lists, and the split is what makes this cheap. **The validator checks the
mechanical half** — run it, read what it says, and do not re-walk those items
by hand:

> missing or prose `Where:` · a bare-route `Where:` · addresses with no
> `BASE_URL` declared, or `BASE_URL` without a default · missing
> `Selector:` · structural selectors ·
> "then" in instructions · instructions restating the navigation · a step 1
> spent on arriving · no entry point in `# Prerequisites` · nothing says
> who the tester is in the app · a bare route in a
> prerequisite · `### Expected` missing, prose rather than bullets, carrying
> rationale, or using an unmeasurable adjective · a variable with no way to
> get its value · an undeclared `%NAME%` · a missing `@project` or title
> prefix · `@version` drift · a `Kind: quick` subset that does not parse to
> the marked steps

### The by-eye list

These are the ones no tool can settle, because they need the app's source or
a judgement about the case. Check every step against them:

- [ ] A UI label, route, or selector appears that was not read from source
- [ ] A screen, record or external page is named in prose with no address
      beside it, where one exists
- [ ] An address in a Markdown link is a bare route rather than an absolute
      URL or `%BASE_URL%/…`
- [ ] A value the tester must type is not written as `"**value**"`
- [ ] A visible label is marked up as a value, or a typed value is in
      backticks
- [ ] Instructions list more than ~3 discrete actions
- [ ] A step body contains "if", "or", "optionally" in a way that makes
      the tester choose
- [ ] More than half the steps are marked `Kind: quick`, or an edge case,
      error state or permission variant is marked
- [ ] A service the tester must start is missing from `# Prerequisites`,
      or is listed without the command that starts it
- [ ] A prerequisite names an account whose credential lives with a person
      to ask, not in a place to look
- [ ] A step lists fallback `Selector:` lines that are near-duplicates of
      each other, or puts the loosest one first
- [ ] The run leaves state behind with no cleanup step and no `### Note`
      acknowledging it

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

That sentence is the whole of Enloop's manifesto (`MANIFESTO.md` at the
repo root) applied to one step: a human verifying a flow puts in **zero
effort** beyond doing what the step says. They are never asked to decide,
to provide information, or to look anything up — every address, value,
account and selector was resolved before the case was written, and a
value that cannot be resolved then is a defect in the case, never a
question to the tester. Each rule below closes one place where a human
would otherwise have to stop and think.

Read this before writing any step, and check every finished step against
the by-eye list at the bottom.

## 0. A case is a goal; the tester knows what they will do and need

A case proves one **goal**, stated in one plain line a person who has
never seen the app understands on sight. It is pinned on screen for the
whole run, so no click is ever made without knowing what it is for:

    Goal: A user can sign in with either of their two email addresses

Under the title, beside `Tags:`. Not the description — the description is
background (which ticket, why now); the goal is what finishing the case
proves. A goal longer than a line is two cases, or a case with groups.

Two more things are read before Start:

    You will: log in and out several times, change the primary and secondary email

    # You will need
    - Access to the mailbox that receives the confirmation codes

`You will:` is one line on the *shape* of the work, so nothing mid-run is
a surprise. `# You will need` lists what must be in the tester's **hands**
before step 1 — a mailbox, a second browser, a phone — as distinct from
`# Prerequisites` (where the run begins, who the tester is, what to
start) and `# Dependencies` (what must already be true). It renders open
above Start everywhere; a code that lands in a mailbox nobody opened is
a step failed for no reason.

Both header lines are required (the linter refuses a case without them);
`# You will need` is present whenever the answer is not "nothing". When
the case has groups (rule 9), each group's goal is a **subgoal** of this
one: *Manage primary and secondary email*, *Log in with either*, *Reset
the password for either*. A step that serves no subgoal does not belong.

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
> - Open %DOMAIN%/admin/integrations
>
> ## Open the new-connection form
> Where: %DOMAIN%/admin/integrations
> Selector: button[data-testid="add-connection"]
> Click `Add connection`.
>
> ### Expected
> - A form appears with `Kind`, `Enabled`, `Name`, `Client ID`,
>   `Client Secret` and `Endpoint URL` fields.
>
> ## Save the new connection
> Where: %DOMAIN%/admin/integrations
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
`Where:` line, in a prerequisite, or as a link — and every address is the
**domain** plus a route:

    %DOMAIN%/admin/reports

`%DOMAIN%` is the deployment under test and is **never declared**: it is
empty by default, and a run fills it with the tab the tester starts from
— their branch, a review app, a local dev server, a customer's instance —
unless they type an address or pick an environment on the case screen. A
case guesses no host, so a wrong guess can never make it unrunnable. What
the case *does* say is where it is meant to run, as an `@locations:` line
under the title:

    # Shop: Save a widget
    @project Shop
    @locations: localhost:3000, *.shop.example

Comma-separated host globs — `*` matches anything, a port counts when
written, no scheme. It gates nothing: every address the panel, the viewer
and a downloaded copy build is shown **green** when its host fits one of
the globs and **red** when it fits none, and the link opens either way.
Its first entry without a `*` is also the address a reader with no open
app starts from — the viewer, a downloaded file, the linter's cold run.
Take the hosts from the project's environments (`enloop-case.mjs
environments <folder> "<project>"`): the local port, the staging host,
prod as a wildcard when the case may run there. When the project has none
recorded, derive them from the repo — `.env.example`, deploy config, the
README — and record them there with the same command, so the next case
finds them. Never ask the user for an address.

A scenario may cross hosts — *place the order at `%DOMAIN%/orders`, then
check the audit trail at `%ADMIN%/audit`* — and each step's `Where:` says
which. A **second** host is the one thing `# Domains` is for:

    # Domains

    ## ADMIN
    The admin console.
    Match: admin.*.example.test
    Default: https://admin.staging.example.test

One entry per extra deployment, with the `Default:` a cold reader uses
and the `Match:` that lets a run started from that console's tab fill it.
A second domain is never "the same app, different path" — a path under the
same host is a route on `%DOMAIN%`.

A page of a system the case does not otherwise name — a third-party
console, a mailbox — keeps its literal absolute URL. A bare route —
`Where: /admin/reports` — is the legacy form: the panel resolves it against
the main domain and nothing else can, and the linter says so. Prose alone
is for places that genuinely have no address. `%BASE_URL%` is the
pre-`DOMAIN` spelling of the same placeholder: undeclared it behaves
exactly like `%DOMAIN%`; declared as a variable with `Generator:
page-origin` (the oldest form) it still runs, the linter flags it, and the
next sweep rewrites it as `%DOMAIN%`. A declared `## APP` main domain from
the pre-`DOMAIN` convention keeps working too; new cases write
`%DOMAIN%`.

### A value the run produces is not part of an address

An address is only an address when every part of it is known before the
run. The id of a user step 2 creates, the URL of the record step 4 opens —
those exist only once the run has made them, so no variable can hold them
and no `Default:` can stand in:

    Where: %DOMAIN%/user.php?user=%USER_ID%          (never — nobody can fill it)

A placeholder left in an address is a link the panel refuses to open, and
a `Default:` invented to quiet the linter is worse: a link that opens the
wrong page and reads right. Write where the tester clicks, and give the
address *shape* as help, in backticks so no renderer links it:

    Where: %DOMAIN%/admin/users
    Selector: [data-testid="users-table"]
    Click the row for "**%NEW_USER_EMAIL%**" in `[data-testid="users-table"]`
    (opens `/user.php?user=<id>`).

The step still says where it starts (`Where:` is the list, which *is*
known), the tester still has a Highlight, and the URL pattern is there for
anyone who lands somewhere unexpected.

### 2a. The entry point is a prerequisite, not a step

Most runs start with the tester already in the app, often on the very screen
the case is about. A case whose step 1 is `## Open the Reports page` spends
its first Pass/Fail on something that was true before the run began. Put it
where "what had to be true before step 1" already lives:

    # Prerequisites
    - Open %DOMAIN%/admin/reports

Step 1 is then the first thing the case actually verifies, and its `Where:`
still names the route — so a tester who wasn't there after all gets the Go
control anyway, one line down.

**An address in a prerequisite must resolve absolute.** That block is
rendered Markdown with no page behind it, so a bare `/admin/reports` has no
origin to resolve against: it points at the side panel itself, and at the
repo host when the file is read on GitHub. The standard
`%DOMAIN%/admin/reports` substitutes to an absolute URL before anything
renders; a literal absolute URL is for another system's page.

Keep navigation as a step only when arriving at the page *is* what is under
test — a redirect, a deep link, a permission gate on first load. Then it has
a real `### Expected` and earns its verdict.

### 2b. Every step's `Where:` names its route

`Where:` is the route or screen the tester must already be on. Never make
them infer location from prose, and never let a step begin somewhere the
previous step didn't leave them.

    ## Sync the customer's events
    Where: %DOMAIN%/admin/sync-console
    Selector: #sync-events-btn

**Write it as an address whenever the place has one.** A `Where:` that
substitutes to an absolute URL, or a local address like
`localhost:3000/admin`, gets a Go control in the run screen that navigates
the tab the run is using — one click instead of retyping a path. Prose
gets nothing.

For the app under test that address is `Where: %DOMAIN%/admin/sync` —
rule 2's one form, substituted before the run starts, so Go works from a
blank tab and the viewer has a real URL to link. A bare `/admin/sync`
resolves only against whatever page the tester already has open, and
refuses when there is none; it survives in older cases, not in new ones.

Prose is the last resort, not the default for everything outside the app. A
third-party console has URLs too, and a record inside it that exists
before the run has a fixed URL a variable can hold:

    Where: %CONTACT_URL%                       (a variable with a real Default: — the seeded record)
    Where: the CRM's web console → Contacts    (only when nothing addressable exists)
    Where: terminal, in the deployed app's project root

A record the run *creates* has no such URL — see rule 2's last section:
`Where:` is then the list it appears in, and the record's address is a
shape in backticks.

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

`%DOMAIN%`-built or literal absolute, for the same reason as 2a. And a
fragment href is not a page link: `[the Sync button](#sync-btn)` is a
Highlight control, per rule 3.

### 2d. The case says who the tester is

The entry URL without the account is an invitation to a login screen — the
first unanswerable question a first-time runner hits. When the app needs a
login, a prerequisite names the account, its role in the app's own words,
and where the credential lives:

    # Prerequisites
    - Logged in at %DOMAIN%/login as "**%QA_EMAIL%**" (role `Administrator`),
      password "**%QA_PASSWORD%**"

**The credential is a value, not a place to look.** A test account's
password is a variable the environment provides
(`enloop-case.mjs environments <folder> "<project>" --variable QA_PASSWORD
--env staging --set QA_PASSWORD=…`), written as a typeable value so the
panel puts it in the field. A vault reference ("vault item `staging QA
bot`") is a lookup, and the linter warns on it; keep one only for a
deployment whose credentials must not be recorded — production — and say
so in a `### Note`. A real production credential never goes in a case
file or an environment; a throwaway test-environment one is the team's
call, made once in the rules file's *Accounts and data* section — which
is also where the account facts come from at authoring time, so an author
copies instead of guessing.

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
    Where: %DOMAIN%/admin/sync-console
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

## 3c. Mark optional side-checks with `Kind: extra`

The opposite dial. `Kind: extra` says the check is worth keeping in the case
but no run is required to make it: it stays in the list, numbered with a
minor increment under the ordinary step before it (2.1, 2.2), and starts the
run already marked skipped — the tester opts in by giving it a verdict.

    ## Create account
    Where: %DOMAIN%/accounts
    Selector: [data-testid="create-account"]
    ...

    ## Check the account picture is set
    Kind: extra
    Selector: [data-testid="account-avatar"]
    ...

Mark a step `extra` when it is conditional ("only if a second enabled
account exists"), when it verifies polish rather than function, or when it
needs data or access not every tester has. A step has one `Kind:` — quick or
extra, never both — and extra steps are never part of a quick run.

Testers can also skip any step mid-run, and skips are reported to the test
writer: a step that arrives skipped run after run should become `Kind:
extra` or be removed. Do not pre-empt that by marking half the case extra —
an extra step is one you have decided may be declined, not one you doubt.

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

## 6. Test data is resolved before the run, never during it — and by Enloop, never by asking

Every variable in `# Variables` gets one of:

- a `Default:` literal, or
- a `Generator:` line, or
- a value in the project's environments — its name recorded in
  `environments.json` with a value per deployment, because a QA account
  on staging is not the QA account on prod.

Nothing else passes. A description telling the tester where to look is a
question with extra steps; a variable left for the user to fill in at
authoring time is a question asked earlier. **You resolve it**: read the
fixture, the seed, the `.env.example`, the rules file's *Accounts and
data* section, and write what you found. When a value genuinely differs
per deployment, record it per environment
(`enloop-case.mjs environments <folder> "<project>" --variable NAME --env
staging --set NAME=value`) and say in the report which environments still
have it empty. When a value cannot be known from the repo at all, the case
still gets a `Default:` — the best candidate you found, marked in the
report as an assumption — never a blank.

The one thing that is not a variable at all is a value **the run itself
produces**: the id the app assigns to the record step 2 creates, the token
in the email step 5 sends. No default is honest for it, and a placeholder
for it inside an address is a link to nowhere (rule 2, last section).
Refer to the record by what the tester *can* see — the name they typed,
the row in the table — and keep the value out of `# Variables`.

Bad:

> ## TEST_COMPANY_QUERY
> Name or domain of a company that exists in the CRM but has no matching
> local Organization record yet.

That is a research task, mid-run — and the linter rejects it. Good:

> ## TEST_COMPANY_QUERY
> A CRM company with no matching local Organization — seeded by
> `fixtures/crm.yml` as the one company without an `organization_id`.
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
it its own step whose title states the condition, marked `Kind: extra` so
skipping it is the default rather than a verdict the tester must spend:

> ## (Only if a second enabled connection exists) Account-scoped webhook stays scoped
> Kind: extra

## 8. State cleanup explicitly

If the run leaves anything behind — a created account, a synced record, a
changed CRM property — the last steps must undo it, or a `### Note` on
the creating step must say what is left and why that's acceptable. A case
that can't be run twice in a row is a case that will be run once.

---

## 9. Group steps that prove one thing together

A case that covers a broad change — "the email refactoring" — is a set of
concerns, not one list: log in, restore a password, change the address.
Write each concern as a **group**: a `# Steps: <title>` section that opens
with its **goal**, one or two sentences on what the steps under it prove
together, before the first `## ` step.

```markdown
# Steps: Restore password

The reset mail reaches the migrated address and its link signs the user in.

## Request a reset link
Where: %DOMAIN%/forgot
...
```

- The goal is required — a heading with no goal is a label, and the
  linter refuses it. It says what the group establishes in the big
  picture, not what the steps do; the steps already say that.
- Group titles name the concern (`Log in`, `Restore password`), not the
  ticket or the screen. One heading per group: a title used twice is an
  error, since a group's steps sit together.
- Groups are headings over one list. Steps keep numbering through them,
  every step still meets rules 1–8, `Kind: quick` and `Kind: extra` are
  still per step, and a quick run drops a group with no quick step in it.
- A plain `# Steps` holds what belongs to no concern — shared setup before
  the first group, cleanup after the last. Use it rather than forcing a
  fixture reset into "Log in".
- Do not group a case with one concern. Every step in the one group means
  the group is the case; the linter warns, and the description already
  carries the goal.

The reports lean on this: the run screen heads each group with its goal
and tally, and `report.md` / `feedback.md` open with a **By group** list.
That list is what tells a reader "restore password is broken, log in is
fine" — and it can only say that if the groups were drawn around real
concerns.

## Checking a finished case

Two lists, and the split is what makes this cheap. **The validator checks the
mechanical half** — run it, read what it says, and do not re-walk those items
by hand:

> a missing `Goal:` or `You will:` line, a goal too long for one line ·
> missing or prose `Where:` · a bare-route `Where:` · addresses built
> without a domain, `%DOMAIN%` used with no `@locations:` line, a location
> that is not a host glob, a declared domain without a `Default:`, a
> default that is not an origin, a name declared as both domain and
> variable, `BASE_URL` still written as a variable · a valueless
> placeholder inside an address · missing
> `Selector:` · structural selectors ·
> "then" in instructions · instructions restating the navigation · a step 1
> spent on arriving · no entry point in `# Prerequisites` · nothing says
> who the tester is in the app · a bare route in a
> prerequisite · `### Expected` missing, prose rather than bullets, carrying
> rationale, or using an unmeasurable adjective · a variable with no
> `Default:`, no `Generator:` and no environment providing it · an
> undeclared `%NAME%` · a missing `@project` or title
> prefix · `@version` drift · a `Kind: quick` subset that does not parse to
> the marked steps

### The by-eye list

These are the ones no tool can settle, because they need the app's source or
a judgement about the case. Check every step against them:

- [ ] A UI label, route, or selector appears that was not read from source
- [ ] A screen, record or external page is named in prose with no address
      beside it, where one exists
- [ ] An address carries a value the run produces — a created record's id,
      a generated token — behind a `Default:` invented to pass the linter
- [ ] An address in a Markdown link is a bare route rather than an absolute
      URL or `%DOMAIN%/…`
- [ ] A step points at a second deployment (an admin console, another
      tenant) through a literal URL instead of a declared domain
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
- [ ] A variable's value was asked of the user, or left for the tester,
      rather than read from the repo, the rules file or the environments
- [ ] A step lists fallback `Selector:` lines that are near-duplicates of
      each other, or puts the loosest one first
- [ ] The run leaves state behind with no cleanup step and no `### Note`
      acknowledging it

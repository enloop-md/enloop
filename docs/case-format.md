# The case format

One Markdown file per case. This is the reference; the spec itself is the doc
comment at the top of [`shared/src/markdown.ts`](../shared/src/markdown.ts) —
that comment is the thing to read when writing cases by hand.

A complete case, end to end:

```markdown
# Careerminds: Sync a contact from the CRM to the mailer
@version 0.0.9
@author Your Name
@project Careerminds
Tags: sync-console, integrations, manual
@locations: localhost:8000, staging.careerminds.test, *.careerminds.com
Goal: A contact synced from the CRM appears in the mailer
You will: press one sync button and check two admin screens

Verifies the single-contact sync path added in PROJ-1234.

# You will need
- Access to the mailer's admin (the QA account is in the case)

# Domains

## MAILER
The mailer's own admin, where the synced contact shows up.
Match: mailer.*
Default: https://mailer.staging.careerminds.test

# Variables

## TEST_CONTACT_EMAIL
Email of a contact present in both the CRM and the mailer.
Default: qa.bot@example.com

# Prerequisites
- Open %DOMAIN%/admin/sync-console
- Logged in as a super-admin — password: vault item `staging admin`

# Steps

## Check the account picker
Where: %DOMAIN%/admin/sync-console
Selector: #account-tabs
Read the tabs across the top of the console.

### Expected
- The account picker renders as tabs.
- Each tab shows the account name with its sync purpose beneath it.

## Sync the contact
Where: %DOMAIN%/admin/sync-console
Selector: [data-testid="sync-crm-mailer"]
Selector: #sync-crm-mailer-btn
Click `Sync CRM → Mailer`.

### Expected
- A spinner appears on that button only.
- A toast reports synced / skipped / failed counts.

### Note
Regression check — this button used to stay disabled when the local column
had no match, even though the sync creates the record.

## Check the contact on the mailer side
Where: %MAILER%/contacts
Via: Mailer admin → Contacts
Selector: [data-testid="contact-search"]
Search for "**%TEST_CONTACT_EMAIL%**".

### Expected
- One contact is listed, with today's date as its last update.
```

That file is what an agent writes, what the side panel executes step by step,
and what you commit next to the code it tests.

## The fields

Under the title: `Goal:` (one plain line — what finishing the case proves,
pinned on screen for the whole run), `You will:` (one line on the shape of
the work, read before Start), and `# You will need` (what must be in the
tester's hands before step 1, rendered open above Start). The description
is background; the goal is its own line. See [MANIFESTO.md](../MANIFESTO.md)
for why a tester reads these four things before pressing Start.

`@kind guide` under `@project` marks a **guide**: a case whose prose is
addressed to an end user rather than a tester. The grammar is unchanged;
the panel reads *Done / Could not* and *You should see*, and the linter
stops asking for quick marks. See [screenshots and guides](guides.md).

Key fields: `Where:` (the route or screen the tester starts from), `Via:`
(how that page is reached in the app's own menus — required when a step
moves to a new page, since the address may be for another environment;
`Via: link only` when the UI has no path), `Selector:`
(the extension scrolls it into view and flashes it), `### Expected` (pass
criteria only), `### Note` (background, rendered dimmed), `### Photo` (what
the runner should photograph for this step — see below). A fenced code block
in place of instructions makes the step **automated** — the script runs in the
page's own world with DOM access and calls `api.fail(msg)` to fail the step.

## Photos

A step may carry one or more `### Photo` blocks — `Key: value` lines, all
optional — saying what the runner should capture when the step runs and how
to mark it up:

```markdown
### Photo
Crop: [data-testid="order-form"]
Callout: [data-testid="order-customer"] — Customer
Callout: [data-testid="order-save"] — Save
Blur: [data-testid="order-card-number"]
Take: after
Mode: confirm
Caption: The order form, ready to save
```

`Crop:` is the container to cut to (the viewport when absent, `Pad:` CSS
pixels around it); `Mark:` boxes an element, `Point:` arrows at one,
`Callout:` puts a numbered disc on one with the text after ` — ` as its
legend, `Blur:` pixelates one — each a selector, each repeatable, resolved
on the live page when the photo is taken. `Take:` is `after` (the verdict),
`before` (the step becoming current) or `manual` (a button); `Mode:` is
`confirm` (shown first) or `auto`; `Color:` one of the palette. The n-th
block fills **`%PHOTO_n%`** wherever it is written in the step's
instructions or `### Expected` — that is where the picture goes when the
run is exported as a guide, and the panel shows a `📷 n` chip there.
`PHOTO_` is a reserved prefix: never a variable, never substituted, never
an undeclared-variable finding. A block with no placeholder lands after the
instructions. Linter rule `10` refuses a `%PHOTO_n%` with no n-th block and
a selector both blurred and called out. The whole feature — modes, the
editor, the export — is in [screenshots and guides](guides.md).

## Selectors

Selectors named in a step's *prose* are clickable too: inline code that can
only be a selector (`#sync-btn`, `[data-testid="row"]`, `.modal .btn`) renders
as a Highlight control, as does a link written `[the Sync button](#sync-btn)`.
Nothing declares this and no existing case needs changing — it is recognised
from the text, and deliberately strict, so visible UI labels in backticks
(`` `Save changes` ``), ticket refs (`#1234`), routes and filenames stay plain.

`Selector:` may be repeated. The candidates are tried **in order** and the
first one that matches the page wins, so a step can name an exact handle and
fall back to a looser one when the element sits in a modal or its `data-testid`
has not been deployed yet. The run screen shows which candidate matched. A
single line is always one selector even when it contains commas — `.a, .b` is a
CSS group, and the browser returns whichever comes first in the document, not
the one written first.

## `Where:` and the Go control

A `Where:` that names an address — `%DOMAIN%/admin/sync`, an absolute URL,
or a local address — gets a **Go** control in the run screen that navigates
the tab the run is using — the same tab Highlight and automated steps act
on, so opening the page leaves you where the next step expects. The
`%DOMAIN%/…` form is the standard one: substituted before the run starts,
it works from a blank tab and links in the viewer, and the panel colours it
by the case's `@locations`. A bare route (`/admin/sync`) resolves against
the case's main domain, or, for a case declaring none, against whatever
page is open — the legacy form, kept working for older cases. An address
still holding a `%NAME%` the run could not fill gets no Go control: the
panel will not open `/user.php?user=%USER_ID%` literally.

The contract's wider rule is that **every place a case names carries its
address** — never "navigate to the Reports page" with the path left to memory.
Where the app has no address for a place (a third-party console, a terminal),
prose is correct; where it has one, prose is a defect.

## Values the tester types

Every literal a tester must type is written in **double quotes** —
`Put "Buy milk" in the task field`. The side panel turns each quoted value into
a control: click it and the next input, textarea or **select** you click on the
page receives the value, with the events a React- or Vue-controlled field needs
to register the change. A select is matched by its visible option text, since
that is what an author quotes. There's a copy fallback for anywhere the
extension can't reach.

The two marks are not interchangeable: backticks mean *find this* (a visible
label, or a selector — which gets a Highlight control), double quotes mean
*type this*. ``Set `Priority` to "High"`` reads correctly in both directions.

## Quick and full runs

`Kind: quick` on a step marks it as part of the core path. A case is authored
**once, in full**; starting a run then offers **Quick** (only the marked steps)
or **Full** (all of them), so a developer checking their own branch gets a
two-minute run without anyone writing a second case. Suite prep steps always
run. The tier is recorded on the run and shown in the report, the run header and
run history — a quick pass and a full pass are not the same evidence.

## Extra steps, and skipping

`Kind: extra` is the opposite dial: an optional side-check the case is better
for carrying but no run is required to make. It stays visible in the run,
numbered with a minor increment under the ordinary step before it —

```
1    Open accounts page
2    Create account
2.1  Check account picture is set        (extra)
2.2  Check "test connection" button      (extra)
3    Create X in account
```

— and starts the run already marked **skipped**; the tester opts in by giving
it a verdict. Conditionals ("only if a second account exists"), nice-to-verify
polish checks, and steps that need data not every tester has are what it is
for. A step carries one `Kind:` — quick or extra, not both — and extra steps
are never part of a quick run.

Any step can also be skipped mid-run: a small **Skip this step** link sits
under the Pass/Warning/Fail buttons. A skip is recorded, not discarded —
skipped ordinary steps land in `feedback.md` addressed to the test writer,
because a step that arrives skipped run after run is telling you it should be
`Kind: extra` or gone.

## Groups

A case that covers a broad change — an email refactoring, say — is really a
handful of concerns: log in, restore a password, change the address. Writing
it as one flat list of twenty verdicts hides that. A **group** is a
`# Steps: <title>` section whose opening prose is the group's **goal** — what
its steps prove together — followed by its `## ` steps:

```markdown
# Steps

## Reset the fixture user
...

# Steps: Log in

The login form accepts the migrated address and rejects the old one.

## Log in with the new address
...

## Log in with the old address
...

# Steps: Restore password

The reset mail reaches the migrated address and its link signs the user in.

## Request a reset link
...
```

Groups are headings over **one** list, not lists of their own: steps keep
numbering through them, `Kind:` marks apply per step, and a quick run drops
a group whose steps were all filtered out. A plain `# Steps` holds ungrouped
steps and may sit before or between groups — shared setup, cleanup. The
linter requires a goal under every group heading and refuses a group with
no steps or a title used twice; a case whose every step is in the one group
gets a warning, because that group is the case.

The run screen heads each group's steps with its title, goal and a running
tally; `report.md` and `feedback.md` open with a **By group** list — one
line per group with its goal and how its steps ended — so a reader sees
that *restore password* is broken while *log in* is fine before reading a
single step.

## Prerequisites, project, domains and variables

`# Prerequisites` is where the run begins, who the tester is in the app, and
which services they must start themselves — the address for the first; the
account, its role, and where the credential lives (a vault item or a seed
fixture, never a person to ask) for the second; the command for each of the
rest. The entry point lives here rather than in a step, because a tester is
usually already in the app and a step spent on arriving is a Pass/Fail on
something that was already true. An address here is absolute or
`%DOMAIN%`-built: unlike a step's `Where:`, this block has no open page to
resolve a bare route against. The run screen renders Prerequisites and
Dependencies together in a **"Before you start"** block, collapsed by default —
most runs happen against an environment that is already up, so it stays out of
the way of the current step without being absent, which is what it was before.

`@project` names the app under test. One connected folder usually holds cases
from several repos, so the skills also prefix the title with it — that is what
makes a case findable in the side panel, which lists cases **most recently
updated first**. It is also what scopes environments: a project's staging is
offered to that project's cases.

### `%DOMAIN%` and `@locations`: where a case runs

Every address in a case is `%DOMAIN%` plus a route — `Where:
%DOMAIN%/orders`, `- Open %DOMAIN%/admin`, a link in prose. `%DOMAIN%` is
the deployment under test and needs no declaration. It is **empty by
default, and when empty a run takes the tab you start it from** — scheme,
host and port — so one case runs against your branch, a review app, a
local dev server or a customer's instance without being edited. Typing an
address under **Start run**, or picking an environment, overrides the tab.
A case guesses no host, so a wrong guess can never make it unrunnable.

Write the route with its leading slash and do not worry about the other
side: an address that ends in one — pasted from a browser bar, typed into an
environment card, written as a `Default:` — loses it at the seam, so
`%DOMAIN%/orders` is `https://app.test/orders` either way and never
`https://app.test//orders`. Nothing is added, only the duplicate removed:
`%DOMAIN%?next=/x` and a `%HOST%:8080` join stay exactly as written.

What a case does say is where it is *meant* to run, in one line under the
title:

```markdown
@locations: localhost:8080, staging.acme.test, *.acme.com
```

Comma-separated host globs: `*` matches any run of characters,
case-insensitively; a port is compared when the pattern names one; a
pattern containing `/` is checked against the whole address. The line
gates nothing. Every address the run screen, the online viewer and a
downloaded page build is shown **green** when its host fits one of the
globs and **red** when it fits none — and it still opens either way,
because a tester on an unusual tab may mean it. The `DOMAIN` field on the
case screen shows the same verdict before the run starts. The first entry
with no `*` is also what `%DOMAIN%` resolves to where there is no tab to
read: the viewer, a downloaded copy, the linter's cold run. Leave the line
out and nothing is coloured.

`%BASE_URL%` is the older spelling and keeps working: undeclared it
behaves exactly like `%DOMAIN%`; declared as a variable with
`Generator: page-origin` it resolves as it always did, and the linter asks
for `%DOMAIN%`.

### Domains: a second host

```markdown
# Domains

## MAILER
The mailer's own admin, where the synced contact shows up.
Match: mailer.*
Default: https://mailer.staging.example.test
```

`# Domains` is for a deployment **other than** the one under test — an
admin console on its own host, a second tenant, the site a flow signs in
from. A declared domain is used the same way, as an address prefix
(`Where: %MAILER%/contacts`), and a scenario walks between hosts: *place
the order at `%DOMAIN%/orders`, then check the audit trail at
`%ADMIN%/audit`*. `DOMAIN` itself may be declared here to give it a
description or a `Default:`; declared or not, it is the **main** domain,
the one a bare route resolves against. A case from before `DOMAIN` existed
that declares `## APP` first keeps `APP` as its main domain.

A domain is not a variable. It has no generator, and its address is decided
per run by the **environment** the tester picks on the case screen — local,
staging, prod, or any custom set of addresses — recorded in the connected
folder's `environments.json` (**Settings → Environments** in the panel, or
`enloop-case.mjs environments` from a skill). Resolution, first hit wins:

1. a value typed on the case screen under **Start run** (a blank field
   counts as nothing typed);
2. the picked environment's address for that domain;
3. with **no** environment picked, the open tab's origin — for `DOMAIN`,
   for the main domain, or for any domain whose `Match:` glob accepts the
   tab's host;
4. the `Default:`;
5. for `DOMAIN`, the first concrete `@locations` entry;
6. nothing, in which case `%ADMIN%` stays literal in the run.

`Default:` is what a run from a blank tab, the online viewer and a
downloaded page use, so a declared domain carries one — the address of the
deployment the project normally tests against, which the skills copy from
the default environment. `Match:` is what lets you start a run from
whichever tab you have open without the panel taking the admin console's
tab for the app. The run screen names the environment in its header, and
the report lists the address each domain resolved to.

### Variables: everything else, resolved by Enloop

Variables declared under `# Variables` resolve when a run starts and every
`%NAME%` placeholder in the document is substituted with the result: title,
instructions, selectors, and scripts included. **Every variable is resolved
before the run and never asked of the tester**: it carries a `Default:`, or a
`Generator:`, or its name is one the project's environments provide — an
environment carries variables as well as domains, so `%QA_EMAIL%` can differ
between staging and prod. A variable with none of the three is a linter
error, and the authoring skills read the value from the repo (a fixture, a
seed, the project's rules) rather than asking anyone for it. The case screen
shows the resolved values under **Start run** and lets you override any of
them first, but it never stops the run to ask. A variable that ends up with
no value is left alone, so the step reads `%NAME%` rather than a blank where
a value should have been.

"Provided by the environment" has to mean provided. With the data folder in
view — `--data-dir`, which the skills always pass — the linter refuses a
case whose environment-provided variable or domain has a value in **no**
environment of its project: the name is in the contract, nothing holds a
value, and the run would have to ask. When some environments have it and
others do not, it warns and names the ones with the hole, since a run
there will ask. The value comes from a seed or fixture, or from a
**lookup** recorded on the environment — `lookups: { QA_EMAIL: "select
email from users …" }` — a read-only `select` the validator runs through
the environment's reach and writes back with `lookup … --record`. A
production environment answers a lookup only when asked with
`--production`, and what it answers is never recorded: the value stays
with the tester.

```markdown
## QA_EMAIL
The QA account — provided per environment.
Default: qa.bot@staging.example.test

## RUN_TAG
A fresh suffix so the run's records are telling apart.
Generator: random-string 6
```

Generators: `timestamp` (epoch ms, or ISO text with arg `iso`),
`random-number` (arg `min-max`), `random-string` (arg = length), and the page
generators `page-url`, `page-origin`, `page-domain`, which read the active tab
when the run starts. `page-domain` (the bare host, no scheme and no port) is
for a value that is *about* a host — a tenant name, an email suffix — not for
an address; addresses are domains.

A value **the run itself produces** — the id of a user created in step 2,
the URL of a record that does not exist until the case makes it — is not a
variable, and never goes into an address. `Where: %DOMAIN%/user.php?user=%USER_ID%`
is a link nobody can fill; a `Default:` invented to satisfy the linter opens
a wrong page that reads right. The case says where the tester clicks and
gives the address shape as help in backticks, which no renderer links:
*Click the new user's row in `[data-testid="users-table"]` (opens
`/user.php?user=<id>`)*. The linter refuses a valueless placeholder inside
an address, and the panel refuses to open one.

### Before `%DOMAIN%` existed

A case written against an older format declares `BASE_URL` under
`# Variables` with `Generator: page-origin` and a `Default:`, or declares
the app as `## APP` under `# Domains`. Both still parse and still run
exactly as before; the linter asks for `BASE_URL` to become `%DOMAIN%`, and
the **check** skill's sweep rewrites it. In the panel, a legacy `BASE_URL`
counts as the main domain for bare routes.

## Suites

**Suites** are folders with a `suite.md` holding shared setup; each case inside
inherits the suite's prep steps (prefixed `Prep:`), variables, dependencies, and
prerequisites when a run starts.

## The step contract

The contract is what makes the output executable rather than merely plausible.
It is a real file — [`step-contract.md`](../plugins/enloop/references/step-contract.md)
— and it is the thing to edit when cases come out wrong.

The rules, in brief:

1. One step is one action with one observable result. If it contains "then",
   split it.
2. Every place is an address, written `%DOMAIN%/route` — the undeclared
   domain of the tab the run starts from, with `@locations:` naming the
   hosts the case is meant for; a declared domain only for a second host.
   The entry point is a `# Prerequisites` bullet, not a first step; every
   step states where it starts via `Where:`; a place named in prose
   carries a link. A value the run produces never goes in an address.
3. Every UI step carries a `Selector:`, taken from source — never invented,
   never a structural path. Repeat the line for ordered fallbacks when the
   element can genuinely move (a modal, a portal, a handle not yet deployed),
   best first.
4. `### Expected` holds binary, observable pass criteria as bullets. Nothing
   else.
5. Rationale, regression history, and caveats go in `### Note`.
6. Test data is resolved before the run, by Enloop. A variable gets a
   default, a generator, or a value per environment — never "find a company
   that…" mid-run, and never a question to the user at authoring time.
7. No conditionals inside a step. A conditional becomes its own step, usually
   `Kind: extra` so it is skipped unless it applies.
8. Cleanup is explicit. A case that can't be run twice will be run once.

It ends in two lists the skill checks before writing anything: the mechanical
half, which `enloop-case.mjs validate` enforces and names the offending step
for, and a by-eye half that needs the app's source or a judgement about the
case. If the generated cases drift, tighten those rather than re-explaining
the goal in the prompt — and prefer tightening the linter, since a rule in
code is checked identically every time and costs no context.

---

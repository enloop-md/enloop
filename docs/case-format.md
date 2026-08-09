# The case format

One Markdown file per case. This is the reference; the spec itself is the doc
comment at the top of [`shared/src/markdown.ts`](../shared/src/markdown.ts).

A case is one Markdown file. The full grammar is the doc comment at the top of
[`shared/src/markdown.ts`](../shared/src/markdown.ts) — that comment is the spec,
and it is the thing to read when writing cases by hand.

```markdown
# Careerminds: Sync a contact from the CRM to the mailer
@version 0.0.3
@author Your Name
@project Careerminds
Tags: sync-console, integrations, manual

Verifies the single-contact sync path added in PROJ-1234.

# Variables

## TEST_CONTACT_EMAIL
Email of a contact present in both the CRM and the mailer.
Default: qa.bot@example.com

# Prerequisites
- Open https://admin.example.com/admin/sync-console
- Logged in to the admin as a super-admin

# Steps

## Sync the contact
Where: /admin/sync-console
Selector: [data-testid="sync-crm-mailer"]
Selector: #sync-crm-mailer-btn
Click `Sync CRM → Mailer`.

### Expected
- A spinner appears on that button only.
- A toast reports synced / skipped / failed counts.

### Note
Regression check — this button used to stay disabled when the local column
had no match, even though the sync creates the record.
```

## The fields

Key fields: `Where:` (the route or screen the tester starts from), `Selector:`
(the extension scrolls it into view and flashes it), `### Expected` (pass
criteria only), `### Note` (background, rendered dimmed). A fenced code block
in place of instructions makes the step **automated** — the script runs in the
page's own world with DOM access and calls `api.fail(msg)` to fail the step.

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

A `Where:` that names a route, an absolute URL, or a local address gets a **Go**
control in the run screen that navigates the tab the run is using — the same tab
Highlight and automated steps act on, so opening the page leaves you where the
next step expects. A bare route resolves against whatever page is open and
refuses rather than guesses when there is nothing to resolve against; write
`Where: %BASE_URL%/admin/sync` when a case has to be certain.

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


## Prerequisites, project and variables

`# Prerequisites` is where the run begins and where services the tester must
start themselves belong — the address for the first, the command for each of
the rest. The entry point lives here rather than in a step, because a tester is
usually already in the app and a step spent on arriving is a Pass/Fail on
something that was already true. An address here is absolute or
`%BASE_URL%`-built: unlike a step's `Where:`, this block has no open page to
resolve a bare route against. The run screen renders Prerequisites and
Dependencies together in a **"Before you start"** block, collapsed by default —
most runs happen against an environment that is already up, so it stays out of
the way of the current step without being absent, which is what it was before.

`@project` names the app under test. One connected folder usually holds cases
from several repos, so the skills also prefix the title with it — that is what
makes a case findable in the side panel, which lists cases **most recently
updated first**.

Variables declared under `# Variables` resolve when a run starts — from their
generator, or their default — and every `%NAME%` placeholder in the document is
substituted with the result: title, instructions, selectors, and scripts
included. The case screen shows the resolved values under **Start run** and
lets you override any of them first, but it never stops the run to ask. A
variable that ends up with no value is left alone, so the step reads `%NAME%`
rather than a blank where a value should have been.

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
2. Every place is an address. The entry point is a `# Prerequisites` bullet,
   not a first step; every step states where it starts via `Where:`, as a
   route wherever the app has one; a place named in prose carries a link.
3. Every UI step carries a `Selector:`, taken from source — never invented,
   never a structural path. Repeat the line for ordered fallbacks when the
   element can genuinely move (a modal, a portal, a handle not yet deployed),
   best first.
4. `### Expected` holds binary, observable pass criteria as bullets. Nothing
   else.
5. Rationale, regression history, and caveats go in `### Note`.
6. Test data is resolved before the run. A variable gets a default, a
   generator, or explicit instructions for obtaining it — never "find a company
   that…" mid-run.
7. No conditionals inside a step. A conditional becomes its own skippable step.
8. Cleanup is explicit. A case that can't be run twice will be run once.

It ends in a reject list the skill checks mechanically before writing
anything. If the generated cases drift, tighten that list rather than
re-explaining the goal in the prompt.

---

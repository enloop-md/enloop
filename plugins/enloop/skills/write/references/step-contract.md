# The step contract
<!-- Read by the enloop:write skill. Also the reference enloop-demo
     should follow for any case it writes. -->


The rule every step in an authored test case must satisfy. The goal is a
case a tester can execute without thinking — no inference, no hunting, no
deciding. If a tester has to stop and work something out, the case is
wrong, not the tester.

Read this before writing any step, and check every finished step against
the Reject list at the bottom.

## 1. One step = one action = one observable result

A step is the unit a tester marks Pass or Fail. If a step contains two
things that could independently fail, it cannot be marked honestly.

Bad — seven actions, one verdict:

> Navigate to `/admin/integrations`. Click `Add connection`. Leave `Kind`
> at its default, check `Enabled`, set `Name` to %CONNECTION_NAME%, fill
> the required `Client ID` / `Client Secret` / `Endpoint URL` fields, and
> click `Save`.

Good — split, each with its own verdict:

> ## Open the integrations admin page
> Where: /admin/integrations
> Navigate to the page.
>
> ### Expected
> - The connections table renders with an `Add connection` button above it.
>
> ## Open the new-connection form
> Where: /admin/integrations
> Selector: button[data-testid="add-connection"]
> Click `Add connection`.
>
> ### Expected
> - A form appears with `Kind`, `Enabled`, `Name`, `Client ID`,
>   `Client Secret` and `Endpoint URL` fields.

Filling a single form is one step even though it touches several fields —
the fields are one action with one result. Navigating, opening a form, and
submitting it are three.

**Test:** if the instructions contain " then ", " and then ", or a
numbered list of more than about three keystroke-level actions, split it.

## 2. Every step says where it starts

Use the `Where:` line for the route or screen the tester must already be
on. Never make them infer location from prose, and never let a step begin
somewhere the previous step didn't leave them.

    ## Sync the customer's events
    Where: /admin/sync-console
    Selector: #sync-events-btn

When a step happens outside the app under test — in a third-party console,
a terminal, a mail client — say so explicitly:

    Where: the CRM's web console → Contacts → the %TEST_EMAIL% contact
    Where: terminal, in the deployed app's project root

A step whose `Where:` differs from the previous step's must begin by
getting there. Don't leave the tester to navigate silently.

## 3. Every UI step carries a `Selector:`

The extension scrolls the selector into view and flashes it. This is the
single highest-value field in the grammar for "don't make me think", and
it is the one most often skipped.

Take the selector from source — a `data-testid`, an `id`, a stable
`aria-label`. Never invent one, and never use a brittle structural path
like `div > div:nth-child(3) > button`. If the element genuinely has no
stable handle, that is a finding worth a `### Note` and often worth a
`data-testid` in the app; say so rather than guessing.

## 4. `### Expected` is pass criteria only

Bullets. Observable. Binary. A tester reading only the Expected block must
be able to decide Pass or Fail without reading anything else.

Bad — assertion buried in rationale and history:

> ### Expected
> The modal opens immediately and finishes loading within a few seconds —
> it must NOT hang, spin indefinitely, time out, or crash the page. (This
> step regression-checks a real bug: the lookup used to walk the whole
> account's event history across every event type before filtering to this
> one customer, which could exhaust the request's memory/time limit on any
> account with real history — it's now bounded to the last 24 months with a
> hard page cap.) Two columns, "CRM" and "Mailer", each list that system's
> calls/emails/tasks/meetings...

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
> history across every type before filtering to one customer, which could
> exhaust the request's time limit on any account with real history. Now
> bounded to 24 months with a hard page cap.

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

## Reject list

Before writing the file, check every step. Any hit means fix it:

- [ ] Instructions contain " then " or list more than ~3 discrete actions
- [ ] A UI step has no `Selector:`
- [ ] Any step has no `Where:`
- [ ] `### Expected` is prose rather than bullets
- [ ] `### Expected` contains "why", "used to", "this regression-checks",
      or any parenthetical longer than a clause — move it to `### Note`
- [ ] `### Expected` uses an unmeasurable adjective (quickly, properly,
      correctly, appropriately, as expected) with no observable behind it
- [ ] A variable has no `Default:`, no `Generator:`, and no explicit
      instructions for obtaining the value
- [ ] A step body contains "if", "or", "optionally" in a way that makes
      the tester choose
- [ ] A UI label, route, or selector appears that was not read from source
- [ ] The run leaves state behind with no cleanup step and no `### Note`
      acknowledging it

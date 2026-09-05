# The Enloop manifesto

<!-- For every agent working on or with Enloop: this is the principle the
     rest of the repo serves. When a rule in the grammar, the step contract,
     the linter or the panel seems arbitrary, it is an application of what
     is written here. When a proposed change conflicts with it, the change
     is wrong, not the manifesto. Read it once per session; it is short. -->

## The goal

Enloop exists to help a human **verify a feature as a flow** — start at the
top, follow it to the end, and know at each step whether what they see is
right. Everything else in the project — the case grammar, the side panel,
the viewer, the authoring skills, environments — is there to remove
whatever could break that flow.

**Any friction is a defect.** Not a cost to be weighed against a benefit:
a defect, to be found and removed the way a stale selector is.

## The human puts in zero effort

From the moment a person opens the extension, or opens a case file, they
should be able to follow the script with no effort beyond doing what it
says. Concretely, the human is **never**:

- **asked to make a decision** — which environment, which account, which
  record, whether a step applies. The case decided; an optional check is
  marked `Kind: extra` and starts skipped.
- **asked to provide information** — a URL, an id, a password's location,
  a value to type. Every value was resolved before the run began.
- **asked to look anything up** — a route from a menu, a fixture from a
  seed file, an address from a README. If it can be looked up, it was
  looked up when the case was written, and the case carries the result.

The human **may not know the system under test**, and may not know Enloop.
The case is written for that person: someone who has never seen the app,
never read its docs, and is not going to learn either before the test
starts. Starting a run and following it must feel easy and natural — open
the panel, press Start, do what step 1 says. If a tester has to stop and
work something out, the case is wrong, not the tester.

## The tester knows what they are doing, and what they need, before they start

A case is not a list of steps; it is a **goal**, and the steps are how the
goal is proved. The goal is short and plain — one line a person who has
never seen the app understands on sight — and it stays **on screen for the
whole run**, above whatever step is current, so nobody ever wonders what
the click they are about to make is for.

When the goal is large, its steps fall into **subgoals**, several steps
each, and every subgoal is stated the same way: one line, what those
steps prove together. For the goal *User can use two emails*:

- Manage primary and secondary email
- Log in with primary and secondary email
- Reset password for primary and secondary email

Before pressing Start, the tester also reads two short lines that turn
the goal into expectations about the next few minutes:

- **During this test you will** — *log in and out several times, change
  the primary and secondary email.* The shape of the work, so nothing
  that happens mid-run is a surprise.
- **You will need** — *access to a mailbox that receives confirmation
  codes.* Everything that must be in the tester's hands before step 1,
  so they get it now, not halfway through a step with a timer running.

Goal, subgoals, what you will do, what you will need: four things, each
a line or a short list, all visible before the run and the first of them
visible throughout. They are what let someone start a run with nothing to
work out — and what the steps are then judged against: a step that serves
no subgoal does not belong in the case.

In the grammar these are the case description (the goal), `# Steps:
<title>` groups with their opening prose (the subgoals), and
`# Prerequisites` (what you will need). What you will *do* is the one
line the grammar does not carry yet.

## What this means for a case

- **Every place carries its address.** `%DOMAIN%/route`, filled from the
  tab the run starts from, so the case never guesses a host and a wrong
  guess can never make it unrunnable. `@locations:` says where it is meant
  to run, and the panel colours every address green or red so the tester
  sees a wrong tab before clicking — and is still allowed to click.
- **Every value is defined and provided before the case is written.** A
  variable has a `Default:` read from the repo, a `Generator:`, or a value
  per environment recorded in `environments.json`. A variable with none of
  these is refused by the linter. A value the run itself produces — a
  created record's id — is not a variable at all and never appears in an
  address; the case says where to click and gives the shape as help.
- **Every element the tester acts on has a selector** the panel can flash,
  read from source, never invented.
- **Every literal to type is marked** so the panel types it for them.
- **Every pass criterion is observable and binary**, so the verdict needs
  no judgement.
- **Cleanup is explicit**, so the case can be run again without anyone
  working out what it left behind.

These are the step contract's rules (`plugins/enloop/references/step-contract.md`).
They are not style; each one closes a place where a human would otherwise
have to stop and think.

## Creators and consumers

Two kinds of people meet around a case, and they may be very different
people with very different tools.

- **Creators** write cases: a developer running `/enloop:quick` from the
  repo, an agent doing it for them, someone filling in the builder. Their
  tool is a skill or a form; their artifact is a Markdown file.
- **Consumers** follow cases: a QA engineer with the extension, a product
  manager with a link, a customer's admin with a downloaded page. Their
  tool is whatever they already have open; their artifact is the same
  file, rendered.

A **developer is both at once**. They know the system, so mid-run they may
notice a step is wrong and fix it for themselves — the panel lets a case
be edited and hot-swapped during a run for exactly this. That is the one
consumer who is allowed to think, because they are acting as a creator at
that moment. Every other consumer gets the zero-effort guarantee in full.

The rule for both sides is the same rule: **using the tool must be easy,
and the artifact must be easy to use.** A skill that needs a repo of
Enloop on disk, a build step or a question answered before it writes is
friction on the creator. A case that needs an install, an account, a
folder to find or an environment to pick before step 1 is friction on the
consumer. Neither is acceptable, and neither side's convenience may be
bought with the other's effort: a creator never leaves a value for the
consumer to fill in, and a consumer never has to learn the creator's
tools to follow what they made.

## The first minute

Onboarding is the flow before the flow, and it is judged the same way.
Three people arrive at Enloop from three directions, and each must be
able to start with nothing to work out:

1. **A team ships cases with the project.** The cases live in the app
   repo, next to the code they test, and arrive with a clone. A QA
   engineer installs the extension, points it at that folder — or at the
   repository itself — and the Library is full. No copying, no import
   step, no instructions beyond "install and point".
2. **A case is shared with someone who will not install anything.** A
   product manager gets a link, or an HTML file. It opens in the browser
   they already have, reads as a checklist, ticks off, copies values and
   opens the addresses. The link carries the case; there is nothing to
   sign in to and nothing that expires.
3. **Someone curious installed a skill and generated a case.** The moment
   the case is written, the same message tells them exactly how to run it
   — a link they can open right now with nothing installed, and the two
   steps to run it in the extension when they want the panel — so
   "I have a file, now what?" never happens.

Creator or consumer, the first minute must need no decision, no
information and no lookup, just like every step after it.

## Where this leads

The principle that *every value exists before the case does* is the basis
of what comes next:

- **Environment studio** — a place to define and maintain the deployments,
  accounts and data a project's cases run against: which hosts, which QA
  users, which seeded records, which values differ between local, staging
  and prod. Environments stop being a JSON file a skill happens to write
  and become the thing cases are written *from*.
- **Environment agent** — an agent that gathers what the studio needs
  without anyone typing it: reads the repo, the seeds, the fixtures, the
  deploy config, and the running app itself, and answers "which account is
  an administrator on staging" the way a colleague who set it up would.
- **A map of the project** — Enloop learns the app once: its hosts, its
  routes, its screens, its entities and how they connect. Cases are then
  written against that map and to each other — a case that creates an
  order knows the case that ships one — instead of each case being built
  alone from a fresh reading of the source. Familiarity with the system
  moves from the tester's head, where it should never have been, to Enloop.

Every step toward those is measured the same way as everything here: does
the human, opening the panel, have less to do than before?

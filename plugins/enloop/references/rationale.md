# Why the step contract is shaped this way

<!-- Nothing loads this file while authoring, deliberately. It is here for the
     person deciding whether a rule is right, or wondering why an obvious
     simpler alternative was not taken — read it once, argue with it, change
     the contract if you win. An agent following the contract does not need it,
     and a justification re-read on every session is a justification paid for a
     thousand times to change nothing. -->

The rules themselves are in `step-contract.md`. This is the reasoning behind
the ones whose shape looks arbitrary until you know what it is protecting.

## Why a typed value is `"**quoted bold**"` and not a sigil

The mark has two jobs at once, and they pull in opposite directions.

**It must be unambiguous to the extension.** The panel turns each marked value
into a control: clicking it arms the page, and the next input, textarea or
select the tester clicks receives the value — with a copy fallback for anywhere
the extension cannot reach. That only works if the mark cannot be tripped by
ordinary prose. Quotes alone are punctuation — *the row shows "Undefined
property"* quotes an error message, not a value to type. Bold alone is
emphasis. Requiring the pair means the author opts in deliberately and never
trips it by accident.

**It must also read correctly to people who never open the extension.** A case
file is read on GitHub, in editors, in code review far more often than it is
run. `"**Buy milk**"` renders as a quoted value with the value emphasised in
any Markdown viewer. A sigil like `(!)"Buy milk"` would parse just as well and
would litter the text for every human reader.

So the pair is the cheapest mark that is unambiguous to a parser and invisible
as markup to a reader. That is the whole argument; if a better one exists it
has to satisfy both halves.

## Why `Selector:` fallbacks are ordered, and why order is a claim

Highlight stops at the first selector that matches the page. That makes a list
of selectors a ranking, not a set, and a loose entry at the top is worse than
no entry at all: it matches something *plausible* and flashes the wrong
element, so the tester looks at the wrong thing with full confidence. A miss is
honest; a wrong match is not.

It also makes every fallback a claim that the line above it can fail. Three
variations of the same reliable `data-testid` are three claims nobody meant to
make, and they turn "matched #3 of 3" — which should tell the tester the DOM
moved — into noise.

The comma case is the same mistake in one line. `.a, .b` is a CSS group, and
the browser returns whichever comes first in the *document*, not the one you
wrote first. Ordered fallback needs separate lines, and a comma silently gets
you document order instead.

## Why the entry point is a prerequisite rather than step 1

A step is a unit of verdict. `## Open the Reports page` spends one on something
that was usually true before the run began — most runs start with the tester
already in the app, often on the very screen the case is about — and pushes the
real work down a step. Prerequisites is where "what had to be true before step
1" already lives, so the entry point costs nothing there and the case starts at
its first real assertion.

Nothing is lost for the tester who *wasn't* already there: step 1's `Where:`
still names the route, so the Go control is one line down.

## Why warnings are not errors, and must not be silenced

The linter splits its findings by what a machine can be certain of, not by
severity. A prose `Where:` is wrong for `/admin/reports` and right for a
terminal; nothing in the tool can tell those apart. So warnings exist to be
answered, and the answer is sometimes "correct as written".

The failure mode this guards against is an author editing a case until the tool
goes quiet, which trades a real judgement for a green tick and produces a case
that passes the linter and misleads the tester. A case that ships with warnings
unread is exactly what the contract exists to prevent — but so is one where
they were made to disappear.

## Why the reject list is split

Half of it is now `enloop-case.mjs validate`, which checks those items faster,
identically every time, and names the step for each. The half that remains
needs the app's source (an invented label, a selector that is not in the repo)
or a judgement about the case (is this step really the core path?), and no
amount of parsing reaches either.

Keeping the mechanical items in the prose list as well would cost their length
in context on every authoring session and invite the agent to re-derive by hand
what a tool just answered — usually less reliably, since a checklist walked
across twenty steps is exactly the kind of work attention runs out on.

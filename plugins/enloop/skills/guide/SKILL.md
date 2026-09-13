---
name: guide
description: Write a user guide for Enloop — a case in `@kind guide` form, addressed to an end user rather than a tester, for a feature or flow in the app repo you are currently in, with `### Photo` specs so the runner takes and marks up the screenshots itself. Every route, label and selector is derived from source. The guide is run in the extension like any case and `export-guide` turns the run into a Markdown folder or an HTML page. Use when the user asks for a user guide, how-to, walkthrough, onboarding doc or help-centre article.
disable-model-invocation: true
allowed-tools: Read Grep Glob Write Edit Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(rg *) Bash(node *) Bash(mkdir -p *)
---

# Write a user guide

A guide is a case whose reader is the end user: the same grammar, the same
panel, the same run — but the prose tells someone how to *use* the feature,
and every step that changes the screen says what to photograph. The tester
runs it once; the runner takes the pictures; `export-guide` turns the
finished run into a document with the screenshots in place. Nobody opens a
screenshot tool.

$ARGUMENTS is the scope: a feature name, a flow, a ticket id, a branch, or a
free-text description of what the reader should learn to do.

**If it is empty, it was probably an autocomplete sent too soon** — Enter
pressed on `/enloop:guide` while thinking of the completion. Do not stop
at an open question, and never proceed on an empty scope. Derive the
likeliest scope first:

```bash
git rev-parse --abbrev-ref HEAD && git log --oneline -3 && git status --porcelain | head -5
```

On a feature branch, the likeliest scope is that branch's diff against the
default branch; on the default branch, the uncommitted changes when there
are any, else the last commit. Ask one closed question naming it — *"Write
the guide for `feat/coupon-banner` ('Add coupon banner', 3 commits)?
Yes — or name a ticket, branch or feature instead."* — and wait for the
answer. A yes costs one keystroke; a guessed scope costs a whole guide.

## Then check that the feature is finished

A guide is written once, on the final version of the feature, right
before the push that ships it. Its screenshots are the UI at the moment
of the run; a label renamed afterwards makes every picture that shows it
wrong, and nobody runs a guide twice to find out. Cases are written
early and often — a guide is the last thing written for a feature.

So look before writing:

```bash
git status --porcelain | head -20
git log --oneline -5
```

If the tree has uncommitted changes to UI files, or the branch is
visibly mid-work (a WIP commit, a failing case in the folder for this
scope), say so in one line and ask one closed question — *"The branch
still has uncommitted UI changes; a guide photographs the UI as it is.
Write it now anyway, or after the last change lands?"* — and wait. On a
clean tree, or when the user says now, proceed without comment.

## First, print the brief

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" brief
```

(`$ENLOOP_PLUGIN` is the installed plugin root, two levels above this
skill's folder.) It prints a minimal case that parses clean and the hard
rules — the floor under everything below. A guide is a case: everything the
brief says still holds.

## Then follow the procedure

Read `../../references/authoring.md` — the plugin's `references/` folder,
two levels above this one — and follow it in full. Its table at the top has
a **guide** column; that is the column you are in. It says what a guide
covers, that it builds no app map, carries no quick marks, and carries
`### Photo` specs — the keys are in `grammar.md`, which the procedure has
you read anyway.

Two lines the procedure does not add on its own:

- The header carries `@kind guide`, after `@project`. That is what makes
  the panel say **Done / Could not** instead of Pass / Fail and **You
  should see** instead of Expected, and what lets the linter stop asking
  for quick marks.
- Every route, label and selector still comes from source read in this
  session. A guide that names a button the app does not have is worse than
  a test case that does, because nobody runs a guide twice.

## Guide prose rules

Walk this list over every step before validating. The reader has never seen
the case, will never see the case, and is not testing anything — they are
trying to get something done.

1. Second person, present tense: *Open the Orders page*.
2. One action per step; the title is that action in imperative form.
3. `### Expected` says what the reader sees after the action, as
   bullets, in the words on screen. It exports as *You should see*.
4. No internal names in prose: no component, class, route parameter,
   ticket, branch, environment, selector. `Selector:` lines are still
   required on UI steps; they are never exported.
5. No "verify", "assert", "check that", "test".
6. `Goal:` is what the reader will have accomplished. `You will:` is the
   shape of the work in one line.
7. `# You will need` lists what a reader needs in hand, never test data.
8. No `Kind: quick`; `Kind: extra` marks a step the reader may skip and
   its first sentence says so.
9. `### Note` is not exported; author reminders only.

## Photo rules

The photos are the reason a guide is run in Enloop rather than typed into a
wiki. Each `### Photo` is a spec the runner resolves against the live page —
which container to cut to, which controls to number, what to hide — and the
picture lands where `%PHOTO_n%` is written.

1. Every step that changes what is on screen has one `### Photo` and a
   `%PHOTO_1%` in its instructions where the reader should look at it —
   usually right after the sentence that names the screen.
2. `Crop:` is the smallest container that still shows where the reader
   is: the form, the dialog, the card — not the whole viewport unless
   the step is about the whole page. Take the selector from source the
   way `Selector:` is taken.
3. `Callout:` each control the instructions mention, in the order the
   text mentions them, with the legend text being the control's label
   as the reader sees it. Reference them in prose as `(1)`, `(2)`.
4. `Mark:` the thing the reader should notice; `Point:` at something
   small or transient (a toast, a badge). At most three marks of any
   kind per photo — beyond that, split the step.
5. `Blur:` anything personal or secret that the sandbox will show: card
   numbers, emails of real people, tokens. Find them in source by the
   field they render.
6. `Take: after` when the photo shows the result of the action;
   `Take: before` when it shows where to click. `Mode: auto` only when
   the crop and marks are exact; leave `confirm` when unsure.
7. `Caption:` one line, what the reader is looking at, not what to do.

## Validate and land

Exactly as `authoring.md` §9–10 say: `validate` the scratch file with the
real parser, read the printout, answer every finding — rule `10` is the
photo rule, and it is an error when a `%PHOTO_n%` has no n-th `### Photo`
or a `Blur:` hides what a `Callout:` points at — walk the by-eye list, then
`write` it. The `write` command derives the id and the layout; never build
them by hand.

## Hand-off

Report as `authoring.md` §11 says — title, id, absolute path, the `cold
run` line, what you assumed — and then, verbatim:

Open the case in the Enloop panel and run it on the build that will ship —
the runner takes the photos; confirm or retake each. When the run is
finished, run `/enloop:export-guide`. If the feature changes after that,
run the guide again and export again; the pictures are the UI at the time
of the run.

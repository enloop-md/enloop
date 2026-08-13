---
name: quick
description: Write a quick test case for Enloop — the happy path only — covering a feature, ticket, or branch in the app repo you are currently in. Every route, UI label and selector is derived from that repo's source rather than recalled, and the finished case is parsed with the real grammar parser before it is written. Use when the user asks for a quick/short/smoke case, or wants to check their own branch in a couple of minutes — e.g. "quick case for PROJ-1234", "smoke test this branch". For the complete article with edge cases and cleanup, that is the full skill. Not for demo cases exercising the grammar itself; that is enloop-demo, which only runs inside the Enloop repo.
disable-model-invocation: true
allowed-tools: Read Grep Glob Write Edit Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(rg *) Bash(node *) Bash(mkdir -p *)
---

# Write a quick test case

The two-minute version: the path a developer walks to convince themselves
their own branch works. Authoring is the expensive part of testing, and the
full article is not what someone wants before pushing a change.

$ARGUMENTS is the scope: a ticket id, a branch, a feature name, or a
free-text description. If it is empty, ask what to cover before doing
anything else.

## What "quick" changes

Three things, and nothing else:

1. **Cover the happy path only.** No edge cases, no error states, no
   cleanup beyond what the path itself leaves behind.
2. **Do not build or refresh the app map.** Read only the screens the path
   touches. The map is the expensive step and it is not worth it here.
3. **Mark every step `Kind: quick`.** The whole case is the core path, so a
   quick run and a full run of it are the same thing.

Keep variables to what the path cannot run without. A quick case that stops
to ask for five values is not quick.

## First, print the brief

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" brief
```

(`$ENLOOP_PLUGIN` is the installed plugin root, two levels above this
skill's folder.) It prints a minimal case that parses clean and the hard
rules — the floor under everything below, pushed into context rather than
waiting to be read. It does not replace the procedure; it is what remains
standing if everything else gets skipped.

## Then follow the procedure

Read `../../references/authoring.md` — the plugin's `references/` folder,
two levels above this one — and follow it in full. It is the same procedure
the **full** skill uses; the table at the top is the only place the two
differ, and you have just been told which column you are in.

Nothing about being quick relaxes the rest: every route, label and selector
still comes from source, and the case is still parsed with the real parser
and checked against the step contract before it is written.
Quick means smaller, not looser.

## In your report

Say plainly that this is a quick case — that it covers the happy path, that
every step is marked `Kind: quick`, and that the **full** skill will extend
it in place with the edge cases and cleanup when it is worth doing. A reader
who does not know the case is deliberately partial will read a pass as more
evidence than it is.

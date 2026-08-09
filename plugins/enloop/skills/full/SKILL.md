---
name: full
description: Write a complete test case for Enloop — happy path plus edge cases, error states and cleanup — covering a feature, ticket, or branch in the app repo you are currently in. Every route, UI label and selector is derived from that repo's source rather than recalled, and the finished case is parsed with the real grammar parser before it is written. Extends an existing quick case in place rather than starting a second one. Use when the user asks to write/author/generate a test case, QA checklist, or manual verification plan — e.g. "write a test case for PROJ-1234", "full QA case for this branch". Not for demo cases exercising the grammar itself; that is enloop-demo, which only runs inside the Enloop repo.
disable-model-invocation: true
allowed-tools: Read Grep Glob Write Edit Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(rg *) Bash(node *) Bash(mkdir -p *)
---

# Write a full test case

The complete article: the happy path, the edges around it, the states where
it fails, and whatever has to be put back afterwards. This is the case that
outlives the branch it was written for.

$ARGUMENTS is the scope: a ticket id, a branch, a feature name, or a
free-text description. If it is empty, ask what to cover before doing
anything else.

## Check for a quick case first — this is the important one

Before writing anything, look for an existing case covering this scope. If
the **quick** skill already wrote one, **extend it with a new version**
rather than starting a second case:

- Keep its steps and their `Kind: quick` marks exactly as they are. Those
  marks are what makes a quick run of the finished case still mean
  something.
- Add the edge cases, error states and cleanup *around* them.
- Write it as `versions/v<n+1>.md` in the same case folder, with a
  `Change note:` line saying what the full pass added.

Two cases for one feature is the outcome the quick/full split exists to
avoid: the Library grows a near-duplicate, and nobody can tell which one is
authoritative.

## What "full" changes

Relative to a quick case, three things:

1. **Cover beyond the happy path** — the edge cases a reviewer would ask
   about, the error states the code actually has, and cleanup so the case
   can be run twice.
2. **Build or refresh the app map**, since you are reading enough of the app
   to make it pay for itself.
3. **Mark only the core path `Kind: quick`.** The marks pick out the subset
   worth running during development; if everything is marked, the tiering
   does nothing.

## Then follow the procedure

Read `../../references/authoring.md` — the plugin's `references/` folder,
two levels above this one — and follow it in full. It is the same procedure
the **quick** skill uses; the table at the top is the only place the two
differ, and you have just been told which column you are in.

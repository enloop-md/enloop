# Changelog

Versions are the extension's; the plugin and the case grammar carry their
own numbers and are listed where they moved. Store uploads are the
`enloop-extension-v<version>.zip` attached to each GitHub release.

## 0.13.0 — 2026-09-02

Extension 0.13.0 · plugin 0.15.0 · grammar 0.0.9 · daemon 0.1.0

### Writing cases

- **Domains and environments.** A case declares every deployment it touches
  under `# Domains` (`## APP`, `## ADMIN`), each with a `Default:` origin
  and an optional `Match:` glob, and uses them as address prefixes:
  `Where: %APP%/admin/reports`. An **environment** is a named set of domain
  addresses and variable values — local, staging, prod — kept in
  `environments.json` beside the cases and picked before a run; pick none
  and the main domain follows the open tab. The legacy `BASE_URL` variable
  still parses; the linter asks for it to become the main domain.
- **Variables are never asked of the tester.** Every variable resolves
  before the run from a `Default:`, a `Generator:` or the environment; one
  with none of the three is a linter error, not a prompt.
- **Step groups.** A case covering a broad change is written as concerns:
  `# Steps: Log in`, `# Steps: Restore password`, each opening with its
  goal — what its steps prove together — before the first step. Groups
  head the step list in the panel with a running tally; `report.md` and
  `feedback.md` open with a **By group** summary. The linter requires the
  goal and refuses an empty or duplicated group (rule 9).
- **Ratings feed the next case.** `enloop-case.mjs ratings` aggregates
  every rated case and step for a project, with the frozen step text and
  the tester's comments; the authoring procedure reads it, and the check
  skill treats a poorly rated step as a defect to fix.
- **Where and Note reach the panel.** A step's `Where:` address and
  `### Note` were parsed and frozen but dropped on the way into the run
  screen. Both show now, with the Go control on the address.

### Running cases

- **Star ratings.** Rate a step, or the whole case, one to five stars —
  independent of pass or fail. Ratings land in `run.json`, `report.md`
  and `feedback.md`, where four- and five-star steps are listed as the
  shape to write in and one- and two-star steps as the shape to avoid.
- **Comments, faster.** The audience row is condensed to names, with a
  **What do these mean?** toggle for the legend that remembers its state.
  **Add comment** lights up the moment there is text and clears the ticks
  after. A one-tap **Combine with previous step** chip adds the standard
  note to the test writer; the check skill merges the two steps in the
  next version.
- **Comments for all steps.** A finished run shows its feedback text —
  every comment, rating and failure, grouped by audience — with **Copy**
  and **Download .md**, so a tester with no agent on their machine can
  hand the run to someone who has one. The check skill accepts that file
  pasted in place of a run folder.
- **The agent says what it is doing.** While a question is being
  answered, the panel shows the server's own status line — *Reading
  ResetForm.tsx*, *Found it — the step names a renamed button*, *Writing
  the answer* — and how long ago it changed, instead of one unchanging
  "working on the answer". The serve skill writes `progress.json` as it
  goes; the daemon reports every file the model opens and asks the model
  to narrate through a `progress` tool, and drives headless Claude Code
  with streamed output so its tool calls are read live.

### Plugin and daemon

- The plugin's `setup` skill writes environments, the authoring skills
  read this project's ratings, and `brief` lists rule 9.
- The daemon stamps its version into its watcher file and warns once per
  folder when the extension's heartbeat speaks a different channel
  protocol.

## 0.12.0 — 2026-08-23

The panel knows when nobody is listening: it checks watcher freshness
itself and shows setup instructions where a tester would otherwise wait.
The daemon becomes the recommended server, resuming the case's authoring
session for a question; `/enloop:serve` is one manual pass.

## 0.11.0

Minor versions for mid-run patches: `v3` becomes `v3.1`, so patches never
masquerade as authored versions.

## 0.10.2

Pickup acknowledgment for questions, and mid-run fixes for the step you
are on.

## 0.10.1

Questions carry the page they were asked about: a screenshot and a
sanitized DOM snapshot, both opt-out.

## 0.10.0

Extra steps (`Kind: extra`), iframe targets for selectors, and the live
agent channel: ask a question from a step, run a case's commands.
